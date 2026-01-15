import { z } from 'zod';

// Phone number regex - international format
const phoneRegex = /^\+?[1-9]\d{1,14}$/;

// Agent validation schema
export const agentSchema = z.object({
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be less than 50 characters'),
  
  phone_number: z.string()
    .regex(phoneRegex, 'Please enter a valid phone number with country code (e.g., +1234567890)'),
  
  owner_name: z.string()
    .min(2, 'Owner name must be at least 2 characters')
    .max(100, 'Owner name must be less than 100 characters'),
  
  owner_email: z.string()
    .email('Please enter a valid email address'),
  
  owner_phone: z.string()
    .regex(phoneRegex, 'Please enter a valid phone number with country code'),
  
  personality: z.string()
    .max(500, 'Personality description must be less than 500 characters')
    .optional()
    .or(z.literal('')),
  
  instructions: z.string()
    .max(1000, 'Instructions must be less than 1000 characters')
    .optional()
    .or(z.literal('')),
  
  company_name: z.string()
    .max(100, 'Company name must be less than 100 characters')
    .optional()
    .or(z.literal('')),
  
  company_website: z.string()
    .url('Please enter a valid URL (e.g., https://example.com)')
    .optional()
    .or(z.literal('')),
});

export type AgentFormData = z.infer<typeof agentSchema>;

// Contact validation schema
export const contactSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  phone: z.string().regex(phoneRegex, 'Invalid phone number'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  tags: z.array(z.string()).optional(),
});

export type ContactFormData = z.infer<typeof contactSchema>;

// Email integration schema
export const emailConfigSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  imapHost: z.string().min(1, 'IMAP host is required'),
  imapPort: z.number().min(1).max(65535),
  smtpHost: z.string().min(1, 'SMTP host is required'),
  smtpPort: z.number().min(1).max(65535),
});

export type EmailConfigFormData = z.infer<typeof emailConfigSchema>;

// Validation helper functions
export function validateField<T extends z.ZodTypeAny>(
  schema: T,
  fieldName: string,
  value: unknown
): string | null {
  try {
    // Create partial schema for single field validation
    const fieldSchema = z.object({ [fieldName]: schema });
    fieldSchema.parse({ [fieldName]: value });
    return null;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return error.errors[0]?.message || 'Invalid value';
    }
    return 'Validation error';
  }
}

export function validateForm<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): { errors: Record<string, string>; isValid: boolean } {
  try {
    schema.parse(data);
    return { errors: {}, isValid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors: Record<string, string> = {};
      error.errors.forEach((err) => {
        const path = err.path.join('.');
        if (path) {
          errors[path] = err.message;
        }
      });
      return { errors, isValid: false };
    }
    return { errors: { _form: 'Validation failed' }, isValid: false };
  }
}
