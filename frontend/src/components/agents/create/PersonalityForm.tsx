import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

interface PersonalityFormProps {
  formData: {
    personality: string;
  };
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  onChange: (field: string, value: string) => void;
  onBlur: (field: string) => void;
}

export function PersonalityForm({
  formData,
  errors,
  touched,
  onChange,
  onBlur,
}: PersonalityFormProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Personality</CardTitle>
        </div>
        <CardDescription>
          Define your agent's personality and communication style
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormField
          id="personality"
          label="Personality Description"
          error={touched.personality ? errors.personality : undefined}
          helperText="Describe how your agent should communicate (e.g., friendly, professional, casual)"
        >
          {(props) => (
            <Textarea
              {...props}
              value={formData.personality}
              onChange={(e) => onChange('personality', e.target.value)}
              onBlur={() => onBlur('personality')}
              placeholder="Your agent is friendly, professional, and always ready to help customers with a warm and welcoming tone."
              rows={4}
              className="resize-none"
            />
          )}
        </FormField>
      </CardContent>
    </Card>
  );
}
