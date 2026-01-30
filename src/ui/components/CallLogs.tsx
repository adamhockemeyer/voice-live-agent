'use client';

import { useState, useEffect, useRef } from 'react';

interface CallLogsProps {
  callId: string | null;
}

interface CallInfo {
  call_id: string;
  status: string;
  direction: string;
  phone_number: string;
  start_time: string;
}

interface LogEntry {
  time: string;
  status: string;
  callId?: string;
  phoneNumber?: string;
  isDivider?: boolean;
}

export function CallLogs({ callId }: CallLogsProps) {
  const [callInfo, setCallInfo] = useState<CallInfo | null>(null);
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const lastCallIdRef = useRef<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  useEffect(() => {
    if (!callId) {
      // Call ended - mark it as ended if we had an active call
      if (lastCallIdRef.current && callInfo) {
        setAllLogs(prev => {
          const lastEntry = prev[prev.length - 1];
          if (lastEntry && lastEntry.status !== 'ended' && lastEntry.status !== 'disconnected' && !lastEntry.isDivider) {
            return [...prev, { 
              time: new Date().toLocaleTimeString(), 
              status: 'ended',
              callId: lastCallIdRef.current || undefined 
            }];
          }
          return prev;
        });
        setCallInfo(null);
      }
      return;
    }

    // New call started - add divider if there are previous logs
    if (callId !== lastCallIdRef.current) {
      lastCallIdRef.current = callId;
      setAllLogs(prev => {
        const newLogs = [...prev];
        // Add divider if there are previous logs and last entry isn't a divider
        if (newLogs.length > 0 && !newLogs[newLogs.length - 1]?.isDivider) {
          newLogs.push({ time: '', status: '', isDivider: true });
        }
        // Add dialing entry for new call
        newLogs.push({ 
          time: new Date().toLocaleTimeString(), 
          status: 'dialing',
          callId: callId
        });
        return newLogs;
      });
    }

    const fetchCallStatus = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/calls`);
        if (response.ok) {
          const data = await response.json();
          const call = data.calls?.find((c: CallInfo) => c.call_id === callId);
          if (call) {
            setCallInfo(call);
            // Add status to history if it changed
            setAllLogs(prev => {
              const lastNonDivider = [...prev].reverse().find(e => !e.isDivider);
              if (lastNonDivider?.status !== call.status) {
                return [...prev, { 
                  time: new Date().toLocaleTimeString(), 
                  status: call.status,
                  callId: callId,
                  phoneNumber: call.phone_number
                }];
              }
              return prev;
            });
          } else if (callInfo) {
            // Call was removed (ended)
            setAllLogs(prev => {
              const lastNonDivider = [...prev].reverse().find(e => !e.isDivider);
              if (lastNonDivider?.status !== 'disconnected' && lastNonDivider?.status !== 'ended') {
                return [...prev, { 
                  time: new Date().toLocaleTimeString(), 
                  status: 'disconnected',
                  callId: callId 
                }];
              }
              return prev;
            });
            setCallInfo(null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch call status:', error);
      }
    };

    const interval = setInterval(fetchCallStatus, 1000);
    fetchCallStatus();

    return () => clearInterval(interval);
  }, [callId, apiUrl, callInfo]);

  const clearLogs = () => {
    setAllLogs([]);
    lastCallIdRef.current = null;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'connecting':
      case 'dialing':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'connected':
        return 'text-green-600 dark:text-green-400';
      case 'disconnected':
      case 'ended':
        return 'text-gray-600 dark:text-gray-400';
      default:
        return 'text-blue-600 dark:text-blue-400';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'dialing':
        return '📞';
      case 'connecting':
        return '🔄';
      case 'connected':
        return '✅';
      case 'disconnected':
      case 'ended':
        return '📴';
      default:
        return '📋';
    }
  };

  return (
    <div className="space-y-2">
      {/* Header with clear button */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-gray-500">
          {allLogs.filter(l => !l.isDivider).length} events
        </span>
        {allLogs.length > 0 && (
          <button
            onClick={clearLogs}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Clear Logs
          </button>
        )}
      </div>

      {/* Current call info */}
      {callInfo && (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{getStatusIcon(callInfo.status)}</span>
            <span className={`font-bold ${getStatusColor(callInfo.status)}`}>
              {callInfo.status.toUpperCase()}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {callInfo.direction} call to {callInfo.phone_number}
          </div>
        </div>
      )}

      {/* Logs list */}
      <div className="h-40 overflow-y-auto font-mono text-sm">
        {allLogs.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">
            No call logs yet. Start a call to see logs.
          </p>
        ) : (
          <div className="border-l-2 border-gray-300 dark:border-gray-600 pl-3 space-y-1">
            {allLogs.map((entry, index) => (
              entry.isDivider ? (
                <div key={index} className="flex items-center gap-2 py-2">
                  <div className="flex-1 border-t border-dashed border-gray-400 dark:border-gray-500"></div>
                  <span className="text-xs text-gray-400">new call</span>
                  <div className="flex-1 border-t border-dashed border-gray-400 dark:border-gray-500"></div>
                </div>
              ) : (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{entry.time}</span>
                  <span className={`${getStatusColor(entry.status)}`}>
                    {getStatusIcon(entry.status)} {entry.status}
                  </span>
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
