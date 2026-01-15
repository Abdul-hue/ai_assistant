import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { useValidatedForm } from '@/hooks/useValidatedForm';
import { agentSchema, AgentFormData } from '@/lib/validation';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { API_URL } from '@/config';
import type { FileMetadata } from '@/types/agent.types';
import {
  uploadAgentFile as uploadFileToStorage,
  updateAgentFiles as persistAgentFiles,
} from '@/lib/agentStorage';
import { useUploadContacts } from '@/hooks/useContacts';

// Import form section components
import { OwnerDetailsForm } from '@/components/agents/create/OwnerDetailsForm';
import { AgentConfigForm } from '@/components/agents/create/AgentConfigForm';
import { CompanyIntegrationForm } from '@/components/agents/create/CompanyIntegrationForm';
import { PersonalityForm } from '@/components/agents/create/PersonalityForm';
import { InstructionsForm } from '@/components/agents/create/InstructionsForm';
import { FileUploadSection } from '@/components/agents/create/FileUploadSection';
import { ContactManagementSection } from '@/components/agents/create/ContactManagementSection';
import AgentQRCode from '@/components/AgentQRCode';

interface Contact {
  name: string;
  phone: string;
  email?: string;
}

export default function CreateAgent() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const uploadContacts = useUploadContacts();

  // Multi-step state
  const [showQRCode, setShowQRCode] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState('');
  const [draftAgentId] = useState(() => crypto.randomUUID());
  
  // Additional data state
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  // Form validation
  const {
    values: formData,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
  } = useValidatedForm(agentSchema, {
    name: '',
    phone_number: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    personality: '',
    instructions: '',
    company_name: '',
    company_website: '',
  });

  // Helper function to trigger file processing
  const triggerFileProcessing = async (agentId: string, files: FileMetadata[]) => {
    try {
      console.log(`[CREATE-AGENT] Triggering file processing for ${files.length} file(s)`, {
        agentId,
        fileIds: files.map(f => f.id),
      });

      const response = await fetch(`${API_URL}/api/agents/${agentId}/process-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fileIds: files.map(f => f.id) }),
      });

        if (!response.ok) {
        const errorText = await response.text();
        console.error('[CREATE-AGENT] File processing failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Failed to trigger file processing: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[CREATE-AGENT] File processing result:', result);

    return {
        successCount: result.successCount || 0,
        failureCount: result.failureCount || 0,
        results: result.results || [],
      };
    } catch (error) {
      console.error('[CREATE-AGENT] Error triggering file processing:', error);
      return { 
        successCount: 0, 
        failureCount: files.length,
        results: files.map(f => ({ fileId: f.id, success: false, error: error.message })),
      };
    }
  };

  // Form submission handler
  const onSubmit = handleSubmit(async (values: AgentFormData) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Combine phone numbers (assuming country code is included in phone_number)
      const ownerFullPhone = values.owner_phone.replace(/[^\d+]/g, '');
      const agentFullPhone = values.phone_number.replace(/[^\d+]/g, '');

      // Create agent in Supabase
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .insert({
          user_id: user.id,
          agent_owner_name: values.owner_name,
          agent_phone_number: ownerFullPhone,
          agent_name: values.name,
          whatsapp_phone_number: agentFullPhone,
          description: values.personality || values.instructions || null,
          initial_prompt: values.instructions || values.personality || null,
          persona: values.personality || null,
          company_data: values.company_name || values.company_website
            ? {
                company_name: values.company_name || null,
                company_website: values.company_website || null,
              }
            : null,
          integration_endpoints: [],
          uploaded_files: [],
          id: draftAgentId,
          is_active: true,
          status: 'pending', // Explicitly set status to match constraint
        })
        .select()
        .single();

      if (agentError || !agentData) {
        throw agentError || new Error('Failed to create agent');
      }

      console.log('Agent created successfully:', agentData);
      setCreatedAgentId(agentData.id);

      // Upload files if any
      if (uploadedFiles.length > 0) {
        try {
          const uploadedMetadata = await Promise.all(
            uploadedFiles.map(async (file) => {
              const metadata = await uploadFileToStorage(agentData.id, file);
              return metadata;
            })
          );

          const filteredMetadata = uploadedMetadata.filter(
            (meta): meta is FileMetadata => Boolean(meta)
          );

          if (filteredMetadata.length > 0) {
            await persistAgentFiles(agentData.id, filteredMetadata);
            const processingSummary = await triggerFileProcessing(agentData.id, filteredMetadata);

            if (processingSummary.failureCount > 0) {
              toast({
                variant: 'destructive',
                title: 'File processing issues',
                description:
                  'Agent was created but some files failed to process. You can retry from the agent details page.',
              });
            } else if (processingSummary.successCount > 0) {
              toast({
                title: 'Knowledge base ready',
                description: 'Uploaded files were processed successfully.',
              });
            }
          }
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
          toast({
            variant: 'destructive',
            title: 'File upload failed',
            description:
              'Agent was created but some files could not be uploaded. You can retry from the agent details page.',
          });
        }
      }

      // Upload contacts if any
      if (contacts.length > 0) {
        try {
          // Convert contacts array to CSV file
          const csv = [
            'Name,Phone,Email',
            ...contacts.map(c => `${c.name},${c.phone},${c.email || ''}`)
          ].join('\n');

          const blob = new Blob([csv], { type: 'text/csv' });
          const contactFile = new File([blob], `contacts_${agentData.id}.csv`, { type: 'text/csv' });

          await uploadContacts.mutateAsync({ agentId: agentData.id, file: contactFile });
          toast({
            title: 'Contacts uploaded',
            description: `${contacts.length} contact(s) uploaded successfully.`,
          });
        } catch (contactError) {
          console.error('Contact upload error:', contactError);
          toast({
            variant: 'destructive',
            title: 'Contact upload failed',
            description: 'Agent was created but contacts could not be uploaded.',
          });
        }
      }

      // Show QR code
      setShowQRCode(true);
      toast({
        title: 'Agent created!',
        description: 'Share the QR code to let users chat with your agent on WhatsApp.',
      });
    } catch (error) {
      console.error('Error creating agent:', error);
      const message = error instanceof Error ? error.message : 'Failed to create agent';
      toast({
        variant: 'destructive',
        title: 'Error creating agent',
        description: message,
      });
    }
  });

  // Show QR code screen if agent created
  if (showQRCode && createdAgentId) {
    const headerContent = (
      <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
          onClick={() => navigate('/dashboard')}
              className="hover:bg-white/10 text-gray-300"
          aria-label="Go back to dashboard"
            >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to Dashboard
            </Button>
          </div>
    );

    return (
      <AppLayout headerContent={headerContent}>
        <div className="container mx-auto px-4 py-12 max-w-2xl">
          <div className="glass-card shadow-glow border-primary/20 rounded-lg p-6">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-white mb-2">Agent Created Successfully!</h1>
              <p className="text-gray-400">
                Scan this QR code with WhatsApp to connect your agent
              </p>
            </div>
              <AgentQRCode 
                agentId={createdAgentId}
              phoneNumber={formData.phone_number}
              />
            <div className="flex gap-4 mt-6">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => {
                    setShowQRCode(false);
                  setCreatedAgentId('');
                  // Reset form would go here if needed
                  }}
                >
                  Create Another
                </Button>
                <Button 
                  className="flex-1 bg-gradient-primary"
                onClick={() => navigate('/dashboard')}
                >
                  Go to Dashboard
                </Button>
              </div>
        </div>
      </div>
      </AppLayout>
    );
  }

  // Show create agent form
  const headerContent = (
    <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
        onClick={() => navigate('/dashboard')}
              className="hover:bg-gray-100 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300"
        aria-label="Go back to dashboard"
            >
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to Dashboard
            </Button>
          </div>
  );

  return (
    <AppLayout headerContent={headerContent}>
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">Create New Agent</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Set up your AI agent by filling out the form below
          </p>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="space-y-6">
          {/* Owner Details */}
          <OwnerDetailsForm
            formData={{
              owner_name: formData.owner_name,
              owner_email: formData.owner_email,
              owner_phone: formData.owner_phone,
            }}
            errors={errors}
            touched={touched}
            onChange={handleChange}
            onBlur={handleBlur}
          />

          {/* Agent Configuration */}
          <AgentConfigForm
            formData={{
              name: formData.name,
              phone_number: formData.phone_number,
            }}
            errors={errors}
            touched={touched}
            onChange={handleChange}
            onBlur={handleBlur}
          />

          {/* Company Integration */}
          <CompanyIntegrationForm
            formData={{
              company_name: formData.company_name,
              company_website: formData.company_website,
            }}
            errors={errors}
            touched={touched}
            onChange={handleChange}
            onBlur={handleBlur}
          />

          {/* Personality */}
          <PersonalityForm
            formData={{ personality: formData.personality }}
            errors={errors}
            touched={touched}
            onChange={handleChange}
            onBlur={handleBlur}
          />

          {/* Instructions */}
          <InstructionsForm
            formData={{ instructions: formData.instructions }}
            errors={errors}
            touched={touched}
            onChange={handleChange}
            onBlur={handleBlur}
          />

          {/* File Upload Section */}
          <FileUploadSection
            files={uploadedFiles}
            onFilesChange={setUploadedFiles}
            disabled={isSubmitting}
          />

          {/* Contact Management Section */}
          <ContactManagementSection
            contacts={contacts}
            onContactsChange={setContacts}
            disabled={isSubmitting}
          />

          {/* Form Actions */}
          <div className="flex flex-col sm:flex-row justify-end gap-4 pt-6 border-t">
                <Button
                  type="button"
                  variant="outline"
              onClick={() => navigate('/dashboard')}
              disabled={isSubmitting}
              className="sm:w-auto w-full"
            >
              Cancel
                    </Button>
          <Button 
            type="submit" 
              disabled={isSubmitting}
              className="sm:w-auto w-full"
          >
              {isSubmitting ? (
              <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Creating Agent...
              </>
            ) : (
                'Create Agent'
            )}
          </Button>
          </div>
        </form>
        </div>
    </AppLayout>
);
}
