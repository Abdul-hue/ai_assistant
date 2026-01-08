import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const ACCEPTED_EXTENSIONS = '.pdf,.doc,.docx';

export default function FileDropzone({ onFilesSelected }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const triggerPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const files = Array.from(list);
      const invalid = files.filter((file) => !ACCEPTED_TYPES.includes(file.type));

      if (invalid.length) {
        toast.error(`Unsupported file type: ${invalid.map((file) => file.name).join(', ')}`);
        return;
      }

      onFilesSelected(files);
    },
    [onFilesSelected]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      handleFiles(event.dataTransfer?.files ?? null);
    },
    [handleFiles]
  );

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        triggerPicker();
      }
    },
    [triggerPicker]
  );

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        onClick={triggerPicker}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-all',
          'cursor-pointer hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          isDragging && 'border-primary bg-primary/10'
        )}
      >
        <UploadCloud className="mb-3 h-10 w-10 text-muted-foreground transition-colors" />
        <p className="text-sm font-medium">
          Drag &amp; drop files here or{' '}
          <button
            type="button"
            className="text-primary underline-offset-2 hover:underline focus:outline-none"
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              triggerPicker();
            }}
          >
            browse
          </button>
        </p>
        <p className="text-xs text-muted-foreground">PDF, DOC, DOCX • Max 10MB per file</p>

        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          multiple
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

