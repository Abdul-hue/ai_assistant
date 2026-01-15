import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { User } from 'lucide-react';

interface OwnerDetailsFormProps {
  formData: {
    owner_name: string;
    owner_email: string;
    owner_phone: string;
  };
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  onChange: (field: string, value: string) => void;
  onBlur: (field: string) => void;
}

export function OwnerDetailsForm({
  formData,
  errors,
  touched,
  onChange,
  onBlur,
}: OwnerDetailsFormProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <User className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Owner Details</CardTitle>
        </div>
        <CardDescription>
          Information about the person who will manage this agent
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          id="owner_name"
          label="Owner Name"
          required
          error={touched.owner_name ? errors.owner_name : undefined}
        >
          {(props) => (
            <Input
              {...props}
              type="text"
              value={formData.owner_name}
              onChange={(e) => onChange('owner_name', e.target.value)}
              onBlur={() => onBlur('owner_name')}
              placeholder="John Doe"
            />
          )}
        </FormField>

        <FormField
          id="owner_email"
          label="Owner Email"
          required
          error={touched.owner_email ? errors.owner_email : undefined}
          helperText="We'll send important notifications to this email"
        >
          {(props) => (
            <Input
              {...props}
              type="email"
              value={formData.owner_email}
              onChange={(e) => onChange('owner_email', e.target.value)}
              onBlur={() => onBlur('owner_email')}
              placeholder="john@example.com"
            />
          )}
        </FormField>

        <FormField
          id="owner_phone"
          label="Owner Phone Number"
          required
          error={touched.owner_phone ? errors.owner_phone : undefined}
          helperText="Include country code (e.g., +1234567890)"
        >
          {(props) => (
            <Input
              {...props}
              type="tel"
              value={formData.owner_phone}
              onChange={(e) => onChange('owner_phone', e.target.value)}
              onBlur={() => onBlur('owner_phone')}
              placeholder="+1234567890"
            />
          )}
        </FormField>
      </CardContent>
    </Card>
  );
}
