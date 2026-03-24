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
      console.warn(`[LLM] OpenRouter failed (${response.status}): ${errorText}. Sliding to Gemini...`);
    } catch (err) {
      console.warn(`[LLM] OpenRouter error: ${err}. Sliding to Gemini...`);
    }
  }

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
        
        console.warn(`[LLM] Gemini ${model} failed (${response.status}). Trying next Gemini or Groq...`);
      } catch (err) {
        console.warn(`[LLM] Gemini ${model} error: ${err}.`);
      }
    }
  }

  // 3. ULTIMATE FALLBACK: GROQ
  if (groq) {
    try {
      console.log('[LLM] Attempting GROQ (Ultimate Fallback)...');
      payload.model = 'llama-3.3-70b-versatile';
      const chatCompletion = await groq.chat.completions.create(payload as any);
      return chatCompletion.choices[0]?.message || { content: '' };
    } catch (err) {
      console.error(`[LLM] Groq failed too: ${err}`);
    }
  }

  throw new Error('All LLM providers (OpenRouter, Gemini, Groq) failed or are not configured.');
};
