/**
 * ChatInterface Component - Modern Production-Ready Design
 * 
 * A sleek, ChatGPT-inspired chat interface with:
 * - Agent dropdown selector
 * - Centered chat area with max-width
 * - Modern message styling
 * - Smooth animations
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
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Plus,
  Settings,
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
import { parseMessageButtons } from '@/utils/messageButtonParser';
import { MessageButtons } from './MessageButtons';

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

  const handleSendMessage = (text?: string) => {
    const messageToSend = text || message.trim();
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
    
    return Array.from(byContent.values());
  }, [messages]);

  if (agentsLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-b from-[#0a0a0a] to-[#111]">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center animate-pulse">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#0a0a0a]">
              <Loader2 className="w-3 h-3 animate-spin text-white" />
            </div>
          </div>
          <p className="text-gray-400 text-sm">Loading your agents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#0a0a0a] to-[#0d0d0d] overflow-hidden">
      {/* Header with Agent Selector */}
      <div className="shrink-0 border-b border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto p-2 pr-3 hover:bg-white/5 border border-white/10 rounded-xl gap-3 max-w-[300px]"
                  >
                    {selectedAgent ? (
                      <>
                        <Avatar className="h-9 w-9 border border-white/10">
                          {(selectedAgent as any).avatar_url ? (
                            <AvatarImage src={(selectedAgent as any).avatar_url} alt={selectedAgent.agent_name} />
                          ) : null}
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs font-semibold">
                            {getInitials(selectedAgent.agent_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-medium text-white truncate">{selectedAgent.agent_name}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {selectedAgent.unreadCount > 0 && (
                              <span className="text-emerald-400">{selectedAgent.unreadCount} new • </span>
                            )}
                            AI Assistant
                          </p>
                        </div>
                        <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                      </>
                    ) : (
                      <>
                        <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center">
                          <Bot className="w-5 h-5 text-gray-500" />
                        </div>
                        <span className="text-sm text-gray-400">Select an agent</span>
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent 
                  align="start" 
                  className="w-72 bg-[#1a1a1a] border-white/10 p-2"
                >
                  <DropdownMenuLabel className="text-gray-400 text-xs font-normal px-2 pb-2">
                    Your AI Agents
                  </DropdownMenuLabel>
                  {agents.length === 0 ? (
                    <div className="py-6 text-center">
                      <Bot className="w-10 h-10 mx-auto text-gray-600 mb-2" />
                      <p className="text-sm text-gray-400">No agents yet</p>
                      <Button 
                        size="sm" 
                        className="mt-3 bg-violet-600 hover:bg-violet-700"
                        onClick={() => navigate('/create-agent')}
                      >
                        <Plus className="w-4 h-4 mr-1" />
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
                          selectedAgentId === ag.id && "bg-white/5"
                        )}
                      >
                        <Avatar className="h-10 w-10 border border-white/10">
                          {(ag as any).avatar_url ? (
                            <AvatarImage src={(ag as any).avatar_url} alt={ag.agent_name} />
                          ) : null}
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-sm font-semibold">
                            {getInitials(ag.agent_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{ag.agent_name}</p>
                          {ag.lastMessage && (
                            <p className="text-xs text-gray-500 truncate">
                              {ag.lastMessage.message}
                            </p>
                          )}
                        </div>
                        {ag.unreadCount > 0 && (
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-0 text-xs">
                            {ag.unreadCount}
                          </Badge>
                        )}
                        {selectedAgentId === ag.id && (
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        )}
                      </DropdownMenuItem>
                    ))
                  )}
                  <DropdownMenuSeparator className="bg-white/5 my-2" />
                  <DropdownMenuItem 
                    onClick={() => navigate('/create-agent')}
                    className="flex items-center gap-2 p-2 rounded-lg text-gray-400 hover:text-white"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-sm">Create new agent</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
            {selectedAgent && (
              <div className="flex items-center gap-2">
                {isWhatsAppConnected ? (
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                    <Zap className="w-3 h-3 mr-1" />
                    Connected
                  </Badge>
                ) : whatsappStatus.hasQRCode ? (
                  <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10">
                    <QrCode className="w-3 h-3 mr-1" />
                    Scan QR
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-red-500/30 text-red-400 bg-red-500/10">
                    <WifiOff className="w-3 h-3 mr-1" />
                    Disconnected
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6">
          {!selectedAgentId ? (
            <EmptyState onCreateAgent={() => navigate('/create-agent')} />
          ) : messagesLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : uniqueMessages.length === 0 ? (
            <WelcomeState agentName={selectedAgent?.agent_name || 'Agent'} />
          ) : (
            <div className="space-y-6">
              {uniqueMessages.map((msg) => (
                <MessageItem 
                  key={`${msg.id}-${msg.timestamp}`} 
                  message={msg} 
                  agentName={selectedAgent?.agent_name || 'Agent'}
                  agentAvatar={(selectedAgent as any)?.avatar_url}
                  onButtonClick={handleSendMessage}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      {selectedAgentId && (
        <div className="shrink-0 border-t border-white/5 bg-black/40 backdrop-blur-xl">
          <div className="max-w-4xl mx-auto px-4 py-4">
            {/* WhatsApp Disconnected Warning */}
            {!isWhatsAppConnected && (
              <div className="mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                  <WifiOff className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">WhatsApp Not Connected</p>
                  <p className="text-xs text-amber-400/70">
                    {whatsappStatus.hasQRCode 
                      ? "Scan the QR code in agent settings to connect" 
                      : "Connect WhatsApp in agent settings to send messages"}
                  </p>
                </div>
                <Button 
                  size="sm" 
                  variant="outline"
                  className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 shrink-0"
                  onClick={() => navigate(`/dashboard`)}
                >
                  <Settings className="w-4 h-4 mr-1" />
                  Setup
                </Button>
              </div>
            )}
            
            <div className={cn(
              "relative bg-[#1a1a1a] rounded-2xl border transition-colors",
              !isWhatsAppConnected 
                ? "border-amber-500/20 opacity-60" 
                : "border-white/10 focus-within:border-violet-500/50"
            )}>
              <Textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isWhatsAppConnected 
                  ? `Message ${selectedAgent?.agent_name || 'Agent'}...`
                  : "Connect WhatsApp to send messages..."
                }
                className="min-h-[52px] max-h-[200px] w-full resize-none bg-transparent border-0 text-white placeholder:text-gray-500 focus-visible:ring-0 focus-visible:ring-offset-0 py-4 px-4 pr-14 text-sm"
                disabled={sendMessageMutation.isPending || !isWhatsAppConnected}
                rows={1}
              />
              <Button
                onClick={() => handleSendMessage()}
                disabled={sendMessageMutation.isPending || !message.trim() || !isWhatsAppConnected}
                size="icon"
                className={cn(
                  "absolute right-2 bottom-2 h-9 w-9 rounded-xl transition-all",
                  message.trim() && isWhatsAppConnected
                    ? "bg-violet-600 hover:bg-violet-700 text-white"
                    : "bg-white/5 text-gray-500"
                )}
              >
                {sendMessageMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-[11px] text-gray-600 text-center mt-2">
              {isWhatsAppConnected 
                ? "Press Enter to send • Shift + Enter for new line"
                : "WhatsApp connection required to send messages"
              }
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// Empty State Component
const EmptyState: React.FC<{ onCreateAgent: () => void }> = ({ onCreateAgent }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center mb-6 border border-violet-500/20">
      <MessageCircle className="w-10 h-10 text-violet-400" />
    </div>
    <h3 className="text-xl font-semibold text-white mb-2">No Agent Selected</h3>
    <p className="text-gray-500 mb-6 max-w-sm">
      Select an agent from the dropdown above to start a conversation, or create a new one.
    </p>
    <Button 
      onClick={onCreateAgent}
      className="bg-violet-600 hover:bg-violet-700"
    >
      <Plus className="w-4 h-4 mr-2" />
      Create Your First Agent
    </Button>
  </div>
);

// Welcome State Component
const WelcomeState: React.FC<{ agentName: string }> = ({ agentName }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg shadow-violet-500/20">
      <Sparkles className="w-8 h-8 text-white" />
    </div>
    <h3 className="text-xl font-semibold text-white mb-2">Start a Conversation</h3>
    <p className="text-gray-500 max-w-sm">
      Send a message to {agentName} and get an AI-powered response.
    </p>
    <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
      {[
        'What can you help me with?',
        'Tell me about yourself',
        'Show me the menu',
        'Schedule a meeting'
      ].map((suggestion) => (
        <button
          key={suggestion}
          className="px-4 py-3 text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 hover:border-white/10 transition-all text-left"
        >
          {suggestion}
        </button>
      ))}
    </div>
  </div>
);

// Message Item Component
interface MessageItemProps {
  message: Message;
  agentName: string;
  agentAvatar?: string;
  onButtonClick?: (text: string) => void;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, agentName, agentAvatar, onButtonClick }) => {
  const isUser = message.is_from_me || message.sender_type === 'user';
  
  // Parse buttons for agent messages
  const buttons = React.useMemo(() => {
    if (message.source === 'dashboard' && message.sender_type === 'agent' && !isUser) {
      return parseMessageButtons(message.message);
    }
    return [];
  }, [message.source, message.sender_type, message.message, isUser]);
  
  // Clean message text (remove button patterns)
  const displayMessage = React.useMemo(() => {
    if (buttons.length === 0) return message.message;
    
    let cleanedMessage = message.message;
    const buttonPatterns = [
      /\*\d[️⃣?]+\s+[^*]+\*/g,
      /\*\d+\s+[^*]+\*/g,
      /\*\d+\.\s+[^*]+\*/g,
      /\d[️⃣?]+\s+[^\n*]+/g,
      /(?:^|\n)\d+\s+[^\n*]+(?=\n|$)/g,
      /\d+\.\s+[^\n*]+/g,
    ];
    
    buttonPatterns.forEach(pattern => {
      cleanedMessage = cleanedMessage.replace(pattern, '');
    });
    
    return cleanedMessage.replace(/\n{3,}/g, '\n\n').trim();
  }, [message.message, buttons.length]);

  const StatusIcon = () => {
    if (!isUser) return null;
    
    switch (message.status) {
      case 'sending':
        return <Clock className="w-3 h-3 text-gray-500" />;
      case 'sent':
        return <Check className="w-3 h-3 text-gray-500" />;
      case 'delivered':
        return <CheckCheck className="w-3 h-3 text-gray-500" />;
      case 'read':
        return <CheckCheck className="w-3 h-3 text-emerald-400" />;
      case 'failed':
        return <AlertCircle className="w-3 h-3 text-red-400" />;
      default:
        return <Check className="w-3 h-3 text-gray-500" />;
    }
  };

  return (
    <div className={cn("flex gap-4", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div className="shrink-0">
        {isUser ? (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
        ) : (
          <Avatar className="w-8 h-8 rounded-lg border border-white/10">
            {agentAvatar ? (
              <AvatarImage src={agentAvatar} alt={agentName} className="rounded-lg" />
            ) : null}
            <AvatarFallback className="rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs font-semibold">
              <Bot className="w-4 h-4" />
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      {/* Message Content */}
      <div className={cn("flex-1 space-y-1", isUser ? "items-end" : "items-start")}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-gray-400">
            {isUser ? 'You' : agentName}
          </span>
          <span className="text-[10px] text-gray-600">
            {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
          </span>
        </div>
        
        <div
          className={cn(
            "rounded-2xl px-4 py-3 max-w-[85%] inline-block",
            isUser
              ? "bg-violet-600 text-white rounded-tr-md"
              : "bg-[#1a1a1a] text-gray-100 border border-white/5 rounded-tl-md"
          )}
        >
          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
            {displayMessage}
          </p>
          
          {/* Buttons for agent messages */}
          {buttons.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
              {buttons.map((btn, idx) => (
                <button
                  key={idx}
                  onClick={() => onButtonClick?.(btn.fullText)}
                  className="w-full px-3 py-2 text-sm text-left bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 hover:border-violet-500/30 transition-all flex items-center gap-2"
                >
                  <span className="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center text-violet-400 text-xs font-medium">
                    {btn.number}
                  </span>
                  <span className="text-gray-300">{btn.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        
        {isUser && (
          <div className="flex items-center gap-1 mt-1">
            <StatusIcon />
          </div>
        )}
      </div>
    </div>
  );
};
