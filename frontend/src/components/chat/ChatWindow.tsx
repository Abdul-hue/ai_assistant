/**
 * ChatWindow Component - WhatsApp Style
 * 
 * Main chat interface for a selected agent with WhatsApp-style design
 * - WhatsApp green header with agent avatar and info
 * - Profile view accessible by clicking agent name
 * - WhatsApp-style message bubbles
 */

import React, { useEffect, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { AgentProfileView } from './AgentProfileView';
import { useAgentMessages } from '@/hooks/useAgentMessages';
import { useSendMessage } from '@/hooks/useSendMessage';
import { useAgentDetails } from '@/hooks/useAgentDetails';
import { Loader2, Search, MoreVertical, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useQueryClient } from '@tanstack/react-query';
import { Agent } from '@/lib/api/agents';
import { Message } from '@/types/message.types';

interface ChatWindowProps {
  agentId: string;
  agentName: string;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ agentId, agentName }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const queryClient = useQueryClient();
  
  const { data: messages = [], isLoading, error } = useAgentMessages({ agentId });
  const { data: agentDetails, isLoading: agentLoading } = useAgentDetails(agentId);
  const sendMessageMutation = useSendMessage();

  const agent = agentDetails?.agent;
  const agentAvatar = agent?.avatar_url;
  const agentPhone = agent?.whatsapp_phone_number;
  const agentPersona = agent?.persona;
  // Use agent name from details, fallback to prop
  const displayAgentName = agent?.agent_name || agentName;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Show typing indicator after sending message
  useEffect(() => {
    if (sendMessageMutation.isSuccess) {
      setIsTyping(true);
      const timer = setTimeout(() => setIsTyping(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [sendMessageMutation.isSuccess]);

  const handleSendMessage = (message: string) => {
    sendMessageMutation.mutate({
      agentId,
      message,
      contact_id: null,
    });
  };

  const handleAgentUpdate = (updatedAgent: Agent) => {
    console.log('[ChatWindow] Agent updated, refreshing data:', updatedAgent);
    
    // Invalidate all queries to refetch updated data from database
    queryClient.invalidateQueries({ queryKey: ['agent-details', agentId] });
    queryClient.invalidateQueries({ queryKey: ['agent-chat-list'] });
    queryClient.invalidateQueries({ queryKey: ['agents'] });
    queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
    
    // Refetch agent details immediately to update UI
    queryClient.refetchQueries({ queryKey: ['agent-details', agentId] });
    queryClient.refetchQueries({ queryKey: ['agent-chat-list'] });
    
    // Update local state immediately
    setShowProfile(false);
  };

  if (showProfile && agent) {
    return (
      <AgentProfileView
        agent={agent}
        onClose={() => setShowProfile(false)}
        onUpdate={handleAgentUpdate}
      />
    );
  }

  if (isLoading || agentLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#e5ddd5]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Loading messages...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#e5ddd5]">
        <div className="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center mb-4">
          <AlertCircle className="w-6 h-6 text-red-500" />
        </div>
        <p className="text-red-600 font-medium mb-1">Failed to load messages</p>
        <p className="text-gray-500 text-sm">{error.message}</p>
      </div>
    );
  }

  const initials = (displayAgentName || 'A')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-[#e5ddd5]">
      {/* WhatsApp Style Header */}
      <div className="bg-[#008069] text-white px-4 py-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar className="h-10 w-10 border-2 border-white/30 cursor-pointer" onClick={() => setShowProfile(true)}>
              {agentAvatar ? (
                <AvatarImage src={agentAvatar} alt={displayAgentName} />
              ) : null}
              <AvatarFallback className="bg-white/20 text-white text-sm font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setShowProfile(true)}>
            <h3 className="font-semibold text-white truncate">{displayAgentName}</h3>
            {agentPhone && (
              <p className="text-xs text-white/80 truncate">{agentPhone}</p>
            )}
            {/* Persona is NOT displayed in header - only shown in profile view */}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white hover:bg-white/20"
            title="Search"
          >
            <Search className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white hover:bg-white/20"
            title="More options"
          >
            <MoreVertical className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Messages Area - WhatsApp Background Pattern */}
      <div 
        className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0 bg-[#e5ddd5] bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iYSIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIj48cGF0aCBkPSJNMCAwaDQwdjQwSDB6IiBmaWxsPSIjZTVkZGQ1Ii8+PHBhdGggZD0iTTAgMGgyMHYyMEgweiIgZmlsbD0iI2RkZGRkZCIgb3BhY2l0eT0iMC4wNSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNhKSIvPjwvc3ZnPg==')]"
        style={{ backgroundSize: '40px 40px' }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-white/50 flex items-center justify-center mb-4">
              <Avatar className="h-12 w-12">
                {agentAvatar ? (
                  <AvatarImage src={agentAvatar} alt={displayAgentName} />
                ) : null}
                <AvatarFallback className="bg-[#008069] text-white text-lg font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </div>
            <p className="text-gray-700 font-medium mb-1">No messages yet</p>
            <p className="text-sm text-gray-600">Start a conversation with {displayAgentName}</p>
          </div>
        ) : (
          <>
            {/* Deduplicate messages by ID and content+timestamp to prevent duplicate display */}
            {(() => {
              // First deduplicate by ID
              const byId = new Map<string, Message>();
              messages.forEach(msg => {
                if (!byId.has(msg.id)) {
                  byId.set(msg.id, msg);
                }
              });
              
              // Then deduplicate by content + timestamp (in case IDs differ but content is same)
              const byContent = new Map<string, Message>();
              Array.from(byId.values()).forEach(msg => {
                // Create a unique key from message content + timestamp (rounded to nearest second)
                const timestamp = new Date(msg.timestamp).getTime();
                const roundedTimestamp = Math.floor(timestamp / 1000) * 1000; // Round to nearest second
                const contentKey = `${msg.message?.trim() || ''}_${roundedTimestamp}_${msg.agent_id}_${msg.is_from_me ? 'user' : 'agent'}`;
                
                // Only keep the first occurrence of messages with same content and timestamp
                if (!byContent.has(contentKey)) {
                  byContent.set(contentKey, msg);
                }
              });
              
              return Array.from(byContent.values());
            })().map((message) => (
              <MessageBubble key={`${message.id}-${message.timestamp}`} message={message} />
            ))}
            {isTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="shrink-0 bg-[#f0f2f5]">
        <MessageInput
          onSend={handleSendMessage}
          disabled={sendMessageMutation.isPending}
        />
      </div>
    </div>
  );
};
