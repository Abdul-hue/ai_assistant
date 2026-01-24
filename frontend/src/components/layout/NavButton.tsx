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
        "flex items-center gap-3 px-4 py-3 rounded-lg h-12 text-base font-semibold",
        "transition-all duration-200",
        isActive
          ? "bg-primary/20 text-white border-l-4 border-primary rounded-l-none shadow-sm"
          : "text-sidebar-foreground hover:text-white hover:bg-white/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
});
