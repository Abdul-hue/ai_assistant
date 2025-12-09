import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Key,
  Settings,
  Trash2,
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

interface EmailAccount {
  id: string;
  email: string;
  provider: string;
  type: 'imap';
  isActive: boolean;
}

const EmailAccountSelection = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnectingAccount, setDisconnectingAccount] = useState<string | null>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [accountToDisconnect, setAccountToDisconnect] = useState<EmailAccount | null>(null);

  useEffect(() => {
    loadAllAccounts();
  }, []);

  const loadAllAccounts = async () => {
    try {
      setLoading(true);
      const allAccounts: EmailAccount[] = [];

      // Get IMAP/SMTP accounts (Gmail OAuth removed)
      try {
        const imapAccounts = await getImapSmtpAccounts();
        imapAccounts
          .filter(acc => acc.is_active)
          .forEach(acc => {
            allAccounts.push({
              id: acc.id,
              email: acc.email,
              provider: acc.provider || 'custom',
              type: 'imap',
              isActive: acc.is_active,
            });
          });
      } catch (error) {
        console.error("Error loading IMAP accounts:", error);
      }

      setAccounts(allAccounts);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load email accounts",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAccountClick = (account: EmailAccount) => {
    navigate(`/emails/${account.id}`);
  };

  const handleDisconnectClick = (e: React.MouseEvent, account: EmailAccount) => {
    e.stopPropagation();
    setAccountToDisconnect(account);
    setDisconnectDialogOpen(true);
  };

  const handleConfirmDisconnect = async () => {
    if (!accountToDisconnect) return;

    try {
      setDisconnectingAccount(accountToDisconnect.id);
      
      await disconnectImapSmtpAccount(accountToDisconnect.id);

      toast({
        title: "Success",
        description: `${accountToDisconnect.email} has been disconnected`,
      });

      // Reload accounts
      await loadAllAccounts();
      
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

  const getProviderIcon = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'outlook':
      case 'office365':
        return <Mail className="h-5 w-5" />;
      case 'yahoo':
        return <Mail className="h-5 w-5" />;
      default:
        return <Key className="h-5 w-5" />;
    }
  };

  const getProviderName = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'outlook':
      case 'office365':
        return 'Outlook';
      case 'yahoo':
        return 'Yahoo';
      default:
        return 'IMAP/SMTP';
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

  if (accounts.length === 0) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Select Email Account</h1>
          <p className="text-muted-foreground mt-2">
            Choose which email account to open
          </p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Mail className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-semibold mb-2">No email accounts connected</p>
            <p className="text-sm text-muted-foreground text-center mb-4">
              Connect an email account first to get started
            </p>
            <Button onClick={() => navigate("/email-integration")}>
              Go to Email Integration
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate("/email-integration")}
          className="mb-4"
        >
          ← Back to Email Integration
        </Button>
        <h1 className="text-3xl font-bold">Select Email Account</h1>
        <p className="text-muted-foreground mt-2">
          Choose which email account you want to open
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => (
          <Card
            key={account.id}
            className="cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] h-full flex flex-col border-green-500/20 hover:border-green-500"
            onClick={() => handleAccountClick(account)}
          >
            <CardHeader className="flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    {getProviderIcon(account.provider)}
                  </div>
                  <div>
                    <CardTitle className="text-base">
                      {getProviderName(account.provider)}
                    </CardTitle>
                    <CardDescription className="text-xs truncate max-w-[150px]">
                      {account.email}
                    </CardDescription>
                  </div>
                </div>
                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Type:</span>
                  <span className="font-medium">
                    IMAP/SMTP
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="text-green-500 font-medium">Connected</span>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAccountClick(account);
                  }}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Open Inbox
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={(e) => handleDisconnectClick(e, account)}
                  disabled={disconnectingAccount === account.id}
                  className="flex-shrink-0"
                >
                  {disconnectingAccount === account.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-destructive" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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

export default EmailAccountSelection;

