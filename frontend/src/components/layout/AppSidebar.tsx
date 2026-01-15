import { useLocation } from 'react-router-dom';
import { NavButton } from './NavButton';
import { 
  LayoutDashboard, 
  MessageCircle, 
  Plus,
  Calendar as CalendarIcon,
  Settings,
  Home,
  Key,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ProfileAvatarMenu from '@/components/ProfileAvatarMenu';
import { ariaLabels } from '@/lib/accessibility';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  ariaLabel: string;
}

const navItems: NavItem[] = [
  { 
    to: '/dashboard', 
    icon: LayoutDashboard, 
    label: 'Dashboard',
    ariaLabel: 'Go to dashboard'
  },
  { 
    to: '/agent-chat', 
    icon: MessageCircle, 
    label: 'Agent Chat',
    ariaLabel: 'Go to agent chat'
  },
  { 
    to: '/create-agent', 
    icon: Plus, 
    label: 'Create Agent',
    ariaLabel: 'Create new agent'
  },
  { 
    to: '/calendar', 
    icon: CalendarIcon, 
    label: 'Calendar',
    ariaLabel: 'Go to calendar'
  },
  { 
    to: '/email-integration', 
    icon: Key, 
    label: 'Email Integration',
    ariaLabel: 'Email integration settings'
  },
];

const settingsItems: NavItem[] = [
  { 
    to: '/profile', 
    icon: Settings, 
    label: 'Profile Settings',
    ariaLabel: 'Application settings'
  },
  { 
    to: '/', 
    icon: Home, 
    label: 'Back to Home',
    ariaLabel: 'Go to home page'
  },
];

interface AppSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AppSidebar({ isOpen, onClose }: AppSidebarProps) {
  const location = useLocation();
  
  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50",
          "w-64 bg-[#0a0a0a] border-r border-white/5 flex flex-col h-screen",
          "transform transition-transform duration-300 ease-in-out",
          "lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label={ariaLabels.navigation.mainMenu}
      >
        <div className="p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <span className="text-lg font-bold text-white">
                PA Agent
              </span>
              <p className="text-[10px] text-gray-500 -mt-0.5">AI Powered Assistant</p>
            </div>
          </div>
        </div>
        
        <nav className="flex-1 p-3 space-y-1" aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavButton
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              ariaLabel={item.ariaLabel}
              onClick={onClose}
            />
          ))}
        </nav>
        
        <div className="pt-4 pb-2 px-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">
            Settings
          </p>
        </div>
        
        <nav className="p-3 space-y-1" aria-label="Secondary navigation">
          {settingsItems.map((item) => (
            <NavButton
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              ariaLabel={item.ariaLabel}
              onClick={onClose}
            />
          ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          <ProfileAvatarMenu />
        </div>
      </aside>
    </>
  );
}
