import React, { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Save, X, Loader2, FileText, Upload, Eye, EyeOff } from 'lucide-react';
import {
  Form, FormControl, FormDescription, FormField,
  FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { API_URL } from '@/config';
import { formatDistanceToNow } from 'date-fns';

const companyIntegrationSchema = z.object({
  endpoint_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  access_token: z.string().optional().or(z.literal('')),
});

const configurationSchema = z.object({
  systemPrompt: z.string().max(5000).optional().nullable(),
  company_integrations: z.array(companyIntegrationSchema).optional().nullable(),
});

type ConfigurationFormData = z.infer<typeof configurationSchema>;

interface AgentDetailsConfigurationTabProps {
  agent: any;
}

export const AgentDetailsConfigurationTab: React.FC<AgentDetailsConfigurationTabProps> = ({ agent }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileToDelete, setFileToDelete] = useState<any | null>(null);
  const [showAccessToken, setShowAccessToken] = useState<Record<number, boolean>>({});
  const queryClient = useQueryClient();

  // Transform company_data from database format to form format
  const transformCompanyIntegrations = (companyData: any) => {
    if (!companyData) return [{ endpoint_url: '', access_token: '' }];
    
    // If it's an array, use it directly
    if (Array.isArray(companyData) && companyData.length > 0) {
      return companyData.map((item: any) => ({
        endpoint_url: item.endpoint_url || '',
        access_token: item.access_token || '',
      }));
    }
    
    // If it's a single object (old format), convert to array
    if (companyData.endpoint_url || companyData.access_token) {
      return [{
        endpoint_url: companyData.endpoint_url || '',
        access_token: companyData.access_token || '',
      }];
    }
    
    // Default: return one empty integration
    return [{ endpoint_url: '', access_token: '' }];
  };

  const form = useForm<ConfigurationFormData>({
    resolver: zodResolver(configurationSchema),
    defaultValues: {
      systemPrompt: agent.initial_prompt || agent.system_prompt || '',
      company_integrations: transformCompanyIntegrations(agent.company_data || agent.erp_crs_data),
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'company_integrations',
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      console.log('🗑️ Deleting file:', fileId);
      const response = await fetch(`${API_URL}/api/agents/${agent.id}/files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to delete file');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success('File deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['agent-details', agent.id] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      setFileToDelete(null);
    },
    onError: (error: Error) => {
      console.error('❌ Delete file error:', error);
      toast.error(`Failed to delete file: ${error.message}`);
    },
  });


  const updateConfigMutation = useMutation({
    mutationFn: async (data: ConfigurationFormData) => {
      console.log('📝 Sending configuration update:', { agentId: agent.id, data });
      
      // Upload files first if any
      if (selectedFiles.length > 0) {
        console.log('📤 Uploading files first...');
        const uploadResponse = await fetch(`${API_URL}/api/agents/${agent.id}/upload-files`, {
          method: 'POST',
          credentials: 'include',
          body: (() => {
            const formData = new FormData();
            selectedFiles.forEach((file) => {
              formData.append('files', file);
            });
            return formData;
          })(),
        });

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json().catch(() => ({}));
          throw new Error(errorData.message || errorData.error || 'Failed to upload files');
        }
        console.log('✅ Files uploaded successfully');
      }
      
      // Filter out empty integrations and convert to database format
      const companyIntegrations = (data.company_integrations || [])
        .filter((integration: any) => integration.endpoint_url?.trim() || integration.access_token?.trim())
        .map((integration: any) => ({
          endpoint_url: integration.endpoint_url?.trim() || null,
          access_token: integration.access_token?.trim() || null,
        }));

      // Then update configuration
      const payload = {
        systemPrompt: data.systemPrompt || null,
        erpCrsData: companyIntegrations.length > 0 ? companyIntegrations : null,
      };
      
      console.log('📤 [CONFIG-UPDATE] Payload being sent:', JSON.stringify(payload, null, 2));
      
      const response = await fetch(`${API_URL}/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      
      const responseData = await response.json();
      console.log('📤 Configuration update response:', responseData);
      
      if (!response.ok) {
        // Log validation errors if present
        if (responseData.details && Array.isArray(responseData.details)) {
          console.error('❌ Validation errors:', responseData.details);
          const errorMessages = responseData.details.map((d: any) => `${d.field}: ${d.message}`).join(', ');
          throw new Error(`Validation failed: ${errorMessages}`);
        }
        throw new Error(responseData.message || responseData.error || 'Failed to update configuration');
      }
      
      console.log('✅ Configuration update successful:', responseData);
      return responseData;
    },
    onSuccess: () => {
      toast.success('Configuration updated successfully');
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent-details', agent.id] });
      setIsEditing(false);
      setSelectedFiles([]);
    },
    onError: (error: Error) => {
      console.error('❌ Configuration update error:', error);
      toast.error(`Failed to update: ${error.message}`);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles((prev) => [...prev, ...files]);
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (size?: number) => {
    if (!size && size !== 0) return 'Unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const formatFileDate = (date?: string) => {
    if (!date) return 'Unknown date';
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true });
    } catch (error) {
      return 'Invalid date';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Configuration</h3>
          <p className="text-sm text-muted-foreground">Advanced settings and integrations</p>
        </div>
        <div className="flex gap-2">
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)} variant="outline">
              <Pencil className="h-4 w-4 mr-2" />Edit Configuration
            </Button>
          ) : (
            <>
              <Button 
                variant="outline" 
                onClick={() => { 
                  form.reset(); 
                  setIsEditing(false);
                  setSelectedFiles([]);
                }} 
                disabled={updateConfigMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" />Cancel
              </Button>
              <Button 
                onClick={form.handleSubmit((data) => updateConfigMutation.mutate(data))} 
                disabled={updateConfigMutation.isPending}
              >
                {updateConfigMutation.isPending ? (
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
              <CardTitle>System Prompt</CardTitle>
              <CardDescription>Define the agent's behavior and personality</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      value={field.value || ''} 
                      disabled={!isEditing} 
                      rows={8} 
                      className={!isEditing ? 'bg-muted font-mono text-sm' : 'font-mono text-sm'} 
                      placeholder="You are a helpful AI assistant..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Knowledge Base Files</CardTitle>
              <CardDescription>Upload documents to train your agent (PDF, DOC, DOCX)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isEditing && (
                <div className="border-2 border-dashed rounded-lg p-4">
                  <label className="flex flex-col items-center justify-center cursor-pointer">
                    <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                    <span className="text-sm font-medium">Click to upload files</span>
                    <span className="text-xs text-muted-foreground">PDF, DOC, DOCX (Max 10MB each)</span>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {selectedFiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Selected Files:</p>
                  {selectedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-muted rounded-lg">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{file.name}</span>
                        <span className="text-xs text-muted-foreground">({formatFileSize(file.size)})</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSelectedFile(index)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {agent.uploaded_files && agent.uploaded_files.length > 0 ? (
                <div className="space-y-3">
                  {agent.uploaded_files.map((file: any) => (
                    <div key={file.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg border p-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)} • Uploaded {formatFileDate(file.uploadedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {file.url && (
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-primary underline"
                          >
                            View
                          </a>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setFileToDelete(file)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : selectedFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No knowledge base files uploaded</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Company Integration</CardTitle>
                  <CardDescription>Connect your business systems</CardDescription>
                </div>
                {isEditing && (
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={() => append({ endpoint_url: '', access_token: '' })}
                  >
                    <Plus className="h-4 w-4 mr-2" />Add Integration
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {fields.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                  <p>No integrations configured</p>
                  {isEditing && (
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      className="mt-2" 
                      onClick={() => append({ endpoint_url: '', access_token: '' })}
                    >
                      <Plus className="h-4 w-4 mr-2" />Add Integration
                    </Button>
                  )}
                </div>
              ) : (
                fields.map((field, index) => (
                  <div key={field.id} className="space-y-4 p-4 rounded-lg border-2">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold">Integration {index + 1}</h4>
                      {isEditing && fields.length > 1 && (
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>

                    <FormField
                      control={form.control}
                      name={`company_integrations.${index}.endpoint_url`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Endpoint URL</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ''}
                              disabled={!isEditing}
                              placeholder="https://api.yourcompany.com/webhook"
                              type="url"
                              className={!isEditing ? 'bg-muted' : ''}
                            />
                          </FormControl>
                          <FormDescription>
                            Webhook URL for company system integration
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`company_integrations.${index}.access_token`}
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center gap-2">
                            <FormLabel>Access Token</FormLabel>
                            <Badge variant="outline" className="text-xs">Optional</Badge>
                          </div>
                          <FormControl>
                            <div className="relative">
                              <Input
                                {...field}
                                value={field.value || ''}
                                disabled={!isEditing}
                                placeholder="your-access-token-here"
                                type={showAccessToken[index] ? 'text' : 'password'}
                                className={!isEditing ? 'bg-muted pr-10' : 'pr-10'}
                              />
                              {isEditing && (
                                <button
                                  type="button"
                                  onClick={() => setShowAccessToken(prev => ({ ...prev, [index]: !prev[index] }))}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                  aria-label={showAccessToken[index] ? "Hide access token" : "Show access token"}
                                >
                                  {showAccessToken[index] ? (
                                    <EyeOff className="h-4 w-4" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </FormControl>
                          <FormDescription>
                            Authentication token for your company API (if required)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ))
              )}

              {/* Show current values when not editing */}
              {!isEditing && fields.length > 0 && (
                <div className="rounded-lg border p-4 bg-muted/50">
                  <p className="text-sm font-medium mb-2">Current Configuration:</p>
                  <div className="space-y-2 text-sm">
                    {fields.map((field, index) => {
                      const endpointUrl = form.watch(`company_integrations.${index}.endpoint_url`);
                      const accessToken = form.watch(`company_integrations.${index}.access_token`);
                      return (
                        <div key={field.id} className="space-y-1">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Integration {index + 1} - Endpoint URL:</span>
                            <span className="font-mono text-xs">
                              {endpointUrl || 'Not configured'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Integration {index + 1} - Access Token:</span>
                            <span>
                              {accessToken ? '••••••••' : 'Not configured'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </form>
      </Form>

      <AlertDialog open={!!fileToDelete} onOpenChange={(open) => !open && setFileToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                This will permanently delete <strong>{fileToDelete?.name}</strong> from Supabase Storage, Pinecone Vector Database, and the agent's knowledge base.
                <span className="mt-2 block font-semibold text-destructive">This action cannot be undone.</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteFileMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (fileToDelete) {
                  deleteFileMutation.mutate(fileToDelete.id);
                }
              }}
              disabled={deleteFileMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteFileMutation.isPending ? 'Deleting...' : 'Delete File'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
