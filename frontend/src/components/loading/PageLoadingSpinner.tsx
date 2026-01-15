import { Loader2 } from 'lucide-react';

export function PageLoadingSpinner() {
  return (
    <div 
      className="min-h-screen flex items-center justify-center bg-background"
      role="status"
      aria-live="polite"
      aria-label="Loading page content"
    >
      <div className="flex flex-col items-center gap-4">
        <Loader2 
          className="h-8 w-8 animate-spin text-primary" 
          aria-hidden="true" 
        />
        <p className="text-sm text-muted-foreground">
          Loading...
        </p>
      </div>
    </div>
  );
}
