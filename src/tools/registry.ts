export type ToolFunction = (args: any) => Promise<string> | string;

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any; // JSON Schema object for parameters
  };
}

export interface ToolRegistration {
  definition: ToolDefinition;
  execute: ToolFunction;
}

// Global registry of all available tools
const toolsRegistry = new Map<string, ToolRegistration>();

/**
 * Register a new tool into the global registry.
 */
export const registerTool = (registration: ToolRegistration) => {
  toolsRegistry.set(registration.definition.function.name, registration);
};

/**
 * Get the config for all registered tools, formatted for OpenAI/Groq API.
 */
export const getAvailableToolsConfig = (): ToolDefinition[] => {
  return Array.from(toolsRegistry.values()).map(t => t.definition);
};

/**
 * Executes a tool by its name with the provided JSON arguments.
 */
export const executeTool = async (name: string, argsStr: string): Promise<string> => {
  const tool = toolsRegistry.get(name);
  if (!tool) {
    throw new Error(`Tool ${name} not found in registry`);
  }
  
  try {
    const args = argsStr ? JSON.parse(argsStr) : {};
    console.log(`[Tool Execution] ${name} with args:`, args);
    const result = await tool.execute(args);
    console.log(`[Tool Result] ${name}:`, result);
    return result;
  } catch (error: any) {
    console.error(`[Tool Error] ${name}:`, error.message);
    return `Error executing tool ${name}: ${error.message}`;
  }
};
