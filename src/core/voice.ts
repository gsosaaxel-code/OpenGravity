import fs from 'fs';
import path from 'path';
import { Groq } from 'groq-sdk';
import textToSpeech from '@google-cloud/text-to-speech';
import axios from 'axios';

// Initialize Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Initialize Google TTS
// It will automatically use GOOGLE_APPLICATION_CREDENTIALS if set,
// or we can pass some config if needed.
const ttsClient = new textToSpeech.TextToSpeechClient();

/**
 * Transcribe an audio file using Groq Whisper
 */
export const transcribeAudio = async (filePath: string): Promise<string> => {
  try {
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3',
      language: 'es', // Optional, but helps with accuracy
      response_format: 'text',
    });
    return transcription as unknown as string;
  } catch (error) {
    console.error('❌ Error en STT (Groq Whisper):', error);
    throw new Error('No se pudo transcribir el audio.');
  }
};

/**
 * Synthesize text to speech using Google Cloud TTS
 */
export const synthesizeSpeech = async (text: string, outputFilePath: string): Promise<void> => {
  try {
    const request = {
      input: { text },
      voice: { languageCode: 'es-US', ssmlGender: 'NEUTRAL' as const, name: 'es-US-Journey-F' },
      audioConfig: { audioEncoding: 'MP3' as const },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    
    if (response.audioContent) {
      fs.writeFileSync(outputFilePath, response.audioContent as Buffer, 'binary');
      console.log(`🔊 Audio sintetizado guardado en: ${outputFilePath}`);
    } else {
        throw new Error('No se generó contenido de audio.');
    }
  } catch (error) {
    console.error('❌ Error en TTS (Google Cloud):', error);
    throw new Error('No se pudo generar el audio de respuesta.');
  }
};

/**
 * Helper to download a file from a URL
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
