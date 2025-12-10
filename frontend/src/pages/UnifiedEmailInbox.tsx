import { useEffect, useState } from "react";
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

const UnifiedEmailInbox = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [emails, setEmails] = useState<ImapSmtpEmail[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<ImapSmtpEmail | null>(null);
  const [loading, setLoading] = useState(true);
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
    
    // Auto-refresh every 15 minutes
    const refreshInterval = setInterval(() => {
      console.log('🔄 Auto-refreshing emails...');
      loadImapEmails();
      setLastRefresh(new Date());
    }, 15 * 60 * 1000); // 15 minutes
    
    return () => clearInterval(refreshInterval);
  }, [accountId, currentFolder]);

  // Sync from IMAP and refresh UI
  const triggerInitialSync = async () => {
    if (!accountId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No account selected",
      });
      return;
    }
    
    setLoading(true);
    setLoadingMessage('🔄 Syncing emails from IMAP...');
    
    try {
      console.log('[UI] 🔄 Starting IMAP sync for:', accountId);
      console.log(`[UI] Folder: ${currentFolder || 'INBOX'}`);
      
      // Map folder name
      const actualFolder = folders.length > 0 
        ? mapFolderNameToImap(currentFolder, folders)
        : currentFolder;
      
      // Trigger IMAP sync - fetch emails and save to database
      // ✅ Use forceRefresh=true to fetch most recent emails regardless of sync state
      const response = await fetch(
        `${API_URL}/api/imap-smtp/emails/${accountId}?folder=${actualFolder || 'INBOX'}&limit=20&headersOnly=false&forceRefresh=true`,
        {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      console.log(`[UI] ✅ Sync completed: ${data.count || data.savedCount || 0} emails synced`);
      console.log('[UI] Sync mode:', data.mode || 'unknown');
      
      const emailCount = data.savedCount || data.count || data.emails?.length || 0;
      
      // Success toast
      toast({
        title: "Sync Complete!",
        description: `Successfully synced ${emailCount} ${emailCount === 1 ? 'email' : 'emails'}!`,
        duration: 3000,
      });
      
      // 🎯 CRITICAL: Reload emails from database after sync
      await loadImapEmails();
      
    } catch (error: any) {
      console.error('[UI] ❌ Sync error:', error);
      
      toast({
        variant: "destructive",
        title: "Sync Failed",
        description: `Failed to sync emails: ${error.message || 'Unknown error'}`,
      });
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  // Load emails from DATABASE (with proper sorting)
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
      
      // Fetch from database (not IMAP) - this is fast!
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
        
        console.log(`[UI] ✅ Loaded ${sortedEmails.length} emails (sorted by date)`);
        if (sortedEmails.length > 0) {
          console.log('[UI] 📅 Newest email:', sortedEmails[0]?.subject, sortedEmails[0]?.date);
        }
        
        setEmails(sortedEmails);
        
        // Auto-select first email if none selected
        if (sortedEmails.length > 0 && !selectedEmail) {
          setSelectedEmail(sortedEmails[0]);
        }
        
        // ✅ IF NO EMAILS, CHECK IF IT'S AN AUTH ERROR BEFORE TRIGGERING SYNC
        if (sortedEmails.length === 0) {
          console.warn('⚠️ [INBOX] No emails in database, checking account status...');
          
          // Call debug endpoint to check if auth is failing
          try {
            const debugResponse = await fetch(`${API_URL}/api/imap-smtp/debug/${accountId}`, {
              credentials: 'include',
            });
            const debugData = await debugResponse.json();
            
            // Check if account has auth issues
            const account = debugData.account;
            const hasAuthError = account?.last_error?.includes('authentication') ||
                                account?.last_error?.includes('Not authenticated') ||
                                account?.last_error?.includes('credentials') ||
                                account?.last_error?.includes('AUTHENTICATIONFAILED') ||
                                account?.needs_reconnection === true;
            
            if (hasAuthError) {
              console.error('❌ [INBOX] Authentication error detected!');
              setAuthError(true);
              setShowReconnectPrompt(true);
              
              toast({
                variant: "destructive",
                title: "Authentication Failed",
                description: "Your email password is incorrect or expired. Please reconnect your account.",
                duration: 10000,
              });
              
              return; // Don't trigger sync if auth is failing
            }
            
            // Only trigger initial sync if NO auth errors
            console.log('⚠️ [INBOX] No auth errors detected, triggering initial sync...');
            
            toast({
              title: "First Time Setup",
              description: "Syncing your emails for the first time. This may take a moment...",
            });
            
            // Trigger initial sync in background
            setTimeout(() => triggerInitialSync(), 1000);
            
          } catch (debugError) {
            console.error('[INBOX] Error checking account status:', debugError);
            // If debug check fails, still try initial sync
            toast({
              title: "First Time Setup",
              description: "Syncing your emails for the first time. This may take a moment...",
            });
            setTimeout(() => triggerInitialSync(), 1000);
          }
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

    try {
      const result = await deleteImapSmtpEmail(accountId, email.uid, currentFolder);
      if (result.success) {
        toast({
          title: "Success",
          description: "Email deleted",
        });
        loadImapEmails();
        if (selectedEmail?.uid === email.uid) {
          setSelectedEmail(null);
        }
      } else {
        throw new Error(result.error || "Failed to delete email");
      }
    } catch (error: any) {
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
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r bg-gradient-to-b from-background to-muted/20 p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/10">
                <Mail className="h-4 w-4 text-primary" />
              </div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-sm">Folders</h2>
                {accountInfo && (
                  <span className="text-xs text-muted-foreground font-medium">
                    • {getProviderDisplayName(accountInfo.provider)}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => navigate("/email-integration")}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          </div>
          
          {accountInfo && (
            <div className="px-2 py-1.5 rounded-md bg-primary/5 border border-primary/10">
              <p className="text-xs text-muted-foreground truncate">
                {accountInfo.email}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto">
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
                  variant={isActive ? "secondary" : "ghost"}
                  className={`w-full justify-start h-9 ${
                    isActive 
                      ? "bg-primary/10 text-primary font-medium border-l-2 border-primary" 
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => {
                    // Store the actual IMAP folder name for fetching
                    setCurrentFolder(folder.name);
                    // Emails will be reloaded via useEffect when currentFolder changes
                  }}
                >
                  <FolderIcon className={`mr-2 h-4 w-4 ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`} />
                  <span className="flex-1 text-left truncate">{cleanedName}</span>
                </Button>
              );
            })
          ) : (
            <Button
              variant={currentFolder === "INBOX" ? "secondary" : "ghost"}
              className="w-full justify-start h-9"
              onClick={() => setCurrentFolder("INBOX")}
            >
              <Inbox className="mr-2 h-4 w-4" />
              INBOX
            </Button>
          )}
        </div>

        <div className="pt-4 border-t space-y-2">
          <Button
            className="w-full bg-primary hover:bg-primary/90"
            onClick={() => setComposeOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
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
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                {accountInfo ? `${getProviderDisplayName(accountInfo.provider)} Inbox` : 'Email Inbox'}
              </h1>
              {accountInfo && (
                <p className="text-sm text-muted-foreground mt-1">
                  {accountInfo.email}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                setLastRefresh(new Date());
                loadImapEmails();
              }}
              disabled={loading}
              title="Refresh emails (auto-refreshes every 15 minutes)"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="outline"
              size="sm"
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
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </div>

        {/* Email List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : filteredEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Mail className="h-12 w-12 mb-4" />
              <p>No emails found</p>
              {searchQuery && (
                <p className="text-sm mt-2">Try a different search term</p>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {filteredEmails.map((email) => (
                <div
                  key={email.id}
                  className="p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => handleEmailClick(email)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold truncate">
                          {email.from || email.fromEmail || "Unknown"}
                        </p>
                        {!email.isRead && (
                          <Badge variant="default" className="h-2 w-2 p-0 rounded-full" />
                        )}
                      </div>
                      <p className="text-sm font-medium truncate mb-1">
                        {email.subject || "(No subject)"}
                      </p>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {email.body?.substring(0, 100) || ""}
                      </p>
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatEmailDate(email.date)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
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
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedEmail.subject || "(No subject)"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">
                      From: {selectedEmail.from || selectedEmail.fromEmail}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      To: {selectedEmail.to || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatEmailDate(selectedEmail.date)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="icon">
                      <Reply className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon">
                      <Forward className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        handleDeleteEmail(selectedEmail);
                        setSelectedEmail(null);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="border-t pt-4">
                {selectedEmail.bodyHtml ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
                    className="prose max-w-none"
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{selectedEmail.body}</p>
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
