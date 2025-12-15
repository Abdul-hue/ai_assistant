import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import { AuthProvider } from "./context/AuthContext.jsx";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import AgentChat from "./pages/AgentChat";
import CreateAgent from "./pages/CreateAgent";
import Calendar from "./pages/Calendar";
import ProfileSettings from "./pages/ProfileSettings";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";
// Email Integration - IMAP/SMTP
import EmailAccountIntegration from "./pages/EmailAccountIntegration";
import EmailAccountSelection from "./pages/EmailAccountSelection";
import ImapSmtpConnect from "./pages/ImapSmtpConnect";
import UnifiedEmailInbox from "./pages/UnifiedEmailInbox";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/agent-chat" element={<AgentChat />} />
            <Route path="/create-agent" element={<CreateAgent />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/profile" element={<ProfileSettings />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            {/* Email Account Integration - IMAP/SMTP */}
            <Route path="/email-integration" element={<EmailAccountIntegration />} />
            <Route path="/email-integration/select" element={<EmailAccountSelection />} />
            <Route path="/email-integration/imap-smtp/connect" element={<ImapSmtpConnect />} />
            <Route path="/emails/:accountId" element={<UnifiedEmailInbox />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
