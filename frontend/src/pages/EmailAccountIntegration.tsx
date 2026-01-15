import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  Mail,
  CheckCircle2,
  XCircle,
  Loader2,
  Key,
  ArrowRight,
  Settings,
  Plus,
  Sparkles,
  Zap,
  Clock,
  Info,
  Shield,
  Check,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getImapSmtpAccounts,
  disconnectImapSmtpAccount,
  type ImapSmtpAccount,
} from "@/lib/imapSmtpApi";
// Gmail OAuth removed - using IMAP/SMTP only
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, RefreshCw } from "lucide-react";

const EmailAccountIntegration = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [imapAccounts, setImapAccounts] = useState<ImapSmtpAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnectingAccount, setDisconnectingAccount] = useState<string | null>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [accountToDisconnect, setAccountToDisconnect] = useState<{ id: string; email: string; type: 'imap' } | null>(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const accounts = await getImapSmtpAccounts();
      setImapAccounts(accounts.filter(acc => acc.is_active));
    } catch (error) {
      console.error("Error loading accounts:", error);
    } finally {
      setLoading(false);
    }
  };

  // Gmail OAuth removed - using IMAP/SMTP only

  const handleDisconnectClick = (e: React.MouseEvent, account: { id: string; email: string; type: 'imap' }) => {
    e.stopPropagation();
    setAccountToDisconnect(account);
    setDisconnectDialogOpen(true);
  };

  const handleConfirmDisconnect = async () => {
    if (!accountToDisconnect) return;

    try {
      setDisconnectingAccount(accountToDisconnect.id);
      
      await disconnectImapSmtpAccount(accountToDisconnect.id);
      await loadAccounts(); // Reload accounts

      toast({
        title: "Success",
        description: `${accountToDisconnect.email} has been disconnected`,
      });

      setDisconnectDialogOpen(false);
      setAccountToDisconnect(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to disconnect account",
      });
    } finally {
      setDisconnectingAccount(null);
    }
  };

  const hasAnyConnection = imapAccounts.length > 0;
  const activeCount = imapAccounts.filter(acc => acc.is_active && !acc.needs_reconnection).length;

  // Format time helper
  const formatTime = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <AppLayout>
      <div className="w-full">
        {/* Background Pattern */}
        <div className="fixed inset-0 opacity-5 dark:opacity-10 pointer-events-none z-0">
          <div className="absolute inset-0" style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)`,
            backgroundSize: '40px 40px'
          }}></div>
        </div>

        <div className="container mx-auto px-6 py-12 max-w-6xl relative z-10">
          {/* Header Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                Email Accounts
              </h1>
            </div>
            <p className="text-gray-700 dark:text-gray-300 text-lg font-medium">
              Manage your connected email accounts in one place
            </p>
          </div>

        {/* Loading State with Skeleton */}
        {loading ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
              {[1, 2].map((n) => (
                <Card key={n} className="animate-pulse">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <Skeleton className="h-12 w-12 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                    <div className="space-y-2 mb-4">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                    <Skeleton className="h-10 w-full rounded-lg" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : hasAnyConnection ? (
          <div className="space-y-6">
            {/* Quick Stats Bar */}
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/50 dark:to-blue-950/50 rounded-xl p-6 border border-purple-200 dark:border-purple-800">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-8">
                  <div>
                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Total Accounts</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{imapAccounts.length}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Active</p>
                    <p className="text-3xl font-bold text-green-600 dark:text-green-400">{activeCount}</p>
                  </div>
                  {imapAccounts.filter(acc => acc.needs_reconnection).length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Needs Attention</p>
                      <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                        {imapAccounts.filter(acc => acc.needs_reconnection).length}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Account Cards Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
              {imapAccounts.map((account, index) => (
                <Card 
                  key={account.id} 
                  className="group hover:shadow-lg transition-all duration-200 border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-blue-400 dark:hover:border-blue-500"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <CardContent className="p-6">
                    {/* Account Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Avatar with status indicator */}
                        <div className="relative">
                          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold text-lg shadow-lg">
                            {account.email.charAt(0).toUpperCase()}
                          </div>
                          {/* Active status dot */}
                          {account.is_active && !account.needs_reconnection && (
                            <div className="absolute -bottom-1 -right-1 h-4 w-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 shadow-sm" />
                          )}
                          {account.needs_reconnection && (
                            <div className="absolute -bottom-1 -right-1 h-4 w-4 bg-orange-500 rounded-full border-2 border-white dark:border-gray-900 shadow-sm" />
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          {/* EMAIL ADDRESS - HIGH CONTRAST - WHITE IN DARK MODE */}
                          <p className="font-semibold text-lg text-gray-900 dark:text-white truncate">
                            {account.email}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            {/* BADGE - HIGH CONTRAST WITH VISIBLE TEXT */}
                            <Badge className="bg-purple-100 dark:bg-purple-500/30 text-purple-700 dark:text-purple-200 border border-purple-300 dark:border-purple-400/50 text-xs font-semibold px-2.5 py-1">
                              {account.provider || 'IMAP/SMTP'}
                            </Badge>
                            {account.needs_reconnection && (
                              <Badge variant="destructive" className="text-xs font-semibold px-2.5 py-1">
                                Reconnect
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Account Info - HIGH CONTRAST - VISIBLE TEXT */}
                    <div className="mb-4 space-y-2">
                      {account.imap_host && (
                        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                          <Key className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                          <span className="truncate font-semibold">{account.imap_host}</span>
                        </div>
                      )}
                      {account.last_connection_attempt && (
                        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                          <Clock className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                          <span className="font-semibold">Last attempt: {formatTime(account.last_connection_attempt)}</span>
                        </div>
                      )}
                    </div>

                    {/* Error Message */}
                    {account.last_error && (
                      <Alert variant="destructive" className="mb-4 py-3">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-sm font-medium text-red-900 dark:text-red-100">
                          {account.last_error}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Quick Actions */}
                    <div className="flex items-center gap-2">
                      <Button 
                        className="flex-1 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold text-base h-11 shadow-lg" 
                        onClick={() => navigate(`/emails/${account.id}`)}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Open Inbox
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon"
                        className="border-2 border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400"
                        onClick={() => navigate(`/emails/${account.id}`)}
                        title="View Settings"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon"
                        className="border-2 border-gray-300 dark:border-gray-600 hover:border-red-500 dark:hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-700 dark:text-gray-200 hover:text-red-600 dark:hover:text-red-400"
                        onClick={(e) => handleDisconnectClick(e, { id: account.id, email: account.email, type: 'imap' })}
                        disabled={disconnectingAccount === account.id}
                        title="Disconnect"
                      >
                        {disconnectingAccount === account.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Add Account Button */}
            <Button 
              variant="outline" 
              className="w-full h-20 border-dashed border-2 border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all duration-200 rounded-xl text-base font-semibold text-gray-700 dark:text-gray-200 hover:text-blue-700 dark:hover:text-blue-200"
              onClick={() => navigate("/email-integration/imap-smtp/connect")}
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Another Email Account
            </Button>

            {/* Contextual Help */}
            <Alert className="bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800">
              <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <AlertTitle className="text-base font-semibold text-blue-900 dark:text-blue-50">
                Need help connecting your email?
              </AlertTitle>
              <AlertDescription className="text-sm font-medium text-blue-800 dark:text-blue-200 mt-1">
                Check our setup guide for step-by-step instructions on connecting Gmail, Outlook, and other providers.
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Illustration/Icon */}
            <div className="relative mb-8">
              <div className="h-32 w-32 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900 dark:to-blue-900 flex items-center justify-center shadow-xl">
                <Mail className="h-16 w-16 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="absolute -bottom-2 -right-2 h-12 w-12 rounded-full bg-white dark:bg-gray-800 shadow-lg flex items-center justify-center border-2 border-purple-200 dark:border-purple-800">
                <Plus className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>

            {/* Text Content */}
            <h2 className="text-2xl font-bold mb-3 text-gray-900 dark:text-gray-50">No Email Accounts Connected</h2>
            <p className="text-gray-700 dark:text-gray-300 text-center max-w-md mb-8 text-base font-medium">
              Connect your email accounts to manage all your emails in one place. 
              We support Gmail, Outlook, and any provider via IMAP/SMTP.
            </p>

            {/* Primary CTA */}
            <Button 
              size="lg" 
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-lg hover:shadow-xl h-12 px-8 text-base font-semibold transition-all duration-200 hover:scale-105"
              onClick={() => navigate("/email-integration/imap-smtp/connect")}
            >
              <Plus className="h-5 w-5 mr-2" />
              Connect Your First Email Account
            </Button>

            {/* Secondary Info */}
            <div className="mt-12 grid grid-cols-3 gap-8 text-center max-w-2xl">
              <div>
                <div className="h-12 w-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mx-auto mb-2">
                  <Shield className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-1">Secure</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 font-medium">End-to-end encrypted</p>
              </div>
              <div>
                <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mx-auto mb-2">
                  <Zap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-1">Fast</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 font-medium">Real-time sync</p>
              </div>
              <div>
                <div className="h-12 w-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mx-auto mb-2">
                  <Check className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-1">Easy</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 font-medium">Setup in minutes</p>
              </div>
            </div>
          </div>
        )}

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Email Account?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect {accountToDisconnect?.email}? 
              You will need to reconnect to access emails from this account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </div>
      </div>
    </AppLayout>
  );
};

export default EmailAccountIntegration;

