import { supabase } from '@/integrations/supabase/client';
import type { FileMetadata, IntegrationEndpoint } from '@/types/agent.types';

const STORAGE_BUCKET = 'agent-files';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function assertValidFile(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('File type not supported. Use PDF, DOC, or DOCX');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File exceeds 10MB limit');
  }
}

function sanitiseFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function uploadAgentFile(agentId: string, file: File): Promise<FileMetadata> {
  if (!agentId) throw new Error('Agent ID is required');
  assertValidFile(file);

  const timestamp = Date.now();
  const safeName = sanitiseFilename(file.name);
  const storagePath = `${agentId}/${timestamp}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error('[agentStorage] Upload failed', uploadError);
    if (uploadError.message?.includes('Bucket not found')) {
      throw new Error('Storage bucket not configured. Please contact support.');
    }
    throw new Error(uploadError.message || 'Upload failed. Try again');
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error('[agentStorage] Failed to create signed URL', signedUrlError);
    throw new Error('Upload succeeded but fetching URL failed');
  }

  const metadata: FileMetadata = {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type,
    url: signedUrlData.signedUrl,
    uploadedAt: new Date().toISOString(),
    storagePath: `${STORAGE_BUCKET}/${storagePath}`,
  };

  return metadata;
}

export async function getSignedUrlForFile(file: FileMetadata): Promise<string> {
  if (file.url) {
    return file.url;
  }

  const storagePath = file.storagePath?.replace(`${STORAGE_BUCKET}/`, '');
  if (!storagePath) {
    throw new Error('File location unavailable. Please re-upload the file.');
  }

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60); // 1 hour

  if (error || !data?.signedUrl) {
    console.error('[agentStorage] Failed to create signed URL', error);
    throw new Error('Failed to load file. Please try again later.');
  }

  return data.signedUrl;
}

export async function updateAgentFiles(agentId: string, files: FileMetadata[]) {
  const { error } = await supabase
    .from('agents')
    .update({ uploaded_files: files })
    .eq('id', agentId);

  if (error) {
    console.error('[agentStorage] Failed to persist uploaded files', error);
    throw new Error('Failed to update files');
  }
}

export async function deleteAgentFile(_agentId: string, file: FileMetadata) {
  if (!file.storagePath) {
    throw new Error('Missing storage path');
  }

  const storagePath = file.storagePath.replace(`${STORAGE_BUCKET}/`, '');

  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath]);

  if (storageError) {
    console.error('[agentStorage] Failed to remove storage object', storageError);
    throw new Error('Delete failed. Try again');
  }
}

export async function updateIntegrationEndpoints(agentId: string, endpoints: IntegrationEndpoint[]) {
  if (endpoints.length > 10) {
    throw new Error('Maximum 10 endpoints allowed');
  }

  const seen = new Set<string>();
  const sanitized = endpoints.map((endpoint) => {
    const key = endpoint.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new Error('Endpoint name already exists');
    }
    seen.add(key);

    return {
      ...endpoint,
      id: endpoint.id || crypto.randomUUID(),
    };
  });

  const { error } = await supabase
    .from('agents')
    .update({ integration_endpoints: sanitized })
    .eq('id', agentId);

  if (error) {
    console.error('[agentStorage] Failed to update integration endpoints', error);
    throw new Error('Failed to update integration endpoints');
  }
}

