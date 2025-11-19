import { useState, type ReactNode } from 'react';
import { Upload, X, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useUploadContacts } from '@/hooks/useContacts';
import { useToast } from '@/hooks/use-toast';

interface ContactUploadDialogProps {
  agentId: string;
  trigger?: ReactNode;
}

export const ContactUploadDialog = ({ agentId, trigger }: ContactUploadDialogProps) => {
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const uploadMutation = useUploadContacts();
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const validMimeTypes = [
      'text/csv',
      'text/vcard',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    const hasValidType =
      validMimeTypes.includes(file.type) || /\.(csv|vcf|xlsx|xls)$/i.test(file.name);

    if (!hasValidType) {
      toast({
        variant: 'destructive',
        title: 'Unsupported file',
        description: 'Please upload CSV, VCF, or Excel files only.',
      });
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast({
        variant: 'destructive',
        title: 'No file selected',
        description: 'Choose a contact file to upload.',
      });
      return;
    }

    try {
      await uploadMutation.mutateAsync({ agentId, file: selectedFile });
      setSelectedFile(null);
      setOpen(false);
    } catch (error) {
      console.error('Contact upload failed:', error);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" />
            Upload Contacts
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV, VCF, or Excel file containing the contacts you want to associate with this
            agent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!selectedFile ? (
            <label className="flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors hover:bg-muted/50">
              <div className="flex flex-col items-center justify-center pb-6 pt-5 text-center">
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click to upload or drag and drop</p>
                <p className="mt-1 text-xs text-muted-foreground">CSV, VCF, XLS, XLSX (max 10MB)</p>
              </div>
              <input
                type="file"
                className="hidden"
                accept=".csv,.vcf,.xls,.xlsx"
                onChange={handleFileChange}
              />
            </label>
          ) : (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center space-x-2">
                <FileText className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={handleRemoveFile}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={!selectedFile || uploadMutation.isPending}>
            {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ContactUploadDialog;

