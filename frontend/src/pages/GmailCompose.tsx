import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Send,
  ArrowLeft,
  Loader2,
  Inbox,
  Settings,
  Mail,
  X,
  Paperclip,
  Bold,
  Italic,
  Underline,
  Link,
  LayoutDashboard,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sendGmailEmail } from "@/lib/gmailApi";
import { isGmailConnected } from "@/lib/gmailAuth";

const GmailCompose = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const isConnected = await isGmailConnected();
      setConnected(isConnected);
      if (!isConnected) {
        navigate("/gmail/inbox");
      }
    } catch (error) {
      console.error("Connection check error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!to || !subject || !body) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please fill in all fields",
      });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      toast({
        variant: "destructive",
        title: "Invalid Email",
        description: "Please enter a valid email address",
      });
      return;
    }

    try {
      setSending(true);
      await sendGmailEmail(to, subject, body, body);
      toast({
        title: "Email Sent",
        description: "Your email has been sent successfully.",
      });
      // Reset form
      setTo("");
      setSubject("");
      setBody("");
      // Navigate to sent folder
      setTimeout(() => {
        navigate("/gmail/sent");
      }, 1000);
    } catch (error: any) {
      console.error("Send email error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to send email",
      });
    } finally {
      setSending(false);
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
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                onClick={() => navigate("/gmail/inbox")}
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-gray-400 hover:text-white hover:bg-gray-800"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-lg font-semibold text-white">New Message</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => navigate("/dashboard")}
                variant="ghost"
                size="sm"
                className="rounded-full text-gray-400 hover:text-white hover:bg-gray-800"
              >
                <LayoutDashboard className="h-4 w-4 mr-2" />
                Dashboard
              </Button>
              <Button
                onClick={() => navigate("/gmail/inbox")}
                variant="ghost"
                size="sm"
                className="rounded-full text-gray-400 hover:text-white hover:bg-gray-800"
              >
                <Inbox className="h-4 w-4 mr-2" />
                Inbox
              </Button>
              <Button
                onClick={() => navigate("/gmail/settings")}
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-gray-400 hover:text-white hover:bg-gray-800"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card className="shadow-lg border-gray-800 bg-gray-900">
          <CardContent className="p-0">
            {/* Compose Header */}
            <div className="border-b border-gray-800 px-6 py-3 bg-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-300">New Message</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-700"
                  onClick={() => navigate("/gmail/inbox")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Compose Form */}
            <div className="p-6 space-y-4">
              <div>
                <div className="flex items-center border-b border-gray-700 pb-2">
                  <Label htmlFor="to" className="w-20 text-sm font-medium text-gray-400">
                    To
                  </Label>
                  <Input
                    id="to"
                    type="email"
                    placeholder="Recipients"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 text-base bg-transparent text-white placeholder:text-gray-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center border-b border-gray-700 pb-2">
                  <Label htmlFor="subject" className="w-20 text-sm font-medium text-gray-400">
                    Subject
                  </Label>
                  <Input
                    id="subject"
                    placeholder="Subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 text-base bg-transparent text-white placeholder:text-gray-500"
                  />
                </div>
              </div>

              <div className="border-b border-gray-700">
                <div className="flex items-center gap-1 px-2 py-1 bg-gray-800 border-b border-gray-700">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-700">
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-700">
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-700">
                    <Underline className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-700">
                    <Link className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-700">
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </div>
                <textarea
                  id="body"
                  className="w-full min-h-[400px] p-4 border-0 focus-visible:outline-none focus-visible:ring-0 resize-none text-base bg-black text-white placeholder:text-gray-500"
                  placeholder="Compose your message..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between pt-4">
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleSend}
                    disabled={sending || !to || !subject || !body}
                    className="rounded-full px-6 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {sending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Send
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => navigate("/gmail/inbox")}
                    variant="ghost"
                    className="rounded-full text-gray-400 hover:text-white hover:bg-gray-800"
                  >
                    Discard
                  </Button>
                </div>
                <div className="text-xs text-gray-500">
                  Press Ctrl+Enter to send
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default GmailCompose;
