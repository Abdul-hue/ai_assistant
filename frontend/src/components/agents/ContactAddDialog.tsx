import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateContact } from '@/hooks/useContacts';

interface ContactAddDialogProps {
  agentId: string;
}

const initialForm = {
  name: '',
  phone_number: '',
  email: '',
  company: '',
  notes: '',
};

export const ContactAddDialog = ({ agentId }: ContactAddDialogProps) => {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(initialForm);
  const createContact = useCreateContact();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await createContact.mutateAsync({
      agentId,
      data: formData,
    });
    setFormData(initialForm);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !createContact.isPending && setOpen(value)}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add contact
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
          <DialogDescription>Create a new contact for this agent.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="new-contact-name">Name *</Label>
            <Input
              id="new-contact-name"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-contact-phone">Phone *</Label>
            <Input
              id="new-contact-phone"
              value={formData.phone_number}
              onChange={(e) => setFormData((prev) => ({ ...prev, phone_number: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-contact-email">Email</Label>
            <Input
              id="new-contact-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-contact-company">Company</Label>
            <Input
              id="new-contact-company"
              value={formData.company}
              onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-contact-notes">Notes</Label>
            <Textarea
              id="new-contact-notes"
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional details"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={createContact.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createContact.isPending}>
              {createContact.isPending ? 'Adding...' : 'Add contact'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ContactAddDialog;

