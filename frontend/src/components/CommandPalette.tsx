import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  LayoutDashboard,
  MessageCircle,
  Plus,
  Calendar as CalendarIcon,
  Settings,
  User,
  Key,
  Mail,
  Users,
  Search,
  Home,
  Sparkles,
} from 'lucide-react';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const handleSelect = (path: string) => {
    navigate(path);
    onOpenChange(false);
    setSearch('');
  };

  const navigationItems = [
    {
      title: 'Dashboard',
      icon: LayoutDashboard,
      shortcut: '⌘D',
      path: '/dashboard',
    },
    {
      title: 'Agent Chat',
      icon: MessageCircle,
      shortcut: '⌘C',
      path: '/agent-chat',
    },
    {
      title: 'Create Agent',
      icon: Plus,
      shortcut: '⌘N',
      path: '/create-agent',
    },
    {
      title: 'Calendar',
      icon: CalendarIcon,
      shortcut: '⌘K',
      path: '/calendar',
    },
    {
      title: 'Email Integration',
      icon: Key,
      shortcut: '⌘E',
      path: '/email-integration',
    },
    {
      title: 'Contacts',
      icon: Users,
      shortcut: '⌘O',
      path: '/contacts',
    },
    {
      title: 'Profile Settings',
      icon: User,
      shortcut: '⌘P',
      path: '/profile',
    },
    {
      title: 'Settings',
      icon: Settings,
      shortcut: '⌘,',
      path: '/settings',
    },
  ];

  const filteredItems = navigationItems.filter((item) =>
    item.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command or search..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {filteredItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.path}
                onSelect={() => handleSelect(item.path)}
                value={item.title}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.title}</span>
                <CommandShortcut>{item.shortcut}</CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Quick Actions">
          <CommandItem
            onSelect={() => {
              handleSelect('/create-agent');
            }}
            value="create-agent"
          >
            <Plus className="mr-2 h-4 w-4" />
            <span>Create New Agent</span>
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              handleSelect('/dashboard');
            }}
            value="home"
          >
            <Home className="mr-2 h-4 w-4" />
            <span>Go to Home</span>
            <CommandShortcut>⌘H</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
