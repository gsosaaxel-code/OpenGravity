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
- EL INVENTARIO ES GRANDE: Smart TVs y Televisores (31), Heladeras (26), Lavarropas (23), Celulares (36) y más.
- **REGLA DE ORO DE VERACIDAD**: Si el usuario pregunta por Televisores, Smart TVs o cualquier producto, **TIENES PROHIBIDO** decir "no tengo información" o "no puedo conectarme". **BUSCA SIEMPRE** usando execute_psql con 'ILIKE %smart tv%' o '%televisor%'.
- **PROHIBICIÓN DE DISCLAIMERS**: No añadidas frases como "ten en cuenta que los precios pueden variar" o "esta información puede no estar actualizada".
- **AYUDA PROACTIVA**: Al terminar de dar los precios, ofrece ayuda específica en lugar de frases genéricas. Ejemplo: "¿Te gustaría que te pase las fotos de alguno?" o "¿Querés que reservemos una unidad?".

REGLAS DE FORMATO OBLIGATORIAS (SIN EXCEPCIÓN):
Debes presentar cada producto en este esquema exacto:
Numero. [Marca] [Modelo] (Si el color existe y no es "-", añade " - Color: [Color Traducido]")
   Precio: $[Precio] [Moneda]

PASOS PARA LA RESPUESTA:
1. Usa 'execute_psql' para encontrar lo que el usuario pide.
2. Traduce los colores. Si el color en la base de datos es "-" o está vacío, OMITE la mención al color en esa línea.
3. Genera la lista limpia. No uses tablas ni asteriscos.

VERACIDAD Y RESULTADOS:
- CONFIA SIEMPRE en los resultados de las herramientas. Si execute_psql te devuelve datos, úsalos.
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
    console.log(`[Debug] Context size: ${messages.length} messages. Has tool results: ${messages.some(m => m.role === 'tool')}`);

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
    // Clean markdown and formatting artifacts before returning
    const cleanContent = (assistantContent || 'No tengo respuesta para eso.')
      .replace(/\*\*/g, '')      // Remove bold
      .replace(/\*/g, '')        // Remove italics
      .replace(/__/g, '')        // Remove alternative bold
      .replace(/_/g, '')         // Remove alternative italics
      .replace(/\s+-\s*$/gm, '') // Remove trailing hyphens
      .replace(/-\s*$/gm, '')    // Remove trailing hyphens (alt)
      .trim();

    return cleanContent;
  }

  return "⚠️ Límite de iteraciones del agente alcanzado sin solución final.";
};
