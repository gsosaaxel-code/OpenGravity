import { Bot, InputFile } from 'grammy';
import { agentLoop } from '../core/agent.js';
import { downloadFile, transcribeAudio, synthesizeSpeech } from '../core/voice.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
    await ctx.reply('🚀 OpenGravity Agent en línea. Listo para recibir comandos y notas de voz.');
  });

  // --- HANDLER PARA TEXTO ---
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const userMessage = ctx.message.text;
    const pendingMsg = await ctx.reply('Procesando...');

    try {
      const finalReply = await agentLoop(userId, userMessage);
      await ctx.api.editMessageText(ctx.chat.id, pendingMsg.message_id, finalReply);
    } catch (error: any) {
      console.error(error);
      await ctx.api.editMessageText(ctx.chat.id, pendingMsg.message_id, `Error Crítico: ${error.message}`);
    }
  });

  // --- HANDLER PARA VOZ/AUDIO ---
  bot.on(['message:voice', 'message:audio'], async (ctx) => {
    const userId = ctx.from.id.toString();
    const voice = ctx.message.voice || ctx.message.audio;
    if (!voice) return;

    const pendingMsg = await ctx.reply('🎤 Escuchando audio...');

    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `input_${voice.file_unique_id}.ogg`);
    const outputPath = path.join(tempDir, `output_${voice.file_unique_id}.mp3`);

    try {
      // 1. Obtener URL del archivo desde Telegram
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      // 2. Descargar y Transcribir
      await downloadFile(fileUrl, inputPath);
      const transcribedText = await transcribeAudio(inputPath);

      await ctx.api.editMessageText(ctx.chat.id, pendingMsg.message_id, `📝 Has dicho: "${transcribedText}"\n\nProcesando respuesta...`);

      // 3. Pasar al Agente
      const finalReply = await agentLoop(userId, transcribedText);

      // 4. Sintetizar respuesta a Audio
      await synthesizeSpeech(finalReply, outputPath);

      // 5. Enviar respuesta final (Texto + Audio)
      await ctx.api.editMessageText(ctx.chat.id, pendingMsg.message_id, finalReply);
      await ctx.replyWithVoice(new InputFile(outputPath));

    } catch (error: any) {
      console.error('Error procesando audio:', error);
      await ctx.api.editMessageText(ctx.chat.id, pendingMsg.message_id, `❌ Error de audio: ${error.message}`);
    } finally {
      // Limpieza
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
  });

  bot.start({
    onStart(botInfo) {
      console.log(`📱 Adaptador Telegram (@${botInfo.username}) iniciado.`);
    }
  });

  return bot;
};
