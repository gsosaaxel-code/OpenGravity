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
- Tienes acceso a una base de datos PostgreSQL mediante la herramienta 'execute_psql'.
- **ÚNICA TABLA**: 'inventario_productos' (Con guiones bajos). **PROHIBIDO** usar 'products', 'inventario' o 'categorias'.
- **SIN JOINS**: No existe ninguna otra tabla. No uses INNER JOIN, LEFT JOIN, etc. Todo está en una sola tabla.
- **COLUMNAS REALES**: (categoria, marca, modelo, capacidad_detalle, color_adicional, precio, moneda). Nombres EN ESPAÑOL con _.
- **MAPEO DE CATEGORÍAS**: Si el usuario pregunta por "televisor", "TV" o "televisores", **DEBES** mapearlo a la categoría 'Smart TV'.
- **ASISTENCIA ENFOCADA**: Ofrece ayuda proactiva (fotos, reserva) **ÚNICAMENTE** sobre el tipo de producto que el usuario está consultando.

REGLAS DE FORMATO OBLIGATORIAS (SIN EXCEPCIÓN):
Debes presentar cada producto en este esquema exacto, añadiendo un ÚNICO emoji de la categoría al inicio y dejando un DOBLE SALTO DE LÍNEA entre cada producto:

[Emoji] Numero. [Marca] [Modelo] [Capacidad_detalle] - Color: [Color Traducido]
   Precio: $[Precio con puntos de miles] [Moneda]

Ejemplos de Emojis: Celular 📱, Heladera 🧊, Lavarropas 🫧, Smart TV 📺, Tablet 📱, Impresora 🖨️, etc.

PASOS PARA LA RESPUESTA:
1. Usa 'execute_psql' para encontrar lo que el usuario pide.
2. CUIDADO CON DUPLICADOS: Si en el resultado de la base de datos hay modelos idénticos con el mismo precio y color, fíltralos y muéstralos UNA SOLA VEZ.
3. Formato Dinámico: 
   - PRECIOS: Siempre usa un punto como separador de miles (ejem: 100.000, 2.500.000). 
   - COLOR: Si el color es "-", "Unknown", "N/A" o está vacío, **BOORRA** toda la sección de color (incluyendo el guion y la palabra "Color:"). La línea debe terminar en el Modelo o Capacidad. NUNCA dejes un guion colgando solo.
   - CAPACIDAD: Incluye '[Capacidad_detalle]' solo si existe (ej. 256GB). 
4. Genera la lista limpia asegurando que haya espacio entre los productos. No uses tablas ni asteriscos.

VERACIDAD Y RESULTADOS (CERO TOLERANCIA A ALUCINACIONES):
- **CERO INVENTOS**: Tienes TOTALMENTE PROHIBIDO inventar, crear o imaginar modelos de productos, marcas o precios. Solo puedes responder con los datos EXACTOS que te devuelve la herramienta 'execute_psql'.
- Si la base de datos no tiene algo, di la verdad: "En este momento no tengo stock de ese producto en mi base de datos". NINGÚN PRODUCTO puede salir de tu memoria general.
- CONFÍA SIEMPRE en los resultados de las herramientas. Si execute_psql te devuelve datos, úsalos tal cual, sin alterar nada.
- PROHIBIDO EL USO DE MARKDOWN EN LA RESPUESTA FINAL.

DECISIVIDAD: No entres en bucles infinitos de búsqueda. Si ya encontraste productos que responden a la duda del usuario, responde INMEDIATAMENTE. No busques más si ya tienes información útil.
`;

export const agentLoop = async (userId: string, currentMessage: string, maxIterations: number = 5): Promise<string> => {
  // 1. Fetch history once to start the turn
  const dbHistoryRaw = await getHistory(userId, 30);
  
  // Sanitize history to prevent Gemini API Sequence Errors
  let activeHistory: LmMessage[] = [];
  let hasReachedFinalAssistant = false;
  
  for (let i = dbHistoryRaw.length - 1; i >= 0; i--) {
    const msg = dbHistoryRaw[i];
    if (msg.role === 'assistant' && !msg.tool_calls) hasReachedFinalAssistant = true;
    if (hasReachedFinalAssistant && (msg.role === 'tool' || msg.tool_calls)) continue;
    activeHistory.unshift(msg);
  }

  // Strictly start with a user message
  while (activeHistory.length > 0 && activeHistory[0].role !== 'user') { activeHistory.shift(); }
  
  // 2. Add the NEW current message if not already there (getHistory might have it if already saved)
  const lastMsg = activeHistory[activeHistory.length - 1];
  if (!lastMsg || lastMsg.content !== currentMessage || lastMsg.role !== 'user') {
    const userMsg: LmMessage = { role: 'user', content: currentMessage };
    activeHistory.push(userMsg);
    await saveMessage(userId, userMsg);
  }

  let iteration = 0;
  
  while (iteration < maxIterations) {
    // Construct actual conversation array for the LLM
    const messages: LmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT.trim() },
      ...activeHistory
    ];

    console.log(`[Agent] Iteration ${iteration + 1}: LLM generation initiated...`);
    
    // 3. Call LLM
    const responseMsg = await generateResponse(messages);
    if(!responseMsg) throw new Error("Recibido un mensaje vacío del LLM");

    // FALLBACK: Detect if LLM sent tool calls as JSON string in content (common in some Llama versions)
    let toolCalls = responseMsg.tool_calls;
    if (!toolCalls && responseMsg.content?.trim().startsWith('[{')) {
      try {
        const potentialJson = responseMsg.content.trim();
        const parsed = JSON.parse(potentialJson);
        if (Array.isArray(parsed) && parsed[0].name) {
          toolCalls = parsed.map((tc: any) => ({
            id: `call_${Math.random().toString(36).substring(7)}`,
            type: 'function',
            function: tc
          }));
          console.log('[Agent] Detected and recovered JSON tool calls from text content.');
        }
      } catch (e) { /* Not valid tool call JSON */ }
    }

    // 4. Record Assistant response
    const assistantMsg: LmMessage = {
      role: 'assistant',
      content: toolCalls ? null : responseMsg.content,
      tool_calls: (toolCalls && toolCalls.length > 0) ? toolCalls : undefined
    };
    
    activeHistory.push(assistantMsg);
    await saveMessage(userId, assistantMsg);

    // 5. Tool execution loop
    if (assistantMsg.tool_calls) {
      console.log(`[Agent] Tool execution required (${assistantMsg.tool_calls.length} tools)`);
      
      for (const toolCall of assistantMsg.tool_calls) {
        // SQL HEALER: If the model forgot underscores in table/column names, fix it!
        if (toolCall.function.name === 'execute_psql' && toolCall.function.arguments.query) {
          let q = toolCall.function.arguments.query;
          q = q.replace(/inventarioproductos/gi, 'inventario_productos');
          q = q.replace(/capacidaddetalle/gi, 'capacidad_detalle');
          q = q.replace(/coloradicional/gi, 'color_adicional');
          // Basic check for hallucinated JOIN
          if (q.toLowerCase().includes('join') || q.toLowerCase().includes('categoriaid')) {
            console.warn('[Agent] Detected hallucinated JOIN. Fixing query...');
            q = `SELECT categoria, marca, modelo, capacidad_detalle, color_adicional, precio, moneda FROM inventario_productos WHERE marca ILIKE '%${currentMessage}%' OR modelo ILIKE '%${currentMessage}%' OR categoria ILIKE '%${currentMessage}%' LIMIT 15;`;
          }
          toolCall.function.arguments.query = q;
        }

        const result = await executeTool(toolCall.function.name, toolCall.function.arguments);
        
        const toolMsg: LmMessage = {
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id
        };
        
        activeHistory.push(toolMsg);
        await saveMessage(userId, toolMsg);
      }
      
      iteration++;
      continue;
    }

    // 7. If no tool calls, we are done. Return the text content.
    // Clean markdown and formatting artifacts before returning
    const cleanContent = (assistantMsg.content || 'No tengo respuesta para eso.')
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
