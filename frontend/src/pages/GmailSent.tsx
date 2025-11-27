import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow, parseISO, isValid } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Menu,
  X,
  Archive,
  Star,
  Trash2,
  Filter,
  User,
  LayoutDashboard,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  searchGmailMessages,
  getGmailMessage,
  type EmailData,
  type GmailMessage,
} from "@/lib/gmailApi";
import { isGmailConnected } from "@/lib/gmailAuth";

const GmailSent = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [emails, setEmails] = useState<EmailData[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<GmailMessage | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    checkConnection();
  }, []);

  useEffect(() => {
    if (connected) {
      fetchEmails();
    }
  }, [connected]);

  const checkConnection = async () => {
    try {
      const isConnected = await isGmailConnected();
      setConnected(isConnected);
      if (!isConnected) {
        setLoading(false);
        navigate("/gmail/inbox");
      }
    } catch (error) {
      console.error("Connection check error:", error);
      setLoading(false);
    }
  };

  const fetchEmails = async (query: string = "", pageToken?: string) => {
    try {
      setLoading(true);
      const response = await searchGmailMessages(
        `in:sent ${query}`,
        20,
        pageToken
      );
      if (pageToken) {
        setEmails((prev) => [...prev, ...response.messages]);
      } else {
        setEmails(response.messages);
      }
      setNextPageToken(response.nextPageToken);
    } catch (error: any) {
      console.error("Fetch emails error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to fetch sent emails",
      });
    } finally {
      setLoading(false);
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

  const handleRefresh = () => {
    fetchEmails(searchQuery);
  };

  // Helper function to safely format email dates
  const formatEmailDate = (dateString: string | undefined | null) => {
    if (!dateString) return "Unknown date";
    
    try {
      const parsedDate = parseISO(dateString);
      return isValid(parsedDate)
        ? formatDistanceToNow(parsedDate, { addSuffix: true })
        : "Unknown date";
    } catch {
      return "Unknown date";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-16'} bg-gray-900 border-r border-gray-800 transition-all duration-300 flex flex-col`}>
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-blue-500 rounded-lg flex items-center justify-center">
              <Mail className="h-6 w-6 text-white" />
            </div>
            {sidebarOpen && <span className="font-semibold text-white">Gmail</span>}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-800"
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>

        <div className="flex-1 p-2 space-y-1">
          <Button
            onClick={() => navigate("/gmail/compose")}
            className="w-full justify-start gap-3 h-12 rounded-full bg-blue-600 text-white hover:bg-blue-700 font-medium"
            variant="ghost"
          >
            <Plus className="h-5 w-5" />
            {sidebarOpen && "Compose"}
          </Button>

          <div className="pt-4">
            {sidebarOpen && (
              <p className="px-3 text-xs font-semibold text-gray-500 uppercase mb-2">Mail</p>
            )}
            <Button
              onClick={() => navigate("/gmail/inbox")}
              className="w-full justify-start gap-3 h-10 rounded-lg hover:bg-gray-800 text-gray-300"
              variant="ghost"
            >
              <Inbox className="h-5 w-5" />
              {sidebarOpen && "Inbox"}
            </Button>
            <Button
              onClick={() => navigate("/gmail/sent")}
              className="w-full justify-start gap-3 h-10 rounded-lg bg-gray-800 text-white hover:bg-gray-700"
              variant="ghost"
            >
              <Send className="h-5 w-5" />
              {sidebarOpen && "Sent"}
            </Button>
          </div>
        </div>

        <div className="p-2 border-t border-gray-800 space-y-1">
          <Button
            onClick={() => navigate("/dashboard")}
            className="w-full justify-start gap-3 h-10 rounded-lg hover:bg-gray-800 text-gray-300"
            variant="ghost"
          >
            <LayoutDashboard className="h-5 w-5" />
            {sidebarOpen && "Dashboard"}
          </Button>
          <Button
            onClick={() => navigate("/gmail/settings")}
            className="w-full justify-start gap-3 h-10 rounded-lg hover:bg-gray-800 text-gray-300"
            variant="ghost"
          >
            <Settings className="h-5 w-5" />
            {sidebarOpen && "Settings"}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-black">
        {/* Top Bar */}
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-500" />
              <Input
                placeholder="Search sent emails"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-10 h-12 rounded-full border-gray-700 bg-gray-800 text-white placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <Button
              onClick={handleRefresh}
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <RefreshCw className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <Filter className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Email List */}
          <div className={`${selectedEmail ? 'w-1/3' : 'w-full'} border-r border-gray-800 bg-black overflow-y-auto transition-all duration-300`}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8">
                <Send className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-lg font-medium text-gray-400">No sent emails found</p>
                <p className="text-sm mt-2 text-gray-600">Emails you send will appear here</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-900">
                {emails.map((email) => (
                  <div
                    key={email.id}
                    onClick={() => handleEmailClick(email.id)}
                    className={`px-4 py-3 cursor-pointer hover:bg-gray-900 transition-colors border-l-4 ${
                      selectedEmail?.id === email.id
                        ? "bg-gray-900 border-l-blue-500"
                        : "border-l-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center text-white font-semibold text-sm">
                        <Send className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="font-medium text-sm text-white truncate">
                            To: {email.fromEmail}
                          </p>
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            {formatEmailDate(email.date)}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-white mb-1 truncate">
                          {email.subject || "(No subject)"}
                        </p>
                        <p className="text-sm text-gray-400 line-clamp-2">
                          {email.snippet}
                        </p>
                        {email.attachments.length > 0 && (
                          <div className="flex items-center gap-1 mt-2">
                            <Paperclip className="h-3 w-3 text-gray-500" />
                            <span className="text-xs text-gray-500">
                              {email.attachments.length} attachment{email.attachments.length > 1 ? 's' : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {nextPageToken && (
              <div className="p-4 border-t border-gray-800">
                <Button
                  onClick={() => fetchEmails(searchQuery, nextPageToken)}
                  variant="outline"
                  className="w-full border-gray-700 text-gray-300 hover:bg-gray-900"
                >
                  Load More
                </Button>
              </div>
            )}
          </div>

          {/* Email Detail */}
          {selectedEmail && (
            <div className="flex-1 bg-black overflow-y-auto">
              <div className="max-w-4xl mx-auto p-6">
                <div className="mb-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h1 className="text-2xl font-semibold text-white mb-4">
                        {selectedEmail.subject || "(No subject)"}
                      </h1>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center text-white font-semibold">
                          <Send className="h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-white">To: {selectedEmail.to}</p>
                          </div>
                          <p className="text-sm text-gray-400">
                            From: {selectedEmail.from}
                          </p>
                        </div>
                        <span className="text-sm text-gray-500">
                          {formatEmailDate(selectedEmail.date)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-gray-400 hover:text-white hover:bg-gray-900">
                        <Archive className="h-5 w-5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-gray-400 hover:text-white hover:bg-gray-900">
                        <Trash2 className="h-5 w-5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full text-gray-400 hover:text-white hover:bg-gray-900"
                        onClick={() => setSelectedEmail(null)}
                      >
                        <X className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>

                  {selectedEmail.attachments.length > 0 && (
                    <div className="mb-6 p-4 bg-gray-900 rounded-lg border border-gray-800">
                      <p className="font-semibold text-sm text-white mb-3">Attachments</p>
                      <div className="space-y-2">
                        {selectedEmail.attachments.map((att, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-3 p-2 bg-gray-800 rounded border border-gray-700 hover:border-blue-600 transition-colors"
                          >
                            <Paperclip className="h-4 w-4 text-gray-400" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{att.filename}</p>
                              <p className="text-xs text-gray-500">
                                {(att.size / 1024).toFixed(2)} KB • {att.mimeType}
                              </p>
                            </div>
                            <Button variant="ghost" size="sm" className="text-blue-400 hover:text-blue-300">
                              Download
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="prose prose-invert max-w-none text-gray-300">
                    {selectedEmail.bodyHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }} className="text-gray-300" />
                    ) : (
                      <div className="whitespace-pre-wrap text-gray-300">{selectedEmail.body}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GmailSent;
