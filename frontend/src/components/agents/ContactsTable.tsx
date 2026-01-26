import { useState, useMemo } from 'react';
import { Users, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
          <span>{contacts.length} contacts</span>
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
    </div>
  );
};

export default ContactsTable;
