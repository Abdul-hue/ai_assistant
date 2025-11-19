const { z } = require('zod');

/**
 * SECURITY: Input validation schemas using Zod
 * Prevents injection attacks and data corruption
 */

const integrationEndpointSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string()
    .min(1, 'Endpoint name is required')
    .max(100, 'Endpoint name must be less than 100 characters'),
  url: z.string()
    .url('Endpoint URL must be a valid URL')
    .regex(/^https:\/\//, 'Endpoint URL must use HTTPS')
});

const uploadedFileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'File name is required'),
  size: z.number().nonnegative(),
  type: z.string().min(1, 'File type is required'),
  url: z.string().url('File URL must be a valid URL'),
  uploadedAt: z.string().datetime({ offset: true }),
  storagePath: z.string().optional()
});

// Helper to ensure endpoint names remain unique (case insensitive)
const uniqueEndpointNames = (endpoints) => {
  const seen = new Set();
  for (const endpoint of endpoints) {
    const key = endpoint.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};

// Schema for creating a new agent
const createAgentSchema = z.object({
  name: z.string()
    .min(1, 'Agent name is required')
    .max(100, 'Agent name must be less than 100 characters')
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Agent name can only contain letters, numbers, spaces, hyphens, and underscores'),
  
  description: z.string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .default(''),
  
  systemPrompt: z.string()
    .max(2000, 'System prompt must be less than 2000 characters')
    .optional()
    .default(''),
  
  erpCrsData: z.record(z.any())
    .optional()
    .default({}),
  
  integrationEndpoints: z.array(integrationEndpointSchema)
    .max(10, 'Maximum 10 endpoints allowed')
    .optional()
    .default([])
    .refine(uniqueEndpointNames, 'Endpoint name already exists'),

  uploadedFiles: z.array(uploadedFileSchema)
    .optional()
    .default([])
});

// Schema for updating an existing agent (all fields optional)
const updateAgentSchema = z.object({
  name: z.string()
    .min(1, 'Agent name cannot be empty')
    .max(100, 'Agent name must be less than 100 characters')
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Agent name can only contain letters, numbers, spaces, hyphens, and underscores')
    .optional(),
  
  description: z.string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
  
  systemPrompt: z.string()
    .max(2000, 'System prompt must be less than 2000 characters')
    .optional(),
  
  erpCrsData: z.record(z.any())
    .optional(),
  
  integrationEndpoints: z.array(integrationEndpointSchema)
    .max(10, 'Maximum 10 endpoints allowed')
    .optional()
    .refine((list) => (list ? uniqueEndpointNames(list) : true), 'Endpoint name already exists'),

  uploadedFiles: z.array(uploadedFileSchema)
    .optional()
});

// Schema for sending WhatsApp messages
const sendMessageSchema = z.object({
  phoneNumber: z.string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format (e.g., +1234567890)')
    .describe('Phone number in international E.164 format'),
  
  message: z.string()
    .min(1, 'Message cannot be empty')
    .max(4096, 'Message must be less than 4096 characters (WhatsApp limit)')
});

// Schema for agent ID validation
const agentIdSchema = z.string()
  .uuid('Agent ID must be a valid UUID');

module.exports = {
  createAgentSchema,
  updateAgentSchema,
  sendMessageSchema,
  agentIdSchema
};

