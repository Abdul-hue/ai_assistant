/**
 * MessageBubble Component - WhatsApp Style
 * 
 * Displays individual messages in WhatsApp-style bubbles
 * - User messages: Left-aligned, white background with tail
 * - Agent messages: Right-aligned, green background with tail
 * - WhatsApp-style status indicators
 */

import React from 'react';
import { Message } from '@/types/message.types';
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
        return <Clock className="w-3 h-3 text-gray-500" />;
      case 'sent':
        return <Check className="w-3 h-3 text-gray-500" />;
      case 'delivered':
        return <CheckCheck className="w-3 h-3 text-gray-500" />;
      case 'read':
        return <CheckCheck className="w-3 h-3 text-[#53bdeb]" />;
      case 'failed':
        return <AlertCircle className="w-3 h-3 text-red-500" />;
      default:
        return <Check className="w-3 h-3 text-gray-500" />;
    }
  };

  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-1 px-1`}>
      <div
        className={`max-w-[70%] sm:max-w-[65%] rounded-lg px-2 py-1.5 ${
          isUser
            ? 'bg-white rounded-tl-none shadow-sm'
            : 'bg-[#d9fdd3] rounded-tr-none'
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
        
        <div className={`flex items-center gap-1 mt-0.5 ${isUser ? 'justify-start' : 'justify-end'}`}>
          <span className={`text-[10px] ${
            isUser ? 'text-gray-500' : 'text-white/70'
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
