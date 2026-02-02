'use client';

import { useState, useEffect } from 'react';
import { VoiceInterface } from '@/components/VoiceInterface';
import { CallLogs } from '@/components/CallLogs';
import { CallControls } from '@/components/CallControls';
import { TranscriptPanel } from '@/components/TranscriptPanel';
import { useAgentTypes } from '@/components/useAgentTypes';
import { AgentTypeManager } from '@/components/AgentTypeManager';
import { AgendaEditor } from '@/components/AgendaEditor';

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

export default function Home() {
  const [callId, setCallId] = useState<string | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
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

  const {
    agentTypes,
    isLoaded: agentTypesLoaded,
    addAgentType,
    updateAgentType,
    deleteAgentType,
    getAgentType,
  } = useAgentTypes();

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
    if (!agentTypesLoaded) return;
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
  }, [apiUrl, agentTypesLoaded]);

  // Fetch config on mount
  useEffect(() => {
    fetch(`${apiUrl}/api/config`)
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch config:', err));
  }, [apiUrl]);

  // Poll for active inbound calls
  useEffect(() => {
    const pollCalls = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/calls`);
        const data = await res.json();
        const inbound = (data.calls || []).filter((c: ActiveCall) => c.direction === 'inbound');
        setInboundCalls(inbound);

        // Check if our active call has ended (not in the list anymore)
        if (callId && isCallingPhone) {
          const ourCall = (data.calls || []).find((c: ActiveCall) => c.call_id === callId);
          if (!ourCall) {
            // Call ended from the other side
            setIsCallingPhone(false);
            setIsCallActive(false);
          }
        }
      } catch (err) {
        console.error('Failed to fetch calls:', err);
      }
    };

    pollCalls();
    const interval = setInterval(pollCalls, 2000);
    return () => clearInterval(interval);
  }, [apiUrl, callId, isCallingPhone]);

  const startPhoneCall = async () => {
    if (!phoneNumber.trim()) {
      setPhoneCallError('Please enter a phone number');
      return;
    }

    setPhoneCallError(null);
    setIsCallingPhone(true);
    setTranscripts([]);

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
        setCallId(data.call_id);
        setIsCallActive(true);

        // Subscribe to SSE for real-time transcripts
        subscribeToTranscripts(data.call_id);
      } else {
        setPhoneCallError(data.detail || data.message || 'Failed to start call');
        setIsCallingPhone(false);
      }
    } catch (err) {
      setPhoneCallError(`Failed to connect: ${err}`);
      setIsCallingPhone(false);
    }
  };

  const subscribeToTranscripts = (callIdToSubscribe: string) => {
    const eventSource = new EventSource(`${apiUrl}/api/calls/${callIdToSubscribe}/transcripts/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'call_ended') {
          eventSource.close();
          return;
        }
        if (data.role && data.text && !data.partial) {
          setTranscripts(prev => [...prev, { role: data.role, text: data.text }]);
        }
      } catch (err) {
        console.error('Failed to parse transcript:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    // Store reference for cleanup (could be handled via ref, but keeping simple)
    (window as unknown as Record<string, EventSource>)[`transcriptSource_${callIdToSubscribe}`] = eventSource;
  };

  const hangupPhoneCall = async () => {
    if (!callId) return;

    // Close transcript EventSource if it exists
    const eventSourceKey = `transcriptSource_${callId}`;
    const eventSource = (window as unknown as Record<string, EventSource>)[eventSourceKey];
    if (eventSource) {
      eventSource.close();
      delete (window as unknown as Record<string, EventSource>)[eventSourceKey];
    }

    try {
      await fetch(`${apiUrl}/api/calls/${callId}/hangup`, { method: 'POST' });
    } catch (err) {
      console.error('Hangup error:', err);
    }
    setIsCallingPhone(false);
    setIsCallActive(false);
    setCallId(null);
  };

  const handleCallStarted = (id: string) => {
    setCallId(id);
    setIsCallActive(true);
    setTranscripts([]);
  };

  const handleCallEnded = () => {
    setIsCallActive(false);
  };

  const handleTranscript = (role: string, text: string) => {
    setTranscripts(prev => [...prev, { role, text }]);
  };

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Voice Live Agent
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Azure Speech Voice Live Demo with Real-time AI Conversations
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Voice Interface */}
        <div className="space-y-6">
          {/* Agenda Input */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Call Agenda
              </h2>
              <button
                onClick={() => setShowAgenda(!showAgenda)}
                className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
                disabled={isCallActive}
              >
                {showAgenda ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {/* Agent Type Manager with create/edit/delete */}
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
                placeholder="Enter the agenda or instructions for the AI agent to follow during the call..."
              />
            ) : (
              <div
                onClick={() => !isCallActive && setShowAgenda(true)}
                className={`bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-32 overflow-y-auto ${!isCallActive ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : ''}`}
              >
                <pre className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono">
                  {agenda}
                </pre>
                {!isCallActive && (
                  <p className="text-xs text-blue-500 mt-2">Click to edit</p>
                )}
              </div>
            )}
          </div>

          {/* Outbound Phone Call Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
              📞 Outbound Call
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              AI agent calls a phone number and runs through the agenda.
            </p>

            {!config?.inbound_phone_number ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  ⚠️ No source phone number configured. Outbound calls require <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">ACS_PHONE_NUMBER</code> in your environment.
                </p>
              </div>
            ) : (
              <>
                <div className="flex gap-3 mb-4">
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
                      disabled={!phoneNumber.trim()}
                      className="px-6 py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-semibold rounded-lg shadow transition-all"
                    >
                      📞 Call
                    </button>
                  ) : (
                    <button
                      onClick={hangupPhoneCall}
                      className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg shadow transition-all"
                    >
                      🔴 Hang Up
                    </button>
                  )}
                </div>

                {phoneCallError && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded text-sm">
                    {phoneCallError}
                  </div>
                )}

                {isCallingPhone && (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    Call in progress to {phoneNumber}...
                  </div>
                )}
              </>
            )}
          </div>

          {/* Inbound Phone Call Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
              📲 Inbound Calls
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Call this number to talk to the AI agent.
            </p>

            {config?.inbound_phone_number ? (
              <div className="space-y-4">
                {/* Inbound Agent Type Selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Inbound Agent Type
                  </label>
                  <select
                    value={inboundAgentTypeId}
                    onChange={(e) => handleInboundAgentTypeChange(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
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
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Incoming calls will use this agent type
                  </p>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <p className="text-sm text-blue-600 dark:text-blue-400 mb-1">Call this number:</p>
                  <p className="text-2xl font-bold text-blue-800 dark:text-blue-200 font-mono">
                    {config.inbound_phone_number}
                  </p>
                </div>

                {inboundCalls.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Active inbound calls:</p>
                    {inboundCalls.map(call => (
                      <div key={call.call_id} className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 p-2 rounded">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                        <span className="font-mono text-sm">{call.phone_number}</span>
                        <span className="text-xs text-gray-500">({call.status})</span>
                      </div>
                    ))}
                  </div>
                )}

                {inboundCalls.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                    Waiting for incoming calls...
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  ⚠️ No phone number configured. Set <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">ACS_PHONE_NUMBER</code> in your environment.
                </p>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              🎤 Browser Voice Test
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Or test the AI agent directly through your browser microphone.
            </p>
            <VoiceInterface
              onCallStarted={handleCallStarted}
              onCallEnded={handleCallEnded}
              onTranscript={handleTranscript}
              agenda={agenda}
            />
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              Call Controls
            </h2>
            <CallControls
              isCallActive={isCallActive}
              callId={callId}
            />
          </div>
        </div>

        {/* Right Column - Transcripts and Logs */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              Conversation Transcript
            </h2>
            <TranscriptPanel transcripts={transcripts} />
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              Call Logs
            </h2>
            <CallLogs callId={callId} />
          </div>
        </div>
      </div>
    </main>
  );
}
