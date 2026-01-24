<<<<<<< Updated upstream
import { useState } from 'react';
import { AlertTriangle, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
=======
import { useState, useMemo } from 'react';
import { Users, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
>>>>>>> Stashed changes
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ImportantStar } from '@/components/ui/ImportantStar';
import { useWhatsAppContacts, useToggleContactImportant } from '@/hooks/useWhatsAppData';

interface ContactsTableProps {
  agentId: string;
}

export const ContactsTable = ({ agentId }: ContactsTableProps) => {
<<<<<<< Updated upstream
  const { data, isLoading } = useContacts(agentId);
  const deleteContact = useDeleteContact();
  const deleteAllContacts = useDeleteAllContacts();

  const [contactToDelete, setContactToDelete] = useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);

  const contacts: Contact[] = data?.contacts ?? [];
=======
  // Use WhatsApp contacts from database (synced from WhatsApp)
  const { data: contacts = [], isLoading } = useWhatsAppContacts(agentId);
  const toggleImportant = useToggleContactImportant(agentId);
  const [searchTerm, setSearchTerm] = useState('');

  // Filter contacts based on search term
  const filteredContacts = useMemo(() => {
    if (!searchTerm.trim()) {
      return contacts;
    }
    
    const search = searchTerm.toLowerCase();
    return contacts.filter(contact => 
      contact.name?.toLowerCase().includes(search) ||
      contact.phone?.toLowerCase().includes(search)
    );
  }, [contacts, searchTerm]);
>>>>>>> Stashed changes

  const handleToggleImportant = async (contactId: string, currentValue: boolean) => {
    await toggleImportant.mutateAsync({
      contactId,
      is_important: !currentValue,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!contacts.length) {
    return (
      <div className="py-12 text-center">
        <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">No contacts uploaded yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
<<<<<<< Updated upstream
=======
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search WhatsApp contacts by name or phone..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>
      
>>>>>>> Stashed changes
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center space-x-2 text-sm font-medium">
          <Users className="h-5 w-5" />
          <span>{contacts.length} contacts</span>
        </div>
        <div className="flex gap-2 flex-wrap">
<<<<<<< Updated upstream
          <ContactAddDialog agentId={agentId} />
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteAll(true)}
            disabled={deleteAllContacts.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete all
          </Button>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Company</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell className="font-medium">{contact.name}</TableCell>
                <TableCell>{contact.phone_number}</TableCell>
                <TableCell>{contact.email || '-'}</TableCell>
                <TableCell>{contact.company || '-'}</TableCell>
                <TableCell>
                  <div className="flex justify-end space-x-2">
                    <ContactEditDialog contact={contact} agentId={agentId} />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setContactToDelete(contact.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card view */}
      <div className="grid gap-4 md:hidden">
        {contacts.map((contact) => (
          <div key={contact.id} className="space-y-3 rounded-lg border p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{contact.name}</p>
                <p className="text-sm text-muted-foreground">{contact.phone_number}</p>
              </div>
              <div className="flex space-x-2">
                <ContactEditDialog contact={contact} agentId={agentId} />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setContactToDelete(contact.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
            {contact.email && (
              <p className="text-sm text-muted-foreground break-all">
                <span className="font-medium text-foreground">Email:</span> {contact.email}
              </p>
            )}
            {contact.company && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Company:</span> {contact.company}
              </p>
            )}
            {contact.notes && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Notes:</span> {contact.notes}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Delete single contact dialog */}
      <AlertDialog open={Boolean(contactToDelete)} onOpenChange={() => setContactToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this contact? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={confirmDeleteContact}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete all contacts dialog */}
      <AlertDialog open={showDeleteAll} onOpenChange={setShowDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span>Delete all contacts</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all {contacts.length} contacts associated with this
              agent. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={confirmDeleteAll}
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
=======
          <p className="text-xs text-muted-foreground">
            These are WhatsApp contacts synced from your connected account. They are read-only.
          </p>
        </div>
      </div>
      
      {searchTerm && filteredContacts.length === 0 && contacts.length > 0 && (
        <div className="py-8 text-center border rounded-lg bg-muted/50">
          <Search className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">No contacts found matching "{searchTerm}"</p>
          <button
            onClick={() => setSearchTerm('')}
            className="mt-2 text-sm text-primary hover:underline"
          >
            Clear search
          </button>
        </div>
      )}
      
      {!contacts.length ? (
        <div className="py-12 text-center">
          <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">
            {isLoading 
              ? 'Loading WhatsApp contacts...' 
              : 'No WhatsApp contacts found. Connect WhatsApp to sync contacts.'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredContacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <ImportantStar
                        isImportant={contact.is_important || false}
                        onToggle={() => handleToggleImportant(contact.id, contact.is_important || false)}
                        disabled={toggleImportant.isPending}
                        size="md"
                      />
                    </TableCell>
                    <TableCell className="font-medium">{contact.name}</TableCell>
                    <TableCell>{contact.phone}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card view */}
          <div className="grid gap-4 md:hidden">
            {filteredContacts.map((contact) => (
              <div key={contact.id} className="space-y-3 rounded-lg border p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium">{contact.name}</p>
                    <p className="text-sm text-muted-foreground">{contact.phone}</p>
                  </div>
                  <ImportantStar
                    isImportant={contact.is_important || false}
                    onToggle={() => handleToggleImportant(contact.id, contact.is_important || false)}
                    disabled={toggleImportant.isPending}
                    size="md"
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
>>>>>>> Stashed changes
    </div>
  );
};

export default ContactsTable;
