/**
 * MessageBubble Component - WhatsApp Style
 * 
 * Displays individual messages in WhatsApp-style bubbles
 * - User messages: Left-aligned, white background with tail
 * - Agent messages: Right-aligned, green background with tail
 * - WhatsApp-style status indicators
 * - Interactive buttons for dashboard agent messages
 */

import React, { useMemo } from 'react';
import { Message } from '@/types/message.types';
import { formatDistanceToNow } from 'date-fns';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { parseMessageButtons } from '@/utils/messageButtonParser';
import { MessageButtons } from './MessageButtons';

interface MessageBubbleProps {
  message: Message;
  onButtonClick?: (text: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onButtonClick }) => {
  const isUser = message.is_from_me || message.sender_type === 'user';
  
  // Parse buttons for dashboard agent messages
  const buttons = useMemo(() => {
    // Debug: Log all message metadata to diagnose button parsing
    console.log('[MessageBubble] 🔍 Message metadata:', {
      id: message.id,
      source: message.source,
      sender_type: message.sender_type,
      isUser,
      messagePreview: message.message?.substring(0, 200),
      hasButtonsPattern: message.message?.includes('*1') || message.message?.includes('*2') || message.message?.includes('*3')
    });
    
    // Only parse buttons for dashboard agent messages
    if (message.source === 'dashboard' && message.sender_type === 'agent' && !isUser) {
      const parsedButtons = parseMessageButtons(message.message);
      // Debug logging (remove in production)
      if (parsedButtons.length > 0) {
        console.log('[MessageBubble] ✅ Buttons parsed:', parsedButtons);
      } else {
        console.log('[MessageBubble] ⚠️ No buttons found. Message:', message.message?.substring(0, 200));
        console.log('[MessageBubble] ⚠️ Message does not match button patterns');
        // Check if message has button-like patterns
        const hasPattern = /[*]\d+\s+/.test(message.message || '');
        console.log('[MessageBubble] Has button pattern (*N ):', hasPattern);
      }
      return parsedButtons;
    } else {
      console.log('[MessageBubble] ⏭️ Skipping button parse:', {
        reason: message.source !== 'dashboard' ? 'source is not dashboard' : 
                message.sender_type !== 'agent' ? 'sender_type is not agent' : 
                isUser ? 'isUser is true' : 'unknown'
      });
    }
    return [];
  }, [message.source, message.sender_type, message.message, isUser]);
  
  // ✅ NEW: Remove button lines from message text for cleaner display
  // This hides the button text (e.g., "*1️⃣ Option 1*") and only shows the buttons
  const displayMessage = useMemo(() => {
    if (buttons.length === 0) {
      return message.message;
    }
    
    // Remove button patterns from message text
    let cleanedMessage = message.message;
    
    // Remove patterns like "*1️⃣ Option*", "*1 Option*", "*1?? Option*", "*1. Option*", "1️⃣ Option", "1 Option", "1?? Option", "1. Option"
    // ✅ FIX: Handle corrupted emojis (??) and various formats including plain number format
    const buttonPatterns = [
      /\*\d[️⃣?]+\s+[^*]+\*/g,  // *1️⃣ Text* or *1?? Text* (with corrupted emoji)
      /\*\d+\s+[^*]+\*/g,       // ✅ NEW: *1 Text* (just number, no emoji, no period)
      /\*\d+\.\s+[^*]+\*/g,     // *1. Text*
      /\d[️⃣?]+\s+[^\n*]+/g,     // 1️⃣ Text or 1?? Text (not in asterisks, with corrupted emoji)
      /(?:^|\n)\d+\s+[^\n*]+(?=\n|$)/g,  // ✅ NEW: 1 Text (just number, not in asterisks, on its own line)
      /\d+\.\s+[^\n*]+/g,       // 1. Text (not in asterisks)
    ];
    
    buttonPatterns.forEach(pattern => {
      cleanedMessage = cleanedMessage.replace(pattern, '');
    });
    
    // Clean up extra newlines (max 2 consecutive)
    cleanedMessage = cleanedMessage.replace(/\n{3,}/g, '\n\n');
    
    // Trim whitespace
    return cleanedMessage.trim();
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
        return <CheckCheck className="w-3 h-3 text-[#53bdeb]" />;
      case 'failed':
        return <AlertCircle className="w-3 h-3 text-red-500" />;
      default:
        return <Check className="w-3 h-3 text-gray-500" />;
    }
  };

  const handleButtonClick = (text: string) => {
    if (onButtonClick) {
      onButtonClick(text);
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
          {displayMessage}
        </p>
        
        {/* Render buttons for dashboard agent messages */}
        {buttons.length > 0 && (
          <MessageButtons buttons={buttons} onButtonClick={handleButtonClick} />
        )}
        
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
