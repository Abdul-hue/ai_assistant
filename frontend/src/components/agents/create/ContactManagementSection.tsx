import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Upload, Download, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { ariaLabels } from '@/lib/accessibility';

interface Contact {
  name: string;
  phone: string;
  email?: string;
}

interface ContactManagementSectionProps {
  contacts: Contact[];
  onContactsChange: (contacts: Contact[]) => void;
  disabled?: boolean;
}

export function ContactManagementSection({ 
  contacts, 
  onContactsChange, 
  disabled 
}: ContactManagementSectionProps) {
  const [contactInput, setContactInput] = useState({ name: '', phone: '', email: '' });
  const [isImporting, setIsImporting] = useState(false);

  const handleAddContact = () => {
    if (!contactInput.name.trim() || !contactInput.phone.trim()) {
      toast.error('Name and phone are required');
      return;
    }

    const newContact: Contact = {
      name: contactInput.name.trim(),
      phone: contactInput.phone.trim(),
      email: contactInput.email.trim() || undefined,
    };

    onContactsChange([...contacts, newContact]);
    setContactInput({ name: '', phone: '', email: '' });
    toast.success('Contact added');
  };

  const handleRemoveContact = (index: number) => {
    const newContacts = contacts.filter((_, i) => i !== index);
    onContactsChange(newContacts);
    toast.success('Contact removed');
  };

  const handleImportContacts = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      // Skip header if present
      const startIndex = lines[0]?.toLowerCase().includes('name') ? 1 : 0;
      
      const importedContacts: Contact[] = lines
        .slice(startIndex)
        .map(line => {
          const [name, phone, email] = line.split(',').map(s => s.trim());
          return { name, phone, email };
        })
        .filter(c => c.name && c.phone);

      onContactsChange([...contacts, ...importedContacts]);
      toast.success(`Imported ${importedContacts.length} contacts`);
    } catch (error) {
      console.error('Error importing contacts:', error);
      toast.error('Failed to import contacts. Please check file format.');
    } finally {
      setIsImporting(false);
      // Reset file input
      event.target.value = '';
    }
  };

  const handleExportContacts = () => {
    if (contacts.length === 0) {
      toast.error('No contacts to export');
      return;
    }

    const csv = [
      'Name,Phone,Email',
      ...contacts.map(c => `${c.name},${c.phone},${c.email || ''}`)
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Contacts exported');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddContact();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Contact Management</CardTitle>
        </div>
        <CardDescription>
          Add contacts that this agent can interact with (optional)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Contact Form */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="contact-name">Name *</Label>
            <Input
              id="contact-name"
              placeholder="John Doe"
              value={contactInput.name}
              onChange={(e) => setContactInput(prev => ({ ...prev, name: e.target.value }))}
              onKeyPress={handleKeyPress}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-phone">Phone *</Label>
            <Input
              id="contact-phone"
              type="tel"
              placeholder="+1234567890"
              value={contactInput.phone}
              onChange={(e) => setContactInput(prev => ({ ...prev, phone: e.target.value }))}
              onKeyPress={handleKeyPress}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              placeholder="john@example.com"
              value={contactInput.email}
              onChange={(e) => setContactInput(prev => ({ ...prev, email: e.target.value }))}
              onKeyPress={handleKeyPress}
              disabled={disabled}
            />
          </div>
        </div>

        <Button
          type="button"
          onClick={handleAddContact}
          disabled={disabled}
          className="w-full"
          aria-label={ariaLabels.contactManagement.addContact}
        >
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          Add Contact
        </Button>

        {/* Import/Export Buttons */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              type="file"
              accept=".csv"
              onChange={handleImportContacts}
              disabled={disabled || isImporting}
              className="hidden"
              id="import-contacts"
              aria-label={ariaLabels.contactManagement.importContacts}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => document.getElementById('import-contacts')?.click()}
              disabled={disabled || isImporting}
            >
              <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
              {isImporting ? 'Importing...' : 'Import CSV'}
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleExportContacts}
            disabled={disabled || contacts.length === 0}
            aria-label={ariaLabels.contactManagement.exportContacts}
          >
            <Download className="h-4 w-4 mr-2" aria-hidden="true" />
            Export CSV
          </Button>
        </div>

        {/* Contacts List */}
        {contacts.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Added Contacts ({contacts.length})
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {contacts.map((contact, index) => (
                <div
                  key={`${contact.phone}-${index}`}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{contact.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {contact.phone}
                      {contact.email && ` • ${contact.email}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveContact(index)}
                    disabled={disabled}
                    aria-label={ariaLabels.contactManagement.removeContact(contact.name)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Remove {contact.name}</span>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {contacts.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No contacts added yet. Add contacts manually or import from CSV.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
