import Groq from 'groq-sdk';
import { getAvailableToolsConfig } from '../tools/registry.js';

export interface LmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

// Instantiate Groq client if key exists
export const generateResponse = async (messages: LmMessage[]): Promise<any> => {
  const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openRouterModel = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct';
  const tools = getAvailableToolsConfig();

  const payload: any = {
    model: openRouterModel,
    messages: messages,
  };

  // Only attach tools if available
  if (tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

  // Helper to wait between attempts if needed
  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

  // --- NEW TRIAGE ORDER: 1. OpenRouter -> 2. Gemini -> 3. Groq ---
  
  // 1. TRY OPENROUTER
  if (openRouterKey) {
    try {
      console.log('[LLM] Attempting OpenRouter...');
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.choices[0].message;
      }
      
      const errorText = await response.text();
      console.warn(`[LLM] OpenRouter failed (${response.status}). Sliding to Gemini in 1s...`);
    } catch (err) {
      console.warn(`[LLM] OpenRouter error: ${err}. Sliding to Gemini...`);
    }
  }

  await sleep(1000);

  // 2. TRY GEMINI (WITH INTERNAL FALLBACKS)
  if (geminiKey) {
    const geminiModels = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-pro-latest', 'gemini-flash-latest'];
    for (const model of geminiModels) {
      try {
        payload.model = model;
        console.log(`[LLM] Attempting Gemini (${model})...`);
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${geminiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          return data.choices[0].message;
        }
        
        console.warn(`[LLM] Gemini ${model} failed (${response.status}). Trying next...`);
        await sleep(500); 
      } catch (err) {
        console.warn(`[LLM] Gemini ${model} error: ${err}.`);
      }
    }
  }

  await sleep(1000);

  // 3. ULTIMATE FALLBACK: GROQ (WITH MULTI-MODEL CASCADING)
  if (groq) {
    const groqModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'llama3-70b-8192', 'mixtral-8x7b-32768'];
    for (const model of groqModels) {
      try {
        console.log(`[LLM] Attempting GROQ (${model})...`);
        const subPayload = { ...payload, model };
        // For Groq, ensure tool_choice is strict to avoid malformed calls
        if (subPayload.tools) subPayload.tool_choice = "auto";
        const chatCompletion = await groq.chat.completions.create(subPayload as any);
        return chatCompletion.choices[0]?.message || { content: '' };
      } catch (err: any) {
        if (err.status === 429) {
          console.warn(`[LLM] Groq ${model} rate limited. Trying next model...`);
          continue;
        }
        console.error(`[LLM] Groq ${model} failed: ${err.message}`);
      }
    }
  }

  throw new Error('All LLM providers (OpenRouter, Gemini, Groq) exhausted their rates. Please check API keys or wait for refresh.');
};
