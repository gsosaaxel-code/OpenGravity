import { getHistory, saveMessage } from './database.js';
import { generateResponse, LmMessage } from './llm.js';
import { executeTool } from '../tools/registry.js';

const SYSTEM_PROMPT = `
Eres OpenGravity, un asistente de IA local, seguro y escalable.
Tus respuestas deben ser claras y en español.
En esta arquitectura, tienes la habilidad de ejecutar Herramientas Locales en la máquina del anfitrión. 
Si el usuario te pregunta por algo que requiera una herramienta (ej. la hora), debes ejecutar la herramienta correspondiente.
Piensa paso a paso si es necesario.
`;

export const agentLoop = async (userId: string, currentMessage: string, maxIterations: number = 5): Promise<string> => {
  // 1. Save the new user message
  await saveMessage(userId, { role: 'user', content: currentMessage });

  let iteration = 0;
  
  while (iteration < maxIterations) {
    // 2. Fetch history (including the newly added message)
    const dbHistory = await getHistory(userId, 20);
    
    // Construct actual conversation array for the LLM
    const messages: LmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT.trim() },
      ...dbHistory
    ];

    console.log(`[Agent] Iteration ${iteration + 1}: LLM generation initiated...`);

    // 3. Call LLM
    const responseMsg = await generateResponse(messages);
    
    // Validate output safety
    if(!responseMsg) throw new Error("Recibido un mensaje vacío del LLM");

    // 4. Save LLM response to DB
    const assistantContent = responseMsg.content || null;
    const dbEntry: any = {
      role: 'assistant',
      content: assistantContent
    };
    
    // If the LLM decided to use a tool, handle it
    const hasToolCalls = responseMsg.tool_calls && responseMsg.tool_calls.length > 0;
    
    if (hasToolCalls) {
      dbEntry.tool_calls = responseMsg.tool_calls;
    }

    await saveMessage(userId, dbEntry);

    // 5. Check if we need to execute tools
    if (hasToolCalls) {
      console.log(`[Agent] Tool execution required (${responseMsg.tool_calls.length} tools)`);
      
      for (const toolCall of responseMsg.tool_calls) {
        const result = await executeTool(toolCall.function.name, toolCall.function.arguments);
        
        // 6. Save the tool result to the DB as a 'tool' message
        await saveMessage(userId, {
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id
        });
      }
      
      // We loop back to let the LLM see the tool responses
      iteration++;
      continue;
    }

    // 7. If no tool calls, we are done. Return the text content.
    return assistantContent || 'No tengo respuesta para eso.';
  }

  return "⚠️ Límite de iteraciones del agente alcanzado sin solución final.";
};
