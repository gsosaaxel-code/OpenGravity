import fs from 'fs';
import { Groq } from 'groq-sdk';
import * as googleTTS from 'google-tts-api';
import axios from 'axios';

/**
 * Transcribe an audio file using Groq Whisper (STT)
 */
export const transcribeAudio = async (filePath: string): Promise<string> => {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3',
      language: 'es',
      response_format: 'text',
    });
    return transcription as unknown as string;
  } catch (error: any) {
    console.error('❌ Error en STT (Groq Whisper):', error.message || error);
    throw new Error('No se pudo transcribir el audio.');
  }
};

/**
 * Synthesize text to speech using Google Translate TTS (Reliable)
 * Handles long text by chunking.
 */
export const synthesizeSpeech = async (text: string, outputFilePath: string): Promise<void> => {
  try {
    // google-tts-api handles chunking via getAllAudioUrls
    const results = googleTTS.getAllAudioUrls(text, {
      lang: 'es',
      slow: false,
      host: 'https://translate.google.com',
    });

    const buffers: Buffer[] = [];
    for (const item of results) {
      const response = await axios.get(item.url, { responseType: 'arraybuffer' });
      buffers.push(Buffer.from(response.data));
    }

    const finalBuffer = Buffer.concat(buffers);
    fs.writeFileSync(outputFilePath, finalBuffer);
    
    console.log(`🔊 Audio generado exitosamente (gTTS) en: ${outputFilePath}`);
  } catch (error: any) {
    console.error('❌ Error en síntesis de voz (Google):', error.message || error);
    throw new Error('Lo siento, hubo un problema técnico al generar mi respuesta en audio.');
  }
};

/**
 * Helper to download a file from a URL (Telegram API)
 */
export const downloadFile = async (url: string, destPath: string): Promise<void> => {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
};
