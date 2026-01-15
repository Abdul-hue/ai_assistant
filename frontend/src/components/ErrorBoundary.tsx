import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    
    // Call optional error handler
    this.props.onError?.(error, errorInfo);
    
    // TODO: Log to error reporting service (e.g., Sentry)
    // logErrorToService(error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardHeader>
              <div className="flex flex-col items-center text-center space-y-4">
                <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden="true" />
                <CardTitle className="text-2xl">Something went wrong</CardTitle>
                <CardDescription>
                  We're sorry, but something unexpected happened. Please try again.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="w-full text-left">
                  <summary className="cursor-pointer font-semibold mb-2">
                    Error details
                  </summary>
                  <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-48">
                    {this.state.error.toString()}
                    {this.state.error.stack && (
                      <div className="mt-2 text-xs opacity-75">
                        {this.state.error.stack}
                      </div>
                    )}
                  </pre>
                </details>
              )}

              <div className="flex gap-4 w-full">
                <Button
                  onClick={this.handleReset}
                  className="flex-1"
                  aria-label="Try again"
                >
                  Try Again
                </Button>
                <Button
                  onClick={() => window.location.href = '/'}
                  variant="outline"
                  className="flex-1"
                  aria-label="Go to home page"
                >
                  Go Home
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
