import { TTSChunk } from '../types';

const CHUNK_LIMIT = 200; // Character limit per request for Piper

export function splitTextIntoChunks(text: string): TTSChunk[] {
  // Split by punctuation first to maintain natural pauses
  const sentences = text.match(/[^.!?፡።፣፤]+[.!?፡።፣፤]*|[^.!?፡።፣፤]+/g) || [text];
  const chunks: TTSChunk[] = [];
  let currentChunkText = "";

  sentences.forEach((sentence) => {
    const trimmed = sentence.trim();
    if (!trimmed) return;

    if ((currentChunkText + trimmed).length > CHUNK_LIMIT && currentChunkText.length > 0) {
      chunks.push({
        id: Math.random().toString(36).substring(7),
        text: currentChunkText.trim(),
        status: 'idle',
      });
      currentChunkText = trimmed + " ";
    } else {
      currentChunkText += trimmed + " ";
    }
  });

  if (currentChunkText.trim().length > 0) {
    chunks.push({
      id: Math.random().toString(36).substring(7),
      text: currentChunkText.trim(),
      status: 'idle',
    });
  }

  return chunks;
}

export async function fetchAudioForChunk(text: string): Promise<string> {
  const response = await fetch(`/api/tts?text=${encodeURIComponent(text)}`);
  if (!response.ok) {
    throw new Error('Failed to fetch audio');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
