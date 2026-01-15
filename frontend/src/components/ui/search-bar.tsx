import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onClear?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  onClear,
  disabled = false,
  'aria-label': ariaLabel = 'Search',
}: SearchBarProps) {
  const handleClear = () => {
    onChange('');
    onClear?.();
  };

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'pl-9 pr-9',
          value && 'pr-9'
        )}
        aria-label={ariaLabel}
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={handleClear}
          aria-label="Clear search"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Clear search</span>
        </Button>
      )}
    </div>
  );
}
