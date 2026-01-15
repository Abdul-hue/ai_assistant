/**
 * ChatInterface Component - ChatGPT-Style Design
 * 
 * A clean, modern chat interface inspired by ChatGPT with:
 * - Clean alternating message layout
 * - User messages on right (blue)
 * - Bot messages on left (white/gray)
 * - Proper vertical spacing
 * - Fixed input at bottom
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAgentChatList } from '@/hooks/useAgentChatList';
import { useAgentMessages } from '@/hooks/useAgentMessages';
import { useSendMessage } from '@/hooks/useSendMessage';
import { useAgentDetails, getWhatsAppStatus, needsWhatsAppSetup } from '@/hooks/useAgentDetails';
import { 
  Loader2, 
  MessageCircle, 
  Send, 
  ChevronDown, 
  Bot, 
  User,
  Sparkles,
  Plus,
  Zap,
  WifiOff,
  QrCode
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Message } from '@/types/message.types';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { ariaLabels } from '@/lib/accessibility';

export const ChatInterface: React.FC = () => {
  const navigate = useNavigate();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const { data: agents = [], isLoading: agentsLoading } = useAgentChatList();
  const { data: messages = [], isLoading: messagesLoading } = useAgentMessages({ 
    agentId: selectedAgentId || '' 
  });
  const { data: agentDetails } = useAgentDetails(selectedAgentId || '');
  const sendMessageMutation = useSendMessage();

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const agent = agentDetails?.agent;
  
  // Get WhatsApp connection status
  const whatsappStatus = getWhatsAppStatus(agentDetails);
  const needsSetup = needsWhatsAppSetup(agentDetails);
  const isWhatsAppConnected = whatsappStatus.isConnected;

  // Auto-select first agent
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [message]);

  const handleSendMessage = () => {
    const messageToSend = message.trim();
    if (messageToSend && selectedAgentId) {
      sendMessageMutation.mutate({
        agentId: selectedAgentId,
        message: messageToSend,
        contact_id: null,
      });
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  // Deduplicate messages
  const uniqueMessages = React.useMemo(() => {
    const byId = new Map<string, Message>();
    messages.forEach(msg => {
      if (!byId.has(msg.id)) {
        byId.set(msg.id, msg);
      }
    });
    
    const byContent = new Map<string, Message>();
    Array.from(byId.values()).forEach(msg => {
      const timestamp = new Date(msg.timestamp).getTime();
      const roundedTimestamp = Math.floor(timestamp / 1000) * 1000;
      const contentKey = `${msg.message?.trim() || ''}_${roundedTimestamp}_${msg.agent_id}_${msg.is_from_me ? 'user' : 'agent'}`;
      
      if (!byContent.has(contentKey)) {
        byContent.set(contentKey, msg);
      }
    });
    
    return Array.from(byContent.values()).sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });
  }, [messages]);

  // Determine if message is from user
  const isUserMessage = (msg: Message) => {
    return msg.is_from_me === true || msg.is_from_me === 'true' || String(msg.is_from_me).toLowerCase() === 'true' || msg.sender_type === 'user';
  };

  if (agentsLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500 dark:text-gray-400" />
          <p className="text-gray-600 dark:text-gray-400 text-sm">Loading your agents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header with Agent Selector */}
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto p-2 pr-3 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-xl gap-3 max-w-[300px]"
                    aria-label={ariaLabels.chat.agentSelector}
                  >
                    {selectedAgent ? (
                      <>
                        <Avatar className="h-9 w-9 border border-gray-200 dark:border-gray-700">
                          {(selectedAgent as any).avatar_url ? (
                            <AvatarImage src={(selectedAgent as any).avatar_url} alt={selectedAgent.agent_name} />
                          ) : null}
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs font-semibold">
                            {getInitials(selectedAgent.agent_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{selectedAgent.agent_name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {selectedAgent.unreadCount > 0 ? (
                              <span className="text-blue-600 dark:text-blue-400">{selectedAgent.unreadCount} new • </span>
                            ) : null}
                            AI Assistant
                          </p>
                        </div>
                        <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
                      </>
                    ) : (
                      <>
                        <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                          <Bot className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                        </div>
                        <span className="text-sm text-gray-500 dark:text-gray-400">Select an agent</span>
                        <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent 
                  align="start" 
                  className="w-72 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-2"
                >
                  <DropdownMenuLabel className="text-gray-500 dark:text-gray-400 text-xs font-normal px-2 pb-2">
                    Your AI Agents
                  </DropdownMenuLabel>
                  {agents.length === 0 ? (
                    <div className="py-6 text-center">
                      <Bot className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">No agents yet</p>
                      <Button 
                        size="sm" 
                        className="mt-3 bg-blue-600 hover:bg-blue-700"
                        onClick={() => navigate('/create-agent')}
                        aria-label={ariaLabels.actions.create('agent')}
                      >
                        <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                        Create Agent
                      </Button>
                    </div>
                  ) : (
                    agents.map((ag) => (
                      <DropdownMenuItem
                        key={ag.id}
                        onClick={() => setSelectedAgentId(ag.id)}
                        className={cn(
                          "flex items-center gap-3 p-2 rounded-lg cursor-pointer",
                          selectedAgentId === ag.id && "bg-gray-100 dark:bg-gray-700"
                        )}
                        aria-label={`Select ${ag.agent_name} agent`}
                      >
                        <Avatar className="h-10 w-10 border border-gray-200 dark:border-gray-700">
                          {(ag as any).avatar_url ? (
                            <AvatarImage src={(ag as any).avatar_url} alt={ag.agent_name} />
                          ) : null}
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-sm font-semibold">
                            {getInitials(ag.agent_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ag.agent_name}</p>
                          {ag.lastMessage && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {ag.lastMessage.message}
                            </p>
                          )}
                        </div>
                        {ag.unreadCount > 0 && (
                          <Badge className="bg-blue-600 text-white border-0 text-xs">
                            {ag.unreadCount}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                    ))
                  )}
                  <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700 my-2" />
                  <DropdownMenuItem 
                    onClick={() => navigate('/create-agent')}
                    className="flex items-center gap-2 p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-sm">Create new agent</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
            {selectedAgent && (
              <div className="flex items-center gap-2 shrink-0">
                {isWhatsAppConnected ? (
                  <Badge variant="outline" className="border-green-500/50 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 gap-1">
                    <Zap className="w-3 h-3" />
                    Connected
                  </Badge>
                ) : whatsappStatus.hasQRCode ? (
                  <Badge variant="outline" className="border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 gap-1">
                    <QrCode className="w-3 h-3" />
                    Scan QR
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-red-500/30 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 gap-1">
                    <WifiOff className="w-3 h-3" />
                    Disconnected
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages Area - Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {!selectedAgentId ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center mb-6 border border-violet-200 dark:border-violet-800">
                <MessageCircle className="w-10 h-10 text-violet-600 dark:text-violet-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">No agent selected</h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                Select an agent from the dropdown above to start chatting
              </p>
              <Button 
                onClick={() => navigate('/create-agent')}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Agent
              </Button>
            </div>
          ) : messagesLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-gray-400" />
            </div>
          ) : uniqueMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg shadow-violet-500/20">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Start a conversation with {selectedAgent?.agent_name || 'your agent'}
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-8">
                Send a message to {selectedAgent?.agent_name || 'your agent'} and get an AI-powered response.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {uniqueMessages.map((msg) => {
                const isUser = isUserMessage(msg);
                return (
                  <div
                    key={`${msg.id}-${msg.timestamp}`}
                    className={cn(
                      "flex",
                      isUser ? "justify-end" : "justify-start"
                    )}
                  >
                    <div className={cn(
                      "flex items-start gap-3 max-w-2xl",
                      isUser && "flex-row-reverse"
                    )}>
                      {/* Avatar */}
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                        isUser 
                          ? "bg-blue-600" 
                          : "bg-green-600"
                      )}>
                        {isUser ? (
                          <User className="w-4 h-4 text-white" />
                        ) : (
                          <Bot className="w-4 h-4 text-white" />
                        )}
                      </div>
                      
                      {/* Message Bubble */}
                      <div className={cn(
                        "rounded-2xl px-4 py-3",
                        isUser
                          ? "bg-blue-600 text-white"
                          : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm"
                      )}>
                        <p className={cn(
                          "text-sm leading-relaxed whitespace-pre-wrap break-words",
                          isUser
                            ? "text-white"
                            : "text-gray-800 dark:text-gray-200"
                        )}>
                          {msg.message || msg.message_text || ''}
                        </p>
                        {msg.status === 'failed' && (
                          <div className="flex items-center gap-1 mt-2 text-red-200 dark:text-red-400">
                            <span className="text-xs">Failed to send</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input Area - Fixed at Bottom */}
      {selectedAgentId && (
        <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="max-w-3xl mx-auto px-4 py-4">
            {/* WhatsApp Disconnected Warning */}
            {!isWhatsAppConnected && (
              <div className="mb-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                  <WifiOff className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    WhatsApp Disconnected
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Messages won't be sent until WhatsApp is connected
                  </p>
                </div>
              </div>
            )}
            
            <div className="flex items-end gap-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-full px-4 py-2 shadow-lg">
              <Textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message AI Bot..."
                disabled={sendMessageMutation.isPending || !isWhatsAppConnected}
                className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[24px] max-h-[200px] py-2 px-0"
                rows={1}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!message.trim() || sendMessageMutation.isPending || !isWhatsAppConnected}
                className="p-2 bg-blue-600 hover:bg-blue-700 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-8 w-8 shrink-0"
                aria-label={ariaLabels.chat.sendButton}
              >
                {sendMessageMutation.isPending ? (
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                ) : (
                  <Send className="w-4 h-4 text-white" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
