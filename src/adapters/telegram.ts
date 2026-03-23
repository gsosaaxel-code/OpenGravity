import { Bot } from 'grammy';
import { agentLoop } from '../core/agent.js';

export const startTelegramBot = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedIdsStr = process.env.TELEGRAM_ALLOWED_USER_IDS || '';
  
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN no encontrado en .env');
  
  const allowedIds = allowedIdsStr.split(',').map(id => id.trim());
  const bot = new Bot(token);

  // Seguridad: Middleware de Autenticación / Whitelist
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id.toString();
    if (!userId || !allowedIds.includes(userId)) {
      console.warn(`Intento de acceso denegado por ID: ${userId}`);
      return; 
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply('🚀 OpenGravity Agent en línea. Listo para recibir comandos.');
  });

  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const userMessage = ctx.message.text;

    // Feedback visual
    const pendingMsg = await ctx.reply('Procesando...');

    try {
      // Inicia el bucle cognitivo
      const finalReply = await agentLoop(userId, userMessage);
      
      // Reemplaza el mensaje "Procesando..." con la respuesta
      await ctx.api.editMessageText(ctx.chat.id, pendingMsg.message_id, finalReply);

    } catch (error: any) {
      console.error(error);
      await ctx.api.editMessageText(ctx.chat.id, pendingMsg.message_id, `Error Crítico: ${error.message}`);
    }
  });

  bot.start({
    onStart(botInfo) {
      console.log(`📱 Adaptador Telegram (@${botInfo.username}) iniciado.`);
    }
  });
  
  return bot;
};
