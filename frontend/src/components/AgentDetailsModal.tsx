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
              <TabsContent value="overview" className="space-y-4 mt-4">
                {/* Basic Information Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Basic Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-400">Agent Name</p>
                        <p className="text-white font-medium text-lg">{data.agent.agent_name}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">Status</p>
                        <Badge variant={data.agent.is_active ? 'default' : 'secondary'}>
                          {data.agent.is_active ? '🟢 Active' : '🔴 Inactive'}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Owner Information Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <User className="w-5 h-5" />
                      Owner Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-400">Owner Name</p>
                        <p className="text-white font-medium">{data.agent.agent_owner_name || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">Owner Phone</p>
                        <p className="text-white font-medium">{data.agent.agent_phone_number || 'N/A'}</p>
                      </div>
                    </div>
                    
                    {data.agent.description && (
                      <div className="mt-4">
                        <p className="text-sm text-gray-400 mb-2">Notes</p>
                        <p className="text-white bg-white/5 p-3 rounded-lg">
                          {data.agent.description}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Agent Details Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Bot className="w-5 h-5" />
                      Agent Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm text-gray-400">WhatsApp Number</p>
                        <p className="text-white font-medium flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-green-400" />
                          {data.agent.whatsapp_phone_number || 'Not connected'}
                        </p>
                      </div>

                      <div>
                        <p className="text-sm text-gray-400 mb-2">Response Languages</p>
                        <div className="flex flex-wrap gap-2">
                          {data.agent.response_languages?.map((lang: string) => (
                            <Badge key={lang} variant="outline" className="capitalize">
                              {lang}
                            </Badge>
                          )) || <span className="text-gray-500">Not configured</span>}
                        </div>
                      </div>

                      <div>
                        <p className="text-sm text-gray-400">Timezone</p>
                        <p className="text-white font-medium flex items-center gap-2">
                          <Clock className="w-4 h-4 text-purple-400" />
                          {data.agent.timezone || 'UTC'}
                        </p>
                      </div>

                      {data.agent.persona && (
                        <div>
                          <p className="text-sm text-gray-400 mb-2">Persona</p>
                          <p className="text-white bg-white/5 p-3 rounded-lg whitespace-pre-wrap">
                            {data.agent.persona}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Timestamps Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Calendar className="w-5 h-5" />
                      Timestamps
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-400">Created</p>
                        <p className="text-white">
                          {formatDistanceToNow(new Date(data.agent.created_at), { addSuffix: true })}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(data.agent.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">Last Updated</p>
                        <p className="text-white">
                          {formatDistanceToNow(new Date(data.agent.updated_at), { addSuffix: true })}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(data.agent.updated_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Agent ID Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Agent ID</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg font-mono text-sm">
                      <span className="text-white">{data.agent.id}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopy(data.agent.id, 'id')}
                      >
                        {copiedField === 'id' ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              {/* TAB 2: CONFIGURATION */}
              <TabsContent value="configuration" className="space-y-4 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Agent Configuration</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* System Prompt */}
                    <div>
                      <label className="text-sm font-medium mb-2 block">System Prompt</label>
                      <textarea 
                        readOnly
                        value={data.agent.initial_prompt || 'No system prompt configured'}
                        className="w-full h-32 p-3 border rounded-md bg-muted font-mono text-sm resize-none"
                      />
                    </div>
                    
                    {/* Integration Endpoints */}
                    <div>
                      <label className="text-sm font-medium mb-2 block">Integration Endpoints</label>
                      {data.agent.integration_endpoints && data.agent.integration_endpoints.length > 0 ? (
                        <div className="space-y-3">
                          {data.agent.integration_endpoints.map((endpoint: IntegrationEndpoint) => (
                            <div key={endpoint.id} className="rounded-lg border p-3 space-y-2">
                              <div className="flex items-center justify-between gap-3 flex-wrap">
                                <span className="font-semibold text-sm">{endpoint.name}</span>
                                <Badge variant="outline">API Webhook</Badge>
                              </div>
                              <div className="flex flex-col md:flex-row md:items-center gap-2">
                                <input
                                  readOnly
                                  value={endpoint.url}
                                  className="flex-1 p-2 border rounded-md bg-muted text-xs md:text-sm"
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCopy(endpoint.url, `endpoint-${endpoint.id}`)}
                                >
                                  {copiedField === `endpoint-${endpoint.id}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No integration endpoints configured</p>
                      )}
                    </div>

                    {/* Knowledge Base Files */}
                    <div>
                      <label className="text-sm font-medium mb-2 block">Knowledge Base Files</label>
                      {data.agent.uploaded_files && data.agent.uploaded_files.length > 0 ? (
                        <div className="space-y-3">
                          {data.agent.uploaded_files.map((file: FileMetadata) => (
                            <div key={file.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg border p-3">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatFileSize(file.size)} • Uploaded {formatFileDate(file.uploadedAt)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <a
                                  href={file.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-sm text-primary underline"
                                >
                                  View
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No knowledge base files uploaded</p>
                      )}
                    </div>
                    
                    {/* Company Data (if exists) */}
                    {data.agent.company_data && Object.keys(data.agent.company_data).length > 0 && (
                      <div>
                        <label className="text-sm font-medium mb-2 block">Company/ERP Data</label>
                        <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto max-h-64">
                          {JSON.stringify(data.agent.company_data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
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

