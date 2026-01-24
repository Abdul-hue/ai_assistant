import { useState, ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { Breadcrumbs } from './Breadcrumbs';
import { Button } from '@/components/ui/button';
import { Menu, X } from 'lucide-react';
import { ariaLabels } from '@/lib/accessibility';
import { ThemeToggle } from '@/components/ThemeToggle';

interface AppLayoutProps {
  children: ReactNode;
  headerContent?: ReactNode;
}

export function AppLayout({ children, headerContent }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex animate-fade-in">
      <AppSidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
      />
      
      {/* Main content wrapper - flex-1 to fill remaining space, min-w-0 to prevent overflow */}
      <div className="flex-1 min-w-0 flex flex-col bg-background">
        {/* Desktop Header */}
        {headerContent && (
          <header 
            className="hidden lg:block sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl shadow-soft animate-fade-in-down"
            role="banner"
          >
            <div className="px-4 sm:px-6 py-4 flex items-center justify-between">
              <div className="flex-1">{headerContent}</div>
              <ThemeToggle />
            </div>
          </header>
        )}

        {/* Mobile header */}
        <header 
          className="lg:hidden sticky top-0 z-30 border-b border-border bg-sidebar backdrop-blur-xl shadow-soft"
          role="banner"
        >
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-label={sidebarOpen ? ariaLabels.navigation.closeMenu : ariaLabels.navigation.toggleMenu}
                aria-expanded={sidebarOpen}
                className="text-sidebar-foreground hover:bg-white/10"
              >
                {sidebarOpen ? (
                  <X className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Menu className="h-5 w-5" aria-hidden="true" />
                )}
              </Button>
              
              {headerContent || (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sidebar-foreground">PA Agent</span>
                </div>
              )}
              
              <ThemeToggle />
            </div>
          </div>
        </header>
        
        {/* Main content */}
        <main 
          id="main-content" 
          role="main"
          className="flex-1 overflow-auto bg-background"
          tabIndex={-1}
        >
          <a 
            href="#main-content" 
            className="skip-link sr-only sr-only-focusable"
          >
            Skip to main content
          </a>
          <div className="px-4 sm:px-6 py-4">
            <Breadcrumbs />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
