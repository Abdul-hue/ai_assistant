import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2 } from 'lucide-react';

interface CompanyIntegrationFormProps {
  formData: {
    company_name: string;
    company_website: string;
  };
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  onChange: (field: string, value: string) => void;
  onBlur: (field: string) => void;
}

export function CompanyIntegrationForm({
  formData,
  errors,
  touched,
  onChange,
  onBlur,
}: CompanyIntegrationFormProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Company Integration</CardTitle>
        </div>
        <CardDescription>
          Optional company information for context
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          id="company_name"
          label="Company Name"
          error={touched.company_name ? errors.company_name : undefined}
          helperText="The name of your company or organization"
        >
          {(props) => (
            <Input
              {...props}
              type="text"
              value={formData.company_name}
              onChange={(e) => onChange('company_name', e.target.value)}
              onBlur={() => onBlur('company_name')}
              placeholder="Acme Corporation"
            />
          )}
        </FormField>

        <FormField
          id="company_website"
          label="Company Website"
          error={touched.company_website ? errors.company_website : undefined}
          helperText="Your company's website URL"
        >
          {(props) => (
            <Input
              {...props}
              type="url"
              value={formData.company_website}
              onChange={(e) => onChange('company_website', e.target.value)}
              onBlur={() => onBlur('company_website')}
              placeholder="https://example.com"
            />
          )}
        </FormField>
      </CardContent>
    </Card>
  );
}
