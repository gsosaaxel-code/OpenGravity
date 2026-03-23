import { registerTool } from './registry.js';

export const getSystemTimeTool = {
  definition: {
    type: "function" as const,
    function: {
      name: "get_system_time",
      description: "Obtiene la fecha y hora actual del sistema. Usa esto cada vez que necesites saber qué día u hora es actualmente.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  execute: async () => {
    return new Date().toLocaleString('es-ES', { timeZoneName: 'short' });
  }
};

// Register this specific tool
export const initSystemTimeTool = () => {
  registerTool(getSystemTimeTool);
};
