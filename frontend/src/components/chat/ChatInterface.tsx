/**
 * ChatInterface Component - Professional Dashboard Style
 * 
 * Main chat interface container with professional styling
 * - Clean white background
 * - Subtle borders and shadows
 * - Professional split-pane layout
 */

import React, { useState, useEffect } from 'react';
import { ChatSidebar } from './ChatSidebar';
import { ChatWindow } from './ChatWindow';
import { useAgentChatList } from '@/hooks/useAgentChatList';
import { Loader2, MessageCircle } from 'lucide-react';

export const ChatInterface: React.FC = () => {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const { data: agents = [], isLoading } = useAgentChatList();

  // Auto-select first agent if none selected
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px] bg-white rounded-lg border border-gray-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Loading conversations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-white rounded-lg border border-gray-200 overflow-hidden min-h-[600px] shadow-sm">
      <ChatSidebar
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
      />
      
      {selectedAgent ? (
        <ChatWindow agentId={selectedAgent.id} agentName={selectedAgent.agent_name} />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-50">
          <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center mb-4">
            <MessageCircle className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-600 font-medium">Select an agent to start chatting</p>
        </div>
      )}
    </div>
  );
};
