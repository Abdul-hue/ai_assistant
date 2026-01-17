import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Bot, MessageSquare, Loader2, Calendar as CalendarIcon, Eye, Users, Trash2, RefreshCw, AlertCircle, Globe, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import AgentDetailsModal from "@/components/AgentDetailsModal";
import ContactsManagementDialog from "@/components/agents/ContactsManagementDialog";
import { useContactCount } from "@/hooks/useContacts";
import { useAgents, useDeleteAgent } from "@/hooks/useAgents";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useAuth } from "@/context/AuthContext";
import type { AgentListItem } from "@/types/agent.types";
import { ariaLabels } from "@/lib/accessibility";
import { SearchBar } from "@/components/ui/search-bar";
import { useDebounce } from "@/hooks/useDebounce";
import { DashboardStatsSkeleton, AgentCardSkeleton } from "@/components/ui/skeletons";
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
    <div className="flex items-center gap-1 text-sm font-semibold text-gray-900 dark:text-white">
      <span>{count} contacts</span>
    </div>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
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
  
  // Modal state
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  
  // Filter agents based on search
  const filteredAgents = useMemo(() => {
    if (!debouncedSearchTerm.trim()) {
      return agents;
    }
    
    const search = debouncedSearchTerm.toLowerCase();
    return agents.filter(agent => 
      agent.agent_name?.toLowerCase().includes(search) ||
      agent.agent_owner_name?.toLowerCase().includes(search) ||
      agent.whatsapp_phone_number?.toLowerCase().includes(search) ||
      agent.description?.toLowerCase().includes(search)
    );
  }, [agents, debouncedSearchTerm]);

  // Memoize callbacks to prevent child re-renders
  const handleCreateAgent = useCallback(() => {
    navigate("/create-agent");
  }, [navigate]);

  const handleViewDetails = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setModalOpen(true);
  }, []);

  const handleDeleteClick = useCallback((agent: AgentListItem, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    setAgentToDelete(agent);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (agentToDelete) {
      deleteAgentMutation.mutate(agentToDelete.id);
    }
  }, [agentToDelete, deleteAgentMutation]);

  const handleRefreshStats = useCallback(() => {
    refetchStats();
  }, [refetchStats]);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setSelectedAgentId(null);
  }, []);

  // Memoize header content
  const headerContent = useMemo(() => (
    <div className="flex items-center justify-between gap-4 w-full">
                <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                    Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}! 👋
                  </h1>
        <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm mt-1 hidden sm:block">
                    Manage your AI agents and monitor conversations
                  </p>
              </div>
              <Button 
        onClick={handleCreateAgent}
                className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105 text-sm sm:text-base"
                size="sm"
        aria-label={ariaLabels.actions.create('agent')}
              >
        <Plus className="mr-1 sm:mr-2 h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Create Agent</span>
                <span className="sm:hidden">Create</span>
              </Button>
            </div>
  ), [user, handleCreateAgent]);

  return (
    <AppLayout headerContent={headerContent}>
      <div className="pl-0 pr-4 sm:pr-6 pt-0 pb-4 sm:pb-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-primary/30 transition-all duration-300 hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300">Total Agents</CardTitle>
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-white/10"
                    onClick={handleRefreshStats}
                    disabled={statsLoading}
                    aria-label={ariaLabels.actions.refresh('dashboard stats')}
                    title="Refresh stats"
                  >
                    <RefreshCw className={`h-3 w-3 ${statsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span className="sr-only">Refresh stats</span>
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
                  <div className="text-3xl font-bold text-gray-900 dark:text-white">
                    {dashboardStats?.total_agents ?? 0}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-primary/30 transition-all duration-300 hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300">Active Agents</CardTitle>
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
                  <div className="text-3xl font-bold text-gray-900 dark:text-white">
                    {dashboardStats?.active_agents ?? 0}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-primary/30 transition-all duration-300 hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300">Total Messages</CardTitle>
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
                  <div className="text-3xl font-bold text-gray-900 dark:text-white">
                    {dashboardStats?.total_messages ?? 0}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Agents Section */}
          <div className="mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-1 sm:mb-2">Your Agents</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">Manage and monitor your AI agents</p>
              </div>
              {agents.length > 0 && (
                <div className="w-full sm:w-80">
                  <SearchBar
                    value={searchTerm}
                    onChange={setSearchTerm}
                    placeholder="Search agents..."
                    aria-label="Search agents"
                  />
                </div>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-wrap gap-4 sm:gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <AgentCardSkeleton key={i} />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-center py-16 border-dashed">
              <CardContent className="space-y-6">
                <Bot className="h-20 w-20 mx-auto text-gray-400 dark:text-gray-600" />
                <div>
                  <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">No agents yet</h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Create your first AI agent to get started
                  </p>
                  <Button 
                    onClick={handleCreateAgent}
                    className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Your First Agent
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : filteredAgents.length === 0 && debouncedSearchTerm ? (
            <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-center py-16 border-dashed">
              <CardContent className="space-y-6">
                <Bot className="h-20 w-20 mx-auto text-gray-400 dark:text-gray-600" />
                <div>
                  <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">No agents found</h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    No agents match "{debouncedSearchTerm}"
                  </p>
                  <Button 
                    variant="outline"
                    onClick={() => setSearchTerm('')}
                  >
                    Clear search
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-wrap gap-4 sm:gap-6">
              {filteredAgents.map((agent) => (
                <Card 
                  key={agent.id} 
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-primary/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-300 hover:scale-[1.02] sm:hover:scale-105 w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-gray-900 dark:text-white text-lg sm:text-xl font-bold mb-2 truncate">
                          {agent.agent_name}
                        </CardTitle>
                        
                        {/* Description */}
                        {agent.description && (
                          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 line-clamp-2 font-medium">
                            {agent.description}
                          </p>
                        )}
                      </div>
                      
                      {/* Status Badge */}
                      <Badge 
                        variant={agent.is_active ? 'default' : 'secondary'}
                        className={`${agent.is_active ? 'bg-green-500 text-white font-bold' : 'font-semibold'} shrink-0 text-xs`}
                      >
                        {agent.is_active ? 'active' : 'inactive'}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-2.5 sm:space-y-3">
                    {/* Owner Name */}
                    {agent.agent_owner_name && (
                      <div className="flex items-center gap-2 text-sm sm:text-base">
                        <User className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600 dark:text-gray-400 shrink-0" />
                        <span className="text-gray-900 dark:text-white truncate font-semibold">{agent.agent_owner_name}</span>
                      </div>
                    )}

                    {/* WhatsApp Number */}
                    {agent.whatsapp_phone_number && (
                      <div className="flex items-center gap-2 text-sm sm:text-base">
                        <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-green-500 dark:text-green-400 shrink-0" />
                        <span className="text-gray-700 dark:text-gray-300 shrink-0 font-semibold">WhatsApp:</span>
                        <span className="text-gray-900 dark:text-white truncate font-semibold">{agent.whatsapp_phone_number}</span>
                      </div>
                    )}

                    {/* Languages */}
                    {agent.response_languages && agent.response_languages.length > 0 && (
                      <div className="flex items-center gap-2 text-sm sm:text-base">
                        <Globe className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500 dark:text-blue-400 shrink-0" />
                        <span className="text-gray-700 dark:text-gray-300 shrink-0 font-semibold">Languages:</span>
                        <span className="text-gray-900 dark:text-white truncate font-semibold">
                          {agent.response_languages.length === 1 
                            ? agent.response_languages[0]
                            : agent.response_languages.join(', ')
                          }
                        </span>
                      </div>
                    )}

                    {/* Contact Count */}
                    <div className="flex items-center gap-2 text-sm sm:text-base">
                      <Users className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-500 dark:text-cyan-400 shrink-0" />
                      <span className="text-gray-700 dark:text-gray-300 shrink-0 font-semibold">Contacts:</span>
                      <ContactCountBadge agentId={agent.id} />
                    </div>

                    {/* Created Date */}
                    <div className="flex items-center gap-2 text-sm sm:text-base">
                      <CalendarIcon className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600 dark:text-gray-400 shrink-0" />
                      <span className="text-gray-700 dark:text-gray-300 truncate font-semibold">{formatDistanceToNow(new Date(agent.created_at), { addSuffix: true })}</span>
                    </div>
                  </CardContent>

                  <CardFooter className="flex flex-col sm:flex-row gap-2 border-t border-gray-200 dark:border-gray-700 pt-3 sm:pt-4 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleViewDetails(agent.id)}
                      className="flex-1 w-full sm:w-auto font-semibold"
                      aria-label={ariaLabels.actions.view(`${agent.agent_name} details`)}
                    >
                      <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" aria-hidden="true" />
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
                        onClick={(event) => handleDeleteClick(agent, event)}
                        disabled={deleteAgentMutation.isPending && agentToDelete?.id === agent.id}
                        className="flex-1 sm:flex-initial"
                        aria-label={ariaLabels.actions.delete(agent.agent_name)}
                      >
                        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                        <span className="sr-only">Delete {agent.agent_name}</span>
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
      </div>

      <AlertDialog 
        open={!!agentToDelete} 
        onOpenChange={(open) => !open && setAgentToDelete(null)}
        aria-labelledby="delete-agent-dialog-title"
        aria-describedby="delete-agent-dialog-description"
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle id="delete-agent-dialog-title">Delete agent?</AlertDialogTitle>
            <AlertDialogDescription id="delete-agent-dialog-description">
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
              onClick={handleDeleteConfirm}
              aria-label={`Confirm delete ${agentToDelete?.agent_name ?? 'agent'}`}
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
          if (!open) handleModalClose();
        }}
        agentId={selectedAgentId}
      />
    </AppLayout>
  );
};

export default Dashboard;
