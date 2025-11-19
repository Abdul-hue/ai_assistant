import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Bot, MessageSquare, Loader2, Calendar as CalendarIcon, Eye, Users, Trash2, LayoutDashboard, Settings, Home, RefreshCw, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AgentDetailsModal from "@/components/AgentDetailsModal";
import ContactsManagementDialog from "@/components/agents/ContactsManagementDialog";
import { useContactCount } from "@/hooks/useContacts";
import { useDeleteAgent } from "@/hooks/useAgents";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import ProfileAvatarMenu from "@/components/ProfileAvatarMenu";
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

interface Agent {
  id: string;
  agent_name: string;
  description: string | null;
  status: string;
  whatsapp_phone_number: string | null;
  created_at: string;
}

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
  const { toast } = useToast();
  const { data: dashboardStats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useDashboardStats();
  const deleteAgentMutation = useDeleteAgent({
    onSuccess: (_, deletedAgentId) => {
      setAgentToDelete(null);
      setAgents((prev) => prev.filter((agent) => agent.id !== deletedAgentId));
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  
  // Modal state
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    checkAuth();
    fetchAgents();
  }, []);

  // Refetch stats when user is authenticated
  useEffect(() => {
    if (user) {
      refetchStats();
    }
  }, [user, refetchStats]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }
    setUser(session.user);
  };

  const fetchAgents = async () => {
    try {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAgents(data || []);
      // Refetch dashboard stats after agents are loaded to ensure counts are up to date
      refetchStats();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error loading agents",
        description: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0a0a0a] border-r border-white/10 flex flex-col fixed h-screen z-40">
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
      <div className="flex-1 ml-64">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-black/80 backdrop-blur-xl">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white">
                  Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}! 👋
                </h1>
                <p className="text-gray-400 text-sm mt-1">
                  Manage your AI agents and monitor conversations
                </p>
              </div>
              <Button 
                onClick={() => navigate("/create-agent")}
                className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105"
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Agent
              </Button>
            </div>
          </div>
        </header>

        <div className="p-6">
          {/* Quick Stats */}
          <div className="grid md:grid-cols-3 gap-6 mb-8">
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
          <div className="mb-6">
            <h2 className="text-3xl font-bold text-white mb-2">Your Agents</h2>
            <p className="text-gray-400">Manage and monitor your AI agents</p>
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
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {agents.map((agent) => (
                <Card 
                  key={agent.id} 
                  className="glass-card hover:border-primary/50 transition-all duration-300 hover:scale-105 cursor-pointer group"
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    setModalOpen(true);
                  }}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <CardTitle className="text-lg text-white group-hover:text-primary transition-colors">
                          {agent.agent_name}
                        </CardTitle>
                        <CardDescription className="line-clamp-2 text-gray-400">
                          {agent.description || "No description"}
                        </CardDescription>
                      </div>
                      <Badge 
                        variant={agent.status === "active" ? "default" : "secondary"}
                        className={agent.status === "active" ? "bg-gradient-success text-white" : "bg-gray-800 text-gray-300"}
                      >
                        {agent.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 text-sm">
                      {agent.whatsapp_phone_number ? (
                        <p className="flex items-center gap-2 text-gray-300">
                          <MessageSquare className="h-4 w-4 text-primary" />
                          {agent.whatsapp_phone_number}
                        </p>
                      ) : (
                        <p className="text-gray-500 italic">Not connected</p>
                      )}
                      <p className="text-xs text-gray-500">
                        Created {new Date(agent.created_at).toLocaleDateString()}
                      </p>
                      <ContactCountBadge agentId={agent.id} />
                      <div className="flex items-center gap-1 text-xs text-primary pt-2">
                        <Eye className="h-3 w-3" />
                        <span>Click for details</span>
                      </div>
                      <div className="pt-3 flex gap-2" onClick={(event) => event.stopPropagation()}>
                        <ContactsManagementDialog
                          agentId={agent.id}
                          agentName={agent.agent_name}
                        />
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            setAgentToDelete(agent);
                          }}
                          disabled={deleteAgentMutation.isPending && agentToDelete?.id === agent.id}
                          className="hover:scale-105 transition-transform"
                        >
                          {deleteAgentMutation.isPending && agentToDelete?.id === agent.id ? (
                            "Deleting..."
                          ) : (
                            <>
                              <Trash2 className="mr-1 h-4 w-4" />
                              Delete
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
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
