export interface TTSChunk {
  id: string;
  text: string;
  status: 'idle' | 'loading' | 'completed' | 'error';
  audioUrl?: string;
}

export interface TTSState {
  chunks: TTSChunk[];
  isPlaying: boolean;
  currentIndex: number;
}
