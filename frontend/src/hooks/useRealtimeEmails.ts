/**
 * Hook for real-time email updates
 */

import { useEffect } from 'react';
import { realtimeService } from '@/services/realtimeService';
import { supabase } from '@/integrations/supabase/client';

export const useRealtimeEmails = (
  accountId: string,
  currentFolder: string,
  onNewEmail: () => void
) => {
  useEffect(() => {
    // Get current user and connect
    const setupRealtime = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          await realtimeService.connect(user.id);
        }
      } catch (error) {
        console.error('Failed to connect to realtime:', error);
      }
    };

    setupRealtime();

    // Listen for new emails
    const handleNewEmail = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      // Only refresh if it's for current folder
      if (detail.accountId === accountId && detail.folder === currentFolder) {
        console.log('[HOOK] New email received, refreshing inbox');
        onNewEmail();
      }
    };

    // Listen for flag updates
    const handleFlagUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      if (detail.accountId === accountId && detail.folder === currentFolder) {
        onNewEmail(); // Refresh to show updated flags
      }
    };

    // Listen for email deletion
    const handleEmailDeleted = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      if (detail.accountId === accountId && detail.folder === currentFolder) {
        onNewEmail(); // Refresh to remove deleted email
      }
    };

    // Listen for email moved
    const handleEmailMoved = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      if (detail.accountId === accountId) {
        onNewEmail(); // Refresh to update folder
      }
    };

    window.addEventListener('newEmail', handleNewEmail);
    window.addEventListener('emailFlagUpdate', handleFlagUpdate);
    window.addEventListener('emailDeleted', handleEmailDeleted);
    window.addEventListener('emailMoved', handleEmailMoved);

    return () => {
      window.removeEventListener('newEmail', handleNewEmail);
      window.removeEventListener('emailFlagUpdate', handleFlagUpdate);
      window.removeEventListener('emailDeleted', handleEmailDeleted);
      window.removeEventListener('emailMoved', handleEmailMoved);
    };
  }, [accountId, currentFolder, onNewEmail]);
};

