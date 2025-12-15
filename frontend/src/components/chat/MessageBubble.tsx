/**
 * MessageBubble Component - WhatsApp Style
 * 
 * Displays individual messages in WhatsApp-style bubbles
 * - User messages: Right-aligned, green background with tail
 * - Agent messages: Left-aligned, white background with tail
 * - WhatsApp-style status indicators
 */

import React from 'react';
import { Message } from '@/types/message.types';
import { formatDistanceToNow } from 'date-fns';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.is_from_me || message.sender_type === 'user';
  
  const StatusIcon = () => {
    if (!isUser) return null;
    
    switch (message.status) {
      case 'sending':
        return <Clock className="w-3 h-3 text-white/70" />;
      case 'sent':
        return <Check className="w-3 h-3 text-white/70" />;
      case 'delivered':
        return <CheckCheck className="w-3 h-3 text-white/70" />;
      case 'read':
        return <CheckCheck className="w-3 h-3 text-[#53bdeb]" />;
      case 'failed':
        return <AlertCircle className="w-3 h-3 text-white" />;
      default:
        return <Check className="w-3 h-3 text-white/70" />;
    }
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-1 px-1`}>
      <div
        className={`max-w-[70%] sm:max-w-[65%] rounded-lg px-2 py-1.5 ${
          isUser
            ? 'bg-[#d9fdd3] rounded-tr-none'
            : 'bg-white rounded-tl-none shadow-sm'
        }`}
        style={{
          ...(isUser ? {} : {}),
        }}
      >
        <p className={`text-sm break-words whitespace-pre-wrap leading-relaxed ${
          isUser ? 'text-gray-900' : 'text-gray-900'
        }`}>
          {message.message}
        </p>
        <div className={`flex items-center gap-1 mt-0.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span className={`text-[10px] ${
            isUser ? 'text-white/70' : 'text-gray-500'
          }`}>
            {new Date(message.timestamp).toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            })}
          </span>
          {isUser && <StatusIcon />}
        </div>
      </div>
    </div>
  );
};
