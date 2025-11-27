import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const OutlookInbox = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Implement Outlook connection check
    setLoading(false);
    setConnected(false);
    
    if (searchParams.get("connected") === "true") {
      toast({
        title: "Outlook Connected",
        description: "Your Outlook account has been successfully connected.",
      });
    }
    if (searchParams.get("error")) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: searchParams.get("error") || "Failed to connect Outlook",
      });
    }
  }, [searchParams, toast]);

  const handleConnect = async () => {
    toast({
      title: "Coming Soon",
      description: "Outlook integration is coming soon. Please use Gmail for now.",
    });
  };

  if (!connected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center flex items-center justify-center gap-2">
              <Mail className="h-6 w-6" />
              Connect Outlook
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-gray-600">
              Outlook integration is coming soon. For now, please use Gmail integration.
            </p>
            <Button onClick={() => navigate("/gmail/inbox")} className="w-full" size="lg">
              Use Gmail Instead
            </Button>
            <Button
              onClick={() => navigate("/dashboard")}
              variant="outline"
              className="w-full"
            >
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Inbox className="h-6 w-6" />
                Outlook Inbox
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => navigate("/outlook/compose")}
                size="sm"
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Compose
              </Button>
              <Button
                onClick={() => navigate("/outlook/sent")}
                variant="outline"
                size="sm"
              >
                <Send className="h-4 w-4" />
                Sent
              </Button>
              <Button
                onClick={() => navigate("/outlook/settings")}
                variant="outline"
                size="sm"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-gray-500">
            <div className="text-center">
              <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Outlook integration coming soon</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OutlookInbox;

