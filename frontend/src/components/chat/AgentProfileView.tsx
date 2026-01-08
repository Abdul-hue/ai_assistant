/**
 * AgentProfileView Component - WhatsApp Style
 * 
 * Displays agent profile information in WhatsApp-style interface
 * Allows editing avatar, name, persona, and phone number
 */

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Camera, Phone, User, FileText, Loader2, Trash2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { uploadAgentAvatar, deleteAgentAvatar, updateAgent, Agent } from '@/lib/api/agents';

interface AgentProfileViewProps {
  agent: Agent;
  onClose: () => void;
  onUpdate: (updatedAgent: Agent) => void;
}

export const AgentProfileView: React.FC<AgentProfileViewProps> = ({ agent, onClose, onUpdate }) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [previewUrl, setPreviewUrl] = useState<string | null>(agent.avatar_url || null);
  const [uploading, setUploading] = useState(false);
  const [deletingAvatar, setDeletingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  
  const [formData, setFormData] = useState({
    agent_name: agent.agent_name || '',
    persona: agent.persona || '',
    whatsapp_phone_number: agent.whatsapp_phone_number || '',
  });

  // Update form data when agent prop changes
  useEffect(() => {
    setFormData({
      agent_name: agent.agent_name || '',
      persona: agent.persona || '',
      whatsapp_phone_number: agent.whatsapp_phone_number || '',
    });
    // Only set preview URL if it's not a blob URL (permanent URL from database)
    if (agent.avatar_url && !agent.avatar_url.startsWith('blob:')) {
      setPreviewUrl(agent.avatar_url);
    } else if (!agent.avatar_url) {
      setPreviewUrl(null);
    }
  }, [agent]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      // Clean up any blob URLs when component unmounts
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const initials = (agent.agent_name || 'A')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast({
        variant: 'destructive',
        title: 'Invalid file type',
        description: 'Please upload a JPG, PNG, GIF, or WEBP image.',
      });
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      toast({
        variant: 'destructive',
        title: 'File too large',
        description: 'Please upload an image smaller than 5MB.',
      });
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Store the File object for upload during save
    setPendingAvatarFile(file);
    
    // Create blob URL for preview (will be cleaned up later)
    const previewBlobUrl = URL.createObjectURL(file);
    setPreviewUrl(previewBlobUrl);
    
    // Clean up previous blob URL if exists
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
  };

  const handleDeleteAvatar = async () => {
    setDeletingAvatar(true);
    try {
      await deleteAgentAvatar(agent.id);
      setPreviewUrl(null);
      const updatedAgent = { ...agent, avatar_url: null };
      onUpdate(updatedAgent);
      toast({ title: 'Avatar removed', description: 'Agent avatar has been removed.' });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: error.message,
      });
    } finally {
      setDeletingAvatar(false);
    }
  };

  const handleSave = async () => {
    // Validate required fields
    if (!formData.agent_name || formData.agent_name.trim() === '') {
      toast({
        variant: 'destructive',
        title: 'Validation error',
        description: 'Agent name is required and cannot be empty.',
      });
      return;
    }

    setSaving(true);
    setUploading(!!pendingAvatarFile); // Show uploading state if avatar is being uploaded
    
    try {
      let avatarUrl = agent.avatar_url || null;

      // Step 1: Upload avatar to Supabase storage if a new file is selected
      if (pendingAvatarFile) {
        console.log('[AgentProfileView] Uploading avatar to Supabase storage...');
        try {
          // Upload via backend API which handles Supabase storage
          const avatarUpdatedAgent = await uploadAgentAvatar(agent.id, pendingAvatarFile);
          avatarUrl = avatarUpdatedAgent.avatar_url || null;
          
          if (!avatarUrl) {
            throw new Error('Avatar upload succeeded but no URL returned');
          }
          
          console.log('[AgentProfileView] Avatar uploaded successfully:', avatarUrl);
          
          // Clean up blob URL and replace with permanent URL
          if (previewUrl && previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl);
          }
          setPreviewUrl(avatarUrl);
          setPendingAvatarFile(null);
        } catch (avatarError: any) {
          console.error('[AgentProfileView] Avatar upload failed:', avatarError);
          setUploading(false);
          
          // Ask user if they want to continue saving other fields
          toast({
            variant: 'destructive',
            title: 'Avatar upload failed',
            description: avatarError.message || 'Failed to upload avatar. Other changes will still be saved.',
          });
          
          // Continue with save using existing avatar URL
          avatarUrl = agent.avatar_url || null;
          // Reset preview to existing avatar
          if (previewUrl && previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(avatarUrl);
          }
          setPendingAvatarFile(null);
        }
      }

      setUploading(false);

      // Step 2: Update agent_name and persona in database
      console.log('[AgentProfileView] Saving agent to database:', {
        agentId: agent.id,
        agent_name: formData.agent_name.trim(),
        persona: formData.persona.trim() || null,
        avatar_url: avatarUrl,
      });

      // Update agent - always include all fields to ensure they're saved
      const updatePayload: { agent_name: string; persona: string | null; avatar_url: string | null } = {
        agent_name: formData.agent_name.trim(),
        persona: formData.persona.trim() || null,
        avatar_url: avatarUrl || null, // Include the avatar URL (from upload or existing)
      };

      console.log('[AgentProfileView] Update payload being sent:', updatePayload);

      let updatedAgent: Agent;
      try {
        updatedAgent = await updateAgent(agent.id, updatePayload);
        console.log('[AgentProfileView] Agent updated successfully:', updatedAgent);
      } catch (updateError: any) {
        console.error('[AgentProfileView] Update agent call failed:', updateError);
        throw updateError;
      }

      // Validate response
      if (!updatedAgent) {
        console.error('[AgentProfileView] updatedAgent is null/undefined');
        throw new Error('Update succeeded but no agent data returned from server');
      }

      if (!updatedAgent.id) {
        console.error('[AgentProfileView] Invalid agent response - missing id:', updatedAgent);
        throw new Error('Update succeeded but invalid agent data returned (missing ID)');
      }

      if (!updatedAgent.agent_name) {
        console.error('[AgentProfileView] Invalid agent response - missing agent_name:', updatedAgent);
        throw new Error('Update succeeded but invalid agent data returned (missing agent_name)');
      }

      // Step 3: Update local state with the response from server
      // Use updated values from server, fallback to form data if missing
      const newAgentName = updatedAgent.agent_name || formData.agent_name || agent.agent_name;
      const newPersona = updatedAgent.persona !== undefined ? updatedAgent.persona : formData.persona;
      const newAvatarUrl = updatedAgent.avatar_url !== undefined ? updatedAgent.avatar_url : avatarUrl;
      const newPhoneNumber = updatedAgent.whatsapp_phone_number || formData.whatsapp_phone_number || agent.whatsapp_phone_number;

      console.log('[AgentProfileView] Updating local state:', {
        newAgentName,
        newPersona,
        newAvatarUrl,
        newPhoneNumber,
      });

      setFormData({
        agent_name: newAgentName,
        persona: newPersona || '',
        whatsapp_phone_number: newPhoneNumber || '',
      });

      // Update preview URL with permanent URL from database
      if (newAvatarUrl && !newAvatarUrl.startsWith('blob:')) {
        // Clean up blob URL if exists
        if (previewUrl && previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(previewUrl);
        }
        setPreviewUrl(newAvatarUrl);
        console.log('[AgentProfileView] Avatar URL updated:', newAvatarUrl);
      } else if (!newAvatarUrl) {
        // If avatar was removed, clean up blob URL
        if (previewUrl && previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(previewUrl);
        }
        setPreviewUrl(null);
      }

      // Clear pending file
      setPendingAvatarFile(null);

      // Create complete agent object for parent component
      const completeUpdatedAgent: Agent = {
        ...agent,
        ...updatedAgent,
        agent_name: newAgentName,
        persona: newPersona || null,
        avatar_url: newAvatarUrl || null,
        whatsapp_phone_number: newPhoneNumber || null,
      };

      console.log('[AgentProfileView] Notifying parent with updated agent:', completeUpdatedAgent);

      // Notify parent component with complete agent data
      onUpdate(completeUpdatedAgent);
      
      toast({
        title: 'Profile updated',
        description: `Agent "${newAgentName}" has been updated successfully.`,
      });
    } catch (error: any) {
      console.error('[AgentProfileView] Update failed:', error);
      setUploading(false);
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: error.message || 'Failed to update agent profile. Please try again.',
      });
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header - Only Avatar + Name + Phone (NO PERSONA) */}
      <div className="bg-teal-700 text-white shadow-lg shrink-0">
        <div className="px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-teal-600 h-10 w-10 rounded-full transition-colors"
              onClick={onClose}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            
            <Avatar className="h-12 w-12 border-2 border-white">
              {previewUrl ? (
                <AvatarImage src={previewUrl} alt={formData.agent_name} className="object-cover" />
              ) : null}
              <AvatarFallback className="bg-teal-600 text-white text-lg font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold truncate">{formData.agent_name}</h2>
              {formData.whatsapp_phone_number && (
                <p className="text-sm text-teal-100 truncate">{formData.whatsapp_phone_number}</p>
              )}
              {/* IMPORTANT: Persona is NOT displayed in header */}
            </div>
          </div>
        </div>
      </div>

      {/* Form Content - Full width with centered content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Avatar Upload Section */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Avatar className="h-32 w-32 border-4 border-teal-500 shadow-lg">
                  {previewUrl ? (
                    <AvatarImage src={previewUrl} alt={formData.agent_name} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-gray-300 text-gray-600 text-4xl font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <label
                  htmlFor="agent-avatar-upload"
                  className="absolute bottom-0 right-0 bg-teal-600 hover:bg-teal-700 p-3 rounded-full cursor-pointer shadow-lg transition-colors"
                >
                  {(uploading || saving) ? (
                    <Loader2 className="h-5 w-5 text-white animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" />
                  )}
                  <input
                    id="agent-avatar-upload"
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarChange}
                    disabled={uploading || saving}
                  />
                </label>
              </div>
              <p className="text-sm text-gray-500">Click camera icon to change avatar</p>
              {previewUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteAvatar}
                  disabled={deletingAvatar}
                  className="text-red-600 border-red-300 hover:bg-red-50"
                >
                  {deletingAvatar ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Removing...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" /> Remove Avatar
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Name Field */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Agent Name
            </label>
            <Input
              type="text"
              value={formData.agent_name}
              onChange={(e) => setFormData({ ...formData, agent_name: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              placeholder="Enter agent name"
            />
          </div>

          {/* Phone Number Field - Read Only */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <Phone className="h-4 w-4" />
              WhatsApp Phone Number
            </label>
            <Input
              type="text"
              value={formData.whatsapp_phone_number}
              disabled
              className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-2">Phone number cannot be changed</p>
          </div>

          {/* Persona Field */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Agent Persona
            </label>
            <Textarea
              value={formData.persona}
              onChange={(e) => setFormData({ ...formData, persona: e.target.value })}
              rows={6}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
              placeholder="Describe your agent's personality and behavior..."
            />
            <p className="text-xs text-gray-500 mt-2">
              This defines how your agent communicates with contacts
            </p>
          </div>

          {/* Spacer for sticky button */}
          <div className="h-20" />
        </div>
      </div>

      {/* Sticky Save Button */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 shadow-lg shrink-0">
        <div className="max-w-2xl mx-auto px-6 py-4">
          <Button
            onClick={handleSave}
            disabled={saving || !formData.agent_name.trim()}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-5 w-5" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

