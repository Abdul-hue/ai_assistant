import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  CheckCircle2,
  XCircle,
  Loader2,
  Key,
  ArrowRight,
  Settings,
  Plus,
  LayoutDashboard,
} from "lucide-react";
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

  const handleImapSmtpClick = () => {
    if (imapAccounts.length > 0) {
      // If multiple accounts, show selection
      if (imapAccounts.length > 1) {
        navigate("/email-integration/select");
      } else {
        // Single IMAP account, go directly
        navigate(`/emails/${imapAccounts[0].id}`);
      }
    } else {
      navigate("/email-integration/imap-smtp/connect");
    }
  };

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

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  const hasAnyConnection = imapAccounts.length > 0;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Email Account Integration</h1>
            <p className="text-muted-foreground mt-2">
              Connect and manage your email accounts
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2"
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Button>
        </div>
      </div>

      {!hasAnyConnection && (
        <Card className="mb-6 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Mail className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-semibold mb-2">No email accounts connected</p>
            <p className="text-sm text-muted-foreground text-center">
              Click on a connection option below to get started
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-1">
        {/* IMAP/SMTP Card */}
        <Card 
          className={`cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] h-full flex flex-col ${
            imapAccounts.length > 0 ? 'border-green-500 bg-green-500/5' : 'hover:border-primary'
          }`}
          onClick={handleImapSmtpClick}
        >
          <CardHeader className="flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  imapAccounts.length > 0 ? 'bg-green-500/10' : 'bg-muted'
                }`}>
                  <Key className={`h-5 w-5 ${
                    imapAccounts.length > 0 ? 'text-green-500' : 'text-muted-foreground'
                  }`} />
                </div>
                <div>
                  <CardTitle>IMAP/SMTP</CardTitle>
                  <CardDescription>
                    Connect any email provider via IMAP/SMTP
                  </CardDescription>
                </div>
              </div>
              {imapAccounts.length > 0 ? (
                <CheckCircle2 className="h-6 w-6 text-green-500 flex-shrink-0" />
              ) : (
                <XCircle className="h-6 w-6 text-muted-foreground flex-shrink-0" />
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status:</span>
                <span className={imapAccounts.length > 0 ? "text-green-500 font-medium" : "text-muted-foreground"}>
                  {imapAccounts.length > 0 ? `Connected (${imapAccounts.length})` : "Not Connected"}
                </span>
              </div>
              {imapAccounts.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1 min-h-[20px]">
                  {imapAccounts.map(acc => (
                    <div key={acc.id} className="flex items-center justify-between group">
                      <span className="truncate flex-1">{acc.email}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => handleDisconnectClick(e, { id: acc.id, email: acc.email, type: 'imap' })}
                        disabled={disconnectingAccount === acc.id}
                      >
                        {disconnectingAccount === acc.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3 text-destructive" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="w-full mt-4 space-y-2">
              <Button 
                className="w-full" 
                variant={imapAccounts.length > 0 ? "outline" : "default"}
                onClick={(e) => {
                  e.stopPropagation();
                  handleImapSmtpClick();
                }}
              >
                {imapAccounts.length > 0 ? (
                  <>
                    <Settings className="mr-2 h-4 w-4" />
                    Open Inbox
                  </>
                ) : (
                  <>
                    <Key className="mr-2 h-4 w-4" />
                    Connect IMAP/SMTP
                  </>
                )}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              {hasAnyConnection && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate("/email-integration/imap-smtp/connect");
                  }}
                >
                  <Plus className="mr-2 h-3 w-3" />
                  Add Another IMAP/SMTP Account
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Connected Accounts Management Section */}
      {hasAnyConnection && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Connected Accounts</CardTitle>
            <CardDescription>
              Manage your connected email accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Gmail OAuth removed - using IMAP/SMTP only */}

              {/* IMAP/SMTP Accounts */}
              {imapAccounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Key className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">{account.email}</p>
                      <p className="text-sm text-muted-foreground">
                        {account.provider || 'IMAP/SMTP'} • {account.imap_host || 'Not configured'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/emails/${account.id}`)}
                    >
                      Open
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => handleDisconnectClick(e, { id: account.id, email: account.email, type: 'imap' })}
                      disabled={disconnectingAccount === account.id}
                    >
                      {disconnectingAccount === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
  );
};

export default EmailAccountIntegration;

