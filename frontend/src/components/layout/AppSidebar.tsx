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
          "w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col h-screen",
          "transform transition-transform duration-300 ease-in-out",
          "lg:translate-x-0 animate-slide-in-left",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label={ariaLabels.navigation.mainMenu}
      >
        <div className="p-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-whatsapp-green-primary to-whatsapp-teal flex items-center justify-center shadow-lg animate-scale-in">
              <Sparkles className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <span className="text-xl font-bold text-sidebar-foreground">
                PA Agent
              </span>
              <p className="text-xs text-sidebar-foreground -mt-0.5">AI Powered Assistant</p>
            </div>
          </div>
        </div>
        
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Primary navigation">
          {navItems.map((item, index) => (
            <div key={item.to} className="stagger-item animate-fade-in-up" style={{ animationDelay: `${index * 0.1}s` }}>
              <NavButton
                to={item.to}
                icon={item.icon}
                label={item.label}
                ariaLabel={item.ariaLabel}
                onClick={onClose}
              />
            </div>
          ))}
        </nav>
        
        <div className="pt-4 pb-2 px-3">
          <p className="text-xs uppercase tracking-wider text-sidebar-foreground font-semibold">
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

        <div className="p-4 border-t border-sidebar-border">
          <ProfileAvatarMenu />
        </div>
      </aside>
    </>
  );
}
