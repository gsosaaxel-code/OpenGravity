import Groq from 'groq-sdk';
import { getAvailableToolsConfig } from '../tools/registry.js';

export interface LmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

// Instantiate Groq client if key exists
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

export const generateResponse = async (messages: LmMessage[]): Promise<any> => {
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

  if (openRouterKey) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API Error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    return data.choices[0].message; // returns full message object containing content and tool_calls
  } else if (groq) {
    payload.model = 'llama-3.3-70b-versatile';
    
    const chatCompletion = await groq.chat.completions.create(payload as any);
    return chatCompletion.choices[0]?.message || { content: '' };
  } else {
    throw new Error('No LLM API keys configured. Set GROQ_API_KEY or OPENROUTER_API_KEY.');
  }
};
