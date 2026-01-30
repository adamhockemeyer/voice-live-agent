'use client';

import { useState } from 'react';

interface CallControlsProps {
  isCallActive: boolean;
  callId: string | null;
}

export function CallControls({ isCallActive, callId }: CallControlsProps) {
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [loadingRecording, setLoadingRecording] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  const fetchRecording = async () => {
    if (!callId) return;

    setLoadingRecording(true);
    try {
      const response = await fetch(`${apiUrl}/api/calls/${callId}/recording`);
      if (response.ok) {
        const data = await response.json();
        setRecordingUrl(data.recordingUrl);
      }
    } catch (error) {
      console.error('Failed to fetch recording:', error);
    } finally {
      setLoadingRecording(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Call Info */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-500 dark:text-gray-400">Status:</span>
          <span className={`ml-2 font-medium ${isCallActive ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'
            }`}>
            {isCallActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Call ID:</span>
          <span className="ml-2 font-mono text-xs text-gray-600 dark:text-gray-300">
            {callId ? callId.substring(0, 8) + '...' : 'N/A'}
          </span>
        </div>
      </div>

      {/* Recording */}
      {callId && !isCallActive && (
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Call Recording
          </h3>
          {!recordingUrl ? (
            <button
              onClick={fetchRecording}
              disabled={loadingRecording}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white text-sm rounded transition-colors"
            >
              {loadingRecording ? 'Loading...' : 'Get Recording'}
            </button>
          ) : (
            <audio controls className="w-full">
              <source src={recordingUrl} type="audio/wav" />
              Your browser does not support the audio element.
            </audio>
          )}
        </div>
      )}

      {/* Pricing Info */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Estimated Costs
        </h3>
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <p>• Azure OpenAI Realtime: ~$0.10/min (audio input) + ~$0.24/min (audio output)</p>
          <p>• Azure Blob Storage: ~$0.02/GB for recordings</p>
          <p>• Container Apps: Based on usage</p>
        </div>
      </div>
    </div>
  );
}
