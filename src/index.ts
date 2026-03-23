import dotenv from 'dotenv';
dotenv.config();

import { initializeTools } from './tools/index.js';
import { startTelegramBot } from './adapters/telegram.js';

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

  // 3. Mini-servidor HTTP para Health Checks (CRÍTICO para Render/Koyeb/HuggingFace)
  const http = await import('http');
  const port = process.env.PORT || 8080;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OpenGravity Agent is ALIVE\n');
  }).listen(port, () => {
    console.log(`📡 Servidor de salud escuchando en el puerto ${port}`);
  });
  
  console.log('✅ OpenGravity está escuchando eventos...');
} catch (error) {
  console.error('❌ Error fatal al iniciar OpenGravity:', error);
  process.exit(1);
}
