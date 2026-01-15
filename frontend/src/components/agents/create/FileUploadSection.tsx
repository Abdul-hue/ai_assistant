import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, X, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { ariaLabels } from '@/lib/accessibility';

interface FileUploadSectionProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
}

export function FileUploadSection({ files, onFilesChange, disabled }: FileUploadSectionProps) {
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = event.target.files;
    if (!newFiles || newFiles.length === 0) return;

    setIsUploading(true);
    try {
      const filesArray = Array.from(newFiles);
      onFilesChange([...files, ...filesArray]);
      toast.success(`${filesArray.length} file(s) uploaded successfully`);
    } catch (error) {
      console.error('Error uploading files:', error);
      toast.error('Failed to upload files');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveFile = (index: number) => {
    const newFiles = files.filter((_, i) => i !== index);
    onFilesChange(newFiles);
    toast.success('File removed');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Knowledge Base Files</CardTitle>
        </div>
        <CardDescription>
          Upload documents to give your agent context and knowledge (optional)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Input
            type="file"
            multiple
            onChange={handleFileUpload}
            disabled={disabled || isUploading}
            accept=".pdf,.txt,.doc,.docx,.csv"
            className="cursor-pointer"
            aria-label={ariaLabels.fileManagement.uploadFiles}
          />
          <p className="text-sm text-muted-foreground mt-2">
            Supported formats: PDF, TXT, DOC, DOCX, CSV
          </p>
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Uploaded Files ({files.length})
            </p>
            <div className="space-y-2">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    <span className="text-sm truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFile(index)}
                    disabled={disabled}
                    aria-label={ariaLabels.fileManagement.removeFile(file.name)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Remove {file.name}</span>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
