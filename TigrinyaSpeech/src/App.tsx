/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  Square, 
  Download, 
  Volume2, 
  MessageSquare, 
  CheckCircle2, 
  Loader2, 
  AlertCircle,
  History,
  Languages,
  RefreshCw,
  FileText,
  Plus,
  Trash2,
  ChevronRight,
  Flame,
  Rabbit,
  Sparkles,
  Sliders,
  Hourglass,
  AlertTriangle,
  BookOpen
} from 'lucide-react';
import { TTSChunk, TTSState } from './types';
import { splitTextIntoChunks, fetchAudioForChunk } from './services/ttsService';

async function fetchWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        // Fallback for failed fetches
        results[index] = null as any;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export default function App() {
  const [text, setText] = useState('ሰላም፡ ከመይ፡ ኢኹም? እዚ፡ ብፒፐር (Piper) ዝተዳለወ፡ ናይ፡ ትግርኛ፡ ድምጺ፡ መሳርሒ፡ እዩ።');
  const [state, setState] = useState<TTSState>({
    chunks: [],
    isPlaying: false,
    currentIndex: -1,
  });
  
  const [syncCode, setSyncCode] = useState<string>(() => localStorage.getItem('tigrinya_sync_code') || '');
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [tempCode, setTempCode] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mode, setMode] = useState<'listen' | 'download'>('listen');

  const [voiceMode, setVoiceMode] = useState<'slow' | 'normal' | 'fast' | 'exciting' | 'deep' | 'custom'>('normal');
  const [customRate, setCustomRate] = useState<number>(1.1);
  const [customPreservesPitch, setCustomPreservesPitch] = useState<boolean>(true);

  const voiceModeSettings = {
    slow: { rate: 0.75, preservesPitch: true, name: 'ቀስ ዝበለ', description: 'ንጹር ምንባብ፡ ንምምሃር ዝበለጸ', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/30' },
    normal: { rate: 1.0, preservesPitch: true, name: 'ንቡር/ስሩዕ', description: 'ከምቲ ልሙድ ምንባብ', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20 hover:border-blue-500/30' },
    fast: { rate: 1.35, preservesPitch: true, name: 'ቅልጡፍ', description: 'ቅልጡፍ ምንባብ', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20 hover:border-purple-500/30' },
    exciting: { rate: 1.18, preservesPitch: false, name: 'ንጡፍ ድምጺ', description: 'ደስ ዝብልን ንጡፍን ቃና', color: 'text-orange-400 bg-orange-500/10 border-orange-500/30 hover:border-orange-500/50' },
    deep: { rate: 1.18, preservesPitch: false, name: 'ዑሙቕ ቃና', description: 'ዑሙቕ ዝበለ ቃና', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20 hover:border-rose-500/30' },
    custom: { rate: customRate, preservesPitch: customPreservesPitch, name: 'ናትካ ቅዲ', description: 'ባዕልኻ እተስተኻኽሎ', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20 hover:border-yellow-500/30' }
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeChunkRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to active chunk
  useEffect(() => {
    if (state.isPlaying && activeChunkRef.current) {
      activeChunkRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [state.currentIndex, state.isPlaying]);

  // Auto-resize textarea
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [text]);

  const currentlyPlayingId = useRef<string | null>(null);
  const activePrefetchIds = useRef<Set<string>>(new Set());

  const handleStart = async () => {
    if (!text.trim()) return;

    const newChunks = splitTextIntoChunks(text);
    currentlyPlayingId.current = null;
    setState({
      chunks: newChunks,
      isPlaying: true,
      currentIndex: 0,
    });
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    currentlyPlayingId.current = null;
    setState(prev => ({ ...prev, isPlaying: false, currentIndex: -1 }));
  };

  // Active playback look-ahead pre-fetcher (pre-fetches exactly 1 upcoming segment sequentially)
  useEffect(() => {
    if (!state.isPlaying || state.currentIndex === -1 || state.chunks.length === 0) return;

    // Look ahead exactly 1 segment from the current index (fully sequential/non-parallel)
    const i = state.currentIndex + 1;
    if (i < state.chunks.length) {
      const chunk = state.chunks[i];
      if (!chunk) return;

      if (!chunk.audioUrl && chunk.status !== 'completed' && chunk.status !== 'loading' && !activePrefetchIds.current.has(chunk.id)) {
        const chunkId = chunk.id;
        const chunkText = chunk.text;
        const targetIndex = i;

        activePrefetchIds.current.add(chunkId);

        // Mark it as loading in state so the UI reflects that it is preparing
        setState(prev => {
          const updatedChunks = [...prev.chunks];
          if (updatedChunks[targetIndex] && updatedChunks[targetIndex].id === chunkId) {
            updatedChunks[targetIndex] = {
              ...updatedChunks[targetIndex],
              status: 'loading'
            };
          }
          return { ...prev, chunks: updatedChunks };
        });

        fetchAudioForChunk(chunkText)
          .then(url => {
            setState(prev => {
              const updatedChunks = [...prev.chunks];
              if (updatedChunks[targetIndex] && updatedChunks[targetIndex].id === chunkId) {
                updatedChunks[targetIndex] = {
                  ...updatedChunks[targetIndex],
                  status: 'completed',
                  audioUrl: url
                };
              }
              return { ...prev, chunks: updatedChunks };
            });
          })
          .catch(err => {
            console.error(`Active playback look-ahead pre-fetch failed for chunk ${targetIndex}:`, err);
            setState(prev => {
              const updatedChunks = [...prev.chunks];
              if (updatedChunks[targetIndex] && updatedChunks[targetIndex].id === chunkId) {
                updatedChunks[targetIndex] = {
                  ...updatedChunks[targetIndex],
                  status: 'error'
                };
              }
              return { ...prev, chunks: updatedChunks };
            });
          })
          .finally(() => {
            activePrefetchIds.current.delete(chunkId);
          });
      }
    }
  }, [state.isPlaying, state.currentIndex, state.chunks]);

  // Main playback execution and synchronization
  useEffect(() => {
    if (!state.isPlaying || state.currentIndex === -1 || state.currentIndex >= state.chunks.length) {
      if (state.currentIndex >= state.chunks.length) {
        setState(prev => ({ ...prev, isPlaying: false }));
      }
      currentlyPlayingId.current = null;
      return;
    }

    const currentChunk = state.chunks[state.currentIndex];

    // Safety guard: if we are already playing or have loaded this chunk, do nothing
    if (currentlyPlayingId.current === currentChunk.id) {
      return;
    }

    const playChunk = async () => {
      try {
        if (currentChunk.status === 'completed' && currentChunk.audioUrl) {
          currentlyPlayingId.current = currentChunk.id;
          if (audioRef.current) {
            audioRef.current.src = currentChunk.audioUrl;
            const settings = voiceModeSettings[voiceMode];
            audioRef.current.playbackRate = settings.rate;
            if ('preservesPitch' in audioRef.current) {
              audioRef.current.preservesPitch = settings.preservesPitch;
            } else if ('webkitPreservesPitch' in audioRef.current) {
              (audioRef.current as any).webkitPreservesPitch = settings.preservesPitch;
            } else if ('mozPreservesPitch' in audioRef.current) {
              (audioRef.current as any).mozPreservesPitch = settings.preservesPitch;
            }
            try {
              await audioRef.current.play();
            } catch (playError) {
              console.warn("Audio playback interrupted or deferred:", playError);
            }
          }
        } else if (currentChunk.status === 'error') {
          // Skip to next chunk directly if this chunk has encountered an error
          setState(prev => ({ ...prev, currentIndex: prev.currentIndex + 1 }));
        } else if (currentChunk.status !== 'loading') {
          // If the chunk is idle and not already loading, trigger normal load/play
          setState(prev => {
            const nextChunks = [...prev.chunks];
            nextChunks[state.currentIndex] = { ...nextChunks[state.currentIndex], status: 'loading' };
            return { ...prev, chunks: nextChunks };
          });

          const audioUrl = await fetchAudioForChunk(currentChunk.text);
          
          setState(prev => {
            const nextChunks = [...prev.chunks];
            nextChunks[state.currentIndex] = { 
              ...nextChunks[state.currentIndex], 
              status: 'completed', 
              audioUrl 
            };
            return { ...prev, chunks: nextChunks };
          });
        }
        // If status is 'loading', we simply do nothing and wait for the prefetcher to resolve it.
        // Once resolved to completed/audioUrl, state.chunks updates, triggering this effect again.
      } catch (error) {
        console.error("Playback error:", error);
        setState(prev => {
          const nextChunks = [...prev.chunks];
          if (nextChunks[state.currentIndex]) {
            nextChunks[state.currentIndex] = { ...nextChunks[state.currentIndex], status: 'error' };
          }
          
          const nextIndex = state.currentIndex + 1;
          const hasMore = nextIndex < nextChunks.length;
          
          setNotice({
            message: `ሓደ ክፍሊ ክንሰናዶ ከለና ጸገም ኣጋጢሙ። ዝተዳለወ ጥራይ ንምንባብ ንቕጽል ኣለና... (Skipping unready segment)`,
            type: 'warning'
          });
          
          return { 
            ...prev, 
            chunks: nextChunks,
            currentIndex: hasMore ? nextIndex : -1,
            isPlaying: hasMore
          };
        });
      }
    };

    playChunk();
  }, [state.isPlaying, state.currentIndex, state.chunks, voiceMode]);

  const onAudioEnded = () => {
    setState(prev => ({ ...prev, currentIndex: prev.currentIndex + 1 }));
  };

  // Dynamically update audio elements during playback
  useEffect(() => {
    if (audioRef.current) {
      const settings = voiceModeSettings[voiceMode];
      audioRef.current.playbackRate = settings.rate;
      if ('preservesPitch' in audioRef.current) {
        audioRef.current.preservesPitch = settings.preservesPitch;
      } else if ('webkitPreservesPitch' in audioRef.current) {
        (audioRef.current as any).webkitPreservesPitch = settings.preservesPitch;
      } else if ('mozPreservesPitch' in audioRef.current) {
        (audioRef.current as any).mozPreservesPitch = settings.preservesPitch;
      }
    }
  }, [voiceMode, customRate, customPreservesPitch]);

  // Sync with cloud
  useEffect(() => {
    if (syncCode && state.isPlaying && state.currentIndex >= 0) {
      const timer = setTimeout(async () => {
        try {
          const res = await fetch('/api/sync/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: syncCode,
              projectId: currentProjectId,
              text,
              currentIndex: state.currentIndex
            })
          });
          if (res.ok) {
            const data = await res.json();
            if (!currentProjectId) setCurrentProjectId(data.projectId);
            // Refresh project list if it's a new project
            fetchProjects(syncCode);
          }
        } catch (e) {
          console.error("Auto-sync failed", e);
        }
      }, 3000); // Debounce save
      return () => clearTimeout(timer);
    }
  }, [state.currentIndex, syncCode, text, state.isPlaying, currentProjectId]);

  const fetchProjects = async (code: string) => {
    try {
      const res = await fetch(`/api/sync/${code}`);
      if (res.ok) {
        const data = await res.json();
        const projectList = Object.values(data.projects || {}).sort((a: any, b: any) => b.updatedAt - a.updatedAt);
        setProjects(projectList);
        return data;
      }
    } catch (e) {
      console.error("Failed to fetch projects", e);
    }
    return null;
  };

  const handleSync = async () => {
    if (!tempCode || tempCode.length < 2) return;
    setIsSyncing(true);
    try {
      const data = await fetchProjects(tempCode);
      setSyncCode(tempCode);
      localStorage.setItem('tigrinya_sync_code', tempCode);
      
      if (data && data.lastActiveId && data.projects[data.lastActiveId]) {
        const lastProj = data.projects[data.lastActiveId];
        loadProject(lastProj);
      }
      
      setShowSyncModal(false);
    } catch (e) {
      alert("ምትእስሳር ኣይተዓወተን። በጃኹም ኢንተርነትኩም ኣረጋግጹ።");
    } finally {
      setIsSyncing(false);
    }
  };

  const loadProject = (project: any) => {
    setText(project.text);
    setCurrentProjectId(project.id);
    const newChunks = splitTextIntoChunks(project.text);
    setState({
      chunks: newChunks,
      isPlaying: false,
      currentIndex: project.currentIndex || 0
    });
    setIsSidebarOpen(false);
  };

  const deleteProject = async (id: string) => {
    if (!confirm("ነዚ ፋይል እዚ ክትድምስሶ ርግጸኛ ዲኻ?")) return;
    try {
      const res = await fetch('/api/sync/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: syncCode, projectId: id })
      });
      if (res.ok) {
        fetchProjects(syncCode);
        if (currentProjectId === id) {
          setCurrentProjectId(null);
          setText('');
          setState({ chunks: [], isPlaying: false, currentIndex: -1 });
        }
      }
    } catch (e) {
      console.error("Delete failed");
    }
  };

  const handleNewFile = () => {
    setCurrentProjectId(null);
    setText('');
    setState({ chunks: [], isPlaying: false, currentIndex: -1 });
    setIsSidebarOpen(false);
  };

  // Initial load
  useEffect(() => {
    if (syncCode) {
      fetchProjects(syncCode).then(data => {
        if (data && data.lastActiveId && data.projects[data.lastActiveId]) {
          loadProject(data.projects[data.lastActiveId]);
        }
      });
    }
  }, []);

  const [isMerging, setIsMerging] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [downloadTimeLeft, setDownloadTimeLeft] = useState<number | null>(null);
  const [backgroundPreFetchActive, setBackgroundPreFetchActive] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ message: string; type: 'success' | 'warning' | 'info' | 'error' } | null>(null);

  // Auto-dismiss notices after 6 seconds
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 6000);
      return () => clearTimeout(t);
    }
  }, [notice]);

  // Background pre-fetcher to make everything ready to download/play instantly
  useEffect(() => {
    if (state.isPlaying) return; // Don't interrupt active reading
    if (!text.trim()) return;

    const timer = setTimeout(async () => {
      const newChunks = splitTextIntoChunks(text);
      
      // Map and reuse existing audioUrls where text matches to prevent re-fetching
      const mergedChunks = newChunks.map(nc => {
        const matchingExist = state.chunks.find(ec => ec.text === nc.text);
        if (matchingExist && matchingExist.audioUrl) {
          return {
            ...nc,
            status: 'completed' as const,
            audioUrl: matchingExist.audioUrl
          };
        }
        return nc;
      });

      // Update state with newly split/merged chunks
      setState(prev => {
        if (prev.isPlaying) return prev; // Safety check
        return {
          ...prev,
          chunks: mergedChunks
        };
      });

      // Now pre-fetch the ones that are still missing, sequentially (non-parallel)
      const missingIndexesAndChunks = mergedChunks
        .map((c, i) => ({ index: i, chunk: c }))
        .filter(item => !item.chunk.audioUrl);

      if (missingIndexesAndChunks.length === 0) return;

      setBackgroundPreFetchActive(true);
      try {
        await fetchWithConcurrencyLimit<{ index: number; chunk: TTSChunk }, void>(
          missingIndexesAndChunks,
          1, // Concurrency limit of 1 for background pre-fetching (strictly sequential)
          async (item) => {
            try {
              const url = await fetchAudioForChunk(item.chunk.text);
              setState(prev => {
                if (prev.isPlaying) return prev; // Safety check
                const updatedChunks = [...prev.chunks];
                if (updatedChunks[item.index] && updatedChunks[item.index].id === item.chunk.id) {
                  updatedChunks[item.index] = {
                    ...updatedChunks[item.index],
                    status: 'completed',
                    audioUrl: url
                  };
                }
                return { ...prev, chunks: updatedChunks };
              });
            } catch (err) {
              console.error("Background pre-fetch failed:", err);
            }
          }
        );
      } finally {
        setBackgroundPreFetchActive(false);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [text, state.isPlaying]);

  const generateAudioForDownload = async () => {
    if (!text.trim()) return;
    setIsGeneratingAll(true);
    try {
      let currentChunks = state.chunks;
      const currentReconstructedText = currentChunks.map(c => c.text).join(' ').replace(/\s+/g, ' ').trim();
      const cleanText = text.replace(/\s+/g, ' ').trim();
      
      if (currentChunks.length === 0 || currentReconstructedText !== cleanText) {
        currentChunks = splitTextIntoChunks(text);
        setState(prev => ({ ...prev, chunks: currentChunks, currentIndex: -1, isPlaying: false }));
      }

      // Fetch all missing audio URLs sequentially with concurrency limit of 1
      await fetchWithConcurrencyLimit<TTSChunk, string | null>(
        currentChunks,
        1,
        async (chunk: TTSChunk, index: number): Promise<string | null> => {
          if (chunk.audioUrl) {
            return chunk.audioUrl;
          }
          try {
            const audioUrl = await fetchAudioForChunk(chunk.text);
            
            // Cache in React state
            setState(prev => {
              const nextChunks = [...prev.chunks];
              if (nextChunks[index] && nextChunks[index].id === chunk.id) {
                nextChunks[index] = {
                  ...nextChunks[index],
                  status: 'completed',
                  audioUrl
                };
              }
              return { ...prev, chunks: nextChunks };
            });
            
            return audioUrl;
          } catch (err) {
            console.error(`Failed to pre-fetch audio for chunk ${index}:`, err);
            return null;
          }
        }
      );
    } catch (err) {
      console.error("Manual generate all failed:", err);
    } finally {
      setIsGeneratingAll(false);
    }
  };

  const downloadFullAudio = async () => {
    let currentChunks = state.chunks;
    const currentReconstructedText = currentChunks.map(c => c.text).join(' ').replace(/\s+/g, ' ').trim();
    const cleanText = text.replace(/\s+/g, ' ').trim();
    
    if (currentChunks.length === 0 || currentReconstructedText !== cleanText) {
      if (!text.trim()) return;
      currentChunks = splitTextIntoChunks(text);
      setState(prev => ({ ...prev, chunks: currentChunks, currentIndex: -1, isPlaying: false }));
    }

    setIsMerging(true);
    let fallbackUrl: string | null = null;
    let countdownInterval: any = null;

    try {
      const missingChunks = currentChunks.filter(c => !c.audioUrl);
      
      if (missingChunks.length > 0) {
        // High-speed parallel estimate: base network latency plus concurrent response scaling
        const estSec = Math.max(2, Math.round(missingChunks.length * 0.25 + 1.2));
        setDownloadTimeLeft(estSec);
        
        countdownInterval = setInterval(() => {
          setDownloadTimeLeft(prev => {
            if (prev === null || prev <= 1) return 1; // Stay at 1s until fetches actually finish
            return prev - 1;
          });
        }, 1000);
      } else {
        setDownloadTimeLeft(1); // Prepared segments merge very fast
      }

      // Fetch all missing audio URLs sequentially with concurrency limit of 1
      const audioUrls = await fetchWithConcurrencyLimit<TTSChunk, string | null>(
        currentChunks,
        1, // Concurrency limit of 1 for active download fetches (strictly sequential)
        async (chunk: TTSChunk, index: number): Promise<string | null> => {
          if (chunk.audioUrl) {
            return chunk.audioUrl;
          }
          try {
            const audioUrl = await fetchAudioForChunk(chunk.text);
            
            // Cache in React state so the player can use it immediately without fetching again
            setState(prev => {
              const nextChunks = [...prev.chunks];
              if (nextChunks[index] && nextChunks[index].id === chunk.id) {
                nextChunks[index] = {
                  ...nextChunks[index],
                  status: 'completed',
                  audioUrl
                };
              }
              return { ...prev, chunks: nextChunks };
            });
            
            return audioUrl;
          } catch (err) {
            console.error(`Failed to pre-fetch audio for chunk ${index}:`, err);
            return null;
          }
        }
      );

      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      setDownloadTimeLeft(0); // Initiating audio merge

      const validAudioUrls = audioUrls.filter((url): url is string => !!url);
      if (validAudioUrls.length === 0) {
        throw new Error('All audio fetches failed');
      }

      if (validAudioUrls.length < currentChunks.length) {
        setNotice({
          message: `ገለ ክፍልታት ንምሕዋስ ኣይተሳኽዕን። ዝተዳለዉ (${validAudioUrls.length} ካብ ${currentChunks.length}) ጥраይ ኣወሃሂድና ነዳልወልኩም ኣለና። (Merging ready chunks)`,
          type: 'warning'
        });
      }

      fallbackUrl = validAudioUrls[0];

      if (validAudioUrls.length === 1) {
        const a = document.createElement('a');
        a.href = fallbackUrl;
        a.download = `tigrinya_tts_partial_${Date.now()}.wav`;
        a.click();
        return;
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      
      // Decode all audio buffers in parallel as well
      const audioBuffers = await Promise.all(
        validAudioUrls.map(async (url) => {
          const audioResponse = await fetch(url);
          const arrayBuffer = await audioResponse.arrayBuffer();
          return await ctx.decodeAudioData(arrayBuffer);
        })
      );

      // Merge buffers
      const totalLength = audioBuffers.reduce((acc, b) => acc + b.length, 0);
      const numberOfChannels = audioBuffers[0].numberOfChannels;
      const sampleRate = audioBuffers[0].sampleRate;
      const outBuffer = ctx.createBuffer(numberOfChannels, totalLength, sampleRate);

      for (let channel = 0; channel < numberOfChannels; channel++) {
        let offset = 0;
        for (const buffer of audioBuffers) {
          outBuffer.copyToChannel(buffer.getChannelData(channel), channel, offset);
          offset += buffer.length;
        }
      }

      // Convert buffer to WAV
      const numOfChan = outBuffer.numberOfChannels;
      const length = outBuffer.length * numOfChan * 2 + 44;
      const bufferArray = new ArrayBuffer(length);
      const view = new DataView(bufferArray);
      const channels: Float32Array[] = [];
      let pos = 0;

      const setUint16 = (data: number) => {
        view.setUint16(pos, data, true);
        pos += 2;
      };

      const setUint32 = (data: number) => {
        view.setUint32(pos, data, true);
        pos += 4;
      };

      setUint32(0x46464952); // "RIFF"
      setUint32(length - 8);  // file length - 8
      setUint32(0x45564157); // "WAVE"

      setUint32(0x20746d66); // "fmt " chunk
      setUint32(16);         // length = 16
      setUint16(1);          // PCM format = 1
      setUint16(numOfChan);
      setUint32(sampleRate);
      setUint32(sampleRate * 2 * numOfChan); // byte rate
      setUint16(numOfChan * 2);              // block align
      setUint16(16);                         // bits per sample

      setUint32(0x61746164); // "data" chunk
      setUint32(length - pos - 4); // chunk length

      for (let i = 0; i < outBuffer.numberOfChannels; i++) {
        channels.push(outBuffer.getChannelData(i));
      }

      let offset = 0;
      while (pos < length) {
        for (let i = 0; i < numOfChan; i++) {
          let sample = Math.max(-1, Math.min(1, channels[i][offset]));
          sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          view.setInt16(pos, sample, true);
          pos += 2;
        }
        offset++;
      }

      const blob = new Blob([bufferArray], { type: "audio/wav" });
      const mergedUrl = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = mergedUrl;
      a.download = `tigrinya_tts_full_${Date.now()}.wav`;
      a.click();
      
      setTimeout(() => URL.revokeObjectURL(mergedUrl), 60000);
    } catch (e) {
      console.error("Audio merge failed, downloading first chunk as fallback", e);
      if (fallbackUrl) {
        const a = document.createElement('a');
        a.href = fallbackUrl;
        a.download = `tigrinya_tts_fallback_${Date.now()}.wav`;
        a.click();
      } else {
        alert("ድምጺ ኣብ ምውራድ ጸገም ኣጋጢሙ። በጃኹም ኢንተርነትኩም ኣረጋግጹ።");
      }
    } finally {
      setIsMerging(false);
      setDownloadTimeLeft(null);
      if (countdownInterval) {
        clearInterval(countdownInterval);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#F5F5F0] font-sans selection:bg-[#F27D26] selection:text-white">
      <audio ref={audioRef} onEnded={onAudioEnded} className="hidden" />

      {/* Floating Toast Notice */}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-[200] max-w-md w-[calc(100%-2rem)]"
          >
            <div className={`p-4 rounded-2xl border backdrop-blur-md shadow-2xl flex items-start gap-3 ${
              notice.type === 'error' ? 'bg-red-500/20 border-red-500/40 text-red-200' :
              notice.type === 'warning' ? 'bg-orange-500/20 border-orange-500/40 text-orange-200' :
              notice.type === 'success' ? 'bg-green-500/20 border-green-500/40 text-green-200' :
              'bg-blue-500/20 border-blue-500/40 text-blue-200'
            }`}>
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-semibold">{notice.message}</p>
              </div>
              <button 
                onClick={() => setNotice(null)} 
                className="text-white/40 hover:text-white/80 font-bold font-mono px-1.5 py-0.5 hover:bg-white/5 rounded cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Navigation */}
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between sticky top-0 bg-[#050505]/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#F27D26] rounded-lg flex items-center justify-center">
            <Volume2 className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold tracking-tight text-xl">ትግርኛ <span className="text-[#F27D26]">TTS</span></span>
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-white/60">
          <a href="#" className="hover:text-white transition-colors">ድምጽታት</a>
          <a href="#" className="hover:text-white transition-colors">ኤፒኣይ</a>
          <a href="#" className="hover:text-white transition-colors">ብዛዕባና</a>
        </div>
        <div className="flex items-center gap-3">
          {syncCode && (
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="bg-white/5 border border-white/10 hover:bg-white/10 px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              ፋይላተይ
            </button>
          )}
          {syncCode ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-green-500 uppercase tracking-tighter">ንጡፍ ምትእስሳር: {syncCode}</span>
              <button 
                onClick={() => {
                  setSyncCode('');
                  localStorage.removeItem('tigrinya_sync_code');
                }}
                className="ml-1 text-white/20 hover:text-white transition-colors cursor-pointer"
              >
                <History className="w-3 h-3 rotate-180" />
              </button>
            </div>
          ) : (
            <button 
              onClick={() => setShowSyncModal(true)}
              className="bg-white/5 border border-white/10 hover:bg-white/10 px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              መሳርሒታት ኣመሳስል
            </button>
          )}
        </div>
      </nav>

      <AnimatePresence>
        {showSyncModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#111] border border-white/10 rounded-3xl p-8 max-w-sm w-full relative"
            >
              <div className="space-y-6 text-center">
                <div className="w-16 h-16 bg-[#F27D26]/20 rounded-2xl flex items-center justify-center mx-auto text-[#F27D26]">
                  <RefreshCw className={`w-8 h-8 ${isSyncing ? 'animate-spin' : ''}`} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">ክትእስስር</h3>
                  <p className="text-sm text-white/40">ጽሑፍካን ምዕባለኻን ንምዕቃብ ኮድ የእቱ (ንኣብነት 2222)። ካብ ካልእ ኮምፒተር ንምቕጻል ነዚ ኮድ እዚ ተጠቐም።</p>
                </div>
                <input 
                  type="text" 
                  maxLength={10}
                  placeholder="ናይ ምትእስሳር ኮድ የእቱ"
                  value={tempCode}
                  onChange={(e) => setTempCode(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center text-xl font-bold tracking-[0.5em] focus:border-[#F27D26] outline-none transition-all"
                />
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowSyncModal(false)}
                    className="flex-1 bg-white/5 hover:bg-white/10 py-3 rounded-xl font-bold transition-all cursor-pointer"
                  >
                    ሰርዝ
                  </button>
                  <button 
                    onClick={handleSync}
                    disabled={!tempCode || tempCode.length < 2 || isSyncing}
                    className="flex-1 bg-[#F27D26] hover:bg-[#ff8c3a] disabled:opacity-50 text-white py-3 rounded-xl font-bold transition-all cursor-pointer"
                  >
                    {isSyncing ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'ኮድ ኣረጋግጽ'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Files Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed top-0 right-0 h-full w-full max-w-sm bg-[#0a0a0a] border-l border-white/10 z-[120] p-8 shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold">ፋይላተይ</h2>
                <button 
                  onClick={handleNewFile}
                  className="p-2 bg-[#F27D26] rounded-xl hover:scale-110 active:scale-90 transition-all text-white cursor-pointer"
                  title="ሓድሽ ፋይል"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-grow overflow-y-auto custom-scrollbar space-y-4 pr-2">
                {projects.length === 0 ? (
                  <div className="text-center py-20 text-white/20">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-10" />
                    <p className="text-sm">ዝተዓቀበ ፋይል የለን።<br/>ንምዕቃብ ምንባብ ጀምር።</p>
                  </div>
                ) : (
                  projects.map((project) => (
                    <div 
                      key={project.id}
                      className={`group p-4 rounded-3xl border transition-all cursor-pointer flex items-center justify-between ${
                        currentProjectId === project.id 
                        ? 'bg-[#F27D26]/10 border-[#F27D26]/30' 
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                      onClick={() => loadProject(project)}
                    >
                      <div className="flex-grow min-w-0 pr-4">
                        <h4 className={`font-bold truncate ${currentProjectId === project.id ? 'text-[#F27D26]' : ''}`}>
                          {project.name}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-white/30 uppercase tracking-widest mt-1">
                          <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>ክፍሊ {project.currentIndex + 1}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteProject(project.id);
                          }}
                          className={`${currentProjectId === project.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} p-2 text-white/20 hover:text-red-500 transition-all cursor-pointer`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronRight className={`w-5 h-5 ${currentProjectId === project.id ? 'text-[#F27D26]' : 'text-white/20'}`} />
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-white/5">
                 <div className="text-[10px] text-white/20 uppercase tracking-[0.2em] font-black text-center mb-4">አብዚ ይዕቀብ ምስ: {syncCode}</div>
                 <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="w-full py-4 bg-white/5 border border-white/10 rounded-2xl font-bold hover:bg-white/10 transition-all cursor-pointer"
                >
                  ዕጸው
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="max-w-[1700px] mx-auto px-6 py-12 space-y-12">
        {/* Choice Segmented Mode Control */}
        <div className="flex justify-center">
          <div className="bg-[#111] border border-white/10 p-1.5 rounded-[2rem] flex gap-2 w-full max-w-2xl shadow-2xl relative overflow-hidden backdrop-blur-md">
            <button
              onClick={() => {
                setMode('listen');
                handleStop();
              }}
              className={`flex-1 flex items-center justify-center gap-3 py-4 px-6 rounded-[1.5rem] font-black text-base md:text-lg transition-all duration-300 cursor-pointer ${
                mode === 'listen'
                  ? 'bg-gradient-to-r from-[#F27D26] to-[#ff9800] text-white shadow-xl scale-[1.02]'
                  : 'text-white/40 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              <Play className="w-5 h-5 fill-current" />
              <span>ምስማዕ / ምንባብ (Listen)</span>
            </button>
            <button
              onClick={() => {
                setMode('download');
                handleStop();
              }}
              className={`flex-1 flex items-center justify-center gap-3 py-4 px-6 rounded-[1.5rem] font-black text-base md:text-lg transition-all duration-300 cursor-pointer ${
                mode === 'download'
                  ? 'bg-gradient-to-r from-[#26b459] to-[#2ecc71] text-white shadow-xl scale-[1.02]'
                  : 'text-white/40 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              <Download className="w-5 h-5" />
              <span>ድምጺ ምውራድ (Download)</span>
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {mode === 'listen' ? (
            <motion.div
              key="listen"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-12"
            >
              {/* Top Section: Active Reading Display Grid (Left Brown Box, Center Green Box, Right Blue Box) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* Left Brown Box: Warning / Personal Responsibility */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="lg:col-span-3 xl:col-span-2 relative group flex flex-col h-full"
                >
                  <div className="absolute -inset-1 bg-amber-700/10 rounded-[2.5rem] blur-xl group-hover:bg-amber-700/20 transition-all duration-500" />
                  <div className="relative flex-1 h-full bg-[#120e0a] border-4 border-[#5c3e21]/70 rounded-[2.5rem] pl-8 pr-8 py-8 ml-[-300px] mr-[280px] mb-[-450px] mt-[-100px] flex flex-col justify-between shadow-2xl overflow-hidden text-center">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl" />
                    
                    <div className="space-y-6 my-auto py-4">
                      <div className="w-14 h-14 bg-amber-950/40 border border-[#5c3e21]/50 rounded-2xl flex items-center justify-center text-[#F27D26] mx-auto shadow-inner">
                        <AlertTriangle className="w-[25px] h-[25px]" />
                      </div>
                      <h3 className="text-[30px] font-bold text-[#c78044] tracking-tight">ብናይ ባዕልኻ ሓላፍነት</h3>
                      <p className="text-[35px] text-amber-200/60 leading-relaxed font-light">
                        ነዚ መሳርሒ ብናትካ ውልቃዊ ስግኣትን ሓላፍነትን ጥራይ ተጠቐመሉ። እዚ ቴክኖሎጂ ብAI ዝተዳለወ ብምዃኑ ሓላፍነት ናይቲ ተጠቃሚ ጥራይ እዩ።
                      </p>
                    </div>

                    <div className="border-t border-[#5c3e21]/30 pt-4 text-[20px] font-mono text-amber-600/50 uppercase tracking-widest mt-auto">
                      RISK NOTIFICATION • ሓላፍነት
                    </div>
                  </div>
                </motion.div>

                {/* Center Green Box */}
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="lg:col-span-6 xl:col-span-8 relative group flex flex-col h-full"
                >
                  <div className="absolute -inset-1 bg-green-500/20 rounded-[3rem] blur-xl group-hover:bg-green-500/30 transition-all duration-500" />
                  <div className="relative flex-1 bg-[#0a0a0a] border-4 border-green-500 rounded-[2.5rem] pt-8 md:pt-12 pb-[48px] pl-12 pr-12 mr-0 ml-[-280px] mb-0 mt-0 w-[1650px] min-h-[400px] flex flex-col items-center justify-center text-center shadow-2xl overflow-hidden">
                    <AnimatePresence mode="wait">
                      {state.currentIndex === -1 ? (
                        <motion.div 
                          key="placeholder"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="space-y-6"
                        >
                          <div className="flex items-center justify-center gap-2 text-[#F27D26] font-medium text-sm tracking-widest uppercase">
                            <Languages className="w-4 h-4" />
                            <span>ድምጺ ንምድላው ድሉው እዩ</span>
                          </div>
                          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[0.9]">
                            ትግርኛ <br />
                            <span className="text-white/20 italic font-serif">ምንባብ ቅዲ</span>
                          </h1>
                          <p className="text-[24px] text-white bg-[#28704f] max-w-md mx-auto font-light leading-relaxed px-6 py-2 rounded-2xl">
                            ኣብ ታሕቲ ጽሑፍ የእቱ እሞ ብድምጺ ንምንባብ "ኣንብብ" ዝብል ቁልፊ ጠውቕ።
                          </p>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={state.currentIndex}
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 1.05, y: -10 }}
                          className="w-full"
                        >
                          <p className="text-3xl md:text-5xl font-bold leading-tight text-white mb-8">
                            {state.chunks[state.currentIndex]?.text}
                          </p>
                          
                          <div className="flex items-center justify-center gap-4">
                            <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-xs font-mono text-white/40">
                              ክፍሊ {(state.currentIndex + 1).toString().padStart(2, '0')} ካብ {state.chunks.length}
                            </div>
                            {state.chunks[state.currentIndex]?.status === 'loading' && (
                              <Loader2 className="w-5 h-5 text-[#F27D26] animate-spin" />
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Float visualizer inside the box */}
                    {state.isPlaying && (
                      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xs h-8 flex items-end justify-center gap-1 opacity-20">
                        {Array.from({ length: 32 }).map((_, i) => (
                          <motion.div
                            key={i}
                            animate={{ height: [4, Math.random() * 24 + 4, 4] }}
                            transition={{ repeat: Infinity, duration: 0.5 + Math.random() * 0.5 }}
                            className="w-1 bg-green-500 rounded-full"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>

                {/* Right Blue Box: Instructions Guidelines */}
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="lg:col-span-3 xl:col-span-2 relative group flex flex-col h-full"
                >
                  <div className="absolute -inset-1 bg-blue-500/10 rounded-[2.5rem] blur-xl group-hover:bg-blue-500/20 transition-all duration-500" />
                  <div className="relative flex-1 h-full bg-[#090e14] border-4 border-dotted border-blue-900/70 rounded-none p-8 flex flex-col justify-between shadow-2xl overflow-hidden text-center ml-[300px] mr-[-300px] mb-[-450px] mt-[-100px]">
                    <div className="absolute top-0 left-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl" />

                    <div className="space-y-6 my-auto py-4 text-[23px]">
                      <div className="w-14 h-14 bg-blue-950/40 border border-blue-900/40 rounded-2xl flex items-center justify-center text-blue-400 mx-auto shadow-inner">
                        <BookOpen className="w-7 h-7" />
                      </div>
                      <h3 className="text-[25px] font-bold text-blue-400 tracking-tight">መምርሒ ድምጺ</h3>
                      
                      <div className="text-left text-sm text-blue-200/60 space-y-3.5 leading-relaxed font-light">
                        <div className="flex items-start gap-2">
                          <span className="text-blue-500 font-bold mt-0.5">•</span>
                          <span className="text-[20px] font-['Verdana']">ስርዓተ-ነጥብታት (ምልክት ሕቶ፡ ሰረዝ) ምጥቃም ጽሬት ንባብ የዕቢ እዩ።</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-blue-500 font-bold mt-0.5">•</span>
                          <span className="text-[20px] font-['Verdana']">ድምጺ ንምስማዕ "ኣንብብ / ምስማዕ" ዝብል ቁልፊ ተጠቐም።</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-blue-500 font-bold mt-0.5">•</span>
                          <span className="text-[20px] font-['Verdana']">ንድምጺ ንምውራድ ድማ "ድምጺ ምውራድ" ዝብል ተጠቐም።</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-blue-900/30 pt-4 text-[20px] font-mono text-blue-500/40 uppercase tracking-widest mt-auto">
                      USAGE GUIDELINES • መምርሒታት
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Dynamic Voice Settings & Tuning Dashboard */}
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-[#0a0a0a] border border-white/10 rounded-[2.5rem] p-8 md:p-10 shadow-2xl space-y-8 mb-[7px]"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-[#F27D26] animate-pulse" />
                      <h3 className="text-sm font-bold uppercase tracking-widest text-[#F27D26]">ቅልጣፈን ድምጽን</h3>
                    </div>
                    <p className="text-xl font-bold tracking-tight text-white">ናይ ድምጺ ቅድታት</p>
                    <p className="text-sm text-white/40 mt-1">ናይ ምንባብ ቅልጣፈን ቃና ድምጽን ኣብዚ ቀይር።</p>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    {state.isPlaying && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 text-green-500 rounded-full text-xs font-mono font-bold">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ቀጥታ
                      </div>
                    )}
                    {state.isPlaying ? (
                      <button 
                        onClick={handleStop}
                        className="group flex items-center gap-3 bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-[1.5rem] font-bold transition-all shadow-xl hover:scale-[1.02] active:scale-95 text-base cursor-pointer"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        ድምጺ ኣቋርጽ
                      </button>
                    ) : (
                      <button 
                        onClick={handleStart}
                        className="group flex items-center gap-3 bg-[#F27D26] hover:bg-[#ff8c3a] text-white px-8 py-4 rounded-[1.5rem] font-black text-base transition-all shadow-xl hover:scale-[1.03] active:scale-95 whitespace-nowrap cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        ኣንብብ
                      </button>
                    )}
                  </div>
                </div>

                {/* Preset Buttons Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  {/* Slow */}
                  <button
                    onClick={() => setVoiceMode('slow')}
                    className={`p-5 rounded-3xl border text-left transition-all cursor-pointer relative ${
                      voiceMode === 'slow' 
                        ? 'bg-emerald-500/5 border-emerald-500/50 ring-1 ring-emerald-500/20' 
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className={`p-2.5 rounded-xl ${voiceMode === 'slow' ? 'bg-emerald-500 text-black' : 'bg-white/5 text-emerald-400'}`}>
                        <Hourglass className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-emerald-400/80 px-2 py-0.5 bg-emerald-500/20 rounded-full">
                        0.75x
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-sm">Slow & Patient</h4>
                    <p className="text-[10px] text-white/40 leading-snug mt-1">Clear pronunciation</p>
                  </button>

                  {/* Normal */}
                  <button
                    onClick={() => setVoiceMode('normal')}
                    className={`p-5 rounded-3xl border text-left transition-all cursor-pointer relative ${
                      voiceMode === 'normal' 
                        ? 'bg-blue-500/5 border-blue-500/50 ring-1 ring-blue-500/20' 
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className={`p-2.5 rounded-xl ${voiceMode === 'normal' ? 'bg-blue-500 text-black' : 'bg-white/5 text-blue-400'}`}>
                        <Volume2 className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-blue-400/80 px-2 py-0.5 bg-blue-500/20 rounded-full">
                        1.00x
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-sm">Standard flow</h4>
                    <p className="text-[10px] text-white/40 leading-snug mt-1">Natural cadence</p>
                  </button>

                  {/* Fast */}
                  <button
                    onClick={() => setVoiceMode('fast')}
                    className={`p-5 rounded-3xl border text-left transition-all cursor-pointer relative ${
                      voiceMode === 'fast' 
                        ? 'bg-purple-500/5 border-purple-500/50 ring-1 ring-purple-500/20' 
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className={`p-2.5 rounded-xl ${voiceMode === 'fast' ? 'bg-purple-500 text-white' : 'bg-white/5 text-purple-400'}`}>
                        <Rabbit className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-purple-400/80 px-2 py-0.5 bg-purple-500/20 rounded-full">
                        1.35x
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-sm">Fast Speed</h4>
                    <p className="text-[10px] text-white/40 leading-snug mt-1">Rapid brief reading</p>
                  </button>

                  {/* Exciting */}
                  <button
                    onClick={() => setVoiceMode('exciting')}
                    className={`p-5 rounded-3xl border text-left transition-all cursor-pointer relative ${
                      voiceMode === 'exciting' 
                        ? 'bg-orange-500/5 border-orange-500/50 ring-1 ring-orange-500/20' 
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className={`p-2.5 rounded-xl ${voiceMode === 'exciting' ? 'bg-orange-500 text-white' : 'bg-white/5 text-orange-400'}`}>
                        <Flame className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-orange-400/80 px-1.5 py-0.5 bg-orange-500/20 rounded-full">
                        Exciting
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-sm">Vivid & Lively</h4>
                    <p className="text-[10px] text-white/40 leading-snug mt-1">Exciting performance</p>
                  </button>

                  {/* Deep */}
                  <button
                    onClick={() => setVoiceMode('deep')}
                    className={`p-5 rounded-3xl border text-left transition-all cursor-pointer relative ${
                      voiceMode === 'deep' 
                        ? 'bg-rose-500/5 border-rose-500/50 ring-1 ring-rose-500/20' 
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className={`p-2.5 rounded-xl ${voiceMode === 'deep' ? 'bg-rose-500 text-white' : 'bg-white/5 text-rose-400'}`}>
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-rose-400/80 px-2 py-0.5 bg-rose-500/20 rounded-full">
                        1.18x
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-sm">Deep Cinema</h4>
                    <p className="text-[10px] text-white/40 leading-snug mt-1">Immersive baritone</p>
                  </button>

                  {/* Custom Tuning */}
                  <button
                    onClick={() => setVoiceMode('custom')}
                    className={`p-5 rounded-3xl border text-left transition-all cursor-pointer relative ${
                      voiceMode === 'custom' 
                        ? 'bg-yellow-500/5 border-yellow-500/50 ring-1 ring-yellow-500/20' 
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className={`p-2.5 rounded-xl ${voiceMode === 'custom' ? 'bg-yellow-500 text-black' : 'bg-white/5 text-yellow-400'}`}>
                        <Sliders className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-yellow-400/80 px-2 py-0.5 bg-yellow-500/20 rounded-full">
                        Manual
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-sm">Custom Tune</h4>
                    <p className="text-[10px] text-white/40 leading-snug mt-1">Manual sliders rate</p>
                  </button>
                </div>

                {/* Animated Custom Sliders Container */}
                <AnimatePresence initial={false}>
                  {voiceMode === 'custom' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-white/5 pt-6"
                    >
                      <div className="grid md:grid-cols-2 gap-8 bg-white/[0.02] border border-white/5 p-6 rounded-2xl">
                        {/* Playback rate slider */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center text-sm font-bold text-white/65">
                            <span className="flex items-center gap-2">
                              <Sliders className="w-4 h-4 text-yellow-400" />
                              ቅልጣፈ ድምጺ
                            </span>
                            <span className="text-yellow-400 text-xs font-mono font-bold px-2 py-0.5 bg-yellow-500/10 rounded-md animate-pulse">
                              {customRate.toFixed(2)}x
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.05"
                            value={customRate}
                            onChange={(e) => setCustomRate(parseFloat(e.target.value))}
                            className="w-full accent-yellow-400 bg-white/10 rounded-full h-2 cursor-pointer"
                          />
                          <div className="flex justify-between text-[10px] text-white/20 font-bold uppercase tracking-widest">
                            <span>0.5x (ቀስ ዝበለ)</span>
                            <span>1.0x (ልሙድ)</span>
                            <span>2.0x (ቅልጡፍ)</span>
                          </div>
                        </div>

                        {/* Pitch Shift Toggle */}
                        <div className="flex flex-col justify-center">
                          <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl hover:border-white/20 transition-all cursor-pointer select-none"
                               onClick={() => setCustomPreservesPitch(prev => !prev)}>
                            <div className="space-y-1 pr-4">
                              <p className="text-sm font-bold text-white">ናቱ ናይ ድምጺ ቃና ዓቅብ</p>
                              <p className="text-xs text-white/40">እንተነጢፉ፡ ምንባብ ክቀላጠፍ ከሎ ቃና ድምጺ ከይተበላሸወ ይዕቀብ።</p>
                            </div>
                            <div className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ${customPreservesPitch ? 'bg-yellow-500' : 'bg-white/10'}`}>
                              <div className={`bg-black w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ${customPreservesPitch ? 'translate-x-6' : 'translate-x-0'}`} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="download"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-12"
            >
              {/* Specialized Download Arena Card */}
              <div className="relative group">
                <div className="absolute -inset-1 bg-green-500/10 rounded-[3rem] blur-xl group-hover:bg-green-500/20 transition-all duration-500" />
                <div className="relative bg-[#0a0a0a] border-4 border-dashed border-green-500/40 rounded-[2.5rem] p-8 md:p-12 flex flex-col items-center justify-center text-center shadow-2xl min-h-[350px]">
                  <div className="w-20 h-20 bg-green-500/10 border border-green-500/30 rounded-full flex items-center justify-center mb-6 text-green-400">
                    <Download className="w-10 h-10" />
                  </div>
                  <h2 className="text-3xl font-black tracking-tight text-white mb-2">ምሉእ ድምጺ ንምውራድ ድሉው እዩ</h2>
                  <p className="text-base text-white/50 max-w-xl mb-8 leading-relaxed">
                    ነዚ ኣብ ታሕቲ ዘሎ ጽሑፍ ተንቲንና፡ ናይ ኩሉ ክፍልታት ፍሉይ Wav ድምጺ ኣወሃሂድና ክነዳልወልኩም ኢና። ንምውራድ ነቲ ቁልፊ ጠውቕዎ።
                  </p>

                  {/* Complete composite Download Box */}
                  <div className="w-full max-w-xl bg-white/[0.02] border border-white/5 p-6 md:p-8 rounded-3xl space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Step 1: Generate Button */}
                      <button 
                        onClick={generateAudioForDownload}
                        disabled={!text.trim() || isGeneratingAll || isMerging}
                        className={`font-black py-5 px-6 rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 text-center w-[380px] max-w-full text-[25px] leading-[16px] not-italic no-underline font-['Arial'] border-[#8c4a99] outline-none border ${
                          state.chunks.length > 0 && state.chunks.every(c => c.audioUrl)
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-white/5 text-white hover:bg-white/10'
                        } disabled:opacity-30`}
                      >
                        {isGeneratingAll ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin text-green-400" />
                            <span>ድምጺ ይዳሎ ኣሎ... ⬅️</span>
                          </>
                        ) : state.chunks.length > 0 && state.chunks.every(c => c.audioUrl) ? (
                          <>
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                            <span>ድምጺ ድሉው እዩ ⬅️</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-5 h-5 text-[#F27D26]" />
                            <span>ድምጺ ኣዳልው ⬅️</span>
                          </>
                        )}
                      </button>

                      {/* Step 2: Download Button */}
                      <button 
                        onClick={downloadFullAudio}
                        disabled={!text.trim() || isMerging || isGeneratingAll}
                        className="text-[19px] bg-gradient-to-r from-[#26b459] to-[#2ecc71] text-white font-black py-5 px-6 rounded-2xl hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-30 cursor-pointer flex items-center justify-center gap-2 text-center w-full outline-none"
                      >
                        {isMerging ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>ድምጺ ንጥርንፍ ኣለና...</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-5 h-5" />
                            <span>ድምጺ ኣውርድ</span>
                          </>
                        )}
                      </button>
                    </div>
                    
                    <div className="text-xs text-white/40 mt-1 flex flex-col gap-2 text-left">
                      {state.chunks.length === 0 ? (
                        <span className="text-center italic text-white/30 font-bold">ምሉእ ድምጺ ንምውራድ ኣብዚ ጠውቕ</span>
                      ) : (
                        <>
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-[15px] uppercase font-semibold">
                            <span className="text-[15px] bg-[#000000] text-[#26b459] font-bold px-1.5 py-0.5 rounded">{state.chunks.filter(c => c.audioUrl).length} ካብ {state.chunks.length} ክፍሊ ተዳልዩ</span>
                            {isMerging ? (
                              downloadTimeLeft !== null && downloadTimeLeft > 0 ? (
                                <span className="text-yellow-400 text-[16px] font-bold animate-pulse font-[Arial]">~{downloadTimeLeft} ሰከንድ ተረፉ (ብሓባር)</span>
                              ) : (
                                <span className="text-green-400 text-[16px] font-bold animate-pulse font-[Arial]">ኣውዲዮ ንጥርንፍ ኣለና...</span>
                              )
                            ) : backgroundPreFetchActive ? (
                              <span className="text-[#F27D26] text-[16px] font-bold animate-pulse font-[Arial]">ብድሕሪት ይዳሎ ኣሎ...</span>
                            ) : state.chunks.every(c => c.audioUrl) ? (
                              <span className="text-green-400 text-[16px] font-bold font-[Arial]">100% ቅሩብ (ብኡንብኡ)</span>
                            ) : (
                              <span className="text-white/40 text-[16px] font-[Arial]">ብሓባር ክወርድ እዩ</span>
                            )}
                          </div>
                          {/* Progress Bar */}
                          <div className="w-full h-3 bg-white/15 rounded-full overflow-hidden mt-0.5">
                            <div 
                              className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300 rounded-full"
                              style={{ width: `${(state.chunks.filter(c => c.audioUrl).length / state.chunks.length) * 100}%` }}
                            />
                          </div>
                          {state.chunks.some(c => c.status === 'error') && (
                            <div className="text-orange-400 text-[11px] font-semibold mt-1.5 flex items-center gap-1.5 leading-snug animate-pulse">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>ሓደ ሓደ ክፍልታት ክንሰናዶ ኣይከኣልናን። ግን ዝተዳለወ ጥራይ ክትሰምዕ ወይ ክታውርድ ትኽእል ኢኻ። (Ready segments play cleanly)</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>


              {/* Individual clip downloads list removed per request */}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Section: Large Input Area */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-[#0c0c0c] border border-white/10 rounded-[2rem] p-1 shadow-2xl focus-within:border-[#F27D26]/50 transition-all duration-500"
        >
          <div className="px-8 py-4 border-b border-white/5 flex items-center justify-between text-xs font-bold text-white/20 uppercase tracking-widest">
            <span className="bg-black text-white text-[17px]">ጽሑፍ መእተዊ</span>
            <div className="flex gap-4">
              <span>{text.length} ፊደላት</span>
              <span>{state.chunks.length || splitTextIntoChunks(text).length} ክፍልታት</span>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ኣብዚ ጽሑፍካ ጸሓፍ ወይ ኣእቱ..."
            className="w-full bg-transparent border-none focus:ring-0 p-8 text-2xl leading-relaxed resize-none min-h-[300px]"
          />
          <div className="p-6 border-t border-white/5 flex items-center justify-between gap-3">
            <button 
              onClick={() => {
                setText('');
                handleStop();
              }}
              className="flex items-center gap-2 text-white/20 hover:text-white/60 px-5 py-3 rounded-2xl hover:bg-white/5 transition-all font-bold text-sm cursor-pointer"
              title="ጽሑፍ ደምስስ"
            >
              <History className="w-5 h-5" />
              <span>ጽሑፍ ደምስስ</span>
            </button>
            <span className="text-xs text-white/20 font-bold uppercase tracking-[0.12em] text-right hidden sm:inline">
              ናይ ምቁጽጻርን ድምጺ ናይ ምድላውን ቁልፍታት ኣብ ላዕሊ ይርከቡ።
            </span>
          </div>
        </motion.div>

        {/* Status Section (placed down as last) */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="flex items-center gap-4 bg-white/5 border border-white/10 p-6 rounded-3xl">
            <div className="w-12 h-12 bg-[#F27D26]/20 rounded-2xl flex items-center justify-center text-[#F27D26]">
              <Languages className="w-6 h-6" />
            </div>
            <div>
              <div className="text-sm font-bold uppercase tracking-tight">ንጡፍ ድምጺ</div>
              <div className="text-xs text-white/40">ትግርኛ ኤርትራ (Neural)</div>
            </div>
          </div>
          
          <div className="flex items-center gap-4 bg-white/5 border border-white/10 p-6 rounded-3xl">
            <div className="w-12 h-12 bg-green-500/20 rounded-2xl flex items-center justify-center text-green-500">
              <Volume2 className="w-6 h-6" />
            </div>
            <div>
              <div className="text-sm font-bold uppercase tracking-tight">ናይ ድምጺ ጽሬት</div>
              <div className="text-xs text-white/40">16kHz ሃይ ፊደሊቲ WAV</div>
            </div>
          </div>
        </div>

        {/* Hidden reference queue scroll - keeping component code simple */}
        <div className="hidden">
           {state.chunks.map((chunk, index) => (
             <div key={chunk.id} ref={state.currentIndex === index ? activeChunkRef : null} />
           ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5 text-white/20">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold uppercase tracking-widest text-[#F27D26]/60">ዝሰርሓሉ መሳርሒታት</span>
            <div className="flex items-center gap-6">
              <span className="text-sm">Piper Voice Engine</span>
              <span className="text-sm">TigrinyaNLP</span>
              <span className="text-sm">Lomitec</span>
            </div>
          </div>
          <div className="text-xs">
            © 2026 ትግርኛ ድምጺ ምድላው። ክፉት ምንጪ።
          </div>
        </div>
      </footer>

      {/* Styles for custom scrollbar */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(242, 125, 38, 0.5);
        }
      `}</style>
    </div>
  );
}
