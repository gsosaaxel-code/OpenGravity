import { getHistory, saveMessage } from './database.js';
import { generateResponse, LmMessage } from './llm.js';
import { executeTool } from '../tools/registry.js';

const SYSTEM_PROMPT = `
Eres OpenGravity (v1.6), el asistente oficial de ventas de Electro Singe. 
TU MISIÓN: Consultar el stock real y responder con el formato exacto de la tienda. 

REGLAS DE ORO (CERO TOLERANCIA):
1. **PROHIBIDO INVENTAR**: NUNCA menciones modelos o marcas que no estén en los resultados de 'execute_psql'. No respondas desde tu memoria.
2. **OBLIGACIÓN DE HERRAMIENTA**: Si el usuario pide cualquier producto, **DEBES** llamar a 'execute_psql' inmediatamente.
3. **LÍMITE DE 10**: Si encuentras 50 productos, SOLO muestra los primeros 10 en tu mensaje final.
4. **FORMATO OBLIGATORIO** (Sin guiones, sin negritas):
   📱 1. [Marca] [Modelo] [Capacidad] - Color: [Color]
      Precio: $[Precio con puntos] [Moneda]

CONFIGURACIÓN DE DATOS:
- TABLA: 'inventario_productos'.
- CATEGORÍAS: 'Celulares', 'Smart TV', 'Tablets', 'Combos', 'Impresoras', 'Consolas', 'Lavarropas', 'Accesorios', 'Secado', 'Heladeras'.
- MAPEO: "iPhone/Samsung" -> 'Celulares'. "Televisor/TV" -> 'Smart TV'. "Epson/Xerox" -> 'Impresoras'. "Heladera" -> 'Heladeras'.

MODO DE RESPUESTA FINAL (PARA VOZ):
- Responde como si estuviéramos hablando, sin Markdown (** no usar ** ni __).
- Si hay más de 10 productos, EMPIEZA así: "Tengo un total de [X] productos en stock, aquí tienes una muestra de los mejores 10:

" (Asegúrate de dejar ese DOBLE SALTO DE LÍNEA antes del primer producto).
- FILTRO: NUNCA muestres productos con precio 0.

EJEMPLO DE FLUJO:
1. User pide productos.
2. Llamas a la herramienta 'execute_psql' con el SQL correcto.
3. El sistema te devuelve los datos.
4. Respondes al usuario con el formato de la tienda.

NUNCA respondas con el nombre de la función como texto. Usa siempre el sistema de herramientas del chat.
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
  
  // 2. Add the NEW current message if not already there
  const lastMsg = activeHistory[activeHistory.length - 1];
  if (!lastMsg || lastMsg.content !== currentMessage || lastMsg.role !== 'user') {
    const userMsg: LmMessage = { role: 'user', content: currentMessage };
    activeHistory.push(userMsg);
    await saveMessage(userId, userMsg);
  }

  let iteration = 0;
  
  while (iteration < maxIterations) {
    const messages: LmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT.trim() },
      ...activeHistory
    ];

    console.log(`[Agent] Iteration ${iteration + 1}: LLM generation initiated...`);
    
    // 3. Call LLM
    const responseMsg = await generateResponse(messages);
    if(!responseMsg) throw new Error("Recibido un mensaje vacío del LLM");

    // FALLBACK: Detect if LLM sent tool calls as JSON in text
    let toolCalls = responseMsg.tool_calls;
    if (!toolCalls && responseMsg.content) {
      const jsonStart = responseMsg.content.indexOf('[{');
      if (jsonStart !== -1) {
        try {
          const potentialJson = responseMsg.content.substring(jsonStart).trim();
          const parsed = JSON.parse(potentialJson);
          if (Array.isArray(parsed) && (parsed[0].name || parsed[0].function)) {
            toolCalls = parsed.map((tc: any) => ({
              id: `call_${Math.random().toString(36).substring(7)}`,
              type: 'function',
              function: tc.function || tc
            }));
            console.log('[Agent] Detected and recovered JSON tool calls from text content.');
          }
        } catch (e) { /* ignore */ }
      }
    }

    // 4. Record Assistant response
    const assistantMsg: LmMessage = {
      role: 'assistant',
      content: toolCalls ? null : responseMsg.content,
      tool_calls: (toolCalls && toolCalls.length > 0) ? toolCalls : undefined
    };
    
    activeHistory.push(assistantMsg);
    await saveMessage(userId, assistantMsg);

    // 5. Tool execution flow
    if (assistantMsg.tool_calls) {
      console.log(`[Agent] Tool execution required (${assistantMsg.tool_calls.length} tools)`);
      
      for (const toolCall of assistantMsg.tool_calls) {
        if (toolCall.function.name === 'execute_psql' && toolCall.function.arguments.query) {
          let q = toolCall.function.arguments.query;
          
          // COLUMN NORMALIZER (Llama 3 fix)
          q = q.replace(/\bMarca\b/g, "marca");
          q = q.replace(/\bModelo\b/g, "modelo");
          q = q.replace(/\bCapacidad\b/g, "capacidad_detalle");
          q = q.replace(/\bColor\b/g, "color_adicional");
          q = q.replace(/\bCategoria\b/g, "categoria");
          
          // CATEGORY FIXES
          q = q.replace(/'Mobile Phone'|'Smartphone'/gi, "'Celulares'");
          q = q.replace(/'Printer'/gi, "'Impresoras'");
          q = q.replace(/'Fridge'|'Refrigerador'/gi, "'Heladeras'");
          
          // COLOR TRANSLATOR
          q = q.replace(/blanco/gi, "White");
          q = q.replace(/negro/gi, "Black");
          q = q.replace(/azul/gi, "Blue");
          q = q.replace(/gris/gi, "Gray");
          
          // SECURITY LIMIT
          if (!q.toLowerCase().includes('limit')) {
            q = q.trim().replace(/;$/, '') + ' LIMIT 20;';
          }
          
          toolCall.function.arguments.query = q;
        }

        const rawResult = await executeTool(toolCall.function.name, toolCall.function.arguments);
        
        // SANITIZE & HARD LIMIT (12 rows max)
        let result = rawResult
          .replace(/[^\x20-\x7E\sÀ-ÿ]/g, '') 
          .replace(/#VALOR!/gi, 'N/A');
        
        const lines = result.split('\n');
        if (lines.length > 15) {
          result = lines.slice(0, 12).join('\n') + `\n... (Total de ${lines.length - 2} productos encontrados)`;
        }

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

    // 6. Return Clean Response
    const cleanContent = (assistantMsg.content || 'Sin respuesta.')
      .replace(/[\*_]/g, '')      // Clear all markdown artifacts
      .replace(/\s+-\s*$/gm, '') 
      .trim();

    return cleanContent;
  }

  return "⚠️ Límite de iteraciones alcanzado.";
};
