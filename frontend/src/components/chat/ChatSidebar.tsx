/**
 * ChatSidebar Component - WhatsApp Style
 * 
 * Displays list of agents with their last message and unread count
 * WhatsApp-style design with avatars
 */

import React from 'react';
import { AgentChatInfo } from '@/types/message.types';
import { Bot, MessageCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface ChatSidebarProps {
  agents: AgentChatInfo[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
}) => {
  return (
    <div className="w-full lg:w-80 border-r border-gray-300 bg-white flex flex-col h-full min-h-0">
      {/* Header - WhatsApp Style */}
      <div className="bg-[#008069] text-white px-4 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-white" />
          </div>
          <h2 className="text-lg font-semibold text-white">Chats</h2>
        </div>
      </div>

      {/* Agent List - WhatsApp Style */}
      <div className="flex-1 overflow-y-auto bg-white">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Bot className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-gray-600 text-sm font-medium">No agents available</p>
            <p className="text-gray-400 text-xs mt-1">Create an agent to start chatting</p>
          </div>
        ) : (
          agents.map((agent) => {
            const initials = (agent.agent_name || 'A')
              .split(' ')
              .map((part) => part[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();

            return (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={`w-full px-4 py-3 border-b border-gray-200 hover:bg-gray-50 transition-colors text-left ${
                  selectedAgentId === agent.id 
                    ? 'bg-[#f0f2f5]' 
                    : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar - WhatsApp Style */}
                  <Avatar className="h-12 w-12 shrink-0">
                    {(agent as any).avatar_url ? (
                      <AvatarImage src={(agent as any).avatar_url} alt={agent.agent_name} />
                    ) : null}
                    <AvatarFallback className="bg-[#008069] text-white text-sm font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-medium text-gray-900 truncate text-sm">
                        {agent.agent_name}
                      </h3>
                      {agent.unreadCount > 0 && (
                        <Badge 
                          variant="secondary" 
                          className="ml-2 bg-[#25d366] text-white shrink-0 text-xs font-medium px-2 py-0.5 rounded-full min-w-[20px] h-5 flex items-center justify-center"
                        >
                          {agent.unreadCount}
                        </Badge>
                      )}
                    </div>
                    
                    {agent.lastMessage && (
                      <>
                        <p className="text-sm text-gray-600 truncate mb-1">
                          {agent.lastMessage.is_from_me ? (
                            <span className="text-gray-500">You: </span>
                          ) : null}
                          {agent.lastMessage.message}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDistanceToNow(new Date(agent.lastMessage.timestamp), {
                            addSuffix: true,
                          })}
                        </p>
                      </>
                    )}

                    {!agent.lastMessage && (
                      <p className="text-sm text-gray-500 italic">No messages yet</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
