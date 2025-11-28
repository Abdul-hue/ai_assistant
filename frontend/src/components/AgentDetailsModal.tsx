/**
 * AgentDetailsModal.tsx
 * 
 * Displays comprehensive agent details with WhatsApp connection management.
 * 
 * Features:
 * - View agent configuration and statistics
 * - Connect/disconnect WhatsApp via QR code
 * - Real-time connection status updates
 * - Tabbed interface with Overview, Configuration, WhatsApp, and Statistics
 * 
 * @param open - Modal visibility state
 * @param onOpenChange - Callback when modal opens/closes
 * @param agentId - UUID of agent to display
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAgentDetails } from '@/hooks';
import { formatDistanceToNow } from 'date-fns';
import { Copy, Check, AlertCircle, User, Bot, MessageSquare, Globe, Clock, Calendar } from 'lucide-react';
import WhatsAppConnectionPanel from './WhatsAppConnectionPanel';
import { AgentDetailsOverviewTab } from './agents/AgentDetailsOverviewTab';
import { AgentDetailsConfigurationTab } from './agents/AgentDetailsConfigurationTab';
import type { FileMetadata, IntegrationEndpoint } from '@/types/agent.types';

interface AgentDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string | null;
}

export default function AgentDetailsModal({ open, onOpenChange, agentId }: AgentDetailsModalProps) {
  const { data, isLoading, error, refetch } = useAgentDetails(agentId || undefined);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  // Handle copy to clipboard
  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };
  
  // If no agentId, don't render
  if (!agentId) return null;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        aria-describedby="agent-details-description"
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            {isLoading ? 'Loading...' : data?.agent.agent_name || 'Agent Details'}
          </DialogTitle>
        </DialogHeader>
        <p id="agent-details-description" className="sr-only">
          View and manage agent details, configuration, and WhatsApp connection
        </p>
        
        {/* Content area with scroll */}
        <div className="flex-1 overflow-y-auto">
          {/* ERROR STATE */}
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to load agent details. {error.message}
                <Button onClick={() => refetch()} variant="link" className="ml-2">
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          
          {/* LOADING STATE */}
          {isLoading && <LoadingSkeleton />}
          
          {/* DATA STATE */}
          {data && (
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="configuration">Configuration</TabsTrigger>
                <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
                <TabsTrigger value="statistics">Statistics</TabsTrigger>
              </TabsList>
              
              {/* TAB 1: OVERVIEW - Complete Information */}
              <TabsContent value="overview" className="mt-4">
                <AgentDetailsOverviewTab agent={data.agent} />
              </TabsContent>
              
              {/* TAB 2: CONFIGURATION */}
              <TabsContent value="configuration" className="mt-4">
                <AgentDetailsConfigurationTab agent={data.agent} />
              </TabsContent>
              
              {/* TAB 3: WHATSAPP CONNECTION */}
              <TabsContent value="whatsapp" className="mt-4">
                <WhatsAppConnectionPanel
                  agentId={data.agent.id}
                  whatsappSession={data.agent.whatsapp_session}
                  onConnectionChange={() => refetch()}
                />
              </TabsContent>
              
              {/* TAB 4: STATISTICS */}
              <TabsContent value="statistics" className="space-y-4 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Agent Statistics</CardTitle>
                    <CardDescription>Real-time metrics from message logs</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <StatCard 
                        label="Total Messages" 
                        value={data.statistics.total_messages?.toString() || '0'}
                        icon="📨"
                      />
                      <div className="text-center p-6 border rounded-lg bg-card hover:shadow-md transition-shadow">
                        <div className="text-4xl mb-3">🕐</div>
                        <div className="text-lg font-bold mb-2">
                          {data.statistics.last_message_at 
                            ? formatDistanceToNow(new Date(data.statistics.last_message_at), { addSuffix: true })
                            : 'No messages yet'
                          }
                        </div>
                        <div className="text-sm text-muted-foreground mb-2">Last Message</div>
                        {data.statistics.last_message_text && (
                          <div className="text-xs text-muted-foreground mt-2 p-2 bg-muted rounded border max-h-20 overflow-y-auto">
                            "{data.statistics.last_message_text.length > 100 
                              ? data.statistics.last_message_text.substring(0, 100) + '...'
                              : data.statistics.last_message_text
                            }"
                          </div>
                        )}
                      </div>
                      <StatCard 
                        label="Unprocessed Messages" 
                        value={data.statistics.unprocessed_messages?.toString() || '0'}
                        icon="⏳"
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Helper Components

function formatFileSize(size?: number) {
  if (!size && size !== 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatFileDate(date?: string) {
  if (!date) return 'Unknown date';
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch (error) {
    return 'Invalid date';
  }
}

interface InfoFieldProps {
  label: string;
  value: string;
  copyable?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}

function InfoField({ label, value, copyable, onCopy, copied }: InfoFieldProps) {
  return (
    <div className="flex flex-col">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium truncate">{value}</span>
        {copyable && (
          <button 
            onClick={onCopy} 
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`Copy ${label}`}
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="text-center p-6 border rounded-lg bg-card hover:shadow-md transition-shadow">
      <div className="text-4xl mb-3">{icon}</div>
      <div className="text-3xl font-bold mb-2">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

