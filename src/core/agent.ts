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
- EL INVENTARIO ES GRANDE: Smart TV, Heladeras, Lavarropas, Celulares y más.
- **MAPEO DE CATEGORÍAS**: Si el usuario pregunta por "televisor", "TV" o "televisores", **DEBES** mapearlo a la categoría 'Smart TV' al buscar en SQL.
- **LÍMITE DE RESPUESTA**: Si encuentras más de 10 productos, ofrece solo los 10 mejores/más baratos y pregunta si desea ver el resto. NUNCA envíes el catálogo completo de golpe.
- **ASISTENCIA ENFOCADA**: Ofrece ayuda proactiva (fotos, reserva) **ÚNICAMENTE** sobre el tipo de producto que el usuario está consultando. Si pregunta por TVs, NO menciones heladeras.

REGLAS DE FORMATO OBLIGATORIAS (SIN EXCEPCIÓN):
Debes presentar cada producto en este esquema exacto, añadiendo un ÚNICO emoji de la categoría al inicio y dejando un DOBLE SALTO DE LÍNEA entre cada producto:

[Emoji] Numero. [Marca] [Modelo] [Capacidad_detalle] - Color: [Color Traducido]
   Precio: $[Precio] [Moneda]

Ejemplos de Emojis: Celular 📱, Heladera 🧊, Lavarropas 🫧, Smart TV 📺, Tablet 📱, Impresora 🖨️, etc.

PASOS PARA LA RESPUESTA:
1. Usa 'execute_psql' para encontrar lo que el usuario pide.
2. CUIDADO CON DUPLICADOS: Si en el resultado de la base de datos hay modelos idénticos con el mismo precio y color, fíltralos y muéstralos UNA SOLA VEZ.
3. Formato Dinámico: Incluye '[Capacidad_detalle]' solo si existe (ej. 256GB). Si el color es "-" o está vacío, omite la palabra "Color" y sus guiones. Nunca imprimas paréntesis como "( - Color: )". Solo incluye " - Color: [Color]" si hay un color válido y tradúcelo.
4. Genera la lista limpia asegurando que haya espacio entre los productos. No uses tablas ni asteriscos.

VERACIDAD Y RESULTADOS (CERO TOLERANCIA A ALUCINACIONES):
- **CERO INVENTOS**: Tienes TOTALMENTE PROHIBIDO inventar, crear o imaginar modelos de productos, marcas o precios. Solo puedes responder con los datos EXACTOS que te devuelve la herramienta 'execute_psql'.
- Si la base de datos no tiene algo, di la verdad: "En este momento no tengo stock de ese producto en mi base de datos". NINGÚN PRODUCTO puede salir de tu memoria general.
- CONFÍA SIEMPRE en los resultados de las herramientas. Si execute_psql te devuelve datos, úsalos tal cual, sin alterar nada.
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
