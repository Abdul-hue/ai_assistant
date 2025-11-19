const { ZodError } = require('zod');

/**
 * SECURITY: Validation middleware factory
 * Validates request data against Zod schemas
 * 
 * @param {Object} schema - Zod schema to validate against
 * @param {string} source - Where to get data from ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
const validate = (schema, source = 'body') => {
  return async (req, res, next) => {
    try {
      // Get the data to validate based on source
      const dataToValidate = req[source];
      
      // Validate the data
      const validatedData = await schema.parseAsync(dataToValidate);
      
      // Replace the request data with validated/sanitized data
      req[source] = validatedData;
      
      // Log validation success in development
      if (process.env.NODE_ENV !== 'production') {
        console.log(`✅ Validation passed for ${req.method} ${req.path}`);
      }
      
      next();
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof ZodError) {
        const errors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }));
        
        console.warn(`⚠️ Validation failed for ${req.method} ${req.path}:`, errors);
        
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Invalid input data',
          details: errors
        });
      }
      
      // Handle other errors
      console.error('❌ Validation middleware error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'An error occurred during validation'
      });
    }
  };
};

/**
 * Validates UUID in URL parameters
 */
const validateUUID = (paramName = 'id') => {
  return (req, res, next) => {
    const uuid = req.params[paramName];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(uuid)) {
      console.warn(`⚠️ Invalid UUID provided: ${uuid}`);
      return res.status(400).json({
        error: 'Invalid ID format',
        message: `${paramName} must be a valid UUID`
      });
    }
    
    next();
  };
};

module.exports = {
  validate,
  validateUUID
};

