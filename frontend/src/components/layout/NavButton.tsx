import { memo } from 'react';
import { NavLink } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavButtonProps {
  to: string;
  icon: LucideIcon;
  label: string;
  ariaLabel?: string;
  onClick?: () => void;
}

export const NavButton = memo(function NavButton({ 
  to, 
  icon: Icon, 
  label, 
  ariaLabel,
  onClick 
}: NavButtonProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      aria-label={ariaLabel || label}
      className={({ isActive }) => cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg h-10 text-sm font-medium",
        "transition-all duration-200",
        isActive
          ? "bg-violet-500/10 text-violet-400 border-l-2 border-violet-500 rounded-l-none"
          : "text-gray-400 hover:text-white hover:bg-white/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
});
