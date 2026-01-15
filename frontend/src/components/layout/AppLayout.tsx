import { useState, ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { Breadcrumbs } from './Breadcrumbs';
import { Button } from '@/components/ui/button';
import { Menu, X } from 'lucide-react';
import { ariaLabels } from '@/lib/accessibility';

interface AppLayoutProps {
  children: ReactNode;
  headerContent?: ReactNode;
}

export function AppLayout({ children, headerContent }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex">
      <AppSidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
      />
      
      <div className="flex-1 lg:ml-64 w-full flex flex-col bg-gray-50 dark:bg-gray-900">
        {/* Desktop Header */}
        {headerContent && (
          <header 
            className="hidden lg:block sticky top-0 z-30 border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-xl"
            role="banner"
          >
            <div className="pl-0 pr-4 sm:pr-6 py-4">
              {headerContent}
            </div>
          </header>
        )}

        {/* Mobile header */}
        <header 
          className="lg:hidden sticky top-0 z-30 border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-xl"
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
                className="text-gray-400 hover:text-white hover:bg-white/10"
              >
                {sidebarOpen ? (
                  <X className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Menu className="h-5 w-5" aria-hidden="true" />
                )}
              </Button>
              
              {headerContent || (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">PA Agent</span>
                </div>
              )}
              
              <div className="w-10" /> {/* Spacer for alignment */}
            </div>
          </div>
        </header>
        
        {/* Main content */}
        <main 
          id="main-content" 
          role="main"
          className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900"
          tabIndex={-1}
        >
          <a 
            href="#main-content" 
            className="skip-link sr-only sr-only-focusable"
          >
            Skip to main content
          </a>
          <div className="pl-0 pr-4 sm:pr-6 py-4">
            <Breadcrumbs />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
