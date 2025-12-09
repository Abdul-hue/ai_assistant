import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import { AuthProvider } from "./context/AuthContext.jsx";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import CreateAgent from "./pages/CreateAgent";
import Calendar from "./pages/Calendar";
import ProfileSettings from "./pages/ProfileSettings";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";
<<<<<<< HEAD
// Gmail pages
import GmailInbox from "./pages/GmailInbox";
import GmailSent from "./pages/GmailSent";
import GmailCompose from "./pages/GmailCompose";
import GmailSettings from "./pages/GmailSettings";
// Outlook pages
import OutlookInbox from "./pages/OutlookInbox";
import OutlookSent from "./pages/OutlookSent";
import OutlookCompose from "./pages/OutlookCompose";
import OutlookSettings from "./pages/OutlookSettings";
=======
// Email Integration - IMAP/SMTP only
import EmailAccountIntegration from "./pages/EmailAccountIntegration";
import EmailAccountSelection from "./pages/EmailAccountSelection";
import ImapSmtpConnect from "./pages/ImapSmtpConnect";
import UnifiedEmailInbox from "./pages/UnifiedEmailInbox";
>>>>>>> 71f3b5e (push latest changes)

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
            <Route path="/create-agent" element={<CreateAgent />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/profile" element={<ProfileSettings />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
<<<<<<< HEAD
            {/* Gmail Routes */}
            <Route path="/gmail/inbox" element={<GmailInbox />} />
            <Route path="/gmail/sent" element={<GmailSent />} />
            <Route path="/gmail/compose" element={<GmailCompose />} />
            <Route path="/gmail/settings" element={<GmailSettings />} />
            {/* Outlook Routes */}
            <Route path="/outlook/inbox" element={<OutlookInbox />} />
            <Route path="/outlook/sent" element={<OutlookSent />} />
            <Route path="/outlook/compose" element={<OutlookCompose />} />
            <Route path="/outlook/settings" element={<OutlookSettings />} />
=======
            {/* Email Account Integration - IMAP/SMTP only */}
            <Route path="/email-integration" element={<EmailAccountIntegration />} />
            <Route path="/email-integration/select" element={<EmailAccountSelection />} />
            <Route path="/email-integration/imap-smtp/connect" element={<ImapSmtpConnect />} />
            <Route path="/emails/:accountId" element={<UnifiedEmailInbox />} />
>>>>>>> 71f3b5e (push latest changes)
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
