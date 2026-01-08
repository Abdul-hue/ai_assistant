/**
 * Central export file for all custom hooks
 * 
 * Import hooks from here for better organization:
 * import { useAgentDetails, useConnectWhatsApp } from '@/hooks';
 */

// Agent hooks
export { useAgentDetails, getWhatsAppStatus, needsWhatsAppSetup } from './useAgentDetails';
export { useAgents, useDeleteAgent } from './useAgents';
export { useConnectWhatsApp, useDisconnectWhatsApp, isWhatsAppConnected, isWaitingForQRScan, getWhatsAppStatusText } from './useWhatsAppConnection';
export {
  useContacts,
  useUploadContacts,
  useDeleteContact,
  useDeleteAllContacts,
  useUpdateContact,
  useContactCount,
  useCreateContact,
} from './useContacts';

// UI hooks (existing)
export { useToast } from './use-toast';
export { useIsMobile } from './use-mobile';

