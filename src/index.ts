import dotenv from 'dotenv';
import { initializeTools } from './tools/index.js';
import { startTelegramBot } from './adapters/telegram.js';

// Load env variables
dotenv.config();

console.log('🔄 Inicializando sistema OpenGravity...');

const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USER_IDS'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Error: Falta variable de entorno requerida: ${envVar}`);
    process.exit(1);
  }
}

try {
  // 1. Cargar herramientas locales disponibles (ej: get_system_time)
  initializeTools();

  // 2. Iniciar adaptadores de comunicación
  startTelegramBot();
  
  console.log('✅ OpenGravity está escuchando eventos...');
} catch (error) {
  console.error('❌ Error fatal al iniciar OpenGravity:', error);
  process.exit(1);
}
