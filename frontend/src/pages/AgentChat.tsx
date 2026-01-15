import { AppLayout } from "@/components/layout/AppLayout";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { MessageCircle } from "lucide-react";

const AgentChat = () => {
  const headerContent = (
    <div className="flex items-center gap-2">
      <MessageCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Agent Chat</h1>
    </div>
  );

  return (
    <AppLayout headerContent={headerContent}>
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        <div className="flex-1 min-h-0">
          <ChatInterface />
        </div>
      </div>
    </AppLayout>
  );
};

export default AgentChat;
