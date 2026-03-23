import { initSystemTimeTool } from './system_time.js';

export const initializeTools = () => {
  console.log('🛠️ Inicializando registro de Herramientas locales...');
  initSystemTimeTool();
  // Here we can easily add more tools in the future (e.g. read_file, whatsapp_send, etc)
};

export * from './registry.js';
