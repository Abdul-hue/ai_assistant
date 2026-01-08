import { useState } from 'react';
import FileItem from './FileItem';
import type { FileMetadata } from '@/types/agent.types';

interface FileListProps {
  files: FileMetadata[];
  onDelete: (fileId: string) => void;
  onView: (file: FileMetadata) => void;
  viewingId?: string | null;
  isDeletingDisabled?: boolean;
}

export default function FileList({ files, onDelete, onView, viewingId, isDeletingDisabled }: FileListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!files.length) {
    return null;
  }

  const handleDelete = (fileId: string) => {
    setDeletingId(fileId);
    onDelete(fileId);
    setDeletingId(null);
  };

  return (
    <div className="space-y-3">
      {files.map((file) => (
        <FileItem
          key={file.id}
          file={file}
          onDelete={() => handleDelete(file.id)}
          onView={() => onView(file)}
          isDeleting={deletingId === file.id}
          isViewing={viewingId === file.id}
          disabled={isDeletingDisabled}
        />
      ))}
    </div>
  );
}

