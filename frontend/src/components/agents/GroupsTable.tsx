import { useWhatsAppGroups, useToggleGroupImportant } from '@/hooks/useWhatsAppData';
import { Skeleton } from '@/components/ui/skeleton';
import { ImportantStar } from '@/components/ui/ImportantStar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Users, 
  Loader2,
  AlertCircle
} from 'lucide-react';

interface GroupsTableProps {
  agentId: string;
}

export default function GroupsTable({ agentId }: GroupsTableProps) {
  const { data: groups = [], isLoading, error } = useWhatsAppGroups(agentId);
  const toggleImportant = useToggleGroupImportant(agentId);

  const handleToggleImportant = async (groupId: string, currentValue: boolean) => {
    await toggleImportant.mutateAsync({
      groupId,
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

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">
          {error.message.includes('not connected')
            ? 'Please connect WhatsApp first to view groups'
            : 'Failed to load groups'}
        </p>
      </div>
    );
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">
          No WhatsApp groups found. Connect WhatsApp to sync groups.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Group Count */}
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4" />
        <span className="font-medium">{groups?.length || 0} groups</span>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="ml-2">Loading groups...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-8 text-destructive">
          <p>Error: {error.message}</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && (!groups || groups.length === 0) && (
        <div className="text-center py-8">
          <Users className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
          <p className="mt-2 text-muted-foreground">No groups available</p>
        </div>
      )}

      {/* Groups List */}
      {!isLoading && groups && groups.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Group Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell>
                      <ImportantStar
                        isImportant={group.is_important || false}
                        onToggle={() => handleToggleImportant(group.id, group.is_important || false)}
                        disabled={toggleImportant.isPending}
                        size="md"
                      />
                    </TableCell>
                    <TableCell className="font-medium">{group.groupName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card view */}
          <div className="grid gap-4 md:hidden">
            {groups.map((group) => (
              <div key={group.id} className="space-y-3 rounded-lg border p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium">{group.groupName}</p>
                  </div>
                  <ImportantStar
                    isImportant={group.is_important || false}
                    onToggle={() => handleToggleImportant(group.id, group.is_important || false)}
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
}
