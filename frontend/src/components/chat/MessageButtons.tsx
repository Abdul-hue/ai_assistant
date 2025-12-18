/**
 * MessageButtons Component
 * 
 * Renders interactive buttons for agent messages with numbered options
 * - Grid layout: 2 columns on mobile, 3 columns on tablet/desktop
 * - WhatsApp-style button design
 * - Click sends button text as message
 */

import React from 'react';
import { ButtonOption } from '@/types/message.types';

interface MessageButtonsProps {
  buttons: ButtonOption[];
  onButtonClick: (text: string) => void;
}

export const MessageButtons: React.FC<MessageButtonsProps> = ({ buttons, onButtonClick }) => {
  if (!buttons || buttons.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
      {buttons.map((button, index) => (
        <button
          key={`${button.number}-${index}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onButtonClick(button.fullText);
          }}
          className="px-3 py-2 text-sm font-medium text-gray-900 bg-white border-2 border-gray-300 rounded-lg hover:bg-[#008069] hover:text-white hover:border-[#008069] active:bg-[#006b57] active:scale-[0.98] transition-all duration-150 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#008069] focus:ring-offset-1"
          type="button"
        >
          <span className="block text-left whitespace-normal break-words font-semibold">
            {button.fullText}
          </span>
        </button>
      ))}
    </div>
  );
};

