import { useState, useCallback } from 'react';
import { z } from 'zod';

type ValidationErrors = Record<string, string>;
type TouchedFields = Record<string, boolean>;

export function useValidatedForm<T extends z.ZodTypeAny>(
  schema: T,
  initialValues: z.infer<T>
) {
  type FormData = z.infer<T>;
  
  const [values, setValues] = useState<FormData>(initialValues);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<TouchedFields>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateSingleField = useCallback((fieldName: string, value: unknown): string | null => {
    try {
      // Validate the entire form but only return error for this field
      schema.parse({ ...values, [fieldName]: value });
      return null;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldError = error.errors.find(err => 
          err.path[0] === fieldName
        );
        return fieldError?.message || null;
      }
      return null;
    }
  }, [schema, values]);

  const handleChange = useCallback((field: string, value: unknown) => {
    setValues(prev => ({ ...prev, [field]: value }));
    
    // Validate if field has been touched
    if (touched[field]) {
      const error = validateSingleField(field, value);
      setErrors(prev => ({
        ...prev,
        [field]: error || '',
      }));
    }
  }, [touched, validateSingleField]);

  const handleBlur = useCallback((field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    
    // Validate field on blur
    const value = values[field as keyof FormData];
    const error = validateSingleField(field, value);
    setErrors(prev => ({
      ...prev,
      [field]: error || '',
    }));
  }, [values, validateSingleField]);

  const validateAllFields = useCallback((): boolean => {
    try {
      schema.parse(values);
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: ValidationErrors = {};
        error.errors.forEach((err) => {
          const path = err.path.join('.');
          if (path) {
            newErrors[path] = err.message;
          }
        });
        setErrors(newErrors);
        return false;
      }
      return false;
    }
  }, [schema, values]);

  const handleSubmit = useCallback((
    onSubmit: (values: FormData) => void | Promise<void>
  ) => {
    return async (e: React.FormEvent) => {
      e.preventDefault();
      
      // Mark all fields as touched
      const allTouched = Object.keys(values).reduce((acc, key) => ({
        ...acc,
        [key]: true,
      }), {});
      setTouched(allTouched);
      
      // Validate all fields
      const isValid = validateAllFields();
      
      if (isValid) {
        setIsSubmitting(true);
        try {
          await onSubmit(values);
        } catch (error) {
          console.error('Form submission error:', error);
        } finally {
          setIsSubmitting(false);
        }
      } else {
        // Focus first error field
        const firstErrorField = Object.keys(errors)[0];
        if (firstErrorField) {
          document.getElementById(firstErrorField)?.focus();
        }
      }
    };
  }, [values, errors, validateAllFields]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
  }, [initialValues]);

  const setFieldValue = useCallback((field: string, value: unknown) => {
    setValues(prev => ({ ...prev, [field]: value }));
  }, []);

  const setFieldError = useCallback((field: string, error: string) => {
    setErrors(prev => ({ ...prev, [field]: error }));
  }, []);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
    reset,
    setFieldValue,
    setFieldError,
    validateAllFields,
  };
}
