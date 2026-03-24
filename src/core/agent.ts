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
- CATEGORÍAS: 'Celulares', 'Smart TV', 'Tablets', 'Combos', 'Impresoras', 'Consolas', 'Lavarropas', 'Accesorios', 'Secado'.
- MAPEO: "iPhone/Samsung" -> 'Celulares'. "Televisor/TV" -> 'Smart TV'. "Epson/Xerox" -> 'Impresoras'. "Heladera" -> 'Secado' (o similar).

MODO DE RESPUESTA FINAL (PARA VOZ):
- Responde como si estuviéramos hablando, sin Markdown (** no usar ** ni __).
- Si hay más de 10 productos, EMPIEZA así: "Tengo un total de [X] productos en stock, aquí tienes una muestra de los mejores 10:"
- FILTRO: NUNCA muestres productos con precio 0.

EJEMPLO DE EJECUCIÓN CORRECTA:
User: "¿Qué celulares tenés?"
Assistant (Tool Call): execute_psql(query: "SELECT ... FROM inventario_productos WHERE categoria = 'Celulares' AND precio > 0 LIMIT 10;")
Tool Result: [Datos de 35 celulares]
Assistant (Final Response): "Tengo un total de 35 celulares en stock, aquí tienes una muestra de los mejores 10:
📱 1. Apple iPhone 15 128GB - Color: Blue
   Precio: $645 USD

📱 2. Apple iPhone 16 128GB - Color: Teal
   Precio: $770 USD
..."
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

    // FALLBACK: Detect if LLM sent tool calls as JSON string in content
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
            console.log('[Agent] Detected and recovered JSON tool calls from text content (fallback).');
          }
        } catch (e) { /* Not valid JSON */ }
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

    // 5. Tool execution loop
    if (assistantMsg.tool_calls) {
      console.log(`[Agent] Tool execution required (${assistantMsg.tool_calls.length} tools)`);
      
      for (const toolCall of assistantMsg.tool_calls) {
        // SQL HEALER: If the model forgot underscores in table/column names, fix it!
        if (toolCall.function.name === 'execute_psql' && toolCall.function.arguments.query) {
          let q = toolCall.function.arguments.query;
          // Table & Column names
          q = q.replace(/inventarioproductos/gi, 'inventario_productos');
          q = q.replace(/capacidaddetalle/gi, 'capacidad_detalle');
          q = q.replace(/coloradicional/gi, 'color_adicional');
          // Category translations (English LLMs often hallucinate these)
          q = q.replace(/'Mobile Phone'/gi, "'Celulares'");
          q = q.replace(/'Smartphone'/gi, "'Celulares'");
          q = q.replace(/'Printer'/gi, "'Impresoras'");
          q = q.replace(/'Washing Machine'/gi, "'Lavarropas'");
          
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
