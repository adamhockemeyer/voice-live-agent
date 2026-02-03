'use client';

import { useState, useEffect, useRef } from 'react';

interface TranscriptPanelProps {
  transcripts: Array<{ role: string; text: string }>;
  callId: string | null;
  isCallActive: boolean;
}

// Cost rates per minute (approximate)
const COST_RATES = {
  audioInput: 0.10,   // $0.10/min for audio input
  audioOutput: 0.24,  // $0.24/min for audio output
  acsVoice: 0.013,    // ~$0.013/min for ACS PSTN (varies by region)
};

export function TranscriptPanel({ transcripts, callId, isCallActive }: TranscriptPanelProps) {
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [loadingRecording, setLoadingRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const callStartRef = useRef<number | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // Track call duration
  useEffect(() => {
    if (isCallActive && !callStartRef.current) {
      callStartRef.current = Date.now();
    }

    if (!isCallActive && callStartRef.current) {
      // Call ended - keep final duration
      callStartRef.current = null;
    }

    let interval: NodeJS.Timeout | null = null;
    if (isCallActive) {
      interval = setInterval(() => {
        if (callStartRef.current) {
          setCallDuration(Math.floor((Date.now() - callStartRef.current) / 1000));
        }
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isCallActive]);

  // Reset when new call starts
  useEffect(() => {
    if (callId && isCallActive && callDuration === 0) {
      callStartRef.current = Date.now();
      setRecordingUrl(null);
      setRecordingError(null);
    }
  }, [callId, isCallActive, callDuration]);

  const fetchRecording = async () => {
    if (!callId) return;

    setLoadingRecording(true);
    setRecordingError(null);
    try {
      const response = await fetch(`${apiUrl}/api/calls/${callId}/recording`);
      if (response.ok) {
        const data = await response.json();
        if (data.recordingUrl) {
          setRecordingUrl(data.recordingUrl);
        } else {
          setRecordingError(data.message || 'Recording not available');
        }
      } else {
        setRecordingError('Failed to fetch recording');
      }
    } catch (error) {
      console.error('Failed to fetch recording:', error);
      setRecordingError('Failed to fetch recording');
    } finally {
      setLoadingRecording(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const calculateCost = (seconds: number) => {
    const minutes = seconds / 60;
    const totalCost = minutes * (COST_RATES.audioInput + COST_RATES.audioOutput + COST_RATES.acsVoice);
    return totalCost.toFixed(4);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Call Duration & Cost Bar */}
      {(isCallActive || callDuration > 0) && (
        <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 mb-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400 text-sm">Duration:</span>
              <span className="font-mono font-semibold text-gray-900 dark:text-white">
                {formatDuration(callDuration)}
              </span>
            </div>
            {isCallActive && (
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" title="Recording"></span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400 text-sm">Est. Cost:</span>
            <span className="font-mono font-semibold text-green-600 dark:text-green-400">
              ${calculateCost(callDuration)}
            </span>
          </div>
        </div>
      )}

      {/* Transcript Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 p-2 min-h-[250px] max-h-[350px]">
        {transcripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <span className="text-4xl mb-2">💬</span>
            <p className="text-center">
              {isCallActive
                ? 'Conversation will appear here...'
                : 'Start a call to see the conversation'}
            </p>
          </div>
        ) : (
          transcripts.map((item, index) => (
            <div
              key={index}
              className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-4 py-2 rounded-lg ${item.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                  }`}
              >
                <span className="text-xs font-semibold block mb-1 opacity-70">
                  {item.role === 'user' ? 'Caller' : 'AI Agent'}
                </span>
                <p>{item.text}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Recording Section - shown after call ends */}
      {callId && !isCallActive && transcripts.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              🎙️ Call Recording
            </h3>
          </div>

          {!recordingUrl ? (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={fetchRecording}
                disabled={loadingRecording}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
              >
                {loadingRecording ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    Loading...
                  </>
                ) : (
                  <>📥 Get Recording</>
                )}
              </button>
              {recordingError && (
                <span className="text-sm text-amber-600 dark:text-amber-400">{recordingError}</span>
              )}
            </div>
          ) : (
            <audio controls className="w-full">
              <source src={recordingUrl} type="audio/wav" />
              Your browser does not support the audio element.
            </audio>
          )}
        </div>
      )}

      {/* Cost Breakdown - shown after call ends */}
      {!isCallActive && callDuration > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
          <details className="text-xs text-gray-500 dark:text-gray-400">
            <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
              💰 Cost Breakdown ({formatDuration(callDuration)} call)
            </summary>
            <div className="mt-2 space-y-1 pl-4">
              <p>• Audio Input: ${(callDuration / 60 * COST_RATES.audioInput).toFixed(4)}</p>
              <p>• Audio Output: ${(callDuration / 60 * COST_RATES.audioOutput).toFixed(4)}</p>
              <p>• ACS PSTN: ${(callDuration / 60 * COST_RATES.acsVoice).toFixed(4)}</p>
              <p className="font-medium text-gray-700 dark:text-gray-300 pt-1 border-t border-gray-200 dark:border-gray-600">
                Total: ${calculateCost(callDuration)}
              </p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
