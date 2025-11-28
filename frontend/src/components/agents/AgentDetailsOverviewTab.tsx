import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Pencil, Save, X, Loader2 } from 'lucide-react';
import {
  Form, FormControl, FormDescription, FormField,
  FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { API_URL } from '@/config';

const updateAgentSchema = z.object({
  name: z.string().min(1, 'Agent name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  ownerName: z.string().optional().nullable(),
  ownerPhone: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  webhookEnabled: z.boolean().optional(),
});

type UpdateAgentFormData = z.infer<typeof updateAgentSchema>;

interface AgentDetailsOverviewTabProps {
  agent: any;
}

export const AgentDetailsOverviewTab: React.FC<AgentDetailsOverviewTabProps> = ({ agent }) => {
  const [isEditing, setIsEditing] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<UpdateAgentFormData>({
    resolver: zodResolver(updateAgentSchema),
    defaultValues: {
      name: agent.agent_name || '',
      description: agent.description || '',
      ownerName: agent.agent_owner_name || '',
      ownerPhone: agent.agent_phone_number || '',
      timezone: agent.timezone || 'UTC',
      isActive: agent.is_active ?? true,
      webhookEnabled: agent.webhook_enabled ?? true,
    },
  });

  const updateAgentMutation = useMutation({
    mutationFn: async (data: UpdateAgentFormData) => {
      console.log('📝 Sending update request:', { agentId: agent.id, data });
      
      const response = await fetch(`${API_URL}/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          ownerName: data.ownerName,
          ownerPhone: data.ownerPhone,
          timezone: data.timezone,
          isActive: data.isActive,
          webhookEnabled: data.webhookEnabled,
        }),
      });
      
      const responseData = await response.json();
      console.log('📤 Update response:', responseData);
      
      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || 'Failed to update agent');
      }
      
      console.log('✅ Update successful:', responseData);
      return responseData;
    },
    onSuccess: () => {
      toast.success('Agent updated successfully');
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent-details', agent.id] });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      console.error('❌ Update error:', error);
      toast.error(`Failed to update: ${error.message}`);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Agent Overview</h3>
          <p className="text-sm text-muted-foreground">Manage basic information and settings</p>
        </div>
        <div className="flex gap-2">
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)} variant="outline">
              <Pencil className="h-4 w-4 mr-2" />Edit Agent
            </Button>
          ) : (
            <>
              <Button 
                variant="outline" 
                onClick={() => { 
                  form.reset(); 
                  setIsEditing(false); 
                }} 
                disabled={updateAgentMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" />Cancel
              </Button>
              <Button 
                onClick={form.handleSubmit((data) => updateAgentMutation.mutate(data))} 
                disabled={updateAgentMutation.isPending}
              >
                {updateAgentMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />Save Changes
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      <Form {...form}>
        <form className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent Name *</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={!isEditing} placeholder="My AI Assistant" className={!isEditing ? 'bg-muted' : ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value || ''} disabled={!isEditing} rows={3} className={!isEditing ? 'bg-muted' : ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Owner Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="ownerName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner Name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ''} disabled={!isEditing} className={!isEditing ? 'bg-muted' : ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="ownerPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner Phone</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ''} disabled={!isEditing} className={!isEditing ? 'bg-muted' : ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agent Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">WhatsApp Number</label>
                <Input 
                  value={agent.whatsapp_phone_number || 'Not connected'} 
                  disabled 
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground mt-1">Read-only: Set during agent creation</p>
              </div>

              <FormField control={form.control} name="timezone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    value={field.value || 'UTC'} 
                    disabled={!isEditing}
                  >
                    <FormControl>
                      <SelectTrigger className={!isEditing ? 'bg-muted' : ''}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="Asia/Karachi">Asia/Karachi (UTC+5)</SelectItem>
                      <SelectItem value="Asia/Dubai">Asia/Dubai (UTC+4)</SelectItem>
                      <SelectItem value="Asia/Kolkata">Asia/Kolkata (UTC+5:30)</SelectItem>
                      <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                      <SelectItem value="America/Los_Angeles">America/Los_Angeles (PST)</SelectItem>
                      <SelectItem value="Europe/London">Europe/London (UTC+0)</SelectItem>
                      <SelectItem value="Europe/Paris">Europe/Paris (UTC+1)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <FormLabel>Agent Active</FormLabel>
                    <FormDescription>Enable/disable this agent</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!isEditing} />
                  </FormControl>
                </FormItem>
              )} />

              <FormField control={form.control} name="webhookEnabled" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <FormLabel>Webhook Enabled</FormLabel>
                    <FormDescription>Enable webhook notifications</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!isEditing} />
                  </FormControl>
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b">
                  <span className="font-medium text-muted-foreground">Agent ID:</span>
                  <span className="font-mono text-xs">{agent.id}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="font-medium text-muted-foreground">Created:</span>
                  <span>{new Date(agent.created_at).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="font-medium text-muted-foreground">Last Updated:</span>
                  <span>{new Date(agent.updated_at).toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
};
