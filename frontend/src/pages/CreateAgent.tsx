import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Bot, Loader2, MessageSquare, LayoutDashboard, Plus, Calendar as CalendarIcon, Settings, Home } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AgentQRCode from "@/components/AgentQRCode";
import IntegrationEndpointsSection from "@/components/agents/IntegrationEndpointsSection";
import KnowledgeBaseFilesSection from "@/components/agents/KnowledgeBaseFilesSection";
import ContactUploadDialog from "@/components/agents/ContactUploadDialog";
import type { IntegrationEndpoint, FileMetadata } from "@/types/agent.types";
import {
  uploadAgentFile as uploadFileToStorage,
  updateAgentFiles as persistAgentFiles,
} from "@/lib/agentStorage";
import { API_URL } from "@/config";
import { useUploadContacts } from "@/hooks/useContacts";
import ProfileAvatarMenu from "@/components/ProfileAvatarMenu";
import { useLocation } from "react-router-dom";

const CreateAgent = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState("");
  const [contactFile, setContactFile] = useState<File | null>(null);

  const [draftAgentId, setDraftAgentId] = useState<string>(() => crypto.randomUUID());
  const [formData, setFormData] = useState({
    agentName: "",
    description: "",
    whatsappPhoneNumber: "",
    agentType: "custom",
    initialPrompt: "",
    companyData: {
      erpSystem: "",
      crmSystem: "",
    },
  });
  const [integrationEndpoints, setIntegrationEndpoints] = useState<IntegrationEndpoint[]>([]);
  const [pendingFiles, setPendingFiles] = useState<FileMetadata[]>([]);
  const uploadContacts = useUploadContacts();

  useEffect(() => {
    checkAuth();
  }, []);

  const handleAddFiles = (files: File[]) => {
    if (!files.length) return;

    const filesWithIds = files.map<FileMetadata>((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type,
      file,
    }));

    setPendingFiles((prev) => [...prev, ...filesWithIds]);
  };

  const handleRemoveFile = (fileId: string) => {
    setPendingFiles((prev) => prev.filter((file) => file.id !== fileId));
  };

  const handleContactFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = [
      "text/csv",
      "text/vcard",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    const isValid =
      validTypes.includes(file.type) || /\.(csv|vcf|xlsx|xls)$/i.test(file.name);

    if (!isValid) {
      toast({
        variant: "destructive",
        title: "Unsupported file",
        description: "Please upload a CSV, VCF, or Excel file.",
      });
      return;
    }

    setContactFile(file);
  };

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
    }
  };

  const triggerFileProcessing = async (agentId: string, files: FileMetadata[]) => {
    if (!files.length) {
      return { successCount: 0, failureCount: 0 };
    }

    const results = await Promise.allSettled(
      files.map(async (file) => {
        const response = await fetch(`${API_URL}/api/process-agent-file`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            agent_id: agentId,
            file_id: file.id,
          }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const errorMessage =
            payload?.error ||
            payload?.message ||
            `Failed to process ${file.name || "file"}`;
          throw new Error(errorMessage);
        }

        console.log("[CreateAgent] File processed", {
          agentId,
          fileId: file.id,
          fileName: file.name,
        });
      })
    );

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    if (failures.length) {
      failures.forEach((failure) => {
        console.error("[CreateAgent] File processing error:", failure.reason);
      });
    }

    return {
      successCount: results.length - failures.length,
      failureCount: failures.length,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Validate phone number format
      const phoneNumber = formData.whatsappPhoneNumber.replace(/[^\d]/g, "");
      if (!phoneNumber || phoneNumber.length < 10) {
        throw new Error("Please enter a valid WhatsApp phone number with country code");
      }

      if (integrationEndpoints.length > 10) {
        throw new Error('Maximum 10 endpoints allowed');
      }

      const sanitizedEndpoints: IntegrationEndpoint[] = integrationEndpoints.map((endpoint) => ({
        id: endpoint.id || crypto.randomUUID(),
        name: endpoint.name.trim(),
        url: endpoint.url.trim(),
      }));

      const seenNames = new Set<string>();
      sanitizedEndpoints.forEach((endpoint) => {
        if (!endpoint.name) {
          throw new Error('Endpoint name is required');
        }

        try {
          const url = new URL(endpoint.url);
          if (url.protocol !== 'https:') {
            throw new Error('Endpoint URLs must use HTTPS');
          }
        } catch (error) {
          throw new Error('Invalid URL format');
        }

        const key = endpoint.name.toLowerCase();
        if (seenNames.has(key)) {
          throw new Error('Endpoint name already exists');
        }
        seenNames.add(key);
      });
      
      const { data, error } = await supabase
        .from("agents")
        .insert({
          user_id: user.id,
          agent_name: formData.agentName,
          description: formData.description,
          whatsapp_phone_number: phoneNumber,
          agent_type: formData.agentType,
          initial_prompt: formData.initialPrompt,
          company_data: formData.companyData,
          integration_endpoints: sanitizedEndpoints,
          uploaded_files: [],
          id: draftAgentId,
          status: "active"
        })
        .select()
        .single();

      if (error || !data) {
        throw error || new Error('Failed to create agent');
      }

      console.log('Agent created successfully:', data);
      console.log('Agent ID:', data.id);

      // Upload pending files now that the agent exists
      if (pendingFiles.length) {
        try {
          const uploadedMetadata = await Promise.all(
            pendingFiles.map(async (pending) => {
              if (!(pending.file instanceof File)) {
                return null;
              }
              const metadata = await uploadFileToStorage(data.id, pending.file);
              return metadata;
            })
          );

          const filteredMetadata = uploadedMetadata.filter((meta): meta is FileMetadata => Boolean(meta));

          if (filteredMetadata.length) {
            await persistAgentFiles(data.id, filteredMetadata);
            const processingSummary = await triggerFileProcessing(data.id, filteredMetadata);

            if (processingSummary.failureCount) {
              toast({
                variant: "destructive",
                title: "File processing issues",
                description:
                  "Agent was created but some files failed to process. You can retry from the agent details page.",
              });
            } else if (processingSummary.successCount) {
              toast({
                title: "Knowledge base ready",
                description: "Uploaded files were processed successfully.",
              });
            }
          }
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
          toast({
            variant: 'destructive',
            title: 'File upload failed',
            description: 'Agent was created but some files could not be uploaded. You can retry from the agent details page.',
          });
        }
      }

      if (contactFile) {
        try {
          await uploadContacts.mutateAsync({ agentId: data.id, file: contactFile });
        } catch (contactError) {
          console.error("Contact upload error:", contactError);
        }
      }

      setCreatedAgentId(data.id);
      setIntegrationEndpoints(sanitizedEndpoints);
      setPendingFiles([]);
      setContactFile(null);
      setShowQRCode(true);

      toast({
        title: "Agent created!",
        description: "Share the QR code to let users chat with your agent on WhatsApp.",
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create agent';
      toast({
        variant: "destructive",
        title: "Error creating agent",
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (showQRCode) {
    return (
      <div className="min-h-screen bg-black">
        <header className="border-b border-white/10 bg-black/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 py-4">
            <Button 
              variant="ghost" 
              onClick={() => navigate("/dashboard")}
              className="hover:bg-white/10 text-gray-300"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </div>
        </header>

        <div className="container mx-auto px-4 py-12 max-w-2xl">
          <Card className="glass-card shadow-glow border-primary/20">
            <CardHeader className="text-center pb-6">
              <Bot className="h-16 w-16 mx-auto mb-4 text-primary animate-pulse-glow" />
              <CardTitle className="text-3xl font-bold text-white mb-2">Agent Created Successfully!</CardTitle>
              <CardDescription className="text-gray-400 text-base">
                Scan this QR code with WhatsApp to connect your agent
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <AgentQRCode 
                agentId={createdAgentId}
                phoneNumber={formData.whatsappPhoneNumber}
              />
              
              <div className="space-y-4">
                <div className="space-y-2 text-sm text-gray-300">
                  <p className="font-semibold text-white">Scan with WhatsApp</p>
                  <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                  <p className="text-gray-400">Ready to scan. Open WhatsApp → Linked Devices to scan the QR.</p>
                </div>
                <div className="rounded-lg bg-muted p-4 space-y-2">
                  <p className="text-sm font-medium">Agent Details:</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium">Phone:</span> +{formData.whatsappPhoneNumber}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium">Agent ID:</span> {createdAgentId.substring(0, 8)}...
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => {
                    setShowQRCode(false);
                    setFormData({
                      agentName: "",
                      description: "",
                      whatsappPhoneNumber: "",
                      agentType: "custom",
                      initialPrompt: "",
                      companyData: {
                        erpSystem: "",
                        crmSystem: "",
                      },
                    });
                    setIntegrationEndpoints([]);
                    setPendingFiles([]);
                    setContactFile(null);
                    setDraftAgentId(crypto.randomUUID());
                  }}
                >
                  Create Another
                </Button>
                <Button 
                  className="flex-1 bg-gradient-primary"
                  onClick={() => navigate("/dashboard")}
                >
                  Go to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

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
        <header className="border-b border-white/10 bg-black/80 backdrop-blur-xl">
          <div className="px-6 py-4">
            <Button 
              variant="ghost" 
              onClick={() => navigate("/dashboard")}
              className="hover:bg-white/10 text-gray-300"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </div>
        </header>

        <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-8 animate-fade-in-up">
          <h1 className="text-4xl font-bold mb-3 text-white">Create New Agent</h1>
          <p className="text-gray-400 text-lg">
            Set up a new AI agent for WhatsApp communication
          </p>
        </div>

        <Card className="glass-card shadow-glow border-white/10">
          <CardHeader className="pb-6">
            <CardTitle className="text-2xl font-bold text-white mb-2">Agent Configuration</CardTitle>
            <CardDescription className="text-gray-400 text-base">
              Configure your agent's basic settings and behavior
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="space-y-2">
                <Label htmlFor="agent-name" className="text-gray-300">Agent Name *</Label>
                <Input
                  id="agent-name"
                  placeholder="e.g., Sales Bot, Support Assistant"
                  value={formData.agentName}
                  onChange={(e) => setFormData({ ...formData, agentName: e.target.value })}
                  required
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="whatsapp-phone" className="text-gray-300">WhatsApp Phone Number *</Label>
                <Input
                  id="whatsapp-phone"
                  type="tel"
                  placeholder="e.g., 919876543210 (with country code)"
                  value={formData.whatsappPhoneNumber}
                  onChange={(e) => setFormData({ ...formData, whatsappPhoneNumber: e.target.value })}
                  required
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300"
                />
                <p className="text-xs text-gray-500">
                  Enter phone number with country code (no + or spaces). Example: 919876543210
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="text-gray-300">Description</Label>
                <Textarea
                  id="description"
                  placeholder="What will this agent do?"
                  rows={4}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300 resize-none"
                />
              </div>

              <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-6">
                <h3 className="font-semibold text-white text-lg">Company Integration</h3>
                
                <div className="space-y-2">
                  <Label htmlFor="erp-system" className="text-gray-300">ERP System</Label>
                  <select
                    id="erp-system"
                    className="w-full rounded-md border border-white/10 bg-white/5 text-white px-3 py-2 focus:border-primary focus:ring-primary/50 transition-all duration-300"
                    value={formData.companyData.erpSystem}
                    onChange={(e) => setFormData({
                      ...formData,
                      companyData: { ...formData.companyData, erpSystem: e.target.value }
                    })}
                  >
                    <option value="" className="bg-[#0a0a0a]">Select ERP System</option>
                    <option value="sap" className="bg-[#0a0a0a]">SAP</option>
                    <option value="oracle" className="bg-[#0a0a0a]">Oracle</option>
                    <option value="netsuite" className="bg-[#0a0a0a]">NetSuite</option>
                    <option value="custom" className="bg-[#0a0a0a]">Custom API</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="crm-system" className="text-gray-300">CRM System</Label>
                  <select
                    id="crm-system"
                    className="w-full rounded-md border border-white/10 bg-white/5 text-white px-3 py-2 focus:border-primary focus:ring-primary/50 transition-all duration-300"
                    value={formData.companyData.crmSystem}
                    onChange={(e) => setFormData({
                      ...formData,
                      companyData: { ...formData.companyData, crmSystem: e.target.value }
                    })}
                  >
                    <option value="" className="bg-[#0a0a0a]">Select CRM System</option>
                    <option value="salesforce" className="bg-[#0a0a0a]">Salesforce</option>
                    <option value="hubspot" className="bg-[#0a0a0a]">HubSpot</option>
                    <option value="zoho" className="bg-[#0a0a0a]">Zoho</option>
                    <option value="custom" className="bg-[#0a0a0a]">Custom API</option>
                  </select>
                </div>

                <IntegrationEndpointsSection
                  endpoints={integrationEndpoints}
                  onChange={setIntegrationEndpoints}
                />
              </div>

              <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-6">
                <h3 className="font-semibold text-white text-lg">Agent Behavior</h3>
                
                <div className="space-y-2">
                  <Label htmlFor="initial-prompt" className="text-gray-300">Initial System Prompt</Label>
                  <Textarea
                    id="initial-prompt"
                    placeholder="You are a helpful assistant..."
                    rows={3}
                    value={formData.initialPrompt}
                    onChange={(e) => setFormData({ ...formData, initialPrompt: e.target.value })}
                    className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300 resize-none"
                  />
                </div>

              </div>

              <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-6">
                <KnowledgeBaseFilesSection
                  files={pendingFiles}
                  onFilesSelected={handleAddFiles}
                  onFileRemove={handleRemoveFile}
                />
              </div>

              <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white text-lg">Contact List (Optional)</h3>
                  {contactFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setContactFile(null)}
                      className="hover:bg-white/10 text-gray-300"
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-sm text-gray-400">
                  Upload contacts now to immediately associate them with your new agent.
                </p>
                <Input
                  type="file"
                  accept=".csv,.vcf,.xls,.xlsx"
                  onChange={handleContactFileChange}
                  className="bg-white/5 border-white/10 text-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-white hover:file:bg-primary/90 cursor-pointer"
                />
                {contactFile && (
                  <p className="text-xs text-gray-400">
                    Selected file: {contactFile.name} ({(contactFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              <Button 
                type="submit" 
                className="w-full bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-[1.02] disabled:opacity-50 py-6 text-lg"
                disabled={isLoading || uploadContacts.isPending}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Creating Agent...
                  </>
                ) : (
                  "Create Agent"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
};

export default CreateAgent;
