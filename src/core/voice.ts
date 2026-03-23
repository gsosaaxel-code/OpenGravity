import fs from 'fs';
import { Groq } from 'groq-sdk';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'edge-tts-node';
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
  } catch (error) {
    console.error('❌ Error en STT (Groq Whisper):', error);
    throw new Error('No se pudo transcribir el audio.');
  }
};

/**
 * Synthesize text to speech using Microsoft Edge TTS (FREE / HIGH QUALITY)
 */
export const synthesizeSpeech = async (text: string, outputFilePath: string): Promise<void> => {
  try {
    const tts = new MsEdgeTTS({});
    
    // Configurar voz y formato
    await tts.setMetadata(
      'es-MX-DaliaNeural', 
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
    );

    // Guardar a archivo
    await tts.toFile(outputFilePath, text);
    
    console.log(`🔊 Audio neuronal generado con Edge TTS en: ${outputFilePath}`);
  } catch (error) {
    console.error('❌ Error en Edge TTS:', error);
    throw new Error('No se pudo generar el audio de respuesta con la nueva voz.');
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
