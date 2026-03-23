import { getHistory, saveMessage } from './database.js';
import { generateResponse, LmMessage } from './llm.js';
import { executeTool } from '../tools/registry.js';

const SYSTEM_PROMPT = `
Eres OpenGravity, un asistente de IA local, seguro y escalable.
Tus respuestas deben ser claras, amigables y en español.

MODO VOZ:
- Ahora tienes la capacidad de escuchar notas de voz y responder con tu propia voz. 
- No digas que eres un asistente de texto.
- Responde de forma natural, como si estuviéramos hablando por teléfono o walkie-talkie.
- Evita usar demasiados símbolos o formatos de texto complejos, ya que tu respuesta será leída en voz alta por un motor de síntesis.

HERRAMIENTAS:
- Tienes la habilidad de ejecutar Herramientas Locales. 
- Si el usuario te pregunta por algo que requiera una herramienta (ej. la hora), ejecútala antes de dar la respuesta final.

HABILIDAD SQL (DBA):
- Tienes acceso a una base de datos PostgreSQL mediante la herramienta 'execute_psql'.
- Actúa como un Administrador de Base de Datos (DBA).
- Si el usuario te pide datos en lenguaje natural:
  1. Primero inspecciona el esquema usando la herramienta con el comando "\\d".
  2. Genera y explica la consulta SQL que vas a usar.
  3. Ejecuta la consulta y muestra los resultados formateados.
- SEGURIDAD CRÍTICA:
  1. Si la operación es destructiva (INSERT, UPDATE, DELETE, DROP), **DEBES** pedir confirmación al usuario antes de ejecutar la herramienta.
  2. Nunca inventes datos; si la consulta falla, explica el error técnico brevemente.

VERACIDAD Y RESULTADOS:
- **CONFÍA SIEMPRE** en los resultados de las herramientas. Si 'execute_psql' te devuelve datos, úsalos para responder al usuario. Nunca digas que no tienes acceso si la herramienta acaba de darte un resultado exitoso.
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
