import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Mail,
  Search,
  RefreshCw,
  Send,
  Plus,
  Loader2,
  Inbox,
  Trash2,
  Reply,
  Forward,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Key,
  Folder,
  Archive,
  Star,
  FileText,
  Mailbox,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  fetchImapSmtpEmails,
  sendImapSmtpEmail,
  deleteImapSmtpEmail,
  moveImapSmtpEmail,
  getImapSmtpFolders,
  getImapSmtpAccounts,
  debugAccountState,
  type ImapSmtpEmail,
  type ImapSmtpFolder,
} from "@/lib/imapSmtpApi";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
// @ts-ignore - config.js doesn't have type definitions
import { API_URL } from "../config";
import { useAuth } from "@/context/AuthContext";
import { io, Socket } from "socket.io-client";

const UnifiedEmailInbox = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [emails, setEmails] = useState<ImapSmtpEmail[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<ImapSmtpEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [folders, setFolders] = useState<ImapSmtpFolder[]>([]);
  const [currentFolder, setCurrentFolder] = useState("INBOX");

  // Compose state
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [showReconnectPrompt, setShowReconnectPrompt] = useState(false);
  const [accountInfo, setAccountInfo] = useState<{ email: string; provider: string } | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [comprehensiveSyncStatus, setComprehensiveSyncStatus] = useState<string>('pending');
  const [comprehensiveSyncProgress, setComprehensiveSyncProgress] = useState<any>({});
  const [socket, setSocket] = useState<Socket | null>(null);
  const { user } = useAuth();

  // Check sync status
  const checkSyncStatus = async () => {
    if (!accountId) return;
    
    try {
      const res = await fetch(
        `${API_URL}/api/imap-smtp/comprehensive-sync-status/${accountId}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      
      if (data.success) {
        setComprehensiveSyncStatus(data.syncStatus);
        setComprehensiveSyncProgress(data.syncProgress);
      }
    } catch (error) {
      console.error('Error checking sync status:', error);
    }
  };

  // Setup WebSocket connection
  useEffect(() => {
    if (!user?.id) return;

    const wsUrl = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');
    const newSocket = io(wsUrl, {
      query: { userId: user.id },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      withCredentials: true
    });

    newSocket.on('connect', () => {
    });
    
    newSocket.on('connected', (data) => {
      console.log('✅ WebSocket authenticated:', data);
      // Also register with WebSocketManager for comprehensive sync events
      newSocket.emit('register', { userId: user.id });
      // Join user room for targeted events
      newSocket.emit('join_user', { userId: user.id });
    });
    
    newSocket.on('disconnect', (reason) => {
      console.log('❌ WebSocket disconnected:', reason);
    });
    
    newSocket.on('connect_error', (error) => {
      console.error('❌ WebSocket connection error:', error.message);
    });

    // Listen for comprehensive sync events
    newSocket.on('comprehensive_sync_started', (data: { accountId: string; email: string }) => {
      console.log(`[WS] Comprehensive sync started for ${data.email}`);
      if (data.accountId === accountId) {
        setComprehensiveSyncStatus('in_progress');
        toast({
          title: "Syncing All Folders",
          description: `Syncing all folders for ${data.email}...`,
          duration: 0, // Don't auto-dismiss
        });
      }
    });

    newSocket.on('comprehensive_sync_progress', (data: { 
      accountId: string; 
      folder: string;
      count: number;
      progress: { current: number; total: number; percentage: number } 
    }) => {
      if (data.accountId === accountId) {
        console.log(`[WS] Sync progress: ${data.folder} (${data.progress.percentage}%)`);
        setComprehensiveSyncProgress((prev: any) => ({
          ...prev,
          [data.folder]: { status: 'completed', count: data.count }
        }));
        toast({
          title: "Sync Progress",
          description: `Syncing folders: ${data.progress.current}/${data.progress.total} (${data.progress.percentage}%) - ${data.folder}: ${data.count} emails`,
          duration: 2000,
        });
      }
    });

    newSocket.on('comprehensive_sync_completed', (data: { 
      accountId: string; 
      email: string; 
      results: any 
    }) => {
      if (data.accountId === accountId) {
        console.log(`[WS] Comprehensive sync completed:`, data.results);
        setComprehensiveSyncStatus('completed');
        toast({
          title: "✅ All Folders Synced!",
          description: `${data.results.totalEmails} emails loaded across ${data.results.completed} folders.`,
          duration: 5000,
        });
        // Refresh current folder
        loadImapEmails();
      }
    });

    // Listen for background sync updates
    newSocket.on('emails_synced', (data: { accountId: string; folder: string; count: number; type: string }) => {
      if (data.accountId === accountId && data.count > 0 && data.folder === currentFolder) {
        console.log(`[WS] ${data.count} new emails in ${data.folder}`);
        loadImapEmails(); // Refresh current folder
        toast({
          title: "New Emails",
          description: `${data.count} new email${data.count > 1 ? 's' : ''} in ${data.folder}`,
          duration: 3000,
        });
      }
    });
    
    // Listen for new emails from IDLE
    newSocket.on('new_emails', (data: { accountId: string; accountEmail: string; count: number; folder: string; timestamp: string }) => {
      if (data.accountId === accountId && data.folder === currentFolder) {
        console.log('📧 New emails received:', data);
        loadImapEmails(); // Refresh current folder
        toast({
          title: "New Email",
          description: `You have ${data.count} new email(s) in ${data.accountEmail}`,
          duration: 3000,
        });
      }
    });
    
    // Listen for sync completion
    newSocket.on('sync_complete', (data: { accountId: string; folder: string; newEmailsCount: number; timestamp: string }) => {
      if (data.accountId === accountId && data.folder === currentFolder) {
        console.log('✅ Sync complete:', data);
        loadImapEmails(); // Refresh current folder
        if (data.newEmailsCount > 0) {
          toast({
            title: "Sync Complete",
            description: `Synced ${data.newEmailsCount} new email(s)`,
            duration: 3000,
          });
        }
      }
    });
    
    // Listen for sync errors
    newSocket.on('sync_error', (data: { accountId: string; folder: string; error: string }) => {
      if (data.accountId === accountId) {
        console.error('❌ Sync error:', data);
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: data.error,
          duration: 5000,
        });
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.off('comprehensive_sync_started');
      newSocket.off('comprehensive_sync_progress');
      newSocket.off('comprehensive_sync_completed');
      newSocket.off('emails_synced');
      newSocket.off('new_emails');
      newSocket.off('sync_complete');
      newSocket.off('sync_error');
      newSocket.disconnect();
    };
  }, [user?.id, accountId, currentFolder]);

  useEffect(() => {
    if (!accountId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No email account specified",
      });
      navigate("/email-integration");
      return;
    }
    
    // Load account info
    const loadAccountInfo = async () => {
      try {
        const accounts = await getImapSmtpAccounts();
        const account = accounts.find(acc => acc.id === accountId);
        if (account) {
          setAccountInfo({ email: account.email, provider: account.provider || 'custom' });
        }
      } catch (error) {
        console.error("Error loading account info:", error);
      }
    };
    
    loadAccountInfo();
    loadImapEmails();
    loadFolders();
    checkSyncStatus();
    
    // Auto-refresh every 15 minutes
    const refreshInterval = setInterval(() => {
      console.log('🔄 Auto-refreshing emails...');
      loadImapEmails();
      setLastRefresh(new Date());
    }, 15 * 60 * 1000); // 15 minutes
    
    return () => clearInterval(refreshInterval);
  }, [accountId, currentFolder]);

  // ✅ FIX: Manual sync - only triggered by user clicking "Sync from IMAP" button
  // This should NOT be called automatically on folder clicks
  // NON-BLOCKING: Returns immediately and syncs in background
  const triggerInitialSync = async () => {
    if (!accountId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No account selected",
      });
      return;
    }
    
    setIsSyncing(true);
    
    try {
      console.log('[UI] 🔄 Manual sync triggered for:', accountId);
      console.log(`[UI] Folder: ${currentFolder || 'INBOX'}`);
      
      // Map folder name
      const actualFolder = folders.length > 0 
        ? mapFolderNameToImap(currentFolder, folders)
        : currentFolder;
      
      // Use new non-blocking sync endpoint
      const response = await fetch(
        `${API_URL}/api/imap-smtp/manual-sync/${accountId}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: actualFolder || 'INBOX' })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        // Show immediate feedback
        toast({
          title: "Sync Started!",
          description: "New emails will appear shortly.",
          duration: 3000,
        });
        
        // The actual refresh will happen via WebSocket when sync completes
        // But also set a fallback refresh after 10 seconds
        setTimeout(() => {
          loadImapEmails();
        }, 10000);
      } else {
        toast({
          variant: "destructive",
          title: "Sync Failed",
          description: data.error || 'Failed to start sync',
          duration: 3000,
        });
      }
    } catch (error: any) {
      console.error('[UI] ❌ Sync error:', error);
      
      toast({
        variant: "destructive",
        title: "Sync Failed",
        description: `Failed to start sync: ${error.message || 'Unknown error'}`,
        duration: 3000,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // ✅ FIX: Load emails from DATABASE only - no aggressive syncing
  const loadImapEmails = async () => {
    if (!accountId) {
      console.warn('⚠️ [INBOX] No accountId provided');
      return;
    }

    try {
      console.log('[UI] 📖 Loading emails from database for:', accountId);
      setLoading(true);
      setAuthError(false);
      
      // Map the current folder name to actual IMAP folder name
      const actualFolder = folders.length > 0 
        ? mapFolderNameToImap(currentFolder, folders)
        : currentFolder;
      
      console.log(`[UI] 📂 Folder: ${actualFolder} (displayed as: ${currentFolder})`);
      
      // ✅ FIX: Only fetch from database - emails-quick handles initial sync automatically
      const response = await fetch(
        `${API_URL}/api/imap-smtp/emails-quick/${accountId}?folder=${actualFolder || 'INBOX'}&limit=50`,
        {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to load emails');
      }

      const data = await response.json();
      
      if (data.success && data.emails) {
        // 🎯 CRITICAL: Sort by date descending (newest first)
        const emailsArray = data.emails as ImapSmtpEmail[];
        const sortedEmails = emailsArray.sort((a, b) => {
          const dateA = new Date(a.date || 0).getTime();
          const dateB = new Date(b.date || 0).getTime();
          return dateB - dateA; // Newest first
        });
        
        console.log(`[UI] ✅ Loaded ${sortedEmails.length} emails from database (${data.loadTime}ms)`);
        if (sortedEmails.length > 0) {
          console.log('[UI] 📅 Newest email:', sortedEmails[0]?.subject, sortedEmails[0]?.date);
        }
        
        setEmails(sortedEmails);
        
        // Auto-select first email if none selected
        if (sortedEmails.length > 0 && !selectedEmail) {
          setSelectedEmail(sortedEmails[0]);
        }
        
        // ✅ FIX: If no emails and needs initial sync, show loading indicator
        // Initial sync will happen automatically in background via emails-quick endpoint
        if (sortedEmails.length === 0 && data.needsInitialSync) {
          console.log('[UI] ⏳ First time accessing this folder - initial sync in progress...');
          setLoadingMessage('Loading emails for the first time...');
        } else {
          setLoadingMessage('');
        }
        
      } else {
        throw new Error('Invalid response from server');
      }
      
    } catch (error: any) {
      console.error('❌ [INBOX] Error loading emails:', error);
      const errorMessage = error.message || "Failed to load emails";
      
      // Check for authentication errors
      const isAuthError = error.isAuthError || 
                         errorMessage.includes("credentials") || 
                         errorMessage.includes("authentication") ||
                         errorMessage.includes("AUTHENTICATIONFAILED") ||
                         errorMessage.includes("Invalid credentials");
      
      if (isAuthError) {
        setAuthError(true);
        setShowReconnectPrompt(true);
      }
      
      toast({
        variant: "destructive",
        title: isAuthError ? "Authentication Failed" : "Error",
        description: isAuthError 
          ? "Invalid credentials. Please reconnect your account."
          : errorMessage,
      });
    } finally {
      setLoading(false);
      setLoadingMessage('');
      console.log('🏁 [INBOX] Email load complete');
    }
  };

  const loadFolders = async () => {
    if (!accountId) return;

    try {
      const folderList = await getImapSmtpFolders(accountId);
      setFolders(folderList);
    } catch (error: any) {
      const errorMessage = error.message || "Failed to load folders";
      
      // Check for authentication errors
      const isAuthError = error.isAuthError || 
                         errorMessage.includes("credentials") || 
                         errorMessage.includes("authentication") ||
                         errorMessage.includes("AUTHENTICATIONFAILED") ||
                         errorMessage.includes("Invalid credentials");
      
      if (isAuthError) {
        setAuthError(true);
      }
      console.error("Error loading folders:", error);
    }
  };

  const handleEmailClick = (email: ImapSmtpEmail) => {
    setSelectedEmail(email);
  };

  const handleSendEmail = async () => {
    if (!composeTo || !composeSubject || !composeBody) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please fill in all fields",
      });
      return;
    }

    if (!accountId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No email account specified",
      });
      return;
    }

    try {
      setSending(true);
      const result = await sendImapSmtpEmail(accountId, {
        to: composeTo,
        subject: composeSubject,
        body: composeBody,
        html: composeBody,
      });

      if (result.success) {
        toast({
          title: "Success",
          description: "Email sent successfully",
        });
        setComposeOpen(false);
        resetCompose();
        loadImapEmails();
      } else {
        throw new Error(result.error || "Failed to send email");
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to send email",
      });
    } finally {
      setSending(false);
    }
  };

  const handleDeleteEmail = async (email: ImapSmtpEmail) => {
    if (!accountId) return;

    // Store original email for potential restoration
    const emailToDelete = email;
    const currentIndex = filteredEmails.findIndex(e => e.id === email.id || e.uid === email.uid);
    const isSelectedEmail = selectedEmail && (selectedEmail.id === email.id || selectedEmail.uid === email.uid);

    try {
      // Optimistic UI update - remove email from list immediately
      setEmails(prev => prev.filter(e => e.id !== email.id && e.uid !== email.uid));
      
      // If this is the selected email, navigate to next/previous or close
      if (isSelectedEmail) {
        // Try to show next email
        if (currentIndex < filteredEmails.length - 1 && filteredEmails[currentIndex + 1]) {
          setSelectedEmail(filteredEmails[currentIndex + 1]);
        } 
        // Try to show previous email
        else if (currentIndex > 0 && filteredEmails[currentIndex - 1]) {
          setSelectedEmail(filteredEmails[currentIndex - 1]);
        } 
        // No more emails, close viewer
        else {
          setSelectedEmail(null);
        }
      }

      // Call delete API
      const result = await deleteImapSmtpEmail(accountId, email.uid, currentFolder);
      
      if (result.success) {
        toast({
          title: "Success",
          description: "Email deleted",
        });
        // Optionally reload emails to sync with backend (but UI is already updated)
        // loadImapEmails();
      } else {
        // If deletion failed, restore the email to the list
        setEmails(prev => {
          const exists = prev.some(e => e.id === email.id || e.uid === email.uid);
          if (!exists) {
            // Re-insert email, maintaining sort order (newest first)
            const restored = [...prev, emailToDelete].sort((a, b) => {
              const dateA = new Date(a.date || 0).getTime();
              const dateB = new Date(b.date || 0).getTime();
              return dateB - dateA;
            });
            return restored;
          }
          return prev;
        });
        
        // Restore selected email if it was the deleted one
        if (isSelectedEmail) {
          setSelectedEmail(emailToDelete);
        }
        
        throw new Error(result.error || "Failed to delete email");
      }
    } catch (error: any) {
      // Restore email on error
      setEmails(prev => {
        const exists = prev.some(e => e.id === email.id || e.uid === email.uid);
        if (!exists) {
          // Re-insert email, maintaining sort order
          const restored = [...prev, emailToDelete].sort((a, b) => {
            const dateA = new Date(a.date || 0).getTime();
            const dateB = new Date(b.date || 0).getTime();
            return dateB - dateA;
          });
          return restored;
        }
        return prev;
      });
      
      // Restore selected email if it was the deleted one
      if (isSelectedEmail) {
        setSelectedEmail(emailToDelete);
      }
      
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete email",
      });
    }
  };

  const resetCompose = () => {
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
  };

  const formatEmailDate = (dateString: string) => {
    try {
      if (!dateString) return "Unknown";
      
      const emailDate = new Date(dateString);
      
      // Validate date
      if (isNaN(emailDate.getTime())) {
        return "Unknown";
      }
      
      const now = new Date();
      const diffMs = now.getTime() - emailDate.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
      
      // Show exact time for today
      if (diffDays === 0) {
        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        // Same day - show time
        return emailDate.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
      }
      
      // Show date for older emails
      if (diffDays < 7) {
        return `${diffDays}d ago`;
      }
      
      // Show full date for older emails
      return emailDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: emailDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    } catch {
      return "Unknown";
    }
  };

  // Filter emails by search query
  const filteredEmails = emails.filter((email) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      email.subject?.toLowerCase().includes(query) ||
      email.from?.toLowerCase().includes(query) ||
      email.fromEmail?.toLowerCase().includes(query) ||
      email.body?.toLowerCase().includes(query)
    );
  });

  // Get current email index for navigation
  const getCurrentEmailIndex = useCallback(() => {
    if (!selectedEmail || filteredEmails.length === 0) return -1;
    return filteredEmails.findIndex(e => e.id === selectedEmail.id || e.uid === selectedEmail.uid);
  }, [selectedEmail, filteredEmails]);

  const currentEmailIndex = getCurrentEmailIndex();
  const canNavigatePrevious = currentEmailIndex > 0;
  const canNavigateNext = currentEmailIndex >= 0 && currentEmailIndex < filteredEmails.length - 1;

  // Navigation functions for email viewer
  const navigateToPreviousEmail = useCallback(() => {
    if (!selectedEmail || filteredEmails.length === 0) return;
    
    const currentIndex = getCurrentEmailIndex();
    if (currentIndex > 0) {
      setSelectedEmail(filteredEmails[currentIndex - 1]);
    }
  }, [selectedEmail, filteredEmails, getCurrentEmailIndex]);

  const navigateToNextEmail = useCallback(() => {
    if (!selectedEmail || filteredEmails.length === 0) return;
    
    const currentIndex = getCurrentEmailIndex();
    if (currentIndex < filteredEmails.length - 1) {
      setSelectedEmail(filteredEmails[currentIndex + 1]);
    }
  }, [selectedEmail, filteredEmails, getCurrentEmailIndex]);

  // Keyboard shortcuts for email navigation
  useEffect(() => {
    if (!selectedEmail) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if dialog is open and not typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'ArrowLeft' && canNavigatePrevious) {
        e.preventDefault();
        navigateToPreviousEmail();
      } else if (e.key === 'ArrowRight' && canNavigateNext) {
        e.preventDefault();
        navigateToNextEmail();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEmail, canNavigatePrevious, canNavigateNext, navigateToPreviousEmail, navigateToNextEmail]);

  // Clean folder name - remove [Gmail] prefix and other prefixes
  const cleanFolderName = (folderName: string) => {
    // Remove [Gmail] prefix
    let cleaned = folderName.replace(/^\[Gmail\]\//g, '').replace(/^\[Gmail\]/g, '');
    // Remove other common prefixes
    cleaned = cleaned.replace(/^INBOX\//g, '').replace(/^INBOX$/g, 'INBOX');
    // Capitalize first letter
    if (cleaned && cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
    }
    return cleaned || folderName;
  };

  // Map clean folder name back to actual IMAP folder name
  const mapFolderNameToImap = (cleanName: string, allFolders: ImapSmtpFolder[]) => {
    // First, try exact match
    const exactMatch = allFolders.find(f => f.name === cleanName);
    if (exactMatch) return exactMatch.name;
    
    // Try case-insensitive match
    const caseMatch = allFolders.find(f => 
      f.name.toLowerCase() === cleanName.toLowerCase() ||
      cleanFolderName(f.name).toLowerCase() === cleanName.toLowerCase()
    );
    if (caseMatch) return caseMatch.name;
    
    // Map common folder names
    const folderMap: { [key: string]: string[] } = {
      'inbox': ['INBOX', 'Inbox'],
      'drafts': ['[Gmail]/Drafts', 'Drafts', 'Draft'],
      'sent': ['[Gmail]/Sent Mail', 'Sent', 'Sent Items', 'Sent Mail'],
      'spam': ['[Gmail]/Spam', 'Spam', 'Junk'],
      'trash': ['[Gmail]/Trash', 'Trash', 'Deleted', 'Deleted Items'],
      'starred': ['[Gmail]/Starred', 'Starred', 'Flagged'],
      'important': ['[Gmail]/Important', 'Important'],
      'all mail': ['[Gmail]/All Mail', 'All Mail', 'All'],
    };
    
    const lowerName = cleanName.toLowerCase();
    for (const [key, variants] of Object.entries(folderMap)) {
      if (lowerName.includes(key)) {
        for (const variant of variants) {
          const found = allFolders.find(f => 
            f.name === variant || 
            f.name.toLowerCase() === variant.toLowerCase() ||
            cleanFolderName(f.name).toLowerCase() === key
          );
          if (found) return found.name;
        }
      }
    }
    
    // Default: return the clean name (might work for some providers)
    return cleanName;
  };

  // Get folder icon based on folder name
  const getFolderIcon = (folderName: string) => {
    const cleaned = cleanFolderName(folderName).toLowerCase();
    if (cleaned.includes('inbox')) return Inbox;
    if (cleaned.includes('sent')) return Send;
    if (cleaned.includes('draft')) return FileText;
    if (cleaned.includes('trash') || cleaned.includes('deleted')) return Trash2;
    if (cleaned.includes('spam') || cleaned.includes('junk')) return AlertCircle;
    if (cleaned.includes('starred') || cleaned.includes('important')) return Star;
    if (cleaned.includes('archive')) return Archive;
    if (cleaned.includes('all mail')) return Mailbox;
    return Folder;
  };

  // Get provider display name
  const getProviderDisplayName = (provider: string) => {
    switch (provider?.toLowerCase()) {
      case 'gmail':
        return 'Gmail';
      case 'outlook':
      case 'office365':
        return 'Outlook';
      case 'yahoo':
        return 'Yahoo';
      case 'custom':
        return 'IMAP/SMTP';
      default:
        return provider || 'Email';
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-hidden">
      {/* Sidebar */}
      <div className="hidden md:flex w-64 lg:w-72 border-r border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl p-4 lg:p-6 space-y-4 lg:space-y-6 flex flex-col">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                <Mail className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-base text-gray-900 dark:text-gray-100">Folders</h2>
                {accountInfo && (
                  <span className="text-xs text-muted-foreground font-medium">
                    {getProviderDisplayName(accountInfo.provider)}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 hover:scale-110"
              onClick={() => navigate("/email-integration")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
          
          {accountInfo && (
            <div className="px-4 py-3 rounded-xl bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                  {accountInfo.email.charAt(0).toUpperCase()}
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
                {accountInfo.email}
              </p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1 flex-1 overflow-y-auto pr-2 -mr-2">
          {folders.length > 0 ? (
            folders.map((folder) => {
              const cleanedName = cleanFolderName(folder.name);
              const FolderIcon = getFolderIcon(folder.name);
              // Compare using actual folder names (both stored and displayed)
              const isActive = currentFolder === folder.name || 
                               cleanFolderName(currentFolder).toLowerCase() === cleanedName.toLowerCase();
              
              return (
                <Button
                  key={folder.name}
                  variant="ghost"
                  className={`w-full justify-start h-11 rounded-xl transition-all duration-200 ${
                    isActive 
                      ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold shadow-lg hover:shadow-xl scale-105" 
                      : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:scale-105"
                  }`}
                  onClick={() => {
                    // Store the actual IMAP folder name for fetching
                    setCurrentFolder(folder.name);
                    // Emails will be reloaded via useEffect when currentFolder changes
                  }}
                >
                  <FolderIcon className={`mr-3 h-5 w-5 ${
                    isActive ? "text-white" : "text-gray-500 dark:text-gray-400"
                  }`} />
                  <span className="flex-1 text-left truncate font-medium">{cleanedName}</span>
                </Button>
              );
            })
          ) : (
            <Button
              variant={currentFolder === "INBOX" ? "default" : "ghost"}
              className={`w-full justify-start h-11 rounded-xl transition-all duration-200 ${
                currentFolder === "INBOX"
                  ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold shadow-lg"
                  : "hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              onClick={() => setCurrentFolder("INBOX")}
            >
              <Inbox className="mr-3 h-5 w-5" />
              INBOX
            </Button>
          )}
        </div>

        <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          <Button
            className="w-full h-12 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 rounded-xl"
            onClick={() => setComposeOpen(true)}
          >
            <Plus className="mr-2 h-5 w-5" />
            Compose
          </Button>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground text-center px-2">
              Last refresh: {lastRefresh.toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
        {/* Sync Status Banner */}
        {comprehensiveSyncStatus === 'in_progress' && (
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-4 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
              <div className="flex-1">
                <p className="font-semibold">Initial Sync in Progress</p>
                <p className="text-sm text-blue-100">
                  Syncing all folders for the first time...
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {accountInfo ? `${getProviderDisplayName(accountInfo.provider)} Inbox` : 'Email Inbox'}
              </h1>
              {accountInfo && (
                <p className="text-sm text-muted-foreground mt-1">
                  {accountInfo.email}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
                className="h-10 w-10 rounded-xl border-2 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 hover:scale-110"
              onClick={() => {
                setLastRefresh(new Date());
                loadImapEmails();
              }}
              disabled={loading}
              title="Refresh emails (auto-refreshes every 15 minutes)"
            >
                <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="outline"
              size="sm"
                className="h-10 px-4 rounded-xl border-2 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 hover:scale-105 font-medium"
              onClick={() => {
                console.log('🔄 Manual sync from IMAP triggered');
                triggerInitialSync();
              }}
              disabled={loading}
              title="Sync emails from IMAP server"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Sync from IMAP
            </Button>
            </div>
          </div>

          {/* Authentication Error Alert */}
          {(authError || showReconnectPrompt) && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Authentication Failed</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  Your email password for <strong>{accountInfo?.email || 'this account'}</strong> is incorrect or has expired.
                  This usually happens when you change your Gmail password or revoke app access.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Navigate to email integration page
                      navigate("/email-integration");
                    }}
                  >
                    <Key className="mr-2 h-4 w-4" />
                    Reconnect Account
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/email-integration")}
                  >
                    Manage Accounts
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-gray-500" />
              <Input
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 rounded-full border-2 border-gray-200 dark:border-gray-700 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:focus:ring-blue-900/20 bg-gray-50 dark:bg-gray-800 text-base transition-all duration-200"
              />
            </div>
          </div>
        </div>

        {/* Email List */}
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900/50">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
                <p className="text-sm text-muted-foreground">Loading emails...</p>
              </div>
            </div>
          ) : filteredEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-2xl animate-pulse"></div>
                <Mail className="h-16 w-16 text-blue-500 dark:text-blue-400 relative z-10" />
              </div>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">No emails found</p>
              {searchQuery && (
                <p className="text-sm">Try a different search term</p>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {filteredEmails.map((email, index) => (
                <div
                  key={email.id}
                  className={`group p-6 rounded-xl cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-1 ${
                    !email.isRead 
                      ? 'bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 border-l-4 border-blue-500 shadow-md' 
                      : 'bg-white dark:bg-gray-800 border-l-4 border-transparent hover:border-gray-300 dark:hover:border-gray-600 shadow-sm'
                  }`}
                  onClick={() => handleEmailClick(email)}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`h-10 w-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-md ${
                          !email.isRead ? 'ring-2 ring-blue-400 ring-offset-2' : ''
                        }`}>
                          {(email.from || email.fromEmail || "U").charAt(0).toUpperCase()}
                        </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                            <p className={`font-semibold truncate ${
                              !email.isRead ? 'text-gray-900 dark:text-gray-100 text-lg' : 'text-gray-700 dark:text-gray-300'
                            }`}>
                          {email.from || email.fromEmail || "Unknown"}
                        </p>
                        {!email.isRead && (
                              <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0"></div>
                        )}
                      </div>
                          <p className={`text-base font-medium truncate mb-2 ${
                            !email.isRead ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'
                          }`}>
                        {email.subject || "(No subject)"}
                      </p>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                            {email.body?.substring(0, 120) || ""}
                      </p>
                    </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">
                        {formatEmailDate(email.date)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-100 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteEmail(email);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Email Detail View */}
      {selectedEmail && (
        <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border-2 shadow-2xl">
            <DialogHeader className="pb-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 -m-6 mb-4 p-6 rounded-t-2xl">
              <div className="flex items-center justify-between gap-4">
                <DialogTitle className="flex-1 text-2xl font-bold text-gray-900 dark:text-gray-100 pr-4">
                  {selectedEmail.subject || "(No subject)"}
                </DialogTitle>
                {/* Navigation Arrows */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={navigateToPreviousEmail}
                    disabled={!canNavigatePrevious}
                    title="Previous email (←)"
                    className="h-10 w-10 rounded-xl border-2 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 hover:scale-110 disabled:opacity-50"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={navigateToNextEmail}
                    disabled={!canNavigateNext}
                    title="Next email (→)"
                    className="h-10 w-10 rounded-xl border-2 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 hover:scale-110 disabled:opacity-50"
                  >
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-6 pt-4">
            <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                        {(selectedEmail.from || selectedEmail.fromEmail || "U").charAt(0).toUpperCase()}
                      </div>
                  <div>
                        <p className="font-semibold text-lg text-gray-900 dark:text-gray-100">
                          {selectedEmail.from || selectedEmail.fromEmail}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatEmailDate(selectedEmail.date)}
                    </p>
                      </div>
                    </div>
                    <div className="pl-[60px] space-y-1">
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium">To:</span> {selectedEmail.to || "Unknown"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="icon"
                      className="h-10 w-10 rounded-xl border-2 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 hover:scale-110"
                    >
                      <Reply className="h-5 w-5" />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="icon"
                      className="h-10 w-10 rounded-xl border-2 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 hover:scale-110"
                    >
                      <Forward className="h-5 w-5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 rounded-xl border-2 hover:border-red-500 dark:hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200 hover:scale-110"
                      onClick={() => {
                        handleDeleteEmail(selectedEmail);
                        setSelectedEmail(null);
                      }}
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                {selectedEmail.bodyHtml ? (
                  <div className="bg-gray-950 dark:bg-gray-950 rounded-lg p-6 -mx-6">
                  <div
                    dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
                      className="email-content prose prose-sm dark:prose-invert max-w-none"
                      style={{
                        color: '#e5e7eb !important',
                        fontSize: '15px',
                        lineHeight: '1.6'
                      }}
                  />
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-gray-200 dark:text-gray-200 text-base leading-relaxed font-sans bg-gray-950 dark:bg-gray-950 rounded-lg p-6 -mx-6">
                    {selectedEmail.body || 'No content available'}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Compose Dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Compose Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                placeholder="recipient@example.com"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                placeholder="Email subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Message</Label>
              <Textarea
                id="body"
                placeholder="Your message..."
                rows={10}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setComposeOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSendEmail} disabled={sending}>
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UnifiedEmailInbox;
