import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { 
  MessageSquare, 
  LayoutDashboard, 
  Plus, 
  Calendar as CalendarIcon, 
  Settings, 
  Home, 
  Key, 
  Menu, 
  X, 
  MessageCircle,
  Sparkles 
} from "lucide-react";
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
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        w-64 bg-[#0a0a0a] border-r border-white/5 flex flex-col fixed h-screen z-50
        transform transition-transform duration-300 ease-in-out
        lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold text-white">
                PA Agent
              </span>
              <p className="text-[10px] text-gray-500 -mt-0.5">AI Powered Assistant</p>
            </div>
          </div>
        </div>
        
        <nav className="flex-1 p-3 space-y-1">
          <NavButton
            icon={<LayoutDashboard className="h-4 w-4" />}
            label="Dashboard"
            active={isActive("/dashboard")}
            onClick={() => navigate("/dashboard")}
          />
          <NavButton
            icon={<MessageCircle className="h-4 w-4" />}
            label="Agent Chat"
            active={isActive("/agent-chat")}
            onClick={() => navigate("/agent-chat")}
          />
          <NavButton
            icon={<Plus className="h-4 w-4" />}
            label="Create Agent"
            active={isActive("/create-agent")}
            onClick={() => navigate("/create-agent")}
          />
          <NavButton
            icon={<CalendarIcon className="h-4 w-4" />}
            label="Calendar"
            active={isActive("/calendar")}
            onClick={() => navigate("/calendar")}
          />
          <NavButton
            icon={<Key className="h-4 w-4" />}
            label="Email Integration"
            active={isActive("/email-integration")}
            onClick={() => navigate("/email-integration")}
          />
          
          <div className="pt-4 pb-2">
            <p className="px-3 text-[10px] uppercase tracking-wider text-gray-600 font-medium">
              Settings
            </p>
          </div>
          
          <NavButton
            icon={<Settings className="h-4 w-4" />}
            label="Profile Settings"
            active={isActive("/profile")}
            onClick={() => navigate("/profile")}
          />
          <NavButton
            icon={<Home className="h-4 w-4" />}
            label="Back to Home"
            active={false}
            onClick={() => navigate("/")}
          />
        </nav>

        <div className="p-4 border-t border-white/5">
          <ProfileAvatarMenu />
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 lg:ml-64 w-full flex flex-col h-screen">
        {/* Top Bar - Mobile Only */}
        <header className="shrink-0 lg:hidden border-b border-white/5 bg-black/80 backdrop-blur-xl">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-400 hover:text-white hover:bg-white/5"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                {sidebarOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <span className="font-semibold text-white">Agent Chat</span>
              </div>
              <div className="w-10" /> {/* Spacer for alignment */}
            </div>
          </div>
        </header>

        {/* Chat Interface - Full Height */}
        <div className="flex-1 min-h-0">
          <ChatInterface />
        </div>
      </div>
    </div>
  );
};

// Navigation Button Component
interface NavButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({ icon, label, active, onClick }) => (
  <Button
    variant="ghost"
    className={`
      w-full justify-start gap-3 h-10 px-3 text-sm font-medium
      transition-all duration-200
      ${active 
        ? "bg-violet-500/10 text-violet-400 border-l-2 border-violet-500 rounded-l-none" 
        : "text-gray-400 hover:text-white hover:bg-white/5"
      }
    `}
    onClick={onClick}
  >
    {icon}
    {label}
  </Button>
);

export default AgentChat;
