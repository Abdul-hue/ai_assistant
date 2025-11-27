import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDistanceToNow, parseISO, isValid } from "date-fns";
import { io, Socket } from "socket.io-client";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Mail,
  Search,
  RefreshCw,
  Send,
  Settings,
  Plus,
  Loader2,
  Paperclip,
  FileText,
  Inbox,
  Menu,
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
  Ban,
  Circle,
  Radio,
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
  Smile,
  HelpCircle,
  ChevronRight,
  Calendar,
  WifiOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  searchGmailMessages,
  getGmailMessage,
  replyToGmailEmail,
  forwardGmailEmail,
  deleteGmailEmail,
  archiveGmailEmail,
  starGmailEmail,
  markGmailEmailAsRead,
  type EmailData,
  type GmailMessage,
} from "@/lib/gmailApi";
import { isGmailConnected, initiateGmailOAuth } from "@/lib/gmailAuth";

const GmailInbox = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [emails, setEmails] = useState<EmailData[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<GmailMessage | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [activeFilter, setActiveFilter] = useState<'inbox' | 'starred' | 'spam' | 'archived' | 'all'>('inbox');
  const [realTimeEnabled, setRealTimeEnabled] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());
  const [isReplying, setIsReplying] = useState(false);
  const [isForwarding, setIsForwarding] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [forwardBody, setForwardBody] = useState("");
  const [isStarred, setIsStarred] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [hoveredSidebar, setHoveredSidebar] = useState(false);
  const [activeTab, setActiveTab] = useState("Primary");
  const [emailStarredStates, setEmailStarredStates] = useState<Record<string, boolean>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const [userId, setUserId] = useState<string | null>(null);

  /**
   * Get User ID from localStorage or generate one
   * Falls back to Supabase user ID if available
   */
  const getUserId = useCallback(async () => {
    // First try to get from Supabase
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        localStorage.setItem("gmail_user_id", user.id);
        return user.id;
      }
    } catch (error) {
      console.warn("Could not get Supabase user:", error);
    }

    // Fallback to localStorage or generate new
    let id = localStorage.getItem("gmail_user_id");
    
    if (!id) {
      // Generate a new user ID if not exists
      id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem("gmail_user_id", id);
    }
    
    console.log("👤 User ID:", id);
    return id;
  }, []);

  // Initialize on mount
  useEffect(() => {
    mountedRef.current = true;
    
    const init = async () => {
      const id = await getUserId();
      if (mountedRef.current) {
        setUserId(id);
        // Small delay to ensure state is updated
        setTimeout(() => {
          if (mountedRef.current && connected) {
            connectToBackend(id);
          }
        }, 100);
      }
    };
    
    init();

    return () => {
      mountedRef.current = false;
    };
  }, [getUserId, connected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      
      if (socketRef.current) {
        if ('disconnect' in socketRef.current) {
          (socketRef.current as Socket).disconnect();
        } else {
          (socketRef.current as WebSocket).close();
        }
        socketRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const [connectionError, setConnectionError] = useState("");

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
   * Connect using Socket.IO
   */
  const connectWithSocketIO = useCallback((userId: string) => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const socket = io(API_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        transports: ["websocket", "polling"],
        query: {
          userId: userId, // Send User ID in query
        },
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        console.log("✅ Connected to backend via Socket.IO");
        
        if (mountedRef.current) {
          setSocketConnected(true);
          setConnectionError("");
          setLoading(false);
        }
        
        // Join user room
        socket.emit("join_user", { userId });
        
        // Request initial emails with User ID
        socket.emit("get_initial_emails", { userId });
      });

      socket.on("initial_emails", (data: { emails: any[] }) => {
        console.log("📧 Received initial emails:", data.emails?.length || 0);
        
        if (mountedRef.current) {
          if (data.emails && data.emails.length > 0) {
            // Convert to EmailData format
            const formattedEmails: EmailData[] = data.emails.map(email => ({
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
            setEmails(formattedEmails);
            setLoading(false);
          } else {
            setLoading(false);
          }
        }
      });

      socket.on("new_email", (email: any) => {
        console.log("🔔 New email received:", email.subject);
        
        if (mountedRef.current) {
          // Convert to EmailData format
          const formattedEmail: EmailData = {
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
          };

          // Add new email to the TOP of the list
          setEmails((prev) => {
            const exists = prev.some(e => e.id === formattedEmail.id);
            if (exists) return prev;
            return [formattedEmail, ...prev];
          });

          // Show notification
          toast({
            title: "New Email",
            description: `New email from ${email.from || email.fromEmail}`,
          });

          // Show browser notification
          showNotification(`New email from ${email.from || email.fromEmail}`);
        }
      });

      socket.on("email_update", (data: any) => {
        console.log("✏️ Email updated:", data.messageId);
        
        if (mountedRef.current) {
          setEmails((prev) =>
            prev.map((e) => (e.id === data.messageId ? { ...e, ...data } : e))
          );
        }
      });

      socket.on("connect_error", (error: any) => {
        console.error("❌ Connection error:", error);
        
        if (mountedRef.current) {
          const errorMsg = error.message || 
                          error.data?.content ||
                          "Failed to connect to backend";
          setConnectionError(`Connection error: ${errorMsg}`);
        }
      });

      socket.on("error", (error: any) => {
        console.error("❌ Server error:", error);
        
        if (mountedRef.current) {
          setConnectionError(`Server error: ${error.message || error}`);
        }
      });

      socket.on("disconnect", () => {
        console.warn("⚠️ Disconnected from backend");
        
        if (mountedRef.current) {
          setSocketConnected(false);
          setConnectionError("Connection lost. Reconnecting...");
        }
        
        // Attempt reconnect
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connectToBackend(userId);
          }
        }, 3000);
      });

      socketRef.current = socket;
    } catch (error) {
      console.warn("Socket.IO failed:", error);
      throw error;
    }
  }, [userId]);

  /**
   * Fallback: Native WebSocket
   */
  const connectWithNativeWebSocket = useCallback((userId: string) => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const wsUrl = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');
      const ws = new WebSocket(`${wsUrl}/ws?userId=${userId}`);

      ws.onopen = () => {
        console.log("✅ Connected via Native WebSocket");
        
        if (mountedRef.current) {
          setSocketConnected(true);
          setConnectionError("");
          setLoading(false);
        }
        
        // Request initial emails
        ws.send(JSON.stringify({ type: "get_initial_emails", userId }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (mountedRef.current) {
            if (data.type === "initial_emails") {
              console.log("📧 Received initial emails:", data.emails?.length || 0);
              if (data.emails && data.emails.length > 0) {
                const formattedEmails: EmailData[] = data.emails.map((email: any) => ({
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
                setEmails(formattedEmails);
                setLoading(false);
              }
            } else if (data.type === "new_email") {
              console.log("🔔 New email:", data.email.subject);
              const formattedEmail: EmailData = {
                id: data.email.id || data.email.messageId,
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
              setEmails((prev) => {
                const exists = prev.some(e => e.id === formattedEmail.id);
                if (exists) return prev;
                return [formattedEmail, ...prev];
              });
              showNotification(`New email from ${data.email.from || data.email.fromEmail}`);
            }
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
            connectToBackend(userId);
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
  }, [userId]);

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

  useEffect(() => {
    checkConnection();
    if (searchParams.get("connected") === "true") {
      toast({
        title: "Gmail Connected",
        description: "Your Gmail account has been successfully connected.",
      });
    }
    if (searchParams.get("error")) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: searchParams.get("error") || "Failed to connect Gmail",
      });
    }
  }, [searchParams, toast]);

  // Auto-refresh every second
  useEffect(() => {
    if (!connected) return;

    const refreshInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected && userId) {
        // Use WebSocket if available
        socketRef.current.emit('get_initial_emails', { userId });
      } else if (connected) {
        // Fallback to API call if WebSocket not connected
        fetchEmails(undefined, undefined, true); // Silent refresh
      }
    }, 1000); // Refresh every 1 second

    return () => clearInterval(refreshInterval);
  }, [connected, socketConnected, userId, activeFilter, searchQuery]);

  useEffect(() => {
    if (connected && !socketConnected) {
      // Fallback to polling if WebSocket not connected
      fetchEmails();
    }
  }, [connected, activeFilter, socketConnected]);

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
      
      if (pageToken) {
        setEmails((prev) => [...prev, ...response.messages]);
      } else {
        // Check for new emails (compare by ID)
        setEmails((prev) => {
          const existingIds = new Set(prev.map(e => e.id));
          const newEmails = response.messages.filter(e => !existingIds.has(e.id));
          
          if (newEmails.length > 0 && !silent) {
            toast({
              title: "New Emails",
              description: `${newEmails.length} new email${newEmails.length > 1 ? 's' : ''} received`,
            });
          }
          
          return response.messages;
        });
      }
      setNextPageToken(response.nextPageToken);
      setLastUpdateTime(new Date());
    } catch (error: any) {
      console.error("Fetch emails error:", error);
      
      if (!silent) {
        if (error.message?.includes("not connected") || error.message?.includes("not found") || error.message?.includes("Authentication failed")) {
          toast({
            variant: "destructive",
            title: "Gmail Not Connected",
            description: error.message || "Please connect your Gmail account first.",
          });
          setConnected(false);
        } else {
          toast({
            variant: "destructive",
            title: "Error",
            description: error.message || "Failed to fetch emails",
          });
        }
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleSearch = () => {
    fetchEmails(getFilterQuery(activeFilter));
  };

  const handleFilterChange = (filter: typeof activeFilter) => {
    setActiveFilter(filter);
    setSearchQuery(""); // Clear search when changing filters
    fetchEmails(getFilterQuery(filter));
  };

  const handleEmailClick = async (emailId: string) => {
    try {
      setLoadingEmail(true);
      const message = await getGmailMessage(emailId);
      setSelectedEmail(message);
      // Mark as read when opening
      await markGmailEmailAsRead(emailId, true).catch(console.error);
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

  const handleRefresh = () => {
    fetchEmails(getFilterQuery(activeFilter));
  };

  // Helper function to safely format email dates
  const formatEmailDate = (dateString: string | undefined | null) => {
    if (!dateString) return "Unknown date";
    
    try {
      // Try parsing as ISO string first
      let parsedDate = parseISO(dateString);
      
      // If that fails, try parsing as a date string directly
      if (!isValid(parsedDate)) {
        parsedDate = new Date(dateString);
      }
      
      if (isValid(parsedDate)) {
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - parsedDate.getTime()) / 1000);
        
        // Show relative time for recent emails, absolute time for older ones
        if (diffInSeconds < 86400) { // Less than 24 hours
          return formatDistanceToNow(parsedDate, { addSuffix: true });
        } else {
          // Show date and time for older emails
          return parsedDate.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: parsedDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
            hour: 'numeric',
            minute: '2-digit',
          });
        }
      }
      return "Unknown date";
    } catch {
      return "Unknown date";
    }
  };

  const formatFullDate = (dateString: string | undefined | null) => {
    if (!dateString) return "Unknown date";
    
    try {
      let parsedDate = parseISO(dateString);
      if (!isValid(parsedDate)) {
        parsedDate = new Date(dateString);
      }
      
      if (isValid(parsedDate)) {
        return parsedDate.toLocaleString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      }
      return "Unknown date";
    } catch {
      return "Unknown date";
    }
  };

  const handleReply = async () => {
    if (!selectedEmail || !replyBody.trim()) return;
    
    try {
      await replyToGmailEmail(selectedEmail.id, replyBody, replyBody);
      toast({
        title: "Reply Sent",
        description: "Your reply has been sent successfully.",
      });
      setIsReplying(false);
      setReplyBody("");
      // Refresh emails
      fetchEmails(getFilterQuery(activeFilter));
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to send reply",
      });
    }
  };

  const handleForward = async () => {
    if (!selectedEmail || !forwardTo.trim() || !forwardBody.trim()) return;
    
    try {
      await forwardGmailEmail(selectedEmail.id, forwardTo, forwardBody, forwardBody);
      toast({
        title: "Email Forwarded",
        description: "Your email has been forwarded successfully.",
      });
      setIsForwarding(false);
      setForwardTo("");
      setForwardBody("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to forward email",
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedEmail) return;
    
    if (!confirm("Are you sure you want to delete this email?")) return;
    
    try {
      await deleteGmailEmail(selectedEmail.id);
      toast({
        title: "Email Deleted",
        description: "The email has been deleted successfully.",
      });
      setSelectedEmail(null);
      // Refresh emails
      fetchEmails(getFilterQuery(activeFilter));
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete email",
      });
    }
  };

  const handleArchive = async () => {
    if (!selectedEmail) return;
    
    try {
      await archiveGmailEmail(selectedEmail.id);
      toast({
        title: "Email Archived",
        description: "The email has been archived successfully.",
      });
      setSelectedEmail(null);
      // Refresh emails
      fetchEmails(getFilterQuery(activeFilter));
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to archive email",
      });
    }
  };

  const handleStar = async (emailId: string, starred: boolean) => {
    try {
      await starGmailEmail(emailId, starred);
      setEmailStarredStates(prev => ({ ...prev, [emailId]: starred }));
      toast({
        title: starred ? "Email Starred" : "Email Unstarred",
        description: `The email has been ${starred ? 'starred' : 'unstarred'} successfully.`,
      });
      // Refresh emails
      fetchEmails(getFilterQuery(activeFilter));
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update star status",
      });
    }
  };

  const handleStarSelected = async (starred: boolean) => {
    if (!selectedEmail) return;
    
    try {
      await starGmailEmail(selectedEmail.id, starred);
      setIsStarred(starred);
      toast({
        title: starred ? "Email Starred" : "Email Unstarred",
        description: `The email has been ${starred ? 'starred' : 'unstarred'} successfully.`,
      });
      // Refresh emails
      fetchEmails(getFilterQuery(activeFilter));
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update star status",
      });
    }
  };

  const getAvatarColor = (name: string) => {
    const colors: Record<string, string> = {
      'A': 'bg-red-400',
      'B': 'bg-blue-400',
      'C': 'bg-green-400',
      'D': 'bg-yellow-400',
      'E': 'bg-purple-400',
      'F': 'bg-pink-400',
      'G': 'bg-indigo-400',
      'H': 'bg-orange-400',
    };
    const firstLetter = name.charAt(0).toUpperCase();
    return colors[firstLetter] || 'bg-gray-400';
  };

  const tabs = ["Primary", "Promotions", "Social", "Updates"];

  const sidebarItems = [
    { icon: Edit, label: "Compose", action: () => navigate("/gmail/compose") },
    { icon: Inbox, label: "Inbox", count: emails.length, action: () => handleFilterChange('inbox'), active: activeFilter === 'inbox' },
    { icon: Star, label: "Starred", action: () => handleFilterChange('starred'), active: activeFilter === 'starred' },
    { icon: Clock, label: "Snoozed" },
    { icon: Send, label: "Sent", action: () => navigate("/gmail/sent") },
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

  if (!connected) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <Card className="mb-6 shadow-lg bg-gray-900 border-gray-800">
            <CardContent className="p-8">
              <div className="text-center space-y-6">
                <div className="mx-auto w-16 h-16 bg-gradient-to-br from-red-500 to-blue-500 rounded-full flex items-center justify-center">
                  <Mail className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-white mb-2">Connect Email Source</h2>
                  <p className="text-gray-400">
                    Choose an email source to get started
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Gmail Option */}
                  <Card className="border-2 border-gray-700 hover:border-blue-500 cursor-pointer transition-colors bg-gray-800">
                    <CardContent className="p-6 text-center">
                      <div className="flex justify-center mb-4">
                        <Mail className="h-12 w-12 text-red-500" />
                      </div>
                      <h3 className="font-semibold mb-2 text-white">Gmail</h3>
                      <p className="text-sm text-gray-400 mb-4">
                        Connect your Gmail account for email management
                      </p>
                      <Button onClick={handleConnect} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                        Connect Gmail
                      </Button>
                    </CardContent>
                  </Card>

                </div>

                <Button
                  onClick={() => navigate("/dashboard")}
                  variant="outline"
                  className="w-full border-gray-700 text-gray-300 hover:bg-gray-800"
                >
                  Back to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - Gmail Style with Hover Expand */}
      <div 
        className={`${hoveredSidebar ? "w-64" : "w-16"} bg-white border-r border-gray-200 flex flex-col transition-all duration-300 relative`}
        onMouseEnter={() => setHoveredSidebar(true)}
        onMouseLeave={() => setHoveredSidebar(false)}
      >
        {/* Logo */}
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

        {/* Status */}
        {hoveredSidebar && (
          <div className="px-4 py-2 text-xs font-medium">
            <div className={`flex items-center gap-2 ${socketConnected ? "text-green-600" : "text-red-600"}`}>
              <div className={`w-2 h-2 rounded-full ${socketConnected ? "bg-green-500" : "bg-red-500"}`}></div>
              {socketConnected ? "Real-time Connected" : "Disconnected"}
            </div>
          </div>
        )}

        {/* Compose Button */}
        <div className="p-4">
          <button 
            onClick={() => navigate("/gmail/compose")}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-2xl py-3 px-4 flex items-center justify-center gap-2 font-medium transition-colors"
          >
            <Edit className="w-5 h-5" />
            {hoveredSidebar && "Compose"}
          </button>
        </div>

        {/* Main Navigation */}
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

          {/* Labels Section */}
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

        {/* Footer */}
        {hoveredSidebar && (
          <div className="p-4 border-t border-gray-200 space-y-2">
            <button 
              onClick={() => navigate("/gmail/settings")}
              className="flex items-center gap-4 px-4 py-2 rounded-r-2xl text-gray-700 hover:bg-gray-100 transition-colors w-full text-sm"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
            <button 
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-4 px-4 py-2 rounded-r-2xl text-gray-700 hover:bg-gray-100 transition-colors w-full text-sm"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 hover:bg-gray-100 rounded text-gray-700"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search mail"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full pl-10 pr-4 py-2 bg-gray-100 rounded border-0 focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
            />
          </div>
          <div className="flex items-center gap-2">
            {connected && (
              <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700 border-blue-300">
                <CheckCircle2 className="h-3 w-3" />
                Gmail
              </Badge>
            )}
            {socketConnected ? (
              <Badge variant="secondary" className="gap-1 bg-green-100 text-green-700 border-green-300">
                <Radio className="h-3 w-3 animate-pulse" />
                Real-time Active
              </Badge>
            ) : connected && (
              <Badge variant="secondary" className="gap-1 bg-red-100 text-red-700 border-red-300">
                <WifiOff className="h-3 w-3" />
                Offline
              </Badge>
            )}
          </div>
          <button className="p-2 hover:bg-gray-100 rounded text-gray-700">
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
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8">
                <Mail className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-lg font-medium text-gray-400">No emails found</p>
                <p className="text-sm mt-2 text-gray-600">Try adjusting your search or filters</p>
              </div>
            ) : (
              <div>
                {/* Select All Bar */}
                {selectedEmails.size > 0 && (
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-4">
                    <Checkbox 
                      checked={selectedEmails.size === emails.length}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedEmails(new Set(emails.map(e => e.id)));
                        } else {
                          setSelectedEmails(new Set());
                        }
                      }}
                      className="border-gray-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                    />
                    <span className="text-sm text-gray-600">
                      {selectedEmails.size} selected
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          selectedEmails.forEach(id => {
                            handleStar(id, true);
                          });
                          setSelectedEmails(new Set());
                        }}
                        className="text-gray-600 hover:text-yellow-500"
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          for (const id of selectedEmails) {
                            await archiveGmailEmail(id).catch(console.error);
                          }
                          setSelectedEmails(new Set());
                          fetchEmails(getFilterQuery(activeFilter));
                        }}
                        className="text-gray-600 hover:text-gray-900"
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (confirm(`Delete ${selectedEmails.size} email(s)?`)) {
                            for (const id of selectedEmails) {
                              await deleteGmailEmail(id).catch(console.error);
                            }
                            setSelectedEmails(new Set());
                            fetchEmails(getFilterQuery(activeFilter));
                          }
                        }}
                        className="text-gray-600 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
                <div className="divide-y divide-gray-100">
                  {emails.map((email) => {
                    const isSelected = selectedEmails.has(email.id);
                    const emailIsStarred = emailStarredStates[email.id] || false;
                    const avatarInitial = email.from.charAt(0).toUpperCase();
                    
                    return (
                      <div
                        key={email.id}
                        className={`group p-4 cursor-pointer hover:shadow-sm transition-all ${
                          selectedEmail?.id === email.id ? "bg-blue-50" : "hover:bg-gray-50"
                        }`}
                        onClick={() => handleEmailClick(email.id)}
                      >
                        <div className="flex gap-3">
                          {/* Checkbox */}
                          <div 
                            className={`transition-opacity flex-shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEmails(prev => {
                                const newSet = new Set(prev);
                                if (isSelected) {
                                  newSet.delete(email.id);
                                } else {
                                  newSet.add(email.id);
                                }
                                return newSet;
                              });
                            }}
                          >
                            <Checkbox 
                              checked={isSelected}
                              className="border-gray-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                            />
                          </div>

                          {/* Star */}
                          <div
                            className={`transition-opacity cursor-pointer flex-shrink-0 ${emailIsStarred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStar(email.id, !emailIsStarred);
                            }}
                          >
                            <Star 
                              className={`w-4 h-4 ${
                                emailIsStarred 
                                  ? 'text-yellow-500 fill-yellow-500' 
                                  : 'text-gray-400 hover:text-yellow-500'
                              }`}
                            />
                          </div>

                          {/* Avatar */}
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${getAvatarColor(avatarInitial)}`}
                          >
                            {avatarInitial}
                          </div>

                          {/* Email Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className={`font-medium text-sm ${selectedEmail?.id === email.id ? "text-gray-900" : "text-gray-600"}`}>
                                {email.from}
                              </span>
                              <span className="text-xs text-gray-500">{formatEmailDate(email.date)}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              {emailIsStarred && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
                              <p className={`text-sm truncate ${selectedEmail?.id === email.id ? "text-gray-700 font-medium" : "text-gray-500"}`}>
                                {email.subject || "(No subject)"}
                              </p>
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-1">
                              {email.snippet}
                            </p>
                            {email.attachments.length > 0 && (
                              <div className="flex items-center gap-1 mt-2">
                                <Paperclip className="w-4 h-4 text-gray-400" />
                                <span className="text-xs text-gray-500">
                                  {email.attachments.length} attachment{email.attachments.length > 1 ? 's' : ''}
                                </span>
                              </div>
                            )}
                            {email.hasResume && (
                              <Badge variant="secondary" className="text-xs mt-2 bg-blue-100 text-blue-700 border-blue-300">
                                <FileText className="h-3 w-3 mr-1" />
                                Resume
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {nextPageToken && (
                  <div className="p-4 border-t border-gray-200">
                    <Button
                      onClick={() => fetchEmails(getFilterQuery(activeFilter), nextPageToken)}
                      variant="outline"
                      className="w-full"
                    >
                      Load More
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Email Detail Column */}
          {selectedEmail && (
            <div className="flex-1 bg-white overflow-y-auto">
              <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="border-b border-gray-200 px-6 py-4">
                  <div className="flex items-start justify-between mb-4">
                    <h2 className="text-2xl font-semibold text-gray-900">{selectedEmail.subject || "(No subject)"}</h2>
                    <button 
                      onClick={() => setSelectedEmail(null)}
                      className="p-2 hover:bg-gray-100 rounded"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold ${getAvatarColor(selectedEmail.from.charAt(0).toUpperCase())}`}
                    >
                      {selectedEmail.from.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{selectedEmail.from}</div>
                      <div className="text-sm text-gray-600">to {selectedEmail.to}</div>
                    </div>
                    <div className="text-sm text-gray-500">{formatEmailDate(selectedEmail.date)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleArchive}
                      className="px-3 py-1.5 hover:bg-gray-100 rounded text-sm flex items-center gap-2 text-gray-700"
                    >
                      <Archive className="w-4 h-4" />
                      Archive
                    </button>
                    <button 
                      onClick={handleDelete}
                      className="px-3 py-1.5 hover:bg-gray-100 rounded text-sm flex items-center gap-2 text-gray-700"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                    <button 
                      onClick={() => handleStarSelected(!isStarred)}
                      className="px-3 py-1.5 hover:bg-gray-100 rounded text-sm flex items-center gap-2 text-gray-700"
                    >
                      <Flag className="w-4 h-4" />
                      Flag
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
                {selectedEmail.attachments.length > 0 && (
                  <div className="px-6 py-4 border-t border-gray-200">
                    <p className="font-semibold text-sm text-gray-900 mb-3">Attachments</p>
                    <div className="space-y-2">
                      {selectedEmail.attachments.map((att, idx) => (
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
                          <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700">
                            Download
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reply Section */}
                <div className="border-t border-gray-200 px-6 py-6">
                  <div className="flex gap-2 mb-4">
                    <button 
                      onClick={() => setIsReplying(true)}
                      className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium transition-colors"
                    >
                      Reply
                    </button>
                    <button className="px-4 py-2 hover:bg-gray-100 text-gray-700 rounded text-sm font-medium transition-colors">
                      Reply all
                    </button>
                    <button 
                      onClick={() => setIsForwarding(true)}
                      className="px-4 py-2 hover:bg-gray-100 text-gray-700 rounded text-sm font-medium transition-colors"
                    >
                      Forward
                    </button>
                  </div>
                  {isReplying && (
                    <div className="bg-gray-50 rounded border border-gray-200 p-4">
                      <textarea
                        placeholder="Compose your reply..."
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        className="w-full bg-transparent resize-none focus:outline-none text-sm"
                        rows={4}
                      />
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                        <div className="flex gap-2">
                          <button className="p-2 hover:bg-gray-200 rounded transition-colors">
                            <Paperclip className="w-5 h-5 text-gray-600" />
                          </button>
                          <button className="p-2 hover:bg-gray-200 rounded transition-colors">
                            <Smile className="w-5 h-5 text-gray-600" />
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              setIsReplying(false);
                              setReplyBody("");
                            }}
                            className="px-4 py-2 hover:bg-gray-200 text-gray-700 rounded text-sm font-medium transition-colors"
                          >
                            Cancel
                          </button>
                          <button 
                            onClick={handleReply}
                            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium transition-colors"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {isForwarding && (
                    <div className="bg-gray-50 rounded border border-gray-200 p-4">
                      <div className="mb-4">
                        <label className="text-sm text-gray-700 mb-1 block">To:</label>
                        <Input
                          placeholder="recipient@example.com"
                          value={forwardTo}
                          onChange={(e) => setForwardTo(e.target.value)}
                          className="bg-white"
                        />
                      </div>
                      <textarea
                        placeholder="Add a message (optional)..."
                        value={forwardBody}
                        onChange={(e) => setForwardBody(e.target.value)}
                        className="w-full bg-transparent resize-none focus:outline-none text-sm"
                        rows={4}
                      />
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                        <div className="flex gap-2">
                          <button className="p-2 hover:bg-gray-200 rounded transition-colors">
                            <Paperclip className="w-5 h-5 text-gray-600" />
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              setIsForwarding(false);
                              setForwardTo("");
                              setForwardBody("");
                            }}
                            className="px-4 py-2 hover:bg-gray-200 text-gray-700 rounded text-sm font-medium transition-colors"
                          >
                            Cancel
                          </button>
                          <button 
                            onClick={handleForward}
                            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium transition-colors"
                          >
                            Forward
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GmailInbox;
