'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface VoiceInterfaceProps {
  onCallStarted: (callId: string) => void;
  onCallEnded: () => void;
  onTranscript: (role: string, text: string) => void;
  agenda?: string;
}

export function VoiceInterface({ onCallStarted, onCallEnded, onTranscript, agenda }: VoiceInterfaceProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<string>('Ready to connect');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const playbackQueueRef = useRef<Float32Array[]>([]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const wsUrl = apiUrl.replace('http', 'ws') + '/ws';

  const startCall = useCallback(async () => {
    try {
      setError(null);
      setStatus('Connecting...');

      // Initialize WebSocket
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setStatus('Connected, starting call...');

        // Start the call with optional agenda
        ws.send(JSON.stringify({
          type: 'start_call',
          direction: 'outbound',
          ...(agenda && { agenda })
        }));
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'call_started':
            setStatus('Call active');
            onCallStarted(data.callId);
            await startAudioCapture();
            break;

          case 'audio':
            await playAudio(data.data);
            break;

          case 'transcript':
            if (data.role === 'user') {
              onTranscript('user', data.text || data.delta);
            } else {
              onTranscript('assistant', data.delta || data.text);
            }
            break;

          case 'call_ended':
            handleDisconnect();
            break;

          case 'error':
            setError(data.error?.message || 'An error occurred');
            break;
        }
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
        handleDisconnect();
      };

      ws.onclose = () => {
        handleDisconnect();
      };

    } catch (err) {
      setError(`Failed to start call: ${err}`);
      handleDisconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl, onCallStarted, onTranscript, agenda]);

  const startAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      mediaStreamRef.current = stream;
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const pcm16 = float32ToPcm16(inputData);
        const base64 = arrayBufferToBase64(pcm16.buffer);

        wsRef.current.send(JSON.stringify({
          type: 'audio',
          data: base64
        }));
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      setIsRecording(true);
    } catch (err) {
      setError(`Failed to access microphone: ${err}`);
    }
  };

  const playAudio = async (base64Audio: string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }

    const pcm16 = base64ToInt16Array(base64Audio);
    const float32 = pcm16ToFloat32(pcm16);

    const buffer = audioContextRef.current.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.start();
  };

  const endCall = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'end_call' }));
    }
    handleDisconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = useCallback(() => {
    // Stop audio capture
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsRecording(false);
    setStatus('Disconnected');
    onCallEnded();
  }, [onCallEnded]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      handleDisconnect();
    };
  }, [handleDisconnect]);

  return (
    <div className="space-y-6">
      {/* Status Display */}
      <div className="text-center">
        <div className={`inline-flex items-center px-4 py-2 rounded-full ${isConnected
          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
          }`}>
          <span className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
            }`}></span>
          {status}
        </div>
      </div>

      {/* Audio Visualizer */}
      {isRecording && (
        <div className="flex justify-center items-end h-16 space-x-1">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="audio-bar w-3 bg-blue-500 rounded-t"
              style={{ height: `${Math.random() * 100}%` }}
            ></div>
          ))}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Call Button */}
      <div className="flex justify-center">
        {!isConnected ? (
          <button
            onClick={startCall}
            className="px-8 py-4 bg-green-500 hover:bg-green-600 text-white text-lg font-semibold rounded-full shadow-lg transition-all transform hover:scale-105"
          >
            <svg className="w-6 h-6 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Start Call
          </button>
        ) : (
          <button
            onClick={endCall}
            className="px-8 py-4 bg-red-500 hover:bg-red-600 text-white text-lg font-semibold rounded-full shadow-lg transition-all transform hover:scale-105"
          >
            <svg className="w-6 h-6 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.28 3H5z" />
            </svg>
            End Call
          </button>
        )}
      </div>
    </div>
  );
}

// Audio conversion utilities
function float32ToPcm16(float32Array: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16;
}

function pcm16ToFloat32(pcm16Array: Int16Array): Float32Array {
  const float32 = new Float32Array(pcm16Array.length);
  for (let i = 0; i < pcm16Array.length; i++) {
    float32[i] = pcm16Array[i] / (pcm16Array[i] < 0 ? 0x8000 : 0x7FFF);
  }
  return float32;
}

function arrayBufferToBase64(buffer: ArrayBuffer | SharedArrayBuffer): string {
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}
