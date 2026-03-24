import { getHistory, saveMessage } from './database.js';
import { generateResponse, LmMessage } from './llm.js';
import { executeTool } from '../tools/registry.js';

const SYSTEM_PROMPT = `
Eres OpenGravity (v1.7), el asistente oficial de ventas de Electro Singe. 
TU MISIÓN: Consultar el stock real y responder con el formato exacto de la tienda. 

REGLAS DE ORO (CERO TOLERANCIA):
1. **PROHIBIDO INVENTAR**: NUNCA menciones modelos o marcas que no estén en los resultados de 'execute_psql'. No respondas desde tu memoria.
2. **OBLIGACIÓN DE HERRAMIENTA**: Si el usuario pide cualquier producto, **DEBES** llamar a 'execute_psql' inmediatamente.
3. **LÍMITE DE 10**: Si encuentras más de 10 productos, SOLO muestra los primeros 10 en tu mensaje final.
4. **FORMATO OBLIGATORIO** (Usa el emoji de la categoría y DEJA UN ESPACIO DOBLE entre cada producto):
   [Emoji] [Número]. [Marca] [Modelo] [Capacidad] - Color: [Color]
      Precio: $[Precio con puntos] [Moneda]

   (Deja un \n\n extra antes del siguiente producto para máxima legibilidad).

MAPEO DE EMOJIS:
- 'Celulares' -> 📱
- 'Heladeras' -> ❄️
- 'Smart TV' -> 📺
- 'Impresoras' -> 🖨️
- 'Lavarropas' | 'Secado' -> 🧺
- 'Consolas' -> 🎮
- 'Aire Acondicionado' -> ❄️
- 'Bicicletas' -> 🚲
- 'Tablets' -> 📱
- Otros -> 📦

CONFIGURACIÓN DE DATOS:
- TABLA: 'inventario_productos'.
- COLUMNAS VÁLIDAS: id, categoria, marca, modelo, capacidad_detalle, color_adicional, precio, moneda
- CATEGORÍAS: 'Celulares', 'Smart TV', 'Tablets', 'Combos', 'Impresoras', 'Consolas', 'Lavarropas', 'Accesorios', 'Secado', 'Heladeras'.
- MAPEO: "iPhone/Samsung" -> 'Celulares'. "Televisor/TV" -> 'Smart TV'. "Epson/Xerox" -> 'Impresoras'. "Heladera" -> 'Heladeras'.
- NUNCA uses columnas 'stock', 'capacidad', 'disponibilidad'. NO EXISTEN.

FLUJO DE COMPRA:
- Si el usuario quiere COMPRAR un producto, NO llames a execute_psql. Responde directamente:
  "¡Genial! Para completar tu compra de [producto], te voy a derivar con un asesor. Podés escribirnos por WhatsApp al https://wa.me/message/JFOGCUWX4KKRN1 para coordinar el pago y la entrega. ¡Te esperamos!"

MODO DE RESPUESTA FINAL (PARA VOZ):
- Responde como si estuviéramos hablando, sin Markdown (** no usar ** ni __).
- Si hay más de 10 productos, EMPIEZA así: "Tengo un total de [X] productos en stock, aquí tienes una muestra de los mejores 10:

" (Asegúrate de dejar ese DOBLE SALTO DE LÍNEA antes del primer producto).
- FILTRO: NUNCA muestres productos con precio 0.
`;

export const agentLoop = async (userId: string, currentMessage: string, maxIterations: number = 5): Promise<string> => {
  const dbHistoryRaw = await getHistory(userId, 20);
  
  let activeHistory: LmMessage[] = [];
  let hasReachedFinalAssistant = false;
  
  for (let i = dbHistoryRaw.length - 1; i >= 0; i--) {
    const msg = dbHistoryRaw[i];
    if (msg.role === 'assistant' && !msg.tool_calls) hasReachedFinalAssistant = true;
    if (hasReachedFinalAssistant && (msg.role === 'tool' || msg.tool_calls)) continue;
    activeHistory.unshift(msg);
  }

  while (activeHistory.length > 0 && activeHistory[0].role !== 'user') { activeHistory.shift(); }
  
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
    const responseMsg = await generateResponse(messages);
    if(!responseMsg) throw new Error("Recibido un mensaje vacío del LLM");

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

    const assistantMsg: LmMessage = {
      role: 'assistant',
      content: toolCalls ? null : responseMsg.content,
      tool_calls: (toolCalls && toolCalls.length > 0) ? toolCalls : undefined
    };
    
    activeHistory.push(assistantMsg);
    await saveMessage(userId, assistantMsg);

    if (assistantMsg.tool_calls) {
      console.log(`[Agent] Tool execution required (${assistantMsg.tool_calls.length} tools)`);
      
      for (const toolCall of assistantMsg.tool_calls) {
        if (toolCall.function.name === 'execute_psql' && toolCall.function.arguments.query) {
          let q = toolCall.function.arguments.query;
          
          // Capitalize normalizer (Llama 8B fix)
          q = q.replace(/\bMarca\b/g, "marca");
          q = q.replace(/\bModelo\b/g, "modelo");
          q = q.replace(/\bCapacidad\b/g, "capacidad_detalle");
          q = q.replace(/\bColor\b/g, "color_adicional");
          q = q.replace(/\bCategoria\b/g, "categoria");
          q = q.replace(/inventarioproductos/gi, "inventario_productos");
          
          // Remove hallucinated columns that don't exist in the DB
          q = q.replace(/\s*AND\s+stock\s*>\s*\d+/gi, '');
          q = q.replace(/\s*AND\s+stock\s*=\s*[^\s,)]+/gi, '');
          q = q.replace(/\s*AND\s+disponibilidad\s*[=><][^\s,)]+/gi, '');
          q = q.replace(/\bstock\b/gi, 'precio'); // last resort fallback
          q = q.replace(/\bCapacidad\b\s*(?==|LIKE|>|<)/g, 'capacidad_detalle');
          
          // Category translations
          q = q.replace(/'Mobile Phone'|'Smartphone'/gi, "'Celulares'");
          q = q.replace(/'Printer'/gi, "'Impresoras'");
          q = q.replace(/'Fridge'|'Refrigerador'/gi, "'Heladeras'");
          
          // Color translations
          q = q.replace(/blanco/gi, "White");
          q = q.replace(/negro/gi, "Black");
          q = q.replace(/azul/gi, "Blue");
          q = q.replace(/gris/gi, "Gray");
          
          if (!q.toLowerCase().includes('limit')) {
            q = q.trim().replace(/;$/, '') + ' LIMIT 20;';
          }
          
          toolCall.function.arguments.query = q;
        }

        const rawResult = await executeTool(toolCall.function.name, toolCall.function.arguments);
        
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

    let cleanContent = (assistantMsg.content || 'Sin respuesta.')
      .replace(/[\*_]/g, '')
      .replace(/\s+-\s*$/gm, '')
      // Strip leaked function call syntax from 8B models
      .replace(/<function=[^>]+>[^<]*<\/function>/gs, '')
      .replace(/\n?\s*❄️\s*\d+\.\s*<[^>]+>.*?<\/[^>]+>/gs, '')
      // Strip any line that contains JSON-like SQL artifacts
      .replace(/\n[^❄️📱📺🖨️🧺🎮📦]*(?:SELECT|FROM|WHERE|inventario)[^\n]*/gi, '')
      .trim();

    // If after cleanup the content is empty or just dots, give a safe fallback
    if (!cleanContent || cleanContent.length < 5) {
      cleanContent = "Hubo un problema al generar la respuesta. Por favor, intentá de nuevo.";
    }

    return cleanContent;
  }

  return "⚠️ Límite de iteraciones alcanzado.";
};
