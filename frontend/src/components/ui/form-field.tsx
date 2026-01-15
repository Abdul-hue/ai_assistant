import { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  helperText?: string;
  children: (props: {
    id: string;
    'aria-required'?: boolean;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }) => ReactNode;
  className?: string;
}

export function FormField({
  id,
  label,
  error,
  required = false,
  helperText,
  children,
  className,
}: FormFieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  const helperId = helperText ? `${id}-helper` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span 
            className="text-destructive ml-1" 
            aria-label="required"
          >
            *
          </span>
        )}
      </Label>

      {children({
        id,
        'aria-required': required,
        'aria-invalid': !!error,
        'aria-describedby': describedBy,
      })}

      {helperText && !error && (
        <p
          id={helperId}
          className="text-sm text-muted-foreground"
        >
          {helperText}
        </p>
      )}

      {error && (
        <div
          id={errorId}
          role="alert"
          aria-live="polite"
          className="text-sm text-destructive flex items-start gap-2"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
