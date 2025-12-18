/**
 * Message Button Parser Utility
 * 
 * Parses numbered options from message text to create interactive buttons
 * Supports various formats:
 * - *1️⃣ Send Message* (bold with emoji)
 * - *1. Send Message* (bold with period)
 * - 1️⃣ Send Message (plain with emoji)
 * - 1. Send Message (plain with period)
 */

export interface ButtonOption {
  number: string;
  text: string;
  fullText: string;
}

/**
 * Parse message text to extract numbered button options
 * @param messageText - The message text to parse
 * @returns Array of button options (1-6)
 */
export function parseMessageButtons(messageText: string): ButtonOption[] {
  if (!messageText || typeof messageText !== 'string') {
    console.log('[ButtonParser] ⚠️ Invalid message text:', messageText);
    return [];
  }

  // ✅ FIX: Handle JSON button objects (fallback for old messages stored as JSON)
  try {
    const parsed = JSON.parse(messageText);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.buttons)) {
      console.log('[ButtonParser] ✅ Found JSON button object, converting to buttons');
      // Convert JSON button object directly to ButtonOption format
      const jsonButtons: ButtonOption[] = parsed.buttons
        .slice(0, 6) // Max 6 buttons
        .map((btn: any, index: number) => {
          const buttonNumber = index + 1;
          const buttonText = btn.text || btn.title || btn.id || `Option ${buttonNumber}`;
          return {
            number: String(buttonNumber),
            text: buttonText,
            fullText: `${buttonNumber} ${buttonText}`
          };
        });
      
      if (jsonButtons.length > 0) {
        console.log('[ButtonParser] ✅ Converted', jsonButtons.length, 'buttons from JSON');
        return jsonButtons;
      }
    }
  } catch (e) {
    // Not JSON, continue with normal parsing
  }

  const buttons: ButtonOption[] = [];
  console.log('[ButtonParser] 🔍 Parsing message:', messageText.substring(0, 200));
  
  // Pattern to match numbered options:
  // - *1️⃣ Option Text* (bold with emoji)
  // - *1 Option Text* (bold with just number - NEW)
  // - *1. Option Text* (bold with period)
  // - 1️⃣ Option Text (plain with emoji)
  // - 1 Option Text (plain with just number - NEW)
  // - 1. Option Text (plain with period)
  // Supports numbers 1-6
  // ✅ FIX: Also handle corrupted emojis (??) and various emoji formats
  // Order matters: more specific patterns first
  const patterns = [
    // Bold with period: *1. Text* (most specific - has period)
    /\*(\d+)\.\s+([^*]+)\*/g,
    // Bold with emoji: *1️⃣ Text* or *1?? Text* (corrupted emoji)
    /\*(\d[️⃣?])\s+([^*]+)\*/g,
    // ✅ NEW: Bold with just number: *1 Text* (no emoji, no period)
    /\*(\d+)\s+([^*]+)\*/g,
    // Plain with period: 1. Text (most specific - has period)
    /(\d+)\.\s+([^\n*]+)/g,
    // Plain with emoji: 1️⃣ Text or 1?? Text (corrupted emoji)
    /(\d[️⃣?])\s+([^\n*]+)/g,
    // ✅ NEW: Plain with just number: 1 Text (no emoji, no period, not in asterisks, on its own line)
    /(?:^|\n)(\d+)\s+([^\n*]+)(?=\n|$)/g,
  ];

  const foundNumbers = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(messageText)) !== null) {
      const number = match[1];
      const text = match[2].trim();
      
      // Only process numbers 1-6
      // ✅ FIX: Handle corrupted emojis (??) by extracting just the digit
      const cleanNumber = number.replace(/[️⃣?]/g, '');
      const numValue = parseInt(cleanNumber);
      if (numValue >= 1 && numValue <= 6) {
        // Use clean number as key to avoid duplicates
        if (!foundNumbers.has(cleanNumber)) {
          foundNumbers.add(cleanNumber);
          
          // ✅ FIX: Reconstruct display format based on original pattern
          // If original had emoji pattern, try to restore it
          // If original had period, use period format
          // Otherwise, use just the number (for *1 Text* format)
          let displayNumber;
          if (number.includes('?') || number.includes('️⃣')) {
            // Had emoji (corrupted or not)
            displayNumber = `${cleanNumber}️⃣`;
          } else if (number.includes('.')) {
            // Had period
            displayNumber = `${cleanNumber}.`;
          } else {
            // Just number (e.g., *1 Text* format)
            displayNumber = cleanNumber;
          }
          
          // Construct full text (e.g., "1️⃣ Send Message", "1. Send Message", or "1 Send Message")
          const fullText = `${displayNumber} ${text}`;
          
          buttons.push({
            number: displayNumber,
            text,
            fullText,
          });
        }
      }
    }
  }

  // Sort by number (1-6)
  buttons.sort((a, b) => {
    const numA = parseInt(a.number.replace(/[️⃣]/g, ''));
    const numB = parseInt(b.number.replace(/[️⃣]/g, ''));
    return numA - numB;
  });

  console.log('[ButtonParser] ✅ Found', buttons.length, 'buttons:', buttons);
  return buttons;
}

