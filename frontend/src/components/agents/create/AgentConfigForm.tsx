import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot } from 'lucide-react';

interface AgentConfigFormProps {
  formData: {
    name: string;
    phone_number: string;
  };
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  onChange: (field: string, value: string) => void;
  onBlur: (field: string) => void;
}

export function AgentConfigForm({
  formData,
  errors,
  touched,
  onChange,
  onBlur,
}: AgentConfigFormProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Agent Configuration</CardTitle>
        </div>
        <CardDescription>
          Basic settings for your AI agent
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          id="name"
          label="Agent Name"
          required
          error={touched.name ? errors.name : undefined}
          helperText="Choose a memorable name for your agent"
        >
          {(props) => (
            <Input
              {...props}
              type="text"
              value={formData.name}
              onChange={(e) => onChange('name', e.target.value)}
              onBlur={() => onBlur('name')}
              placeholder="Customer Support Bot"
            />
          )}
        </FormField>

        <FormField
          id="phone_number"
          label="Phone Number"
          required
          error={touched.phone_number ? errors.phone_number : undefined}
          helperText="WhatsApp number for this agent (include country code)"
        >
          {(props) => (
            <Input
              {...props}
              type="tel"
              value={formData.phone_number}
              onChange={(e) => onChange('phone_number', e.target.value)}
              onBlur={() => onBlur('phone_number')}
              placeholder="+1234567890"
            />
          )}
        </FormField>
      </CardContent>
    </Card>
  );
}
