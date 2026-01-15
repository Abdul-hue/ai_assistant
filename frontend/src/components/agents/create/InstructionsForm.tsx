import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText } from 'lucide-react';

interface InstructionsFormProps {
  formData: {
    instructions: string;
  };
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  onChange: (field: string, value: string) => void;
  onBlur: (field: string) => void;
}

export function InstructionsForm({
  formData,
  errors,
  touched,
  onChange,
  onBlur,
}: InstructionsFormProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Instructions</CardTitle>
        </div>
        <CardDescription>
          Specific instructions for how your agent should behave
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormField
          id="instructions"
          label="Agent Instructions"
          error={touched.instructions ? errors.instructions : undefined}
          helperText="Provide detailed instructions on how your agent should respond to different situations"
        >
          {(props) => (
            <Textarea
              {...props}
              value={formData.instructions}
              onChange={(e) => onChange('instructions', e.target.value)}
              onBlur={() => onBlur('instructions')}
              placeholder="Always greet customers warmly. If you don't know the answer, ask for more information or escalate to a human agent. Never make promises you can't keep."
              rows={6}
              className="resize-none"
            />
          )}
        </FormField>
      </CardContent>
    </Card>
  );
}
