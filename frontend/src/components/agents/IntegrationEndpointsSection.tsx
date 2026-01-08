import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus } from 'lucide-react';
import EndpointField, { EndpointFieldErrors } from './EndpointField';
import type { IntegrationEndpoint } from '@/types/agent.types';
import { cn } from '@/lib/utils';

interface IntegrationEndpointsSectionProps {
  endpoints: IntegrationEndpoint[];
  onChange: (endpoints: IntegrationEndpoint[]) => void;
  className?: string;
}

const MAX_ENDPOINTS = 10;

function generateId() {
  return crypto.randomUUID();
}

export default function IntegrationEndpointsSection({ endpoints, onChange, className }: IntegrationEndpointsSectionProps) {
  const [localEndpoints, setLocalEndpoints] = useState<IntegrationEndpoint[]>([]);
  const [errors, setErrors] = useState<Record<string, EndpointFieldErrors>>({});
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  useEffect(() => {
    setLocalEndpoints(endpoints ?? []);
  }, [endpoints]);

  const canAddMore = localEndpoints.length < MAX_ENDPOINTS;

  useEffect(() => {
    const duplicateNames = findDuplicateNames(localEndpoints);
    setDuplicateError(duplicateNames.length ? `Endpoint name "${duplicateNames[0]}" is already used` : null);
  }, [localEndpoints]);

  const handleEndpointChange = (id: string, value: Partial<IntegrationEndpoint>) => {
    setLocalEndpoints((prev) => {
      const updated = prev.map((endpoint) => endpoint.id === id ? { ...endpoint, ...value } : endpoint);
      onChange(updated);
      return updated;
    });
  };

  const handleEndpointBlur = (id: string) => {
    setErrors((prev) => ({
      ...prev,
      [id]: validateEndpoint(localEndpoints.find((endpoint) => endpoint.id === id))
    }));
  };

  const handleAddEndpoint = () => {
    if (!canAddMore) return;

    const newEndpoint: IntegrationEndpoint = {
      id: generateId(),
      name: '',
      url: ''
    };

    const updated = [...localEndpoints, newEndpoint];
    setLocalEndpoints(updated);
    setErrors((prev) => ({ ...prev, [newEndpoint.id]: {} }));
    onChange(updated);
  };

  const handleDeleteEndpoint = (id: string) => {
    const updated = localEndpoints.filter((endpoint) => endpoint.id !== id);
    setLocalEndpoints(updated);
    setErrors((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    onChange(updated);
  };

  const hasValidationErrors = useMemo(() => {
    return Object.values(errors).some((error) => error.name || error.url) || Boolean(duplicateError);
  }, [duplicateError, errors]);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">Integration Endpoints</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddEndpoint}
          disabled={!canAddMore}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Endpoint
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Configure up to 10 endpoints to receive agent events. Duplicate names are not allowed.
      </p>

      {duplicateError && (
        <Alert variant="destructive">
          <AlertDescription>{duplicateError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {localEndpoints.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No endpoints added yet. Click "Add Endpoint" to create one.
          </div>
        )}

        {localEndpoints.map((endpoint) => (
          <EndpointField
            key={endpoint.id}
            endpoint={endpoint}
            errors={errors[endpoint.id]}
            onChange={handleEndpointChange}
            onBlur={handleEndpointBlur}
            onDelete={handleDeleteEndpoint}
          />
        ))}
      </div>

      {hasValidationErrors && (
        <p className="text-xs text-destructive">Resolve validation issues before submitting the form.</p>
      )}
    </div>
  );
}

function validateEndpoint(endpoint?: IntegrationEndpoint): EndpointFieldErrors {
  if (!endpoint) {
    return { name: 'Endpoint missing' };
  }

  const errors: EndpointFieldErrors = {};

  if (!endpoint.name?.trim()) {
    errors.name = 'Name is required';
  }

  if (!endpoint.url?.trim()) {
    errors.url = 'URL is required';
  } else {
    try {
      const url = new URL(endpoint.url);
      if (url.protocol !== 'https:') {
        errors.url = 'URL must use HTTPS';
      }
    } catch (error) {
      errors.url = 'Invalid URL format';
    }
  }

  return errors;
}

function findDuplicateNames(endpoints: IntegrationEndpoint[]) {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  endpoints.forEach((endpoint) => {
    const key = endpoint.name?.trim().toLowerCase();
    if (!key) return;
    if (seen.has(key) && !duplicates.includes(endpoint.name)) {
      duplicates.push(endpoint.name);
    }
    seen.add(key);
  });

  return duplicates;
}

