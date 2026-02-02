'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

export interface AgentType {
  id: string;
  name: string;
  agenda: string;
  isBuiltIn: boolean;
}

// Default built-in agent types
const BUILT_IN_AGENT_TYPES: AgentType[] = [
  {
    id: 'customer_satisfaction',
    name: '📊 Customer Satisfaction Survey',
    agenda: `You are Ava, an AI Assistant conducting a customer satisfaction survey. Follow this agenda:
1. Greet the customer warmly and introduce yourself as Ava, an AI assistant
2. Ask about their recent experience with our service
3. On a scale of 1-10, ask how likely they are to recommend us
4. Ask what we could improve
5. Thank them for their time and end the call politely

LANGUAGE: Start speaking in English. If the user responds in a different language, seamlessly switch to their language for the rest of the conversation. Be conversational and natural. If they go off-topic, gently guide them back.`,
    isBuiltIn: true,
  },
  {
    id: 'delivery_status',
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
    isBuiltIn: true,
  },
  {
    id: 'new_customer',
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
    isBuiltIn: true,
  },
  {
    id: 'repair_support',
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
    isBuiltIn: true,
  },
];

const STORAGE_KEY = 'voice-agent-custom-types';

export function useAgentTypes() {
  const [customTypes, setCustomTypes] = useState<AgentType[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setCustomTypes(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Failed to load custom agent types:', err);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage whenever customTypes changes
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(customTypes));
      } catch (err) {
        console.error('Failed to save custom agent types:', err);
      }
    }
  }, [customTypes, isLoaded]);

  const allTypes = useMemo(() => [...BUILT_IN_AGENT_TYPES, ...customTypes], [customTypes]);

  const addAgentType = useCallback((name: string, agenda: string): AgentType => {
    const newType: AgentType = {
      id: `custom_${Date.now()}`,
      name,
      agenda,
      isBuiltIn: false,
    };
    setCustomTypes(prev => [...prev, newType]);
    return newType;
  }, []);

  const updateAgentType = useCallback((id: string, updates: Partial<Pick<AgentType, 'name' | 'agenda'>>) => {
    setCustomTypes(prev =>
      prev.map(t => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const deleteAgentType = useCallback((id: string) => {
    setCustomTypes(prev => prev.filter(t => t.id !== id));
  }, []);

  const getAgentType = useCallback((id: string): AgentType | undefined => {
    return allTypes.find(t => t.id === id);
  }, [allTypes]);

  return {
    agentTypes: allTypes,
    customTypes,
    builtInTypes: BUILT_IN_AGENT_TYPES,
    isLoaded,
    addAgentType,
    updateAgentType,
    deleteAgentType,
    getAgentType,
  };
}
