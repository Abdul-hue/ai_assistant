import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
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
import { Trash2 } from 'lucide-react';
import type { IntegrationEndpoint } from '@/types/agent.types';

export interface EndpointFieldErrors {
  name?: string;
  url?: string;
}

interface EndpointFieldProps {
  endpoint: IntegrationEndpoint;
  onChange: (id: string, value: Partial<IntegrationEndpoint>) => void;
  onBlur: (id: string) => void;
  onDelete: (id: string) => void;
  errors?: EndpointFieldErrors;
}

export default function EndpointField({ endpoint, onChange, onBlur, onDelete, errors }: EndpointFieldProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-start gap-4">
        <div className="flex-1 space-y-2">
          <Label htmlFor={`endpoint-name-${endpoint.id}`}>Endpoint Name</Label>
          <Input
            id={`endpoint-name-${endpoint.id}`}
            placeholder="Slack Notifications"
            value={endpoint.name}
            onChange={(event) => onChange(endpoint.id, { name: event.target.value })}
            onBlur={() => onBlur(endpoint.id)}
            aria-invalid={Boolean(errors?.name)}
          />
          {errors?.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mt-6 text-destructive hover:text-destructive"
          onClick={() => setShowConfirm(true)}
          aria-label={`Delete endpoint ${endpoint.name || ''}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`endpoint-url-${endpoint.id}`}>Endpoint URL</Label>
        <Input
          id={`endpoint-url-${endpoint.id}`}
          placeholder="https://hooks.slack.com/..."
          value={endpoint.url}
          onChange={(event) => onChange(endpoint.id, { url: event.target.value })}
          onBlur={() => onBlur(endpoint.id)}
          aria-invalid={Boolean(errors?.url)}
        />
        {errors?.url && <p className="text-xs text-destructive">{errors.url}</p>}
      </div>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              This endpoint will no longer receive notifications.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setShowConfirm(false);
                onDelete(endpoint.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

