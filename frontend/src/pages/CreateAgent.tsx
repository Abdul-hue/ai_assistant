import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Bot, Loader2, MessageSquare, LayoutDashboard, Plus, Calendar as CalendarIcon, Settings, Home, User, Phone, FileText, Globe, Clock, Building2, Users, Upload, Trash2 } from "lucide-react";
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
    // Owner Details
    agentOwnerName: "",
    ownerCountryCode: "+92",
    ownerPhoneNumber: "",
    ownerNotes: "",
    
    // Agent Configuration
    agentName: "",
    agentCountryCode: "+92",
    agentPhoneNumber: "",
    responseLanguages: ["english"], // Array for multiple languages
    timezone: "Asia/Karachi",
    persona: "",
    agentType: "custom",
    
    // Company Integration (kept for backwards compatibility)
    description: "",
    whatsappPhoneNumber: "",
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

      // Validate Owner Details
      if (!formData.agentOwnerName.trim()) {
        throw new Error("Agent owner name is required");
      }
      if (!formData.ownerPhoneNumber.trim()) {
        throw new Error("Owner phone number is required");
      }

      // Validate Agent Configuration
      if (!formData.agentName.trim()) {
        throw new Error("Agent name is required");
      }
      if (!formData.agentPhoneNumber.trim()) {
        throw new Error("Agent WhatsApp number is required");
      }

      // Combine country codes with phone numbers
      const ownerFullPhone = `${formData.ownerCountryCode}${formData.ownerPhoneNumber}`.replace(/[^\d]/g, "");
      const agentFullPhone = `${formData.agentCountryCode}${formData.agentPhoneNumber}`.replace(/[^\d]/g, "");

      // Validate phone number format
      if (ownerFullPhone.length < 10) {
        throw new Error("Please enter a valid owner phone number");
      }
      if (agentFullPhone.length < 10) {
        throw new Error("Please enter a valid WhatsApp phone number for the agent");
      }

      const phoneNumber = agentFullPhone; // For backwards compatibility

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
          // Owner Details
          agent_owner_name: formData.agentOwnerName,
          agent_phone_number: ownerFullPhone,
          description: formData.ownerNotes, // Notes saved in description field
          // Agent Configuration
          agent_name: formData.agentName,
          whatsapp_phone_number: agentFullPhone,
          response_languages: formData.responseLanguages, // Already an array
          timezone: formData.timezone,
          persona: formData.persona,
          // Company Integration
          agent_type: formData.agentType,
          initial_prompt: formData.persona, // Also save in initial_prompt for backwards compatibility
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
                phoneNumber={`${formData.agentCountryCode}${formData.agentPhoneNumber}`}
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
                    <span className="font-medium">Owner:</span> {formData.agentOwnerName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium">Agent:</span> {formData.agentName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium">Phone:</span> {formData.agentCountryCode}{formData.agentPhoneNumber}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium">Languages:</span> {formData.responseLanguages.map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(', ')}
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
                      // Owner Details
                      agentOwnerName: "",
                      ownerCountryCode: "+92",
                      ownerPhoneNumber: "",
                      ownerNotes: "",
                      // Agent Configuration
                      agentName: "",
                      agentCountryCode: "+92",
                      agentPhoneNumber: "",
                      responseLanguages: ["english"],
                      timezone: "Asia/Karachi",
                      persona: "",
                      agentType: "custom",
                      // Backwards compatibility
                      description: "",
                      whatsappPhoneNumber: "",
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

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* SECTION 1: Owner Details */}
          <Card className="glass-card shadow-glow border-white/10">
            <CardHeader className="pb-6">
              <CardTitle className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <User className="w-6 h-6 text-primary" />
                Owner Details
              </CardTitle>
              <CardDescription className="text-gray-400 text-base">
                Information about the agent owner
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Agent Owner Name */}
              <div className="space-y-2">
                <Label htmlFor="owner-name" className="text-gray-300">
                  Agent Owner Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="owner-name"
                  type="text"
                  placeholder="Enter your full name"
                  value={formData.agentOwnerName}
                  onChange={(e) => setFormData({...formData, agentOwnerName: e.target.value})}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300"
                  required
                />
              </div>

              {/* Owner Phone Number with Country Code */}
              <div className="space-y-2">
                <Label htmlFor="owner-phone" className="text-gray-300">
                  Phone Number <span className="text-red-500">*</span>
                </Label>
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <Select
                    value={formData.ownerCountryCode}
                    onValueChange={(value) => setFormData({...formData, ownerCountryCode: value})}
                  >
                    <SelectTrigger className="bg-white/5 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px] bg-[#0a0a0a] border-white/10">
                      <SelectItem value="+92">🇵🇰 Pakistan (+92)</SelectItem>
                      <SelectItem value="+1">🇺🇸 United States (+1)</SelectItem>
                      <SelectItem value="+44">🇬🇧 United Kingdom (+44)</SelectItem>
                      <SelectItem value="+91">🇮🇳 India (+91)</SelectItem>
                      <SelectItem value="+971">🇦🇪 UAE (+971)</SelectItem>
                      <SelectItem value="+966">🇸🇦 Saudi Arabia (+966)</SelectItem>
                      <SelectItem value="+86">🇨🇳 China (+86)</SelectItem>
                      <SelectItem value="+81">🇯🇵 Japan (+81)</SelectItem>
                      <SelectItem value="+82">🇰🇷 South Korea (+82)</SelectItem>
                      <SelectItem value="+49">🇩🇪 Germany (+49)</SelectItem>
                      <SelectItem value="+33">🇫🇷 France (+33)</SelectItem>
                      <SelectItem value="+39">🇮🇹 Italy (+39)</SelectItem>
                      <SelectItem value="+34">🇪🇸 Spain (+34)</SelectItem>
                      <SelectItem value="+7">🇷🇺 Russia (+7)</SelectItem>
                      <SelectItem value="+55">🇧🇷 Brazil (+55)</SelectItem>
                      <SelectItem value="+52">🇲🇽 Mexico (+52)</SelectItem>
                      <SelectItem value="+27">🇿🇦 South Africa (+27)</SelectItem>
                      <SelectItem value="+61">🇦🇺 Australia (+61)</SelectItem>
                      <SelectItem value="+64">🇳🇿 New Zealand (+64)</SelectItem>
                      <SelectItem value="+65">🇸🇬 Singapore (+65)</SelectItem>
                      <SelectItem value="+60">🇲🇾 Malaysia (+60)</SelectItem>
                      <SelectItem value="+62">🇮🇩 Indonesia (+62)</SelectItem>
                      <SelectItem value="+63">🇵🇭 Philippines (+63)</SelectItem>
                      <SelectItem value="+66">🇹🇭 Thailand (+66)</SelectItem>
                      <SelectItem value="+84">🇻🇳 Vietnam (+84)</SelectItem>
                      <SelectItem value="+20">🇪🇬 Egypt (+20)</SelectItem>
                      <SelectItem value="+234">🇳🇬 Nigeria (+234)</SelectItem>
                      <SelectItem value="+254">🇰🇪 Kenya (+254)</SelectItem>
                      <SelectItem value="+90">🇹🇷 Turkey (+90)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    id="owner-phone"
                    type="tel"
                    placeholder="3001234567"
                    value={formData.ownerPhoneNumber}
                    onChange={(e) => setFormData({...formData, ownerPhoneNumber: e.target.value.replace(/\D/g, '')})}
                    className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300"
                    required
                  />
                </div>
                <p className="text-xs text-gray-400">Enter number without country code or spaces</p>
              </div>

              {/* Owner Notes */}
              <div className="space-y-2">
                <Label htmlFor="owner-notes" className="text-gray-300">
                  Notes <span className="text-gray-400">(Optional)</span>
                </Label>
                <Textarea
                  id="owner-notes"
                  placeholder="Personal notes about this agent (visible only to you)"
                  value={formData.ownerNotes}
                  onChange={(e) => {
                    if (e.target.value.length <= 500) {
                      setFormData({...formData, ownerNotes: e.target.value});
                    }
                  }}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300 resize-none min-h-[80px]"
                  maxLength={500}
                />
                <p className="text-xs text-gray-400 text-right">
                  {formData.ownerNotes.length} / 500 characters
                </p>
              </div>
            </CardContent>
          </Card>

          {/* SECTION 2: Agent Configuration */}
          <Card className="glass-card shadow-glow border-white/10">
            <CardHeader className="pb-6">
              <CardTitle className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <Bot className="w-6 h-6 text-primary" />
                Agent Configuration
              </CardTitle>
              <CardDescription className="text-gray-400 text-base">
                Configure your AI agent's settings and behavior
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Agent Name */}
              <div className="space-y-2">
                <Label htmlFor="agent-name" className="text-gray-300">
                  Agent Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="agent-name"
                  placeholder="e.g., Sales Assistant"
                  value={formData.agentName}
                  onChange={(e) => setFormData({ ...formData, agentName: e.target.value })}
                  required
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300"
                />
              </div>

              {/* Agent WhatsApp Number with Country Code */}
              <div className="space-y-2">
                <Label htmlFor="agent-number" className="text-gray-300">
                  Agent Number (WhatsApp) <span className="text-red-500">*</span>
                </Label>
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <Select
                    value={formData.agentCountryCode}
                    onValueChange={(value) => setFormData({...formData, agentCountryCode: value})}
                  >
                    <SelectTrigger className="bg-white/5 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px] bg-[#0a0a0a] border-white/10">
                      <SelectItem value="+92">🇵🇰 Pakistan (+92)</SelectItem>
                      <SelectItem value="+1">🇺🇸 United States (+1)</SelectItem>
                      <SelectItem value="+44">🇬🇧 United Kingdom (+44)</SelectItem>
                      <SelectItem value="+91">🇮🇳 India (+91)</SelectItem>
                      <SelectItem value="+971">🇦🇪 UAE (+971)</SelectItem>
                      <SelectItem value="+966">🇸🇦 Saudi Arabia (+966)</SelectItem>
                      <SelectItem value="+86">🇨🇳 China (+86)</SelectItem>
                      <SelectItem value="+81">🇯🇵 Japan (+81)</SelectItem>
                      <SelectItem value="+82">🇰🇷 South Korea (+82)</SelectItem>
                      <SelectItem value="+49">🇩🇪 Germany (+49)</SelectItem>
                      <SelectItem value="+33">🇫🇷 France (+33)</SelectItem>
                      <SelectItem value="+39">🇮🇹 Italy (+39)</SelectItem>
                      <SelectItem value="+34">🇪🇸 Spain (+34)</SelectItem>
                      <SelectItem value="+7">🇷🇺 Russia (+7)</SelectItem>
                      <SelectItem value="+55">🇧🇷 Brazil (+55)</SelectItem>
                      <SelectItem value="+52">🇲🇽 Mexico (+52)</SelectItem>
                      <SelectItem value="+27">🇿🇦 South Africa (+27)</SelectItem>
                      <SelectItem value="+61">🇦🇺 Australia (+61)</SelectItem>
                      <SelectItem value="+64">🇳🇿 New Zealand (+64)</SelectItem>
                      <SelectItem value="+65">🇸🇬 Singapore (+65)</SelectItem>
                      <SelectItem value="+60">🇲🇾 Malaysia (+60)</SelectItem>
                      <SelectItem value="+62">🇮🇩 Indonesia (+62)</SelectItem>
                      <SelectItem value="+63">🇵🇭 Philippines (+63)</SelectItem>
                      <SelectItem value="+66">🇹🇭 Thailand (+66)</SelectItem>
                      <SelectItem value="+84">🇻🇳 Vietnam (+84)</SelectItem>
                      <SelectItem value="+20">🇪🇬 Egypt (+20)</SelectItem>
                      <SelectItem value="+234">🇳🇬 Nigeria (+234)</SelectItem>
                      <SelectItem value="+254">🇰🇪 Kenya (+254)</SelectItem>
                      <SelectItem value="+90">🇹🇷 Turkey (+90)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    id="agent-number"
                    type="tel"
                    placeholder="3001234567"
                    value={formData.agentPhoneNumber}
                    onChange={(e) => setFormData({...formData, agentPhoneNumber: e.target.value.replace(/\D/g, '')})}
                    className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300"
                    required
                  />
                </div>
                <p className="text-xs text-gray-400">WhatsApp number for this agent</p>
              </div>

              {/* Response Languages - Multi-Select Checkbox Grid */}
              <div className="space-y-2">
                <Label className="text-gray-300">
                  Response Languages <span className="text-red-500">*</span>
                </Label>
                <p className="text-xs text-gray-400 mb-3">
                  Select languages your agent can respond in (English is required)
                </p>
                
                {/* Checkbox Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-4 bg-white/5 rounded-lg border border-white/10 max-h-[300px] overflow-y-auto">
                  {[
                    { code: 'english', name: 'English', flag: '🇺🇸', required: true },
                    { code: 'spanish', name: 'Spanish', flag: '🇪🇸' },
                    { code: 'hindi', name: 'Hindi', flag: '🇮🇳' },
                    { code: 'arabic', name: 'Arabic', flag: '🇸🇦' },
                    { code: 'urdu', name: 'Urdu', flag: '🇵🇰' },
                    { code: 'french', name: 'French', flag: '🇫🇷' },
                    { code: 'german', name: 'German', flag: '🇩🇪' },
                    { code: 'portuguese', name: 'Portuguese', flag: '🇵🇹' },
                    { code: 'russian', name: 'Russian', flag: '🇷🇺' },
                    { code: 'chinese', name: 'Chinese', flag: '🇨🇳' },
                    { code: 'japanese', name: 'Japanese', flag: '🇯🇵' },
                    { code: 'korean', name: 'Korean', flag: '🇰🇷' },
                    { code: 'italian', name: 'Italian', flag: '🇮🇹' },
                    { code: 'dutch', name: 'Dutch', flag: '🇳🇱' },
                    { code: 'turkish', name: 'Turkish', flag: '🇹🇷' },
                    { code: 'bengali', name: 'Bengali', flag: '🇧🇩' },
                    { code: 'vietnamese', name: 'Vietnamese', flag: '🇻🇳' },
                    { code: 'thai', name: 'Thai', flag: '🇹🇭' },
                    { code: 'indonesian', name: 'Indonesian', flag: '🇮🇩' },
                    { code: 'malay', name: 'Malay', flag: '🇲🇾' },
                    { code: 'filipino', name: 'Filipino', flag: '🇵🇭' },
                  ].map((lang) => {
                    const isChecked = formData.responseLanguages.includes(lang.code);
                    const isDisabled = lang.required;
                    
                    return (
                      <label
                        key={lang.code}
                        className={`
                          flex items-center gap-2 p-2.5 rounded-md cursor-pointer transition-all
                          ${isChecked 
                            ? 'bg-primary/20 border-2 border-primary' 
                            : 'bg-white/5 border border-white/10 hover:bg-white/10'
                          }
                          ${isDisabled ? 'opacity-75 cursor-not-allowed' : ''}
                        `}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isDisabled}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                responseLanguages: [...formData.responseLanguages, lang.code]
                              });
                            } else {
                              setFormData({
                                ...formData,
                                responseLanguages: formData.responseLanguages.filter(l => l !== lang.code)
                              });
                            }
                          }}
                          className="rounded border-white/20"
                        />
                        <span className="text-lg">{lang.flag}</span>
                        <span className="text-white text-sm flex-1">{lang.name}</span>
                        {lang.required && (
                          <span className="text-xs text-gray-400">(Required)</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                
                <p className="text-xs text-gray-400 mt-2">
                  Selected: {formData.responseLanguages.length} language{formData.responseLanguages.length !== 1 ? 's' : ''}
                </p>
              </div>

              {/* Timezone */}
              <div className="space-y-2">
                <Label htmlFor="timezone" className="text-gray-300">
                  Timezone <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={formData.timezone}
                  onValueChange={(value) => setFormData({...formData, timezone: value})}
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px] bg-[#0a0a0a] border-white/10">
                    {/* Asia/Pacific */}
                    <SelectItem value="Asia/Karachi">🇵🇰 Pakistan (Asia/Karachi, UTC+5)</SelectItem>
                    <SelectItem value="Asia/Dubai">🇦🇪 Dubai (Asia/Dubai, UTC+4)</SelectItem>
                    <SelectItem value="Asia/Riyadh">🇸🇦 Riyadh (Asia/Riyadh, UTC+3)</SelectItem>
                    <SelectItem value="Asia/Kolkata">🇮🇳 India (Asia/Kolkata, UTC+5:30)</SelectItem>
                    <SelectItem value="Asia/Shanghai">🇨🇳 China (Asia/Shanghai, UTC+8)</SelectItem>
                    <SelectItem value="Asia/Tokyo">🇯🇵 Japan (Asia/Tokyo, UTC+9)</SelectItem>
                    <SelectItem value="Asia/Seoul">🇰🇷 South Korea (Asia/Seoul, UTC+9)</SelectItem>
                    <SelectItem value="Asia/Singapore">🇸🇬 Singapore (Asia/Singapore, UTC+8)</SelectItem>
                    <SelectItem value="Asia/Bangkok">🇹🇭 Bangkok (Asia/Bangkok, UTC+7)</SelectItem>
                    <SelectItem value="Asia/Jakarta">🇮🇩 Jakarta (Asia/Jakarta, UTC+7)</SelectItem>
                    {/* Europe */}
                    <SelectItem value="Europe/London">🇬🇧 London (Europe/London, UTC+0)</SelectItem>
                    <SelectItem value="Europe/Paris">🇫🇷 Paris (Europe/Paris, UTC+1)</SelectItem>
                    <SelectItem value="Europe/Berlin">🇩🇪 Berlin (Europe/Berlin, UTC+1)</SelectItem>
                    <SelectItem value="Europe/Rome">🇮🇹 Rome (Europe/Rome, UTC+1)</SelectItem>
                    <SelectItem value="Europe/Moscow">🇷🇺 Moscow (Europe/Moscow, UTC+3)</SelectItem>
                    <SelectItem value="Europe/Istanbul">🇹🇷 Istanbul (Europe/Istanbul, UTC+3)</SelectItem>
                    {/* Americas */}
                    <SelectItem value="America/New_York">🇺🇸 New York (EST, UTC-5)</SelectItem>
                    <SelectItem value="America/Chicago">🇺🇸 Chicago (CST, UTC-6)</SelectItem>
                    <SelectItem value="America/Denver">🇺🇸 Denver (MST, UTC-7)</SelectItem>
                    <SelectItem value="America/Los_Angeles">🇺🇸 Los Angeles (PST, UTC-8)</SelectItem>
                    <SelectItem value="America/Toronto">🇨🇦 Toronto (EST, UTC-5)</SelectItem>
                    <SelectItem value="America/Mexico_City">🇲🇽 Mexico City (CST, UTC-6)</SelectItem>
                    <SelectItem value="America/Sao_Paulo">🇧🇷 São Paulo (BRT, UTC-3)</SelectItem>
                    {/* Australia/Oceania */}
                    <SelectItem value="Australia/Sydney">🇦🇺 Sydney (AEDT, UTC+11)</SelectItem>
                    <SelectItem value="Australia/Melbourne">🇦🇺 Melbourne (AEDT, UTC+11)</SelectItem>
                    <SelectItem value="Pacific/Auckland">🇳🇿 Auckland (NZDT, UTC+13)</SelectItem>
                    {/* Africa */}
                    <SelectItem value="Africa/Cairo">🇪🇬 Cairo (EET, UTC+2)</SelectItem>
                    <SelectItem value="Africa/Johannesburg">🇿🇦 Johannesburg (SAST, UTC+2)</SelectItem>
                    <SelectItem value="Africa/Lagos">🇳🇬 Lagos (WAT, UTC+1)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">Agent operates in this timezone</p>
              </div>

              {/* Persona (renamed from Initial Prompt) */}
              <div className="space-y-2">
                <Label htmlFor="persona" className="text-gray-300">
                  Persona <span className="text-gray-400">(Optional)</span>
                </Label>
                <Textarea
                  id="persona"
                  placeholder="You are a helpful sales assistant who provides product information and helps customers make purchasing decisions..."
                  value={formData.persona}
                  onChange={(e) => setFormData({...formData, persona: e.target.value})}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 transition-all duration-300 resize-none min-h-[120px]"
                />
                <p className="text-xs text-gray-400">Define your agent's personality and behavior</p>
              </div>
            </CardContent>
          </Card>

          {/* SECTION 3: Company Integration */}
          <Card className="glass-card shadow-glow border-white/10">
            <CardHeader className="pb-6">
              <CardTitle className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <Building2 className="w-6 h-6 text-primary" />
                Company Integration
                <Badge variant="secondary" className="ml-2 text-xs">Optional</Badge>
              </CardTitle>
              <CardDescription className="text-gray-400 text-base">
                Connect your business systems (optional)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4"  >
                
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
            </CardContent>
          </Card>

          {/* SECTION 4: Knowledge Base Files */}
          <Card className="glass-card shadow-glow border-white/10">
            <CardHeader className="pb-6">
              <CardTitle className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <FileText className="w-6 h-6 text-primary" />
                Knowledge Base Files
                <Badge variant="secondary" className="ml-2 text-xs">Optional</Badge>
              </CardTitle>
              <CardDescription className="text-gray-400 text-base">
                Upload documents to train your agent (PDF, DOC, DOCX)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KnowledgeBaseFilesSection
                files={pendingFiles}
                onFilesSelected={handleAddFiles}
                onFileRemove={handleRemoveFile}
              />
            </CardContent>
          </Card>

          {/* SECTION 5: Contact List */}
          <Card className="glass-card shadow-glow border-white/10">
            <CardHeader className="pb-6">
              <CardTitle className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <Users className="w-6 h-6 text-primary" />
                Contact List
                <Badge variant="secondary" className="ml-2 text-xs">Optional</Badge>
              </CardTitle>
              <CardDescription className="text-gray-400 text-base">
                Upload contacts for this agent (CSV, VCF, XLSX)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Show upload area if no file selected */}
              {!contactFile ? (
                <div
                  className="border-2 border-dashed border-white/10 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => document.getElementById('contact-file-input')?.click()}
                >
                  <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                  <p className="text-white mb-2">
                    Drag & drop contact file here, or click to browse
                  </p>
                  <p className="text-sm text-gray-400">
                    Supported formats: CSV, VCF, XLSX (Max 10MB)
                  </p>
                  <input
                    id="contact-file-input"
                    type="file"
                    accept=".csv,.vcf,.xlsx"
                    onChange={handleContactFileChange}
                    className="hidden"
                  />
                </div>
              ) : (
                /* Show selected file with red delete icon (matching Knowledge Base style) */
                <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate">
                          {contactFile.name}
                        </p>
                        <p className="text-sm text-gray-400">
                          {(contactFile.size / 1024).toFixed(2)} KB
                        </p>
                      </div>
                    </div>
                    
                    {/* Red Delete Icon Button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setContactFile(null)}
                      className="hover:bg-red-500/10 text-red-500 hover:text-red-400"
                    >
                      <Trash2 className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Submit Button */}
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
        </div>
      </div>
    </div>
  );
};

export default CreateAgent;
