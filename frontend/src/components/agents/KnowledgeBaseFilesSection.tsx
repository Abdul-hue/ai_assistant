import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import FileDropzone from './FileDropzone';
import FileList from './FileList';
import type { FileMetadata } from '@/types/agent.types';
import { getSignedUrlForFile } from '@/lib/agentStorage';

interface KnowledgeBaseFilesSectionProps {
  files: FileMetadata[];
  onFilesSelected: (files: File[]) => void;
  onFileRemove: (fileId: string) => void;
  maxTotalSize?: number;
  maxFileSize?: number;
}

const DEFAULT_MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_PER_BATCH = 5;

export default function KnowledgeBaseFilesSection({
  files,
  onFilesSelected,
  onFileRemove,
  maxTotalSize = DEFAULT_MAX_TOTAL_SIZE,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
}: KnowledgeBaseFilesSectionProps) {
  const [viewingId, setViewingId] = useState<string | null>(null);

  const totalSize = useMemo(() => files.reduce((sum, file) => sum + (file.size || 0), 0), [files]);

  const handleFilesSelected = useCallback(
    (selectedFiles: File[]) => {
      if (!selectedFiles.length) return;

      if (selectedFiles.length > MAX_FILES_PER_BATCH) {
        toast.error('Maximum 5 files at once');
        return;
      }

      const oversized = selectedFiles.find((file) => file.size > maxFileSize);
      if (oversized) {
        toast.error(`${oversized.name} exceeds the 10MB limit`);
        return;
      }

      const newFilesTotalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
      if (totalSize + newFilesTotalSize > maxTotalSize) {
        toast.error('Total size exceeds 50MB');
        return;
      }

      onFilesSelected(selectedFiles);
    },
    [maxFileSize, maxTotalSize, onFilesSelected, totalSize]
  );

  const handleRemove = useCallback(
    (fileId: string) => {
      onFileRemove(fileId);
    },
    [onFileRemove]
  );

  const handleViewFile = useCallback(
    async (file: FileMetadata) => {
      try {
        setViewingId(file.id);

        if (file.file instanceof File) {
          const blobUrl = URL.createObjectURL(file.file);
          window.open(blobUrl, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
          return;
        }

        const signedUrl = await getSignedUrlForFile(file);
        window.open(signedUrl, '_blank', 'noopener');
      } catch (error) {
        console.error('[KnowledgeBaseFiles] Failed to open file', error);
        const message = error instanceof Error ? error.message : 'Failed to open file';
        toast.error(message);
      } finally {
        setViewingId(null);
      }
    },
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">Knowledge Base Files</h3>
        <span className="text-xs text-muted-foreground">Total size: {(totalSize / (1024 * 1024)).toFixed(1)} MB / 50 MB</span>
      </div>

      <p className="text-sm text-muted-foreground">
        Upload documents to provide knowledge to your agent. Supported formats: PDF, DOC, DOCX. Max 10MB per file.
      </p>

      <FileDropzone onFilesSelected={handleFilesSelected} />

      <FileList
        files={files}
        onDelete={handleRemove}
        onView={handleViewFile}
        viewingId={viewingId}
      />

      {!files.length && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Upload documents to provide knowledge to your agent.
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Maximum 5 files per upload • 10MB per file • 50MB total</span>
      </div>
    </div>
  );
}

