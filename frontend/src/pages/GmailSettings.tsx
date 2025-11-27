import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Settings,
  Mail,
  CheckCircle2,
  XCircle,
  Loader2,
  Inbox,
  Send,
  Plus,
  Shield,
  Key,
  Info,
  LayoutDashboard,
  Edit,
  Star,
  Clock,
  FileText,
  ShoppingCart,
  ChevronDown,
  AlertCircle,
  Calendar,
  Trash2,
  Search,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isGmailConnected, disconnectGmail, initiateGmailOAuth } from "@/lib/gmailAuth";

const GmailSettings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [hoveredSidebar, setHoveredSidebar] = useState(false);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const isConnected = await isGmailConnected();
      setConnected(isConnected);
      // Fetch email if connected
      if (isConnected) {
        try {
          const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/gmail/status`, {
            credentials: 'include',
          });
          if (response.ok) {
            const data = await response.json();
            setUserEmail(data.email);
          }
        } catch (error) {
          console.error("Failed to fetch email:", error);
        }
      }
    } catch (error) {
      console.error("Connection check error:", error);
    } finally {
      setLoading(false);
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

  const sidebarItems = [
    { icon: Edit, label: "Compose", action: () => navigate("/gmail/compose") },
    { icon: Inbox, label: "Inbox", action: () => navigate("/gmail/inbox") },
    { icon: Star, label: "Starred" },
    { icon: Clock, label: "Snoozed" },
    { icon: Send, label: "Sent", action: () => navigate("/gmail/sent") },
    { icon: FileText, label: "Drafts" },
    { icon: ShoppingCart, label: "Purchases" },
    { icon: ChevronDown, label: "More" },
  ];

  const labels = [
    { icon: AlertCircle, label: "Important" },
    { icon: Calendar, label: "Scheduled" },
    { icon: Mail, label: "All Mail" },
    { icon: AlertCircle, label: "Spam" },
    { icon: Trash2, label: "Trash" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar - Same as GmailModal */}
      <div
        className={`${hoveredSidebar ? "w-64" : "w-16"} bg-white border-r border-gray-200 flex flex-col transition-all duration-300 relative`}
        onMouseEnter={() => setHoveredSidebar(true)}
        onMouseLeave={() => setHoveredSidebar(false)}
      >
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Mail className="w-8 h-8 text-red-500" />
            {hoveredSidebar && <span className="font-bold text-xl text-gray-900">Gmail</span>}
          </div>
        </div>

        <div className="p-4">
          <button
            onClick={() => navigate("/gmail/compose")}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-2xl py-3 px-4 flex items-center justify-center gap-2 font-medium transition-colors"
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
                  item.label === "Settings" ? "bg-blue-50 text-blue-700 font-medium" : ""
                }`}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {hoveredSidebar && <span className="flex-1 text-left">{item.label}</span>}
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
                    className="w-full flex items-center gap-4 px-4 py-2 rounded-r-2xl text-gray-700 hover:bg-gray-100 transition-colors text-sm"
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
              className="flex items-center gap-4 px-4 py-2 rounded-r-2xl text-gray-700 hover:bg-gray-100 transition-colors w-full text-sm bg-blue-50 text-blue-700 font-medium"
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
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search mail"
              className="w-full pl-10 pr-4 py-2 bg-gray-100 rounded border-0 focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
            />
          </div>
          <button className="p-2 hover:bg-gray-100 rounded text-gray-700">
            <RefreshCw className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded text-gray-700">
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Connection Status Card */}
            <Card className="shadow-sm border-gray-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-900">
                  <Mail className="h-5 w-5" />
                  Account Connection
                </CardTitle>
                <CardDescription className="text-gray-600">
                  Manage your Gmail account connection and authentication
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
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
              </CardContent>
            </Card>

            {/* Features Card */}
            {connected && (
              <Card className="shadow-sm border-gray-200 bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-gray-900">
                    <Info className="h-5 w-5" />
                    Available Features
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                      <Inbox className="h-5 w-5 text-blue-500 mt-0.5" />
                      <div>
                        <p className="font-medium text-gray-900">View Inbox</p>
                        <p className="text-sm text-gray-600">Read and manage your incoming emails</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                      <Send className="h-5 w-5 text-green-500 mt-0.5" />
                      <div>
                        <p className="font-medium text-gray-900">Send Emails</p>
                        <p className="text-sm text-gray-600">Compose and send new messages</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                      <Mail className="h-5 w-5 text-purple-500 mt-0.5" />
                      <div>
                        <p className="font-medium text-gray-900">Search Emails</p>
                        <p className="text-sm text-gray-600">Quickly find emails with advanced search</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                      <Shield className="h-5 w-5 text-orange-500 mt-0.5" />
                      <div>
                        <p className="font-medium text-gray-900">Secure Storage</p>
                        <p className="text-sm text-gray-600">Your emails are safely stored in the database</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Security Info Card */}
            <Card className="shadow-sm border-gray-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-900">
                  <Shield className="h-5 w-5" />
                  Security & Privacy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 text-sm text-gray-600">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900 mb-1">Encrypted Storage</p>
                      <p>Your Gmail access tokens are securely stored in our encrypted database and never exposed to the frontend.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Key className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900 mb-1">Automatic Token Refresh</p>
                      <p>Access tokens are automatically refreshed when they expire, ensuring uninterrupted access to your emails.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-purple-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900 mb-1">OAuth 2.0 Standard</p>
                      <p>We use Google's official OAuth 2.0 protocol for secure authentication. Your password is never stored.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GmailSettings;
