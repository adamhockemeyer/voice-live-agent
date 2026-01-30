'use client';

import { useState, useEffect } from 'react';
import { VoiceInterface } from '@/components/VoiceInterface';
import { CallLogs } from '@/components/CallLogs';
import { CallControls } from '@/components/CallControls';
import { TranscriptPanel } from '@/components/TranscriptPanel';

// Pre-defined agent types with their agendas
const AGENT_PRESETS = {
  customer_satisfaction: {
    name: '📊 Customer Satisfaction Survey',
    agenda: `You are Ava, an AI Assistant conducting a customer satisfaction survey. Follow this agenda:
1. Greet the customer warmly and introduce yourself as Ava, an AI assistant
2. Ask about their recent experience with our service
3. On a scale of 1-10, ask how likely they are to recommend us
4. Ask what we could improve
5. Thank them for their time and end the call politely

LANGUAGE: Start speaking in English. If the user responds in a different language, seamlessly switch to their language for the rest of the conversation. Be conversational and natural. If they go off-topic, gently guide them back.`,
  },
  delivery_status: {
    name: '📦 Delivery Status Check',
    agenda: `You are Ava, an AI Assistant helping with delivery status inquiries. Follow this agenda:
1. Greet the customer warmly and introduce yourself as Ava, an AI delivery assistant
2. Ask for their order number or tracking ID
3. Confirm the delivery address with them
4. Ask if there have been any issues with the delivery (missing packages, damaged items, wrong address)
5. Provide an approximate delivery timeframe or next steps
6. Ask if there's anything else you can help with regarding their delivery
7. Thank them and end the call politely

LANGUAGE: Start speaking in English. If the user responds in a different language, seamlessly switch to their language for the rest of the conversation. Be helpful and reassuring. If they have concerns, acknowledge them and offer solutions.`,
  },
  new_customer: {
    name: '👋 New Customer Welcome',
    agenda: `You are Ava, an AI Assistant welcoming new customers. Follow this agenda:
1. Warmly greet them and introduce yourself as Ava, their AI onboarding assistant
2. Congratulate them on joining and express excitement to have them as a customer
3. Briefly explain the key benefits of their new account/service
4. Ask if they have any questions about getting started
5. Offer to walk them through common features or next steps
6. Ask if there's anything specific they're hoping to accomplish
7. Thank them for choosing us and wish them a great experience

LANGUAGE: Start speaking in English. If the user responds in a different language, seamlessly switch to their language for the rest of the conversation. Be enthusiastic and welcoming. Make them feel valued as a new customer.`,
  },
  repair_support: {
    name: '🔧 Repair & Support Ticket',
    agenda: `You are Ava, an AI Assistant for repair and support triage. Follow this agenda:
1. Greet the customer and introduce yourself as Ava, the repair support assistant
2. Ask what product or service they need help with
3. Ask them to describe the issue they're experiencing
4. Ask when the issue started and if anything changed before it began
5. Ask if they've tried any troubleshooting steps already
6. Based on their responses, determine if this needs a support ticket or work order
7. Confirm the details: their name, contact info, and summary of the issue
8. Let them know a ticket has been created and explain next steps
9. Thank them and end the call

LANGUAGE: Start speaking in English. If the user responds in a different language, seamlessly switch to their language for the rest of the conversation. Be patient and thorough. Gather all relevant details to create a complete support ticket.`,
  },
};

type AgentPresetKey = keyof typeof AGENT_PRESETS;

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
  const [selectedAgentType, setSelectedAgentType] = useState<AgentPresetKey>('customer_satisfaction');
  const [agenda, setAgenda] = useState<string>(AGENT_PRESETS.customer_satisfaction.agenda);
  const [showAgenda, setShowAgenda] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [isCallingPhone, setIsCallingPhone] = useState(false);
  const [phoneCallError, setPhoneCallError] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [inboundCalls, setInboundCalls] = useState<ActiveCall[]>([]);
  const [inboundAgentType, setInboundAgentType] = useState<AgentPresetKey>('customer_satisfaction');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // Update agenda when agent type changes
  const handleAgentTypeChange = (agentType: AgentPresetKey) => {
    setSelectedAgentType(agentType);
    setAgenda(AGENT_PRESETS[agentType].agenda);
  };

  // Update inbound agent type and sync to backend
  const handleInboundAgentTypeChange = async (agentType: AgentPresetKey) => {
    setInboundAgentType(agentType);
    const instructions = AGENT_PRESETS[agentType].agenda;
    
    try {
      await fetch(`${apiUrl}/api/inbound-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions }),
      });
    } catch (err) {
      console.error('Failed to update inbound agent:', err);
    }
  };

  // Sync initial inbound agent type to backend on mount only
  useEffect(() => {
    const syncInboundAgent = async () => {
      const instructions = AGENT_PRESETS.customer_satisfaction.agenda;
      try {
        await fetch(`${apiUrl}/api/inbound-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions }),
        });
      } catch (err) {
        console.error('Failed to sync inbound agent:', err);
      }
    };
    syncInboundAgent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

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
            
            {/* Agent Type Dropdown */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Agent Type
              </label>
              <select
                value={selectedAgentType}
                onChange={(e) => handleAgentTypeChange(e.target.value as AgentPresetKey)}
                disabled={isCallActive}
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {Object.entries(AGENT_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>

            {showAgenda ? (
              <textarea
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                disabled={isCallActive}
                className="w-full h-64 p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
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
                    value={inboundAgentType}
                    onChange={(e) => handleInboundAgentTypeChange(e.target.value as AgentPresetKey)}
                    className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    {Object.entries(AGENT_PRESETS).map(([key, preset]) => (
                      <option key={key} value={key}>
                        {preset.name}
                      </option>
                    ))}
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
