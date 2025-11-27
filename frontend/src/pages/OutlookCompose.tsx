import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Inbox, Settings, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

const OutlookCompose = () => {
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
              <h1 className="text-2xl font-bold">Compose Email (Outlook)</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => navigate("/outlook/inbox")}
                variant="outline"
                size="sm"
              >
                <Inbox className="h-4 w-4" />
                Inbox
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

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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

export default OutlookCompose;

