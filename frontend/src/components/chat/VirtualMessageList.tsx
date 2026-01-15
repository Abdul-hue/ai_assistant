import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Message } from '@/types/message.types';
import { formatDistanceToNow } from 'date-fns';
import { Bot, User, Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface VirtualMessageListProps {
  messages: Message[];
  agentName: string;
  agentAvatar?: string;
}

export function VirtualMessageList({ 
  messages, 
  agentName,
  agentAvatar
}: VirtualMessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // Estimated message height in pixels
    overscan: 5, // Render 5 extra items above/below viewport
  });

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      role="log"
      aria-live="polite"
      aria-label="Message history"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index];
          
          // Determine if this is a user message
          const isFromMe = message.is_from_me === true || message.is_from_me === 'true' || String(message.is_from_me).toLowerCase() === 'true';
          const isUser = isFromMe || message.sender_type === 'user';

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
            <div
              key={message.id}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className={cn("flex gap-4 px-4 py-3", isUser ? "flex-row-reverse" : "flex-row")}>
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
                <div className={cn("flex-1 flex flex-col", isUser ? "items-end" : "items-start")}>
                  <div className={cn("flex items-center gap-2 mb-1", isUser ? "flex-row-reverse" : "flex-row")}>
                    <span className="text-xs font-medium text-gray-400">
                      {isUser ? 'You' : agentName}
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                  
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 max-w-[85%]",
                      isUser
                        ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-tr-sm"
                        : "bg-[#1a1a1a] text-gray-100 border border-white/5 rounded-tl-sm"
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                      {message.message}
                    </p>
                  </div>
                  
                  {isUser && (
                    <div className="flex items-center gap-1 mt-1 justify-end">
                      <StatusIcon />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
