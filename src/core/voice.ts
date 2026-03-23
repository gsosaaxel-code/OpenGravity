import fs from 'fs';
import { Groq } from 'groq-sdk';
import * as googleTTS from 'google-tts-api';
import axios from 'axios';

// Initialize Groq (Sigue siendo gratuito en su capa actual)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Transcribe an audio file using Groq Whisper (STT)
 */
export const transcribeAudio = async (filePath: string): Promise<string> => {
  try {
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3',
      language: 'es',
      response_format: 'text',
    });
    return transcription as unknown as string;
  } catch (error) {
    console.error('❌ Error en STT (Groq Whisper):', error);
    throw new Error('No se pudo transcribir el audio.');
  }
};

/**
 * Synthesize text to speech using Google Translate TTS (FREE / NO KEY)
 * Handles text longer than 200 characters automatically.
 */
export const synthesizeSpeech = async (text: string, outputFilePath: string): Promise<void> => {
  try {
    // google-tts-api tiene un límite de 200 caracteres, pero getAllAudioUrls los divide por nosotros
    const results = googleTTS.getAllAudioUrls(text, {
      lang: 'es',
      slow: false,
      host: 'https://translate.google.com',
    });

    const audioBuffers: Buffer[] = [];

    for (const item of results) {
      const resp = await axios.get(item.url, { responseType: 'arraybuffer' });
      audioBuffers.push(Buffer.from(resp.data));
    }

    // Unir todos los buffers en un solo archivo MP3
    const finalBuffer = Buffer.concat(audioBuffers);
    fs.writeFileSync(outputFilePath, finalBuffer);
    
    console.log(`🔊 Audio gratuito generado en: ${outputFilePath}`);
  } catch (error) {
    console.error('❌ Error en TTS Gratuito:', error);
    throw new Error('No se pudo generar el audio de respuesta gratuito.');
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
