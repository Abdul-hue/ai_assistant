import { useWhatsAppGroups, useToggleGroupImportant, useDeleteGroup, useDeleteAllGroups } from '@/hooks/useWhatsAppData';
import { Skeleton } from '@/components/ui/skeleton';
import { ImportantStar } from '@/components/ui/ImportantStar';
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
import { 
  Users, 
  Loader2,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { useState } from 'react';

interface GroupsTableProps {
  agentId: string;
}

export default function GroupsTable({ agentId }: GroupsTableProps) {
  const { data: groups = [], isLoading, error } = useWhatsAppGroups(agentId);
  const toggleImportant = useToggleGroupImportant(agentId);
  const deleteGroup = useDeleteGroup();
  const deleteAllGroups = useDeleteAllGroups();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<{ id: string; name: string } | null>(null);

  const handleToggleImportant = async (groupId: string, currentValue: boolean) => {
    await toggleImportant.mutateAsync({
      groupId,
      is_important: !currentValue,
    });
  };

  const handleDeleteClick = (group: { id: string; groupName: string }) => {
    setGroupToDelete({ id: group.id, name: group.groupName });
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!groupToDelete) return;
    
    try {
      await deleteGroup.mutateAsync({
        agentId,
        groupId: groupToDelete.id,
      });
      setDeleteDialogOpen(false);
      setGroupToDelete(null);
    } catch (error) {
      // Error is handled by the hook's onError
    }
  };

  const handleDeleteAll = async () => {
    try {
      await deleteAllGroups.mutateAsync(agentId);
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
      {/* Group Count and Delete All Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span className="font-medium">{groups?.length || 0} group{groups?.length !== 1 ? 's' : ''}</span>
        </div>
        {groups && groups.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteAllDialogOpen(true)}
            disabled={deleteAllGroups.isPending}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {deleteAllGroups.isPending ? 'Deleting...' : 'Delete All'}
          </Button>
        )}
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
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id} className="group">
                    <TableCell>
                      <ImportantStar
                        isImportant={group.is_important || false}
                        onToggle={() => handleToggleImportant(group.id, group.is_important || false)}
                        disabled={toggleImportant.isPending}
                        size="md"
                      />
                    </TableCell>
                    <TableCell className="font-medium">{group.groupName}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity md:opacity-0"
                        onClick={() => handleDeleteClick(group)}
                        disabled={deleteGroup.isPending}
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
            {groups.map((group) => (
              <div key={group.id} className="space-y-3 rounded-lg border p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium">{group.groupName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ImportantStar
                      isImportant={group.is_important || false}
                      onToggle={() => handleToggleImportant(group.id, group.is_important || false)}
                      disabled={toggleImportant.isPending}
                      size="md"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteClick(group)}
                      disabled={deleteGroup.isPending}
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

      {/* Delete Single Group Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{groupToDelete?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGroup.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteGroup.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteGroup.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Groups Confirmation Dialog */}
      <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Groups</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all <strong>{groups?.length || 0} group{groups?.length !== 1 ? 's' : ''}</strong>? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAllGroups.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              disabled={deleteAllGroups.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAllGroups.isPending ? 'Deleting...' : 'Delete All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
