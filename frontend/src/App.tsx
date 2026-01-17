import { lazy, Suspense, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageLoadingSpinner } from "@/components/loading/PageLoadingSpinner";
import { AuthProvider } from "./context/AuthContext";
import { CommandPalette } from "@/components/CommandPalette";

// Public pages - eager loaded (small, frequently used)
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

// Protected routes - lazy loaded
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AgentChat = lazy(() => import("./pages/AgentChat"));
const CreateAgent = lazy(() => import("./pages/CreateAgent"));
const Calendar = lazy(() => import("./pages/Calendar"));
const ProfileSettings = lazy(() => import("./pages/ProfileSettings"));
const MonitoringDashboard = lazy(() => import("./pages/MonitoringDashboard"));

// Email Integration - IMAP/SMTP - lazy loaded
const EmailAccountIntegration = lazy(() => import("./pages/EmailAccountIntegration"));
const EmailAccountSelection = lazy(() => import("./pages/EmailAccountSelection"));
const ImapSmtpConnect = lazy(() => import("./pages/ImapSmtpConnect"));
const UnifiedEmailInbox = lazy(() => import("./pages/UnifiedEmailInbox"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner richColors />
          <AuthProvider>
            <BrowserRouter
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true,
              }}
            >
              <ErrorBoundary>
                <Suspense fallback={<PageLoadingSpinner />}>
                  <Routes>
                    {/* Public routes - eager loaded */}
                    <Route path="/" element={<Index />} />
                    <Route path="/auth" element={<Auth />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
                    
                    {/* Protected routes - lazy loaded */}
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/agent-chat" element={<AgentChat />} />
                    <Route path="/create-agent" element={<CreateAgent />} />
                    <Route path="/calendar" element={<Calendar />} />
                    <Route path="/profile" element={<ProfileSettings />} />
                    <Route path="/monitoring" element={<MonitoringDashboard />} />
                    
                    {/* Email Account Integration - IMAP/SMTP - lazy loaded */}
                    <Route path="/email-integration" element={<EmailAccountIntegration />} />
                    <Route path="/email-integration/select" element={<EmailAccountSelection />} />
                    <Route path="/email-integration/imap-smtp/connect" element={<ImapSmtpConnect />} />
                    <Route path="/emails/:accountId" element={<UnifiedEmailInbox />} />
                    
                    {/* Catch-all */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
              <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
            </BrowserRouter>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
