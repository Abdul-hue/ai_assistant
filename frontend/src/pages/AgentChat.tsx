import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageSquare, LayoutDashboard, Plus, Calendar as CalendarIcon, Settings, Home, Key, Menu, X, MessageCircle } from "lucide-react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import ProfileAvatarMenu from "@/components/ProfileAvatarMenu";
import { useAuth } from "@/context/AuthContext";

const AgentChat = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (path: string) => location?.pathname === path;

  return (
    <div className="min-h-screen bg-black flex">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        w-64 bg-[#0a0a0a] border-r border-white/10 flex flex-col fixed h-screen z-50
        transform transition-transform duration-300 ease-in-out
        lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-2 mb-6">
            <MessageSquare className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold gradient-text">
              WhatsApp AI
            </span>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/dashboard") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/dashboard")}
          >
            <LayoutDashboard className="h-5 w-5" />
            Dashboard
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/agent-chat") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/agent-chat")}
          >
            <MessageCircle className="h-5 w-5" />
            Agent Chat
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/create-agent") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/create-agent")}
          >
            <Plus className="h-5 w-5" />
            Create Agent
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/calendar") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/calendar")}
          >
            <CalendarIcon className="h-5 w-5" />
            Calendar
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/email-integration") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/email-integration")}
          >
            <Key className="h-5 w-5" />
            Email Account Integration
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/profile") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/profile")}
          >
            <Settings className="h-5 w-5" />
            Settings
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 text-gray-400"
            onClick={() => navigate("/")}
          >
            <Home className="h-5 w-5" />
            Home
          </Button>
        </nav>

        <div className="p-4 border-t border-white/10">
          <ProfileAvatarMenu />
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 lg:ml-64 w-full">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-black/80 backdrop-blur-xl">
          <div className="px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Mobile Menu Button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="lg:hidden text-gray-400 hover:text-white hover:bg-white/10"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  {sidebarOpen ? (
                    <X className="h-5 w-5" />
                  ) : (
                    <Menu className="h-5 w-5" />
                  )}
                </Button>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-white">
                    Agent Chat
                  </h1>
                  <p className="text-gray-400 text-xs sm:text-sm mt-1 hidden sm:block">
                    Send messages and interact with your AI agents in real-time
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-6">
          <div className="h-[calc(100vh-180px)] sm:h-[calc(100vh-200px)]">
            <ChatInterface />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentChat;

