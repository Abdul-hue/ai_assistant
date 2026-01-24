import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ImportantStarProps {
  isImportant: boolean;
  onToggle: (value: boolean) => void | Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ImportantStar({
  isImportant,
  onToggle,
  disabled = false,
  size = 'md',
  className,
}: ImportantStarProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    await onToggle(!isImportant);
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      await onToggle(!isImportant);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-auto w-auto p-0 hover:bg-transparent focus-visible:ring-0',
              className
            )}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            aria-label={isImportant ? 'Remove from important' : 'Mark as important'}
            aria-pressed={isImportant}
            tabIndex={0}
          >
            <Star
              className={cn(
                sizeClasses[size],
                'transition-all',
                isImportant
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'fill-none text-muted-foreground hover:text-yellow-400'
              )}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isImportant ? 'Remove from important' : 'Mark as important'}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
