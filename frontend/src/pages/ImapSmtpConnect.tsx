import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  Key,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Info,
  Plus,
  Mail,
  ArrowRight,
} from "lucide-react";
import {
  connectImapSmtpAccount,
  detectProviderSettings,
  type ProviderSettings,
} from "@/lib/imapSmtpApi";

const ImapSmtpConnect = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [useSsl, setUseSsl] = useState(true);
  const [useTls, setUseTls] = useState(true);
  const [autoDetect, setAutoDetect] = useState(true);
  const [detectedSettings, setDetectedSettings] = useState<ProviderSettings | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectedAccount, setConnectedAccount] = useState<any>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleEmailChange = async (newEmail: string) => {
    setEmail(newEmail);
    if (autoDetect && newEmail.includes("@")) {
      setDetecting(true);
      try {
        const settings = await detectProviderSettings(newEmail);
        if (settings) {
          setDetectedSettings(settings);
          setImapHost(settings.imap.host);
          setImapPort(settings.imap.port);
          setSmtpHost(settings.smtp.host);
          setSmtpPort(settings.smtp.port);
          setUseSsl(settings.imap.ssl);
          setUseTls(settings.smtp.tls);
        } else {
          setDetectedSettings(null);
        }
      } catch (error) {
        console.error("Error detecting settings:", error);
      } finally {
        setDetecting(false);
      }
    }
  };

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setImapHost("");
    setImapPort(993);
    setSmtpHost("");
    setSmtpPort(587);
    setUseSsl(true);
    setUseTls(true);
    setDetectedSettings(null);
    setShowSuccess(false);
    setConnectedAccount(null);
  };

  const handleConnectAnother = () => {
    resetForm();
  };

  const handleGoToInbox = () => {
    if (connectedAccount?.id) {
      navigate(`/emails/${connectedAccount.id}`);
    } else {
      navigate("/email-integration/select");
    }
  };

  const handleGoToIntegration = () => {
    navigate("/email-integration");
  };

  const handleConnect = async () => {
    if (!email || !password) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Email and password are required",
      });
      return;
    }

    if (!imapHost || !smtpHost) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "IMAP and SMTP hosts are required",
      });
      return;
    }

    try {
      setConnecting(true);
      const result = await connectImapSmtpAccount({
        email,
        imapHost,
        imapPort,
        smtpHost,
        smtpPort,
        imapPassword: password,
        smtpPassword: password,
        useSsl,
        useTls,
        autoDetect,
      });

      if (result.success) {
        setConnectedAccount(result.account);
        setShowSuccess(true);
        toast({
          title: "Success",
          description: "Email account connected successfully",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: result.error || "Failed to connect account",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to connect account",
      });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Button
        variant="ghost"
        onClick={() => navigate("/email-integration")}
        className="mb-6"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Key className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>Connect IMAP/SMTP Account</CardTitle>
              <CardDescription>
                Connect any email provider via IMAP/SMTP
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showSuccess && connectedAccount && (
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-green-900 dark:text-green-100 mb-1">
                    Account Connected Successfully!
                  </h3>
                  <p className="text-sm text-green-700 dark:text-green-300 mb-4">
                    {connectedAccount.email} has been connected successfully.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleConnectAnother}
                      variant="outline"
                      size="sm"
                      className="border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Connect Another Account
                    </Button>
                    <Button
                      onClick={handleGoToInbox}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Go to Inbox
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    <Button
                      onClick={handleGoToIntegration}
                      variant="ghost"
                      size="sm"
                    >
                      Back to Integration
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!showSuccess && (
            <>
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <div className="flex gap-2">
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
              />
              {detecting && <Loader2 className="h-4 w-4 animate-spin mt-2" />}
            </div>
            {detectedSettings && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Auto-detected settings for {email.split("@")[1]}
                  {detectedSettings.note && (
                    <span className="block mt-1 text-xs">{detectedSettings.note}</span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password / App Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter password or app password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              For Gmail, use App Password. For Outlook/Yahoo, use your account password or
              App Password if 2FA is enabled.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="imapHost">IMAP Host</Label>
              <Input
                id="imapHost"
                placeholder="imap.gmail.com"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="imapPort">IMAP Port</Label>
              <Input
                id="imapPort"
                type="number"
                value={imapPort}
                onChange={(e) => setImapPort(parseInt(e.target.value) || 993)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="smtpHost">SMTP Host</Label>
              <Input
                id="smtpHost"
                placeholder="smtp.gmail.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpPort">SMTP Port</Label>
              <Input
                id="smtpPort"
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="useSsl"
              checked={useSsl}
              onChange={(e) => setUseSsl(e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="useSsl" className="cursor-pointer">
              Use SSL for IMAP
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="useTls"
              checked={useTls}
              onChange={(e) => setUseTls(e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="useTls" className="cursor-pointer">
              Use TLS for SMTP
            </Label>
          </div>

          <div className="pt-4">
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full"
              size="lg"
            >
              {connecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Key className="mr-2 h-4 w-4" />
                  Connect Account
                </>
              )}
            </Button>
          </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ImapSmtpConnect;

