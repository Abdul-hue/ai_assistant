import { useEffect, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Bot, MessageSquare, Loader2, Calendar as CalendarIcon, Eye, Users, Trash2, LayoutDashboard, Settings, Home, RefreshCw, AlertCircle, Globe, Clock, User, Mail, Menu, X, Key, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AgentDetailsModal from "@/components/AgentDetailsModal";
import ContactsManagementDialog from "@/components/agents/ContactsManagementDialog";
import { useContactCount } from "@/hooks/useContacts";
import { useAgents, useDeleteAgent } from "@/hooks/useAgents";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import ProfileAvatarMenu from "@/components/ProfileAvatarMenu";
import { useAuth } from "@/context/AuthContext";
import type { AgentListItem } from "@/types/agent.types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ContactCountBadge = ({ agentId }: { agentId: string }) => {
  const { data } = useContactCount(agentId);
  const count = data?.count ?? 0;

  if (count === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Users className="h-3.5 w-3.5" />
      <span>{count} contacts</span>
    </div>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: dashboardStats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useDashboardStats();
  
  // ✅ FIX: Use backend API hook instead of direct Supabase query
  const { data: agentsData, isLoading: agentsLoading, error: agentsError, refetch: refetchAgents } = useAgents();
  
  const deleteAgentMutation = useDeleteAgent({
    onSuccess: (_, deletedAgentId) => {
      setAgentToDelete(null);
      // Refetch agents after deletion
      refetchAgents();
      // Refetch dashboard stats after agent deletion to update counts
      refetchStats();
      toast({
        title: "Agent deleted",
        description: "The agent and its WhatsApp connection were removed.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error.message,
      });
    },
  });
  
  // Use AgentListItem type from backend API
  const agents: AgentListItem[] = agentsData || [];
  const isLoading = agentsLoading;
  
  const [agentToDelete, setAgentToDelete] = useState<AgentListItem | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Modal state
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Refetch stats when agents are loaded
  useEffect(() => {
    if (agents.length > 0) {
      refetchStats();
    }
  }, [agents, refetchStats]);

  // Show error toast if agents fail to load
  useEffect(() => {
    if (agentsError) {
      toast({
        variant: "destructive",
        title: "Error loading agents",
        description: agentsError.message,
      });
    }
  }, [agentsError, toast]);

  const isActive = (path: string) => location?.pathname === path;

  return (
    <div className="min-h-screen bg-black flex">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        w-64 bg-[#0a0a0a] border-r border-white/10 flex flex-col fixed h-screen z-50
        transform transition-transform duration-300 ease-in-out
        lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-2 mb-6">
            <MessageSquare className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold gradient-text">
              WhatsApp AI
            </span>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/dashboard") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/dashboard")}
          >
            <LayoutDashboard className="h-5 w-5" />
            Dashboard
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/agent-chat") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/agent-chat")}
          >
            <MessageCircle className="h-5 w-5" />
            Agent Chat
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/create-agent") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/create-agent")}
          >
            <Plus className="h-5 w-5" />
            Create Agent
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/calendar") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/calendar")}
          >
            <CalendarIcon className="h-5 w-5" />
            Calendar
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/email-integration") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/email-integration")}
          >
            <Key className="h-5 w-5" />
            Email Account Integration
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/profile") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/profile")}
          >
            <Settings className="h-5 w-5" />
            Settings
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 text-gray-400"
            onClick={() => navigate("/")}
          >
            <Home className="h-5 w-5" />
            Home
          </Button>
        </nav>

        <div className="p-4 border-t border-white/10">
          <ProfileAvatarMenu />
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 lg:ml-64 w-full">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-black/80 backdrop-blur-xl">
          <div className="px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Mobile Menu Button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="lg:hidden text-gray-400 hover:text-white hover:bg-white/10"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  {sidebarOpen ? (
                    <X className="h-5 w-5" />
                  ) : (
                    <Menu className="h-5 w-5" />
                  )}
                </Button>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-white">
                    Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}! 👋
                  </h1>
                  <p className="text-gray-400 text-xs sm:text-sm mt-1 hidden sm:block">
                    Manage your AI agents and monitor conversations
                  </p>
                </div>
              </div>
              <Button 
                onClick={() => navigate("/create-agent")}
                className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105 text-sm sm:text-base"
                size="sm"
              >
                <Plus className="mr-1 sm:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Create Agent</span>
                <span className="sm:hidden">Create</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <Card className="glass-card hover:border-primary/30 transition-all duration-300 hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Total Agents</CardTitle>
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-white/10"
                    onClick={() => refetchStats()}
                    disabled={statsLoading}
                    title="Refresh stats"
                  >
                    <RefreshCw className={`h-3 w-3 ${statsLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                ) : statsError ? (
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">Error</span>
                  </div>
                ) : (
                  <div className="text-3xl font-bold text-white">
                    {dashboardStats?.total_agents ?? 0}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="glass-card hover:border-primary/30 transition-all duration-300 hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Active Agents</CardTitle>
                <Bot className="h-5 w-5 text-success" />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                ) : statsError ? (
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">Error</span>
                  </div>
                ) : (
                  <div className="text-3xl font-bold text-white">
                    {dashboardStats?.active_agents ?? 0}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="glass-card hover:border-primary/30 transition-all duration-300 hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Total Messages</CardTitle>
                <MessageSquare className="h-5 w-5 text-primary" />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                ) : statsError ? (
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">Error</span>
                  </div>
                ) : (
                  <div className="text-3xl font-bold text-white">
                    {dashboardStats?.total_messages ?? 0}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Agents Section */}
          <div className="mb-4 sm:mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">Your Agents</h2>
            <p className="text-gray-400 text-sm sm:text-base">Manage and monitor your AI agents</p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : agents.length === 0 ? (
            <Card className="glass-card text-center py-16 border-dashed">
              <CardContent className="space-y-6">
                <Bot className="h-20 w-20 mx-auto text-gray-600" />
                <div>
                  <h3 className="text-2xl font-semibold mb-2 text-white">No agents yet</h3>
                  <p className="text-gray-400 mb-6">
                    Create your first AI agent to get started
                  </p>
                  <Button 
                    onClick={() => navigate("/create-agent")}
                    className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Your First Agent
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-wrap gap-4 sm:gap-6">
              {agents.map((agent) => (
                <Card 
                  key={agent.id} 
                  className="glass-card hover:border-primary/50 transition-all duration-300 hover:scale-[1.02] sm:hover:scale-105 w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-white text-lg sm:text-xl mb-2 truncate">
                          {agent.agent_name}
                        </CardTitle>
                        
                        {/* Description */}
                        {agent.description && (
                          <p className="text-xs sm:text-sm text-gray-400 line-clamp-2">
                            {agent.description}
                          </p>
                        )}
                      </div>
                      
                      {/* Status Badge */}
                      <Badge 
                        variant={agent.is_active ? 'default' : 'secondary'}
                        className={`${agent.is_active ? 'bg-green-500' : ''} shrink-0 text-xs`}
                      >
                        {agent.is_active ? 'active' : 'inactive'}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-2 sm:space-y-3">
                    {/* Owner Name */}
                    {agent.agent_owner_name && (
                      <div className="flex items-center gap-2 text-xs sm:text-sm">
                        <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 shrink-0" />
                        <span className="text-white truncate">{agent.agent_owner_name}</span>
                      </div>
                    )}

                    {/* WhatsApp Number */}
                    {agent.whatsapp_phone_number && (
                      <div className="flex items-center gap-2 text-xs sm:text-sm">
                        <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-400 shrink-0" />
                        <span className="text-gray-400 shrink-0">WhatsApp:</span>
                        <span className="text-white truncate">{agent.whatsapp_phone_number}</span>
                      </div>
                    )}

                    {/* Languages */}
                    {agent.response_languages && agent.response_languages.length > 0 && (
                      <div className="flex items-center gap-2 text-xs sm:text-sm">
                        <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400 shrink-0" />
                        <span className="text-gray-400 shrink-0">Languages:</span>
                        <span className="text-white truncate">
                          {agent.response_languages.length === 1 
                            ? agent.response_languages[0]
                            : agent.response_languages.join(', ')
                          }
                        </span>
                      </div>
                    )}

                    {/* Contact Count */}
                    <div className="flex items-center gap-2 text-xs sm:text-sm">
                      <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 shrink-0" />
                      <span className="text-gray-400 shrink-0">Contacts:</span>
                      <ContactCountBadge agentId={agent.id} />
                    </div>

                    {/* Created Date */}
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-500">
                      <CalendarIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                      <span className="truncate">{formatDistanceToNow(new Date(agent.created_at), { addSuffix: true })}</span>
                    </div>
                  </CardContent>

                  <CardFooter className="flex flex-col sm:flex-row gap-2 border-t border-white/10 pt-3 sm:pt-4 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedAgentId(agent.id);
                        setModalOpen(true);
                      }}
                      className="flex-1 w-full sm:w-auto"
                    >
                      <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                      <span className="text-xs sm:text-sm">View Details</span>
                    </Button>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <ContactsManagementDialog
                        agentId={agent.id}
                        agentName={agent.agent_name}
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          setAgentToDelete(agent);
                        }}
                        disabled={deleteAgentMutation.isPending && agentToDelete?.id === agent.id}
                        className="flex-1 sm:flex-initial"
                      >
                        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!agentToDelete} onOpenChange={(open) => !open && setAgentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-semibold">{agentToDelete?.agent_name ?? "this agent"}</span>, remove its WhatsApp
              connection, and clear related data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAgentMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={deleteAgentMutation.isPending}
              onClick={() => {
                if (agentToDelete) {
                  deleteAgentMutation.mutate(agentToDelete.id);
                }
              }}
            >
              {deleteAgentMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Agent Details Modal */}
      <AgentDetailsModal 
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setSelectedAgentId(null);
        }}
        agentId={selectedAgentId}
      />
      
    </div>
  );
};

export default Dashboard;
