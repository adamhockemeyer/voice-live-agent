'use client';

import { useState, useEffect, useRef } from 'react';
import { CallLogs } from '@/components/CallLogs';
import { TranscriptPanel } from '@/components/TranscriptPanel';
import { useAgentTypes } from '@/components/useAgentTypes';
import { AgentTypeManager } from '@/components/AgentTypeManager';
import { AgendaEditor } from '@/components/AgendaEditor';
import { CallHeader } from '@/components/CallHeader';
import { CallTabs } from '@/components/CallTabs';
import { fetchApiUrl, getApiUrl } from '@/lib/api';

interface ConfigInfo {
  inbound_phone_number: string | null;
  acs_configured: boolean;
  voicelive_configured: boolean;
}

interface ActiveCall {
  call_id: string;
  status: string;
  direction: string;
  phone_number: string;
  start_time: string;
}

interface DebugState {
  timestamp: string;
  active_calls: Record<string, unknown>;
  orphaned_agents: string[];
  orphaned_websockets: string[];
  pending_cleanups: string[];
  transcript_call_ids: string[];
  connection_pool: unknown;
}

// SSE Event types from backend
interface SSECallEvent {
  type: 'call_created' | 'call_status' | 'call_removed';
  call: {
    call_id: string;
    status: string;
    direction: string;
    phone_number: string;
    start_time: string;
  };
}

interface SSETranscriptEvent {
  type: 'transcript';
  callId: string;
  role: string;
  text: string;
  partial: boolean;
}

type SSEEvent = SSECallEvent | SSETranscriptEvent;

export default function Home() {
  const [callId, setCallId] = useState<string | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [callDirection, setCallDirection] = useState<'inbound' | 'outbound' | null>(null);
  const [transcripts, setTranscripts] = useState<Array<{ role: string; text: string }>>([]);
  const [selectedAgentTypeId, setSelectedAgentTypeId] = useState<string>('customer_satisfaction');
  const [agenda, setAgenda] = useState<string>('');
  const [showAgenda, setShowAgenda] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [isCallingPhone, setIsCallingPhone] = useState(false);
  const [phoneCallError, setPhoneCallError] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [inboundCalls, setInboundCalls] = useState<ActiveCall[]>([]);
  const [inboundAgentTypeId, setInboundAgentTypeId] = useState<string>('customer_satisfaction');
  const [activeTab, setActiveTab] = useState<'outbound' | 'inbound'>('outbound');
  const [currentPhoneNumber, setCurrentPhoneNumber] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);
  const [debugState, setDebugState] = useState<DebugState | null>(null);
  
  // Ref to track current call ID for SSE handler (avoids stale closure)
  const callIdRef = useRef<string | null>(null);
  
  // Keep callIdRef in sync with callId state
  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  const {
    agentTypes,
    isLoaded: agentTypesLoaded,
    addAgentType,
    updateAgentType,
    deleteAgentType,
    getAgentType,
  } = useAgentTypes();

  // Keep apiUrl in state - fetched from runtime-config endpoint
  const [apiUrl, setApiUrl] = useState<string>('http://localhost:8000');
  const [apiUrlLoaded, setApiUrlLoaded] = useState(false);

  // Fetch API URL from runtime-config on mount
  useEffect(() => {
    fetchApiUrl().then((url) => {
      setApiUrl(url);
      setApiUrlLoaded(true);
    });
  }, []);

  // Initialize agenda when agent types are loaded
  useEffect(() => {
    if (agentTypesLoaded && !agenda) {
      const defaultType = getAgentType('customer_satisfaction');
      if (defaultType) {
        setAgenda(defaultType.agenda);
      }
    }
  }, [agentTypesLoaded, agenda, getAgentType]);

  // Update agenda when agent type changes
  const handleAgentTypeChange = (typeId: string) => {
    setSelectedAgentTypeId(typeId);
    const agentType = getAgentType(typeId);
    if (agentType) {
      setAgenda(agentType.agenda);
    }
  };

  // Save agenda changes to custom agent types
  const handleAgendaChange = (newAgenda: string) => {
    setAgenda(newAgenda);
    const agentType = getAgentType(selectedAgentTypeId);
    if (agentType && !agentType.isBuiltIn) {
      updateAgentType(selectedAgentTypeId, { agenda: newAgenda });
    }
  };

  // Update inbound agent type and sync to backend
  const handleInboundAgentTypeChange = async (typeId: string) => {
    setInboundAgentTypeId(typeId);
    const agentType = getAgentType(typeId);
    if (!agentType) return;

    try {
      await fetch(`${apiUrl}/api/inbound-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: agentType.agenda }),
      });
    } catch (err) {
      console.error('Failed to update inbound agent:', err);
    }
  };

  // Sync initial inbound agent type to backend on mount only
  useEffect(() => {
    if (!agentTypesLoaded || !apiUrlLoaded) return;
    const syncInboundAgent = async () => {
      const defaultType = getAgentType('customer_satisfaction');
      if (!defaultType) return;
      try {
        await fetch(`${apiUrl}/api/inbound-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: defaultType.agenda }),
        });
      } catch (err) {
        console.error('Failed to sync inbound agent:', err);
      }
    };
    syncInboundAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentTypesLoaded, apiUrlLoaded]);

  // Fetch config when API URL is loaded
  useEffect(() => {
    if (!apiUrlLoaded) return;
    console.log('[UI] Fetching config from:', apiUrl);
    fetch(`${apiUrl}/api/config`)
      .then(res => res.json())
      .then(data => {
        console.log('[UI] Config received:', data);
        setConfig(data);
      })
      .catch(err => console.error('[UI] Failed to fetch config:', err));
  }, [apiUrlLoaded, apiUrl]);

  // Fetch debug state when debug panel is open
  useEffect(() => {
    if (!showDebug || !apiUrlLoaded) return;
    
    const fetchDebug = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/debug/state`);
        if (res.ok) {
          setDebugState(await res.json());
        }
      } catch (err) {
        console.error('[UI] Failed to fetch debug state:', err);
      }
    };
    
    fetchDebug();
    const interval = setInterval(fetchDebug, 2000);
    return () => clearInterval(interval);
  }, [showDebug, apiUrlLoaded, apiUrl]);

  // SSE connection for real-time call events and transcripts
  useEffect(() => {
    if (!apiUrlLoaded) return;

    console.log('[UI] Connecting to SSE event stream');
    const eventSource = new EventSource(`${apiUrl}/api/events/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data: SSEEvent = JSON.parse(event.data);
        console.log('[UI] SSE event:', data.type, data);

        switch (data.type) {
          case 'call_created': {
            const call = (data as SSECallEvent).call;
            console.log('[UI] Call created:', call.call_id, call.direction);
            setCallId(call.call_id);
            setIsCallActive(true);
            setIsCallingPhone(call.direction === 'outbound');
            setCallDirection(call.direction as 'inbound' | 'outbound');
            setCurrentPhoneNumber(call.phone_number || '');
            setTranscripts([]);
            if (call.direction === 'inbound') {
              setActiveTab('inbound');
            }
            // Update inbound calls list
            if (call.direction === 'inbound') {
              setInboundCalls(prev => {
                const exists = prev.some(c => c.call_id === call.call_id);
                if (exists) return prev;
                return [...prev, call];
              });
            }
            break;
          }

          case 'call_status': {
            const call = (data as SSECallEvent).call;
            const currentCallId = callIdRef.current;
            console.log('[UI] Call status update:', call.call_id, call.status, 'current:', currentCallId);
            
            if (call.call_id === currentCallId) {
              if (call.status === 'connected') {
                setIsCallActive(true);
              } else if (call.status === 'ended') {
                console.log('[UI] Call ended via SSE');
                setIsCallActive(false);
                setIsCallingPhone(false);
                // Keep callId for a moment so UI can show ended state
                setTimeout(() => {
                  if (callIdRef.current === call.call_id) {
                    setCallId(null);
                    setCallDirection(null);
                  }
                }, 2000);
              }
            }
            // Update inbound calls list
            setInboundCalls(prev => prev.map(c => 
              c.call_id === call.call_id ? { ...c, status: call.status } : c
            ));
            break;
          }

          case 'call_removed': {
            const call = (data as SSECallEvent).call;
            const currentCallId = callIdRef.current;
            console.log('[UI] Call removed:', call.call_id, 'current:', currentCallId);
            
            if (call.call_id === currentCallId) {
              setCallId(null);
              setCallDirection(null);
              setIsCallActive(false);
              setIsCallingPhone(false);
            }
            // Remove from inbound calls list
            setInboundCalls(prev => prev.filter(c => c.call_id !== call.call_id));
            break;
          }

          case 'transcript': {
            const transcript = data as SSETranscriptEvent;
            const currentCallId = callIdRef.current;
            if (transcript.callId === currentCallId && !transcript.partial) {
              setTranscripts(prev => [...prev, { role: transcript.role, text: transcript.text }]);
            }
            break;
          }
        }
      } catch (err) {
        console.error('[UI] Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[UI] SSE connection error:', err);
      // EventSource will auto-reconnect
    };

    return () => {
      console.log('[UI] Closing SSE connection');
      eventSource.close();
    };
  }, [apiUrl, apiUrlLoaded]);

  const startPhoneCall = async () => {
    if (!phoneNumber.trim()) {
      setPhoneCallError('Please enter a phone number');
      return;
    }

    console.log('[UI] Starting phone call to:', phoneNumber);
    
    setPhoneCallError(null);
    setIsCallingPhone(true);
    setTranscripts([]);  // Fresh transcripts for new call
    setCallDirection('outbound');
    setCurrentPhoneNumber(phoneNumber);

    try {
      const response = await fetch(`${apiUrl}/api/calls/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_phone_number: phoneNumber,
          agenda: agenda,
        }),
      });

      const data = await response.json();

      if (data.success && data.call_id) {
        console.log('[UI] Call started successfully:', data.call_id);
        // Note: SSE event stream will handle setting callId and isCallActive
        // when the call_created event arrives
        setCallId(data.call_id);
        setIsCallActive(true);
      } else {
        console.error('[UI] Call failed:', data);
        setPhoneCallError(data.detail || data.message || 'Failed to start call');
        setIsCallingPhone(false);
        setCallDirection(null);
      }
    } catch (err) {
      console.error('[UI] Call request failed:', err);
      setPhoneCallError(`Failed to connect: ${err}`);
      setIsCallingPhone(false);
      setCallDirection(null);
    }
  };

  const hangupPhoneCall = async () => {
    if (!callId) return;

    try {
      await fetch(`${apiUrl}/api/calls/${callId}/hangup`, { method: 'POST' });
    } catch (err) {
      console.error('Hangup error:', err);
    }
    // Reset all call state (SSE will also send call_status:ended, but we update immediately for responsiveness)
    setIsCallingPhone(false);
    setIsCallActive(false);
    setCallId(null);
    setCallDirection(null);
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Top Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                🎙️ Voice Live Agent
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Azure AI Voice Conversations
              </p>
            </div>
            <div className="flex items-center gap-4">
              {config?.voicelive_configured && (
                <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 px-2 py-1 rounded-full">
                  ✓ VoiceLive
                </span>
              )}
              {config?.acs_configured && (
                <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 px-2 py-1 rounded-full">
                  ✓ ACS
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Call Status Header */}
        <CallHeader
          isCallActive={isCallActive}
          callId={callId}
          direction={callDirection}
          phoneNumber={currentPhoneNumber}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Call Controls */}
          <div className="space-y-6">
            {/* Tabs for Inbound/Outbound */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
              <CallTabs
                activeTab={activeTab}
                onTabChange={setActiveTab}
                disabled={isCallActive}
              />

              <div className="p-6">
                {/* Outbound Tab Content */}
                {activeTab === 'outbound' && (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      AI agent calls a phone number and follows the agenda below.
                    </p>

                    {!config?.inbound_phone_number ? (
                      <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                        <p className="text-sm text-yellow-700 dark:text-yellow-300">
                          ⚠️ No source phone number configured. Set <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">ACS_PHONE_NUMBER</code> in your environment.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-3">
                          <input
                            type="tel"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            placeholder="+1 555 123 4567"
                            disabled={isCallingPhone}
                            className="flex-1 px-4 py-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-lg"
                          />
                          {!isCallingPhone ? (
                            <button
                              onClick={startPhoneCall}
                              disabled={!phoneNumber.trim() || isCallActive}
                              className="px-6 py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-semibold rounded-lg shadow transition-all"
                            >
                              📞 Call
                            </button>
                          ) : (
                            <button
                              onClick={hangupPhoneCall}
                              className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg shadow transition-all"
                            >
                              🔴 End
                            </button>
                          )}
                        </div>

                        {phoneCallError && (
                          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded text-sm">
                            {phoneCallError}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Inbound Tab Content */}
                {activeTab === 'inbound' && (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Call this number to talk to the AI agent.
                    </p>

                    {config?.inbound_phone_number ? (
                      <>
                        {/* Inbound Phone Number Display */}
                        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-center">
                          <p className="text-sm text-blue-600 dark:text-blue-400 mb-1">Call this number:</p>
                          <p className="text-2xl font-bold text-blue-800 dark:text-blue-200 font-mono">
                            {config.inbound_phone_number}
                          </p>
                        </div>

                        {/* Inbound Agent Type Selector */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Inbound Agent Type
                          </label>
                          <select
                            value={inboundAgentTypeId}
                            onChange={(e) => handleInboundAgentTypeChange(e.target.value)}
                            disabled={isCallActive}
                            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white disabled:opacity-50"
                          >
                            <optgroup label="Built-in">
                              {agentTypes.filter(t => t.isBuiltIn).map(type => (
                                <option key={type.id} value={type.id}>
                                  {type.name}
                                </option>
                              ))}
                            </optgroup>
                            {agentTypes.some(t => !t.isBuiltIn) && (
                              <optgroup label="Custom">
                                {agentTypes.filter(t => !t.isBuiltIn).map(type => (
                                  <option key={type.id} value={type.id}>
                                    {type.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>

                        {/* Active Inbound Calls */}
                        {inboundCalls.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Active calls:</p>
                            {inboundCalls.map(call => (
                              <div key={call.call_id} className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 p-3 rounded-lg">
                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                                <span className="font-mono">{call.phone_number}</span>
                                <span className="text-xs text-gray-500">({call.status})</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-4">
                            📞 Waiting for incoming calls...
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                        <p className="text-sm text-yellow-700 dark:text-yellow-300">
                          ⚠️ No phone number configured. Set <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">ACS_PHONE_NUMBER</code> in your environment.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Agent Configuration */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {activeTab === 'outbound' ? 'Outbound Agent' : 'Agent Configuration'}
                </h2>
                {activeTab === 'outbound' && (
                  <button
                    onClick={() => setShowAgenda(!showAgenda)}
                    className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
                    disabled={isCallActive}
                  >
                    {showAgenda ? 'Collapse' : 'Expand'}
                  </button>
                )}
              </div>

              {activeTab === 'outbound' && (
                <>
                  {/* Agent Type Manager */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Agent Type
                    </label>
                    <AgentTypeManager
                      agentTypes={agentTypes}
                      selectedTypeId={selectedAgentTypeId}
                      onSelect={handleAgentTypeChange}
                      onAdd={addAgentType}
                      onUpdate={updateAgentType}
                      onDelete={deleteAgentType}
                      disabled={isCallActive}
                    />
                  </div>

                  {showAgenda ? (
                    <AgendaEditor
                      content={agenda}
                      onChange={handleAgendaChange}
                      disabled={isCallActive}
                      placeholder="Enter the agenda or instructions for the AI agent..."
                    />
                  ) : (
                    <div
                      onClick={() => !isCallActive && setShowAgenda(true)}
                      className={`bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-32 overflow-y-auto ${!isCallActive ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : ''}`}
                    >
                      <pre className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono line-clamp-4">
                        {agenda}
                      </pre>
                      {!isCallActive && (
                        <p className="text-xs text-blue-500 mt-2">Click to edit</p>
                      )}
                    </div>
                  )}
                </>
              )}

              {activeTab === 'inbound' && (
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  <p className="mb-2">The inbound agent uses the selected agent type above.</p>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-40 overflow-y-auto">
                    <pre className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono">
                      {getAgentType(inboundAgentTypeId)?.agenda || 'No agenda configured'}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* Pricing Info - Collapsed */}
            <details className="bg-white dark:bg-gray-800 rounded-lg shadow-lg">
              <summary className="p-4 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg">
                💰 Estimated Costs
              </summary>
              <div className="px-4 pb-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p>• Azure OpenAI Realtime: ~$0.10/min (input) + ~$0.24/min (output)</p>
                <p>• Azure Blob Storage: ~$0.02/GB for recordings</p>
                <p>• Container Apps: Based on usage</p>
              </div>
            </details>
          </div>

          {/* Right Column - Conversation & Logs */}
          <div className="space-y-6">
            {/* Conversation Panel */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                💬 Conversation
                {isCallActive && (
                  <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 px-2 py-0.5 rounded-full animate-pulse">
                    LIVE
                  </span>
                )}
              </h2>
              <TranscriptPanel
                transcripts={transcripts}
                callId={callId}
                isCallActive={isCallActive}
              />
            </div>

            {/* Call Logs */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
                📋 Call Logs
              </h2>
              <CallLogs callId={callId} />
            </div>
          </div>
        </div>

        {/* Debug Panel - Collapsible at bottom */}
        <div className="mt-6">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 flex items-center gap-1"
          >
            🔧 {showDebug ? 'Hide' : 'Show'} Debug Panel
          </button>
          {showDebug && (
            <div className="mt-2 bg-gray-900 rounded-lg p-4 overflow-auto max-h-64">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-400">
                  Backend State (refreshes every 2s)
                </span>
                <span className="text-xs text-gray-500">
                  UI Call ID: {callId ? callId.substring(0, 8) + '...' : 'none'} | 
                  Active: {isCallActive ? 'yes' : 'no'} | 
                  Calling: {isCallingPhone ? 'yes' : 'no'}
                </span>
              </div>
              {debugState ? (
                <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                  {JSON.stringify(debugState, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-gray-500">Loading...</p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
