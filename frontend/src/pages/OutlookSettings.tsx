import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Settings,
  Mail,
  ArrowLeft,
  Inbox,
  Send,
  Plus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

const OutlookSettings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    toast({
      title: "Coming Soon",
      description: "Outlook integration is coming soon.",
    });
  }, [toast]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                onClick={() => navigate("/outlook/inbox")}
                variant="ghost"
                size="icon"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Settings className="h-6 w-6" />
                Outlook Settings
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
                onClick={() => navigate("/outlook/inbox")}
                variant="outline"
                size="sm"
              >
                <Inbox className="h-4 w-4" />
                Inbox
              </Button>
              <Button
                onClick={() => navigate("/outlook/sent")}
                variant="outline"
                size="sm"
              >
                <Send className="h-4 w-4" />
                Sent
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Outlook Connection</CardTitle>
            <CardDescription>
              Outlook integration is coming soon
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-4">
                <Mail className="h-8 w-8 text-gray-400" />
                <div>
                  <p className="font-semibold">Outlook Account</p>
                  <p className="text-sm text-gray-500">
                    Integration coming soon
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-semibold mb-2">Coming Soon</h3>
              <p className="text-sm text-gray-600">
                Outlook integration is currently under development. For now, please use the Gmail integration.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OutlookSettings;

