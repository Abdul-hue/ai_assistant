import { useEffect, useState, useRef, useCallback } from "react";
import { formatDistanceToNow, parseISO, isValid } from "date-fns";
import { io, Socket } from "socket.io-client";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Inbox,
  Settings,
  Plus,
  Loader2,
  Send,
  Paperclip,
  FileText,
  X,
  Archive,
  Star,
  Trash2,
  Filter,
  User,
  LayoutDashboard,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Reply,
  Forward,
  MailOpen,
  MailX,
  Edit,
  Clock,
  ShoppingCart,
  ChevronDown,
  MoreVertical,
  Flag,
  Calendar,
  WifiOff,
  Loader,
  Key,
  Info,
  Shield,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  searchGmailMessages,
  getGmailMessage,
  type EmailData,
  type GmailMessage,
} from "@/lib/gmailApi";
import { isGmailConnected, initiateGmailOAuth, disconnectGmail } from "@/lib/gmailAuth";
import { API_URL } from "@/config";

interface GmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GmailModal = ({ open, onOpenChange }: GmailModalProps) => {
  const { toast } = useToast();
  // Use Map for email deduplication
  const [emailsMap, setEmailsMap] = useState<Map<string, EmailData>>(new Map());
  const [selectedEmailIndex, setSelectedEmailIndex] = useState<number>(-1);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<GmailMessage | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [activeFilter, setActiveFilter] = useState<'inbox' | 'starred' | 'spam' | 'archived' | 'all'>('inbox');
  const [isReplying, setIsReplying] = useState(false);
  const [isForwarding, setIsForwarding] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [forwardBody, setForwardBody] = useState("");
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [hoveredSidebar, setHoveredSidebar] = useState(false);
  const [activeTab, setActiveTab] = useState("Primary");
  const [emailStarredStates, setEmailStarredStates] = useState<Record<string, boolean>>({});
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [currentView, setCurrentView] = useState<'inbox' | 'sent' | 'settings'>('inbox');
  const [sentEmails, setSentEmails] = useState<EmailData[]>([]);
  const [loadingSent, setLoadingSent] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  /**
   * Get User ID from Supabase, then localStorage, or generate one
   */
  const getUserId = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        localStorage.setItem("gmail_user_id", user.id);
        return user.id;
      }
    } catch (error) {
      console.warn("Could not get Supabase user:", error);
    }

    let id = localStorage.getItem("gmail_user_id");
    if (!id) {
      id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem("gmail_user_id", id);
    }
    return id;
  }, []);

  // Initialize on mount
  useEffect(() => {
    if (!open) return;
    
    mountedRef.current = true;
    const init = async () => {
      const id = await getUserId();
      if (mountedRef.current) {
        setUserId(id);
        checkConnection();
        connectToBackend(id);
      }
    };
    init();

    return () => {
      mountedRef.current = false;
      if (socketRef.current?.disconnect) {
        socketRef.current.disconnect();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [open, getUserId]);

  // Auto-refresh ONLY as fallback when WebSocket is disconnected
  // Remove aggressive polling when WebSocket is connected
  useEffect(() => {
    if (!open || !connected || !userId) return;
    
    // Only poll if WebSocket is NOT connected (fallback mode)
    if (socketConnected) {
      // WebSocket is connected - no polling needed
      return;
    }

    // Fallback polling when WebSocket is down (every 30 seconds)
    const refreshInterval = setInterval(() => {
      if (mountedRef.current && connected) {
        fetchEmails(undefined, undefined, true); // Silent refresh
      }
    }, 30000); // 30 seconds fallback polling

    return () => clearInterval(refreshInterval);
  }, [open, connected, socketConnected, userId]);

  /**
   * Connect to backend WebSocket
   */
  const connectToBackend = useCallback((id: string) => {
    if (!id) {
      console.error("❌ No User ID provided");
      setConnectionError("No user ID available");
      setLoading(false);
      return;
    }

    try {
      connectWithSocketIO(id);
    } catch (err) {
      console.warn("Socket.IO not available, trying native WebSocket:", err);
      connectWithNativeWebSocket(id);
    }
  }, []);

  /**
   * Connect using Socket.IO with improved reconnection strategy
   */
  const connectWithSocketIO = useCallback((currentUserId: string) => {
    // Prevent duplicate connections
    if (socketRef.current?.connected) {
      console.log("⚠️ Socket already connected, skipping...");
      return;
    }

    try {
      const socket = io(API_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000, // Exponential backoff up to 10s
        reconnectionAttempts: 5,
        timeout: 10000, // 10 second connection timeout
        transports: ["websocket", "polling"],
        query: {
          userId: currentUserId,
        },
      });

      socketRef.current = socket;
      
      // Heartbeat ping/pong every 30 seconds
      const heartbeatInterval = setInterval(() => {
        if (socket.connected) {
          socket.emit('ping');
        }
      }, 30000);

      socket.on("connect", () => {
        console.log("✅ Connected to backend via Socket.IO");
        if (mountedRef.current) {
          setSocketConnected(true);
          setConnectionError("");
          setLoading(false);
        }
        socket.emit("join_user", currentUserId);
        socket.emit("get_initial_emails", { userId: currentUserId });
      });

      socket.on("initial_emails", (data: { emails: any[] }) => {
        console.log("📧 Received initial emails:", data.emails?.length || 0);
        if (mountedRef.current && data.emails && data.emails.length > 0) {
          // Use Map for deduplication
          const newMap = new Map<string, EmailData>();
          
          data.emails.forEach(email => {
            const emailId = email.id || email.messageId;
            if (emailId) {
              newMap.set(emailId, {
                id: emailId,
                from: email.from,
                fromEmail: email.fromEmail || email.from,
                subject: email.subject || '(No subject)',
                date: email.date,
                snippet: email.snippet || email.preview || '',
                attachments: (email.attachments || []).map((att: any) => ({
                  filename: att.filename,
                  mimeType: att.mimeType,
                  attachmentId: att.attachmentId || '',
                  size: att.size || 0,
                })),
                hasResume: email.hasResume || false,
              });
            }
          });
          
          setEmailsMap(newMap);
          setLoading(false);
          setLastRefresh(new Date());
        } else if (mountedRef.current) {
          setLoading(false);
        }
      });

      socket.on("refresh_complete", (data: { newEmailsCount: number; emails?: any[] }) => {
        if (mountedRef.current) {
          setRefreshing(false);
          setLastRefresh(new Date());
          
          // If emails are provided, update the email list
          if (data.emails && data.emails.length > 0) {
            const newMap = new Map<string, EmailData>();
            data.emails.forEach((email: any) => {
              const emailId = email.id || email.messageId;
              if (emailId) {
                newMap.set(emailId, {
                  id: emailId,
                  from: email.from,
                  fromEmail: email.fromEmail || email.from,
                  subject: email.subject || '(No subject)',
                  date: email.date,
                  snippet: email.snippet || email.preview || '',
                  attachments: (email.attachments || []).map((att: any) => ({
                    filename: att.filename,
                    mimeType: att.mimeType,
                    attachmentId: att.attachmentId || '',
                    size: att.size || 0,
                  })),
                  hasResume: email.hasResume || false,
                });
              }
            });
            setEmailsMap(newMap);
          }
          
          if (data.newEmailsCount === 0) {
            toast({
              title: "Refreshed",
              description: "You're up to date!",
            });
          } else {
            toast({
              title: "Refreshed",
              description: `Loaded ${data.newEmailsCount} email${data.newEmailsCount > 1 ? 's' : ''}`,
            });
          }
        }
      });

      socket.on("new_email", (email: any) => {
        console.log("🔔 New email received:", email.subject);
        if (mountedRef.current) {
          const emailId = email.id || email.messageId;
          if (!emailId) return;
          
          // Check if email already exists (deduplication)
          setEmailsMap(prev => {
            if (prev.has(emailId)) {
              console.log("⏭️ Email already exists, skipping:", emailId);
              return prev; // Don't add duplicates
            }
            
            const formattedEmail: EmailData = {
              id: emailId,
              from: email.from,
              fromEmail: email.fromEmail || email.from,
              subject: email.subject || '(No subject)',
              date: email.date,
              snippet: email.snippet || email.preview || '',
              attachments: (email.attachments || []).map((att: any) => ({
                filename: att.filename,
                mimeType: att.mimeType,
                attachmentId: att.attachmentId || '',
                size: att.size || 0,
              })),
              hasResume: email.hasResume || false,
            };
            
            // Add to Map (new emails go to the top)
            const newMap = new Map(prev);
            newMap.set(emailId, formattedEmail);
            
            // Show notification only for truly new emails
            toast({ 
              title: "New Email", 
              description: `New email from ${email.from || email.fromEmail}` 
            });
            showNotification(`New email from ${email.from || email.fromEmail}`);
            
            return newMap;
          });
        }
      });

      socket.on("email_update", (data: any) => {
        if (mountedRef.current) {
          setEmailsMap((prev) => {
            const newMap = new Map(prev);
            const email = newMap.get(data.messageId);
            if (email) {
              newMap.set(data.messageId, { ...email, ...data.updates });
            }
            return newMap;
          });
        }
      });

      socket.on("email_deleted", (data: any) => {
        if (mountedRef.current) {
          setEmailsMap((prev) => {
            const newMap = new Map(prev);
            newMap.delete(data.messageId);
            return newMap;
          });
          toast({ title: "Email Deleted", description: "Email has been deleted" });
        }
      });

      socket.on("email_archived", (data: any) => {
        if (mountedRef.current) {
          setEmailsMap((prev) => {
            const newMap = new Map(prev);
            newMap.delete(data.messageId);
            return newMap;
          });
          toast({ title: "Email Archived", description: "Email has been archived" });
        }
      });

      socket.on("error", (error: any) => {
        console.error("Socket error:", error);
        if (mountedRef.current) {
          setConnectionError(error.message || "Connection error");
        }
      });

      socket.on("connect_error", (error: any) => {
        console.error("Connection error:", error);
        if (mountedRef.current) {
          setConnectionError("Failed to connect to server");
          setSocketConnected(false);
        }
      });

      socket.on("disconnect", () => {
        console.warn("⚠️ Disconnected from backend");
        clearInterval(heartbeatInterval);
        if (mountedRef.current) {
          setSocketConnected(false);
          setConnectionError("Connection lost. Reconnecting...");
          // Exponential backoff reconnection
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connectToBackend(currentUserId);
            }
          }, 3000);
        }
      });
    } catch (error) {
      console.error("Socket.IO connection failed:", error);
      if (mountedRef.current) {
        setConnectionError("Socket.IO not available");
        connectWithNativeWebSocket(currentUserId);
      }
    }
  }, []);

  const connectWithNativeWebSocket = useCallback((currentUserId: string) => {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.hostname}:${API_URL.split(':')[2] || '3001'}/ws`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("✅ Connected via native WebSocket");
        if (mountedRef.current) {
          setSocketConnected(true);
          setConnectionError("");
          setLoading(false);
        }
        ws.send(JSON.stringify({ type: "join_user", userId: currentUserId }));
        ws.send(JSON.stringify({ type: "get_initial_emails", userId: currentUserId }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "initial_emails" && mountedRef.current) {
            const formattedEmails: EmailData[] = (data.emails || []).map((email: any) => ({
              id: email.id || email.messageId,
              from: email.from,
              fromEmail: email.fromEmail || email.from,
              subject: email.subject || '(No subject)',
              date: email.date,
              snippet: email.snippet || email.preview || '',
              attachments: (email.attachments || []).map((att: any) => ({
                filename: att.filename,
                mimeType: att.mimeType,
                attachmentId: att.attachmentId || '',
                size: att.size || 0,
              })),
              hasResume: email.hasResume || false,
            }));
            // Use Map for deduplication
            const newMap = new Map<string, EmailData>();
            formattedEmails.forEach(email => {
              if (email.id) {
                newMap.set(email.id, email);
              }
            });
            setEmailsMap(newMap);
            setLoading(false);
          } else if (data.type === "new_email" && mountedRef.current) {
            const emailId = data.email.id || data.email.messageId;
            if (!emailId) return;
            
            setEmailsMap((prev) => {
              if (prev.has(emailId)) {
                return prev; // Don't add duplicates
              }
              
              const formattedEmail: EmailData = {
                id: emailId,
                from: data.email.from,
                fromEmail: data.email.fromEmail || data.email.from,
                subject: data.email.subject || '(No subject)',
                date: data.email.date,
                snippet: data.email.snippet || data.email.preview || '',
                attachments: (data.email.attachments || []).map((att: any) => ({
                  filename: att.filename,
                  mimeType: att.mimeType,
                  attachmentId: att.attachmentId || '',
                  size: att.size || 0,
                })),
                hasResume: data.email.hasResume || false,
              };
              
              const newMap = new Map(prev);
              newMap.set(emailId, formattedEmail);
              showNotification(`New email from ${data.email.from || data.email.fromEmail}`);
              return newMap;
            });
          }
        } catch (err) {
          console.error("Error parsing message:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
        if (mountedRef.current) {
          setConnectionError("WebSocket connection error");
        }
      };

      ws.onclose = () => {
        console.warn("⚠️ WebSocket closed");
        if (mountedRef.current) {
          setSocketConnected(false);
          setConnectionError("Connection lost. Reconnecting...");
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connectToBackend(currentUserId);
          }
        }, 3000);
      };

      socketRef.current = ws as any;
    } catch (error) {
      console.error("Native WebSocket failed:", error);
      if (mountedRef.current) {
        setConnectionError("Failed to establish WebSocket connection");
        setLoading(false);
      }
    }
  }, []);

  /**
   * Show browser notification
   */
  const showNotification = useCallback((message: string) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Gmail", {
        body: message,
        icon: "/favicon.ico",
      });
    }
  }, []);

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const checkConnection = async () => {
    try {
      const isConnected = await isGmailConnected();
      setConnected(isConnected);
      if (!isConnected) {
        setLoading(false);
      }
    } catch (error) {
      console.error("Connection check error:", error);
      setLoading(false);
    }
  };

  // Get Gmail query based on active filter
  const getFilterQuery = (filter: typeof activeFilter): string => {
    const baseQuery = searchQuery ? searchQuery : "";
    
    switch (filter) {
      case 'inbox':
        return baseQuery ? `${baseQuery} in:inbox` : 'in:inbox';
      case 'starred':
        return baseQuery ? `${baseQuery} is:starred` : 'is:starred';
      case 'spam':
        return baseQuery ? `${baseQuery} in:spam` : 'in:spam';
      case 'archived':
        return baseQuery ? `${baseQuery} -in:inbox` : '-in:inbox';
      case 'all':
        return baseQuery ? baseQuery : 'in:all';
      default:
        return baseQuery ? `${baseQuery} in:inbox` : 'in:inbox';
    }
  };

  const fetchEmails = async (query?: string, pageToken?: string, silent: boolean = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      const filterQuery = query || getFilterQuery(activeFilter);
      const response = await searchGmailMessages(filterQuery, 20, pageToken);
      
      // Use Map for deduplication
      setEmailsMap(prev => {
        const newMap = new Map(prev);
        let newCount = 0;
        
        response.messages.forEach((email: EmailData) => {
          if (!newMap.has(email.id)) {
            newMap.set(email.id, email);
            newCount++;
          }
        });
        
        if (newCount > 0 && !silent && !pageToken) {
          toast({
            title: "New Emails",
            description: `${newCount} new email${newCount > 1 ? 's' : ''} received`,
          });
        }
        
        return newMap;
      });
      setNextPageToken(response.nextPageToken);
    } catch (error: any) {
      console.error("Fetch emails error:", error);
      
      // Check for metadata scope error
      if (error.message?.includes("Metadata scope") || error.message?.includes("does not support 'q' parameter")) {
        if (!silent) {
          toast({
            variant: "destructive",
            title: "Gmail Scope Error",
            description: "Your Gmail connection needs to be updated. Please disconnect and reconnect your Gmail account in Settings.",
            duration: 10000,
          });
        }
        setConnectionError("Gmail scope error: Please reconnect your Gmail account in Settings to fix this issue.");
        setConnected(false);
        return;
      }
      
      if (!silent) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message || "Failed to fetch emails",
        });
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleSearch = () => {
    fetchEmails(searchQuery);
  };

  const handleEmailClick = async (emailId: string) => {
    try {
      setLoadingEmail(true);
      const message = await getGmailMessage(emailId);
      setSelectedEmail(message);
      
      // Fetch attachments
      if (userId) {
        try {
          setLoadingAttachments(true);
          const response = await fetch(
            `${API_URL}/api/emails/${emailId}/attachments`,
            {
              credentials: 'include',
            }
          );
          if (response.ok) {
            const data = await response.json();
            setAttachments(data.attachments || []);
          }
        } catch (error) {
          console.error("Error fetching attachments:", error);
        } finally {
          setLoadingAttachments(false);
        }
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to load email",
      });
    } finally {
      setLoadingEmail(false);
    }
  };

  const handleArchive = async (messageId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/emails/${messageId}/archive`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
      });
      
      if (response.ok) {
        // Optimistic update
        setEmailsMap(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageId);
          return newMap;
        });
        if (selectedEmail?.id === messageId) {
          setSelectedEmail(null);
        }
        toast({ title: "Email Archived", description: "Email has been archived" });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to archive email",
      });
    }
  };

  const handleDelete = async (messageId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/emails/${messageId}/delete`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
      });
      
      if (response.ok) {
        // Optimistic update
        setEmailsMap(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageId);
          return newMap;
        });
        if (selectedEmail?.id === messageId) {
          setSelectedEmail(null);
        }
        toast({ title: "Email Deleted", description: "Email has been deleted" });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete email",
      });
    }
  };

  const handleStar = async (messageId: string, currentlyStarred: boolean) => {
    try {
      const response = await fetch(`${API_URL}/api/emails/${messageId}/star`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ star: !currentlyStarred }),
      });
      
      if (response.ok) {
        // Optimistic update
        setEmailStarredStates((prev) => ({
          ...prev,
          [messageId]: !currentlyStarred,
        }));
        setEmailsMap(prev => {
          const newMap = new Map(prev);
          const email = newMap.get(messageId);
          if (email) {
            newMap.set(messageId, email); // Update state for starred
          }
          return newMap;
        });
        if (selectedEmail?.id === messageId) {
          setSelectedEmail(selectedEmail); // Update selected email state
        }
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to star email",
      });
    }
  };

  const handleReply = async () => {
    if (!replyBody.trim() || !selectedEmail) return;
    
    setIsReplying(true);
    try {
      const response = await fetch(`${API_URL}/api/emails/${selectedEmail.id}/reply`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyBody }),
      });
      
      if (response.ok) {
        setReplyBody("");
        setIsReplying(false);
        toast({ title: "Reply Sent", description: "Your reply has been sent" });
      } else {
        throw new Error("Failed to send reply");
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send reply",
      });
    } finally {
      setIsReplying(false);
    }
  };

  const handleSendEmail = async () => {
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please fill in all fields",
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(composeTo)) {
      toast({
        variant: "destructive",
        title: "Invalid Email",
        description: "Please enter a valid email address",
      });
      return;
    }

    setSendingEmail(true);
    try {
      const response = await fetch(`${API_URL}/api/emails/send`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: composeTo,
          subject: composeSubject,
          body: composeBody,
        }),
      });
      
      if (response.ok) {
        setComposeTo("");
        setComposeSubject("");
        setComposeBody("");
        setComposeOpen(false);
        toast({ title: "Email Sent", description: "Your email has been sent successfully" });
      } else {
        throw new Error("Failed to send email");
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send email",
      });
    } finally {
      setSendingEmail(false);
    }
  };

  const handleFilterChange = (filter: typeof activeFilter) => {
    setActiveFilter(filter);
    fetchEmails();
  };

  const formatEmailDate = (dateString: string | undefined | null) => {
    if (!dateString) return "Unknown date";
    
    try {
      let parsedDate: Date;
      
      // First try parsing as ISO string
      const isoDate = parseISO(dateString);
      if (isValid(isoDate)) {
        parsedDate = isoDate;
      } else {
        // Try parsing as regular Date (handles RFC 2822, ISO, and other formats)
        parsedDate = new Date(dateString);
      }
      
      // Validate the parsed date
      if (!isValid(parsedDate) || isNaN(parsedDate.getTime())) {
        return "Unknown date";
      }
      
      const now = new Date();
      
      // If date is in the future (more than 1 hour ahead), it's likely a timezone issue
      // Cap it to current time to prevent "in X hours" display
      if (parsedDate.getTime() > now.getTime() + 3600000) {
        console.warn("Date is in the future, capping to now:", dateString, parsedDate);
        parsedDate = now;
      }
      
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const emailDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
      
      // Calculate time differences
      const diffMs = now.getTime() - parsedDate.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
      
      // Format: "Today 2:30 PM" or "Yesterday" or "2 hours ago" or "Mar 15"
      if (emailDate.getTime() === today.getTime()) {
        // Today - show time if more than 1 minute ago, otherwise "Just now"
        if (diffMins < 1) {
          return "Just now";
        } else if (diffMins < 60) {
          return `${diffMins}m ago`;
        } else {
          return parsedDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
          });
        }
      } else if (emailDate.getTime() === yesterday.getTime()) {
        // Yesterday
        return "Yesterday";
      } else if (diffDays < 7) {
        // Within a week - show relative time (always in past)
        if (diffMins < 60) {
          return `${diffMins}m ago`;
        } else if (diffHours < 24) {
          return `${diffHours}h ago`;
        } else {
          return `${diffDays}d ago`;
        }
      } else {
        // Older - show date
        return parsedDate.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: diffDays > 365 ? 'numeric' : undefined
        });
      }
    } catch (error) {
      console.warn("Error parsing date:", dateString, error);
      return "Unknown date";
    }
  };

  // Generate gradient avatar color based on hash of name
  const getAvatarColor = (name: string) => {
    // Hash function for consistent color generation
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const colors = [
      'bg-gradient-to-br from-red-400 to-red-600',
      'bg-gradient-to-br from-blue-400 to-blue-600',
      'bg-gradient-to-br from-green-400 to-green-600',
      'bg-gradient-to-br from-yellow-400 to-yellow-600',
      'bg-gradient-to-br from-purple-400 to-purple-600',
      'bg-gradient-to-br from-pink-400 to-pink-600',
      'bg-gradient-to-br from-indigo-400 to-indigo-600',
      'bg-gradient-to-br from-orange-400 to-orange-600',
      'bg-gradient-to-br from-teal-400 to-teal-600',
      'bg-gradient-to-br from-cyan-400 to-cyan-600',
    ];
    
    return colors[Math.abs(hash) % colors.length];
  };
  
  // Convert emails Map to sorted array for rendering
  const emails = Array.from(emailsMap.values()).sort((a, b) => {
    const dateA = a.date ? new Date(a.date).getTime() : 0;
    const dateB = b.date ? new Date(b.date).getTime() : 0;
    return dateB - dateA; // Newest first
  });
  
  // Handle refresh - fetch from Gmail API directly
  const handleRefresh = useCallback(() => {
    if (!socketRef.current?.connected || refreshing) return;
    
    setRefreshing(true);
    if (socketRef.current && socketRef.current.connected) {
      // Refresh fetches all emails from Gmail API (no cache)
      socketRef.current.emit('refresh_emails', { 
        userId
      });
    } else if (connected) {
      // Fallback: use REST API if WebSocket not connected
      fetchEmails(undefined, undefined, true);
    }
  }, [userId, refreshing, connected]);

  const tabs = ["Primary", "Promotions", "Social", "Updates"];

  // Fetch sent emails
  const fetchSentEmails = async () => {
    if (!connected) return;
    try {
      setLoadingSent(true);
      const response = await searchGmailMessages('in:sent', 20);
      setSentEmails(response.messages || []);
    } catch (error: any) {
      console.error("Error fetching sent emails:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to fetch sent emails",
      });
    } finally {
      setLoadingSent(false);
    }
  };

  // Handle disconnect
  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect your Gmail account? You'll need to reconnect to access your emails.")) {
      return;
    }

    try {
      setDisconnecting(true);
      await disconnectGmail();
      setConnected(false);
      setUserEmail(null);
      toast({
        title: "Gmail Disconnected",
        description: "Your Gmail account has been disconnected successfully.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to disconnect Gmail",
      });
    } finally {
      setDisconnecting(false);
    }
  };

  // Fetch user email on connection
  useEffect(() => {
    if (connected && !userEmail) {
      const fetchUserEmail = async () => {
        try {
          const response = await fetch(`${API_URL}/api/gmail/status`, {
            credentials: "include",
          });
          if (response.ok) {
            const data = await response.json();
            if (data.email) {
              setUserEmail(data.email);
            }
          }
        } catch (error) {
          console.error("Error fetching user email:", error);
        }
      };
      fetchUserEmail();
    }
  }, [connected, userEmail]);

  // Fetch sent emails when switching to sent view
  useEffect(() => {
    if (currentView === 'sent' && connected) {
      fetchSentEmails();
    }
  }, [currentView, connected]);

  const sidebarItems = [
    { icon: Edit, label: "Compose", action: () => setComposeOpen(true) },
    { icon: Inbox, label: "Inbox", count: emailsMap.size, action: () => { setCurrentView('inbox'); handleFilterChange('inbox'); }, active: currentView === 'inbox' && activeFilter === 'inbox' },
    { icon: Star, label: "Starred", action: () => { setCurrentView('inbox'); handleFilterChange('starred'); }, active: currentView === 'inbox' && activeFilter === 'starred' },
    { icon: Clock, label: "Snoozed" },
    { icon: Send, label: "Sent", action: () => setCurrentView('sent'), active: currentView === 'sent' },
    { icon: FileText, label: "Drafts" },
    { icon: ShoppingCart, label: "Purchases" },
    { icon: ChevronDown, label: "More" },
  ];

  const labels = [
    { icon: AlertCircle, label: "Important" },
    { icon: Calendar, label: "Scheduled" },
    { icon: Mail, label: "All Mail", action: () => handleFilterChange('all'), active: activeFilter === 'all' },
    { icon: AlertCircle, label: "Spam", action: () => handleFilterChange('spam'), active: activeFilter === 'spam' },
    { icon: Trash2, label: "Trash" },
  ];

  const handleConnect = async () => {
    try {
      await initiateGmailOAuth();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to initiate Gmail connection",
      });
    }
  };

  if (!connected) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-black border-gray-800">
          <DialogHeader>
            <DialogTitle className="text-white">Connect Gmail</DialogTitle>
          </DialogHeader>
          <div className="text-center space-y-6 py-8">
            <div className="mx-auto w-16 h-16 bg-gradient-to-br from-red-500 to-blue-500 rounded-full flex items-center justify-center">
              <Mail className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white mb-2">Connect Your Gmail Account</h2>
              <p className="text-gray-400">
                Connect your Gmail account to manage emails in real-time
              </p>
            </div>
            <Button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-700 text-white">
              Connect Gmail
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] p-0 bg-gradient-to-br from-gray-50 to-gray-100 overflow-hidden">
        <div className="flex h-[90vh]">
          {/* Sidebar */}
          <div 
            className={`${hoveredSidebar ? "w-64" : "w-16"} bg-white/95 backdrop-blur-lg border-r border-gray-200/60 flex flex-col transition-all duration-300 relative shadow-sm`}
            onMouseEnter={() => setHoveredSidebar(true)}
            onMouseLeave={() => setHoveredSidebar(false)}
          >
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Mail className="w-8 h-8 text-red-500" />
                  {socketConnected && (
                    <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                  )}
                </div>
                {hoveredSidebar && <span className="font-bold text-xl text-gray-900">Gmail</span>}
              </div>
            </div>

            {hoveredSidebar && (
              <div className="px-4 py-2 text-xs font-medium">
                <div className={`flex items-center gap-2 ${socketConnected ? "text-green-600" : "text-red-600"}`}>
                  <div className={`w-2 h-2 rounded-full ${socketConnected ? "bg-green-500" : "bg-red-500"}`}></div>
                  {socketConnected ? "Real-time Connected" : "Disconnected"}
                </div>
              </div>
            )}

            <div className="p-4">
              <button 
                onClick={() => setComposeOpen(true)}
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-2xl py-3 px-4 flex items-center justify-center gap-2 font-medium transition-all duration-300 hover:scale-[1.02] shadow-lg hover:shadow-xl"
              >
                <Edit className="w-5 h-5" />
                {hoveredSidebar && "Compose"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2">
              <nav className="space-y-1">
                {sidebarItems.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={item.action}
                    className={`w-full flex items-center gap-4 px-4 py-3 rounded-r-2xl text-gray-700 hover:bg-gray-100 transition-colors ${
                      item.active ? "bg-blue-50 text-blue-700 font-medium" : ""
                    }`}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    {hoveredSidebar && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.count !== undefined && (
                          <span className="text-sm text-gray-500">{item.count}</span>
                        )}
                      </>
                    )}
                  </button>
                ))}
              </nav>

              {hoveredSidebar && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <div className="flex items-center justify-between px-4 mb-2">
                    <span className="text-xs font-semibold text-gray-600 uppercase">Labels</span>
                    <button className="hover:bg-gray-100 rounded p-1">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <nav className="space-y-1">
                    {labels.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={item.action}
                        className={`w-full flex items-center gap-4 px-4 py-2 rounded-r-2xl text-gray-700 hover:bg-gray-100 transition-colors text-sm ${
                          item.active ? "bg-blue-50 text-blue-700 font-medium" : ""
                        }`}
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0" />
                        <span className="flex-1 text-left">{item.label}</span>
                      </button>
                    ))}
                  </nav>
                </div>
              )}
            </div>

            {hoveredSidebar && (
              <div className="p-4 border-t border-gray-200 space-y-2">
                <button 
                  onClick={() => setCurrentView('settings')}
                  className={`flex items-center gap-4 px-4 py-2 rounded-r-2xl text-gray-700 hover:bg-gray-100 transition-colors w-full text-sm ${currentView === 'settings' ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}
                >
                  <Settings className="w-4 h-4" />
                  <span>Settings</span>
                </button>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col bg-white">
            {/* Settings View */}
            {currentView === 'settings' && (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-4xl mx-auto space-y-6">
                  <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                    <div className="p-6 border-b border-gray-200">
                      <h2 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
                        <Settings className="h-6 w-6" />
                        Gmail Settings
                      </h2>
                    </div>
                    <div className="p-6 space-y-6">
                      {/* Connection Status */}
                      <div className="flex items-center justify-between p-6 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-blue-500 rounded-full flex items-center justify-center">
                            <Mail className="h-6 w-6 text-white" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">
                              {connected ? (userEmail || "Gmail Account") : "No Account Connected"}
                            </p>
                            <p className="text-sm text-gray-600 mt-1">
                              {connected
                                ? "Your Gmail account is connected and ready to use"
                                : "Connect your Gmail account to start managing emails"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {connected ? (
                            <>
                              <CheckCircle2 className="h-6 w-6 text-green-500" />
                              <Button
                                onClick={handleDisconnect}
                                variant="destructive"
                                disabled={disconnecting}
                                className="rounded-full"
                              >
                                {disconnecting ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Disconnecting...
                                  </>
                                ) : (
                                  "Disconnect"
                                )}
                              </Button>
                            </>
                          ) : (
                            <>
                              <XCircle className="h-6 w-6 text-red-500" />
                              <Button onClick={handleConnect} className="rounded-full bg-blue-600 hover:bg-blue-700 text-white">
                                <Mail className="h-4 w-4 mr-2" />
                                Connect Gmail
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {connected && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle2 className="h-5 w-5 text-green-500" />
                              <h3 className="font-semibold text-gray-900">Connection Active</h3>
                            </div>
                            <p className="text-sm text-gray-600">
                              Your Gmail account is connected and synchronized. All features are available.
                            </p>
                          </div>
                          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                            <div className="flex items-center gap-2 mb-2">
                              <Key className="h-5 w-5 text-blue-500" />
                              <h3 className="font-semibold text-gray-900">Secure Authentication</h3>
                            </div>
                            <p className="text-sm text-gray-600">
                              Your credentials are securely stored and encrypted. Tokens are automatically refreshed.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Sent Emails View */}
            {currentView === 'sent' && (
              <>
                <div className="bg-gradient-to-r from-gray-50 to-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search sent emails"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && fetchSentEmails()}
                      className="w-full pl-12 pr-4 py-2.5 bg-white rounded-full border border-gray-200 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 shadow-sm focus:shadow-md"
                    />
                  </div>
                  <button 
                    onClick={fetchSentEmails}
                    disabled={loadingSent}
                    className={`p-2 hover:bg-gray-100 rounded text-gray-700 transition-colors ${loadingSent ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <RefreshCw className={`w-5 h-5 ${loadingSent ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {loadingSent ? (
                    <div className="p-8 text-center text-gray-400">
                      <Loader className="w-12 h-12 mx-auto mb-4 animate-spin" />
                      <p>Loading sent emails...</p>
                    </div>
                  ) : sentEmails.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      <Send className="w-12 h-12 mx-auto mb-4 opacity-25" />
                      <p>No sent emails found</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {sentEmails.map((email) => {
                        const avatarInitial = email.fromEmail?.charAt(0).toUpperCase() || email.from.charAt(0).toUpperCase();
                        return (
                          <div
                            key={email.id}
                            onClick={() => handleEmailClick(email.id)}
                            className="group p-4 cursor-pointer transition-all duration-200 hover:bg-gray-50 hover:shadow-md hover:scale-[1.01] border-l-4 border-transparent hover:border-blue-200"
                          >
                            <div className="flex gap-3">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold flex-shrink-0 shadow-md ${getAvatarColor(avatarInitial)}`}>
                                {avatarInitial}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-semibold text-[15px] text-gray-700">To: {(email as any).to || email.fromEmail}</span>
                                  <span className="text-xs text-gray-500">{formatEmailDate(email.date)}</span>
                                </div>
                                <p className="text-[15px] truncate font-medium text-gray-800">
                                  {email.subject || "(No subject)"}
                                </p>
                                <p className="text-sm text-gray-500 truncate mt-1 line-clamp-1">
                                  {email.snippet}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Inbox View */}
            {currentView === 'inbox' && (
              <>
                {/* Header */}
                <div className="bg-gradient-to-r from-gray-50 to-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search mail"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      className="w-full pl-12 pr-4 py-2.5 bg-white rounded-full border border-gray-200 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 shadow-sm focus:shadow-md"
                    />
                  </div>
                  <button 
                    onClick={handleRefresh}
                    disabled={refreshing || !socketConnected}
                    className={`p-2 hover:bg-gray-100 rounded text-gray-700 transition-colors ${refreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={lastRefresh ? `Last refresh: ${lastRefresh.toLocaleTimeString()}` : 'Refresh emails'}
                  >
                    <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                  </button>
                  <button 
                    onClick={() => setCurrentView('settings')}
                    className="p-2 hover:bg-gray-100 rounded text-gray-700"
                  >
                    <Settings className="w-5 h-5" />
                  </button>
                </div>

                {/* Tabs */}
                <div className="bg-white border-b border-gray-200 px-6 flex items-center gap-8">
                  {tabs.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab
                          ? "text-blue-600 border-blue-600"
                          : "text-gray-600 border-transparent hover:text-gray-900 hover:border-gray-300"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Error Banner */}
                {connectionError && (
                  <div className="bg-red-50 border-b border-red-200 px-6 py-3 flex items-center gap-3 text-red-700 text-sm">
                    <WifiOff className="w-4 h-4 flex-shrink-0" />
                    <span>{connectionError}</span>
                  </div>
                )}

                {/* Email List and Detail */}
                <div className="flex-1 flex overflow-hidden">
              {/* Email List Column */}
              <div className={`${selectedEmail ? 'w-96' : 'w-full'} border-r border-gray-200 overflow-y-auto bg-white transition-all duration-300`}>
                {loading ? (
                  <div className="p-8 text-center text-gray-400">
                    <Loader className="w-12 h-12 mx-auto mb-4 animate-spin" />
                    <p>Loading emails...</p>
                  </div>
                ) : emails.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <Mail className="w-12 h-12 mx-auto mb-4 opacity-25" />
                    <p>No emails found</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {emails.map((email) => {
                      const avatarInitial = email.fromEmail?.charAt(0).toUpperCase() || email.from.charAt(0).toUpperCase();
                      const isStarred = emailStarredStates[email.id] || false;
                      
                      return (
                        <div
                          key={email.id}
                          onClick={() => handleEmailClick(email.id)}
                          className={`group p-4 cursor-pointer transition-all duration-200 hover:bg-gray-50 hover:shadow-md hover:scale-[1.01] border-l-4 ${
                            selectedEmail?.id === email.id 
                              ? "bg-blue-50 border-blue-500 shadow-sm" 
                              : "border-transparent hover:border-blue-200"
                          }`}
                        >
                          <div className="flex gap-3">
                            <div
                              className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold flex-shrink-0 shadow-md ${getAvatarColor(avatarInitial)}`}
                            >
                              {avatarInitial}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className={`font-semibold text-[15px] ${selectedEmail?.id === email.id ? "text-gray-900" : "text-gray-700"}`}>
                                  {email.from}
                                </span>
                                <div className="flex items-center gap-2">
                                  {isStarred && (
                                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                                  )}
                                  <span className="text-xs text-gray-500">{formatEmailDate(email.date)}</span>
                                </div>
                              </div>
                              <p className={`text-[15px] truncate font-medium ${selectedEmail?.id === email.id ? "text-gray-900" : "text-gray-800"}`}>
                                {email.subject || "(No subject)"}
                              </p>
                              <p className="text-sm text-gray-500 truncate mt-1 line-clamp-1">
                                {email.snippet}
                              </p>
                              {email.attachments.length > 0 && (
                                <div className="flex items-center gap-1 mt-2">
                                  <Badge variant="outline" className="text-xs px-2 py-0.5">
                                    <Paperclip className="w-3 h-3 mr-1" />
                                    {email.attachments.length}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Email Detail Column */}
              {selectedEmail && (
                <div className="flex-1 bg-white overflow-y-auto">
                  <div className="max-w-4xl mx-auto">
                    <div className="border-b border-gray-200 px-6 py-4">
                      <div className="flex items-start justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-gray-900">{selectedEmail.subject || "(No subject)"}</h2>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleStar(selectedEmail.id, emailStarredStates[selectedEmail.id] || false)}
                            className="p-2 hover:bg-gray-100 rounded"
                          >
                            <Star className={`w-5 h-5 ${emailStarredStates[selectedEmail.id] ? "fill-yellow-400 text-yellow-400" : "text-gray-600"}`} />
                          </button>
                          <button 
                            onClick={() => setSelectedEmail(null)}
                            className="p-2 hover:bg-gray-100 rounded"
                          >
                            <X className="w-5 h-5 text-gray-600" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold ${getAvatarColor(selectedEmail.from.charAt(0).toUpperCase())}`}
                        >
                          {selectedEmail.from.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{selectedEmail.from}</div>
                          <div className="text-sm text-gray-600">to me</div>
                        </div>
                        <div className="text-sm text-gray-500">{formatEmailDate(selectedEmail.date)}</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setIsReplying(true)}
                          className="px-3 py-1.5 hover:bg-gray-100 rounded text-sm flex items-center gap-2 text-gray-700"
                        >
                          <Reply className="w-4 h-4" />
                          Reply
                        </button>
                        <button
                          onClick={() => handleArchive(selectedEmail.id)}
                          className="px-3 py-1.5 hover:bg-gray-100 rounded text-sm flex items-center gap-2 text-gray-700"
                        >
                          <Archive className="w-4 h-4" />
                          Archive
                        </button>
                        <button
                          onClick={() => handleDelete(selectedEmail.id)}
                          className="px-3 py-1.5 hover:bg-gray-100 rounded text-sm flex items-center gap-2 text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Body */}
                    <div className="px-6 py-8 text-gray-900 whitespace-pre-wrap text-sm leading-relaxed">
                      {selectedEmail.bodyHtml ? (
                        <div dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }} />
                      ) : (
                        <div>{selectedEmail.body}</div>
                      )}
                    </div>

                    {/* Attachments */}
                    {loadingAttachments ? (
                      <div className="px-6 py-4 text-sm text-gray-500">
                        <Loader className="w-4 h-4 inline animate-spin mr-2" />
                        Loading attachments...
                      </div>
                    ) : attachments.length > 0 ? (
                      <div className="px-6 py-4 border-t border-gray-200">
                        <p className="font-semibold text-sm text-gray-900 mb-3">Attachments</p>
                        <div className="space-y-2">
                          {attachments.map((att, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-3 p-2 bg-gray-50 rounded border border-gray-200 hover:border-blue-300 transition-colors"
                            >
                              <Paperclip className="h-4 w-4 text-gray-400" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{att.filename}</p>
                                <p className="text-xs text-gray-500">
                                  {(att.size / 1024).toFixed(2)} KB • {att.mimeType}
                                </p>
                              </div>
                              <a
                                href={`${API_URL}/api/emails/${selectedEmail.id}/attachments/${att.id}/download`}
                                download
                                className="text-blue-600 hover:text-blue-700 text-sm"
                              >
                                Download
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* Reply Section */}
                    {isReplying && (
                      <div className="border-t border-gray-200 px-6 py-6">
                        <textarea
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          placeholder="Write your reply..."
                          className="w-full p-4 border border-gray-200 rounded resize-none focus:ring-1 focus:ring-blue-500 focus:border-transparent mb-4"
                          rows={6}
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => {
                              setIsReplying(false);
                              setReplyBody("");
                            }}
                            className="px-4 py-2 hover:bg-gray-100 text-gray-700 rounded text-sm font-medium"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleReply}
                            disabled={isReplying || !replyBody.trim()}
                            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded text-sm font-medium"
                          >
                            {isReplying ? "Sending..." : "Send"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Compose Modal */}
        {composeOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold">New Message</h3>
                <button
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeTo("");
                    setComposeSubject("");
                    setComposeBody("");
                  }}
                  className="p-2 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="overflow-y-auto p-4 space-y-4 flex-1">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                  <input
                    type="email"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    placeholder="recipient@example.com"
                    className="w-full px-4 py-2 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Email subject"
                    className="w-full px-4 py-2 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                  <textarea
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    placeholder="Compose your email..."
                    className="w-full px-4 py-2 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent resize-none"
                    rows={8}
                  />
                </div>
              </div>
              <div className="border-t border-gray-200 p-4 flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeTo("");
                    setComposeSubject("");
                    setComposeBody("");
                  }}
                  className="px-4 py-2 hover:bg-gray-100 text-gray-700 rounded text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={sendingEmail || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded text-sm font-medium flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  {sendingEmail ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default GmailModal;

