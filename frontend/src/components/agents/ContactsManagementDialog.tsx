import { useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ContactsTable from './ContactsTable';
import ContactUploadDialog from './ContactUploadDialog';
import { useContactCount } from '@/hooks/useContacts';

interface ContactsManagementDialogProps {
  agentId: string;
  agentName: string;
}

export const ContactsManagementDialog = ({
  agentId,
  agentName,
}: ContactsManagementDialogProps) => {
  const [open, setOpen] = useState(false);
  const { data: countData } = useContactCount(agentId);
  const contactCount = countData?.count ?? 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="relative">
          <Users className="mr-2 h-4 w-4" />
          Manage contacts
          {contactCount > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {contactCount}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-full max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contact management</DialogTitle>
          <DialogDescription>
            View, edit, or upload contacts for <span className="font-medium">{agentName}</span>.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="view" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="view">View contacts</TabsTrigger>
            <TabsTrigger value="upload">Upload new</TabsTrigger>
          </TabsList>

          <TabsContent value="view" className="mt-6">
            <ContactsTable agentId={agentId} />
          </TabsContent>

          <TabsContent value="upload" className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload additional contacts for this agent. Existing contacts with the same phone
              number will be updated automatically.
            </p>
            <ContactUploadDialog
              agentId={agentId}
              trigger={
                <Button className="w-full sm:w-auto">
                  <Users className="mr-2 h-4 w-4" />
                  Choose file to upload
                </Button>
              }
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default ContactsManagementDialog;

