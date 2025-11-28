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
    .regex(/^https:\/\//, 'Endpoint URL must use HTTPS'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().default('POST'),
  headers: z.record(z.string()).optional().default({})
}).passthrough(); // Allow extra fields

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
  if (!endpoints || !Array.isArray(endpoints)) return true;
  if (endpoints.length === 0) return true;
  
  const seen = new Set();
  for (const endpoint of endpoints) {
    if (!endpoint || !endpoint.name) continue; // Skip invalid endpoints
    const key = endpoint.name.trim().toLowerCase();
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
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
    .min(1, 'Agent name is required')
    .max(100, 'Agent name must be less than 100 characters')
    .optional(),
  
  description: z.string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .nullable(),
  
  systemPrompt: z.string()
    .max(5000, 'System prompt must be less than 5000 characters')
    .optional()
    .nullable(),
  
  webhookUrl: z.string()
    .url('Invalid webhook URL')
    .optional()
    .nullable()
    .or(z.literal('')),
  
  enableChatHistory: z.boolean()
    .optional(),
  
  erpCrsData: z.any()
    .optional()
    .nullable(),
  
  featureToggles: z.object({
    enableVoice: z.boolean().optional(),
    enableImages: z.boolean().optional(),
    enableDocuments: z.boolean().optional(),
  })
    .optional()
    .nullable(),
  
  integrationEndpoints: z.array(integrationEndpointSchema)
    .max(10, 'Maximum 10 endpoints allowed')
    .optional()
    .nullable()
    .refine((list) => {
      console.log(`🔍 [VALIDATION-REFINE] integrationEndpoints refine check:`, { 
        list, 
        type: typeof list,
        isArray: Array.isArray(list),
        length: Array.isArray(list) ? list.length : 'N/A',
        value: JSON.stringify(list)
      });
      // Skip validation if undefined, null, or empty array
      if (list === undefined || list === null || (Array.isArray(list) && list.length === 0)) {
        console.log(`✅ [VALIDATION-REFINE] Skipping validation (empty/undefined/null)`);
        return true;
      }
      // Validate unique names only if array has items
      if (!Array.isArray(list)) {
        console.error(`❌ [VALIDATION-REFINE] integrationEndpoints is not an array:`, typeof list);
        return false;
      }
      try {
        const result = uniqueEndpointNames(list);
        console.log(`✅ [VALIDATION-REFINE] Unique endpoint names check:`, { result, listLength: list.length });
        return result;
      } catch (error) {
        console.error('❌ [VALIDATION-REFINE] Error in uniqueEndpointNames:', error);
        return false;
      }
    }, {
      message: 'Endpoint name already exists',
      path: ['integrationEndpoints']
    }),

  isActive: z.boolean()
    .optional(),
  
  ownerName: z.string()
    .max(255, 'Owner name must be less than 255 characters')
    .optional()
    .nullable(),
  
  ownerPhone: z.string()
    .max(50, 'Owner phone must be less than 50 characters')
    .optional()
    .nullable(),
  
  timezone: z.string()
    .max(100, 'Timezone must be less than 100 characters')
    .optional()
    .nullable(),
  
  webhookEnabled: z.boolean()
    .optional()
}).passthrough(); // Use passthrough instead of strict to allow extra fields

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

