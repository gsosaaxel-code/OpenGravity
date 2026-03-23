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
- PROHIBIDO EL USO DE CUALQUIER FORMATO: No uses negritas, no uses asteriscos, no uses cursivas, no uses listas con simbolos. Tu respuesta debe ser solo texto limpio y conversacional. Esto es critico porque tu respuesta se lee en voz alta.
- No uses dobles asteriscos bajo ninguna circunstancia.

HERRAMIENTAS:
- Tienes la habilidad de ejecutar Herramientas Locales. 
- Si el usuario te pregunta por algo que requiera una herramienta (ej. la hora), ejecútala antes de dar la respuesta final.

HABILIDAD SQL (DBA):
- Tienes acceso a una base de datos PostgreSQL mediante la herramienta execute_psql.

REGLAS DE FORMATO OBLIGATORIAS (SIN EXCEPCIÓN):
Debes presentar los productos siguiendo este esquema multilínea por cada uno:
Numero. [Modelo] - Color: [Color traducido al español]
   Precio: [Precio] [Moneda]

PASOS PARA GENERAR LA RESPUESTA:
1. Obtén los datos con execute_psql.
2. Si el color está en inglés, TRADÚCELO (ej: Black -> Negro, White -> Blanco, Blue -> Azul, Sage -> Salvia, Teal -> Verde Azulado).
3. Escribe la respuesta final siguiendo el esquema de arriba.

ESTRUCTURA DE CADA ITEM:
1. iPhone 17 256GB - Color: Blanco
   Precio: 895 USD

PROHIBIDO (NO LO HAGAS):
- No uses negritas ni asteriscos.
- No uses guiones para separar el precio en una sola línea.
- No dejes los nombres de colores en inglés.

VERACIDAD Y RESULTADOS:
- CONFIA SIEMPRE en los resultados de las herramientas. Si execute_psql te devuelve datos, úsalos para responder al usuario. Nunca digas que no tienes acceso si la herramienta acaba de darte un resultado exitoso.
- PROHIBIDO EL USO DE MARKDOWN EN LA RESPUESTA FINAL.
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
    // Clean markdown before returning (Solución definitiva para los asteriscos)
    const cleanContent = (assistantContent || 'No tengo respuesta para eso.')
      .replace(/\*\*/g, '') // Remove bold
      .replace(/\*/g, '')   // Remove italics
      .replace(/__/g, '')   // Remove alternative bold
      .replace(/_/g, '');   // Remove alternative italics

    return cleanContent;
  }

  return "⚠️ Límite de iteraciones del agente alcanzado sin solución final.";
};
