import { useState, useMemo } from 'react';
import { Users, Search, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Skeleton } from '@/components/ui/skeleton';
import { ImportantStar } from '@/components/ui/ImportantStar';
import { useWhatsAppContacts, useToggleContactImportant } from '@/hooks/useWhatsAppData';
import { useDeleteContact, useDeleteAllContacts } from '@/hooks/useContacts';

interface ContactsTableProps {
  agentId: string;
}

export const ContactsTable = ({ agentId }: ContactsTableProps) => {
  // Use WhatsApp contacts from database (synced from WhatsApp)
  const { data: contacts = [], isLoading } = useWhatsAppContacts(agentId);
  const toggleImportant = useToggleContactImportant(agentId);
  const deleteContact = useDeleteContact();
  const deleteAllContacts = useDeleteAllContacts();
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<{ id: string; name: string } | null>(null);

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

  const handleToggleImportant = async (contactId: string, currentValue: boolean) => {
    await toggleImportant.mutateAsync({
      contactId,
      is_important: !currentValue,
    });
  };

  const handleDeleteClick = (contact: { id: string; name: string }) => {
    setContactToDelete(contact);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!contactToDelete) return;
    
    try {
      await deleteContact.mutateAsync({
        agentId,
        contactId: contactToDelete.id,
      });
      setDeleteDialogOpen(false);
      setContactToDelete(null);
    } catch (error) {
      // Error is handled by the hook's onError
    }
  };

  const handleDeleteAll = async () => {
    try {
      await deleteAllContacts.mutateAsync(agentId);
      setDeleteAllDialogOpen(false);
    } catch (error) {
      // Error is handled by the hook's onError
    }
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
      
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center space-x-2 text-sm font-medium">
          <Users className="h-5 w-5" />
          <span>{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</span>
          <p className="text-xs text-muted-foreground">
            These are WhatsApp contacts synced from your connected account. You can manage them here.
          </p>
        </div>
        {contacts.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteAllDialogOpen(true)}
            disabled={deleteAllContacts.isPending}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {deleteAllContacts.isPending ? 'Deleting...' : 'Delete All'}
          </Button>
        )}
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
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredContacts.map((contact) => (
                  <TableRow key={contact.id} className="group">
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
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity md:opacity-0"
                        onClick={() => handleDeleteClick({ id: contact.id, name: contact.name })}
                        disabled={deleteContact.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
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
                  <div className="flex items-center gap-2">
                    <ImportantStar
                      isImportant={contact.is_important || false}
                      onToggle={() => handleToggleImportant(contact.id, contact.is_important || false)}
                      disabled={toggleImportant.isPending}
                      size="md"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteClick({ id: contact.id, name: contact.name })}
                      disabled={deleteContact.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Delete Single Contact Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{contactToDelete?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteContact.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteContact.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteContact.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Contacts Confirmation Dialog */}
      <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Contacts</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all <strong>{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</strong>? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAllContacts.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              disabled={deleteAllContacts.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAllContacts.isPending ? 'Deleting...' : 'Delete All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ContactsTable;
