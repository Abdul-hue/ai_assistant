import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import type { FileMetadata } from '@/types/agent.types';
import { FileText, Loader2, Trash2 } from 'lucide-react';

interface FileItemProps {
  file: FileMetadata;
  onDelete: () => void;
  onView: () => void;
  isDeleting?: boolean;
  isViewing?: boolean;
  disabled?: boolean;
}

export default function FileItem({ file, onDelete, onView, isDeleting, isViewing, disabled }: FileItemProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const icon = getFileIcon(file.type);

  const uploadedAtLabel = (() => {
    if (file.uploadedAt) {
      const date = new Date(file.uploadedAt);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleString();
      }
    }
    return 'Pending upload';
  })();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="h-10 w-10 flex items-center justify-center rounded-full bg-muted">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" title={file.name}>{file.name}</p>
          <p className="text-xs text-muted-foreground">{formatFileSize(file.size)} • {uploadedAtLabel}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onView}
          disabled={disabled || isViewing}
        >
          {isViewing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'View'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('text-destructive hover:text-destructive', (disabled || isDeleting) && 'opacity-50 pointer-events-none')}
          onClick={() => setConfirmOpen(true)}
          aria-label={`Delete file ${file.name}`}
        >
          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {file.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone and will remove the file from storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmOpen(false);
                onDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function getFileIcon(mimeType?: string) {
  if (!mimeType) return <FileText className="h-5 w-5 text-muted-foreground" />;
  if (mimeType.includes('pdf')) {
    return <FileText className="h-5 w-5 text-red-500" />;
  }
  if (mimeType.includes('word')) {
    return <FileText className="h-5 w-5 text-primary" />;
  }
  return <FileText className="h-5 w-5 text-muted-foreground" />;
}

function formatFileSize(size?: number) {
  if (!size && size !== 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB'];
  let value = size;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

