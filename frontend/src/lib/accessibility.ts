/**
 * Accessibility utilities for WCAG 2.1 AA compliance
 */

export const ariaLabels = {
  navigation: {
    mainMenu: 'Main navigation',
    toggleMenu: 'Toggle navigation menu',
    closeMenu: 'Close navigation menu',
    skipToMain: 'Skip to main content',
    home: 'Go to home page',
  },
  actions: {
    delete: (item: string) => `Delete ${item}`,
    edit: (item: string) => `Edit ${item}`,
    view: (item: string) => `View ${item} details`,
    create: (item: string) => `Create new ${item}`,
    search: (item: string) => `Search ${item}`,
    filter: (item: string) => `Filter ${item}`,
    sort: (item: string) => `Sort ${item}`,
    refresh: (item: string) => `Refresh ${item}`,
    upload: (item: string) => `Upload ${item}`,
    download: (item: string) => `Download ${item}`,
    send: 'Send message',
    close: 'Close',
    open: 'Open',
    expand: 'Expand',
    collapse: 'Collapse',
  },
  forms: {
    required: (field: string) => `${field} (required)`,
    optional: (field: string) => `${field} (optional)`,
    error: (field: string, error: string) => `${field} error: ${error}`,
  },
  chat: {
    messageInput: 'Type your message',
    sendButton: 'Send message',
    deleteMessage: (from: string) => `Delete message from ${from}`,
    agentSelector: 'Select agent to chat with',
    messageList: 'Message history',
    typing: 'Agent is typing',
  },
  fileManagement: {
    uploadFiles: 'Upload knowledge base files',
    removeFile: (filename: string) => `Remove ${filename}`,
    downloadFile: (filename: string) => `Download ${filename}`,
  },
  contactManagement: {
    addContact: 'Add new contact',
    removeContact: (name: string) => `Remove ${name} from contacts`,
    importContacts: 'Import contacts from CSV file',
    exportContacts: 'Export contacts to CSV file',
  },
  qrCode: {
    display: (agentName: string) => `QR code for connecting ${agentName} to WhatsApp`,
    download: 'Download QR code as image',
  },
  status: {
    loading: 'Loading content, please wait',
    success: (action: string) => `${action} successful`,
    error: (action: string) => `${action} failed`,
  },
  loading: 'Loading content, please wait',
  processing: 'Processing your request',
} as const;

export const getAriaLabel = (
  category: keyof typeof ariaLabels,
  action: string,
  item?: string
): string => {
  const categoryLabels = ariaLabels[category];
  
  if (categoryLabels && typeof categoryLabels === 'object') {
    const actionFn = (categoryLabels as Record<string, unknown>)[action];
    
    if (typeof actionFn === 'function' && item) {
      return actionFn(item);
    }
    
    if (typeof actionFn === 'string') {
      return actionFn;
    }
  }
  
  return '';
};
