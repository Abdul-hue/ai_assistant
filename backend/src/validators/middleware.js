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
    // Get the data to validate based on source - declare outside try-catch for error handling
    let dataToValidate;
    try {
      // Get the data to validate based on source
      dataToValidate = req[source];
      
      console.log(`🔍 [VALIDATION] Starting validation for ${req.method} ${req.path}`, {
        source,
        dataType: typeof dataToValidate,
        dataKeys: dataToValidate && typeof dataToValidate === 'object' ? Object.keys(dataToValidate) : 'N/A',
        dataPreview: dataToValidate ? JSON.stringify(dataToValidate, null, 2).substring(0, 500) : 'null/undefined', // First 500 chars
      });
      
      // Validate the data
      const validatedData = await schema.parseAsync(dataToValidate);
      
      // Replace the request data with validated/sanitized data
      req[source] = validatedData;
      
      console.log(`✅ [VALIDATION] Validation passed for ${req.method} ${req.path}`, {
        validatedKeys: validatedData && typeof validatedData === 'object' ? Object.keys(validatedData) : 'N/A',
      });
      
      next();
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof ZodError) {
        const errors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
          path: err.path,
        }));
        
        console.error(`❌ [VALIDATION] Zod validation failed for ${req.method} ${req.path}:`, {
          errors,
          errorCount: errors.length,
          requestData: dataToValidate ? JSON.stringify(dataToValidate, null, 2) : 'null/undefined',
        });
        
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Invalid input data',
          details: errors
        });
      }
      
      // Handle other errors (non-Zod errors)
      console.error('❌ [VALIDATION] Non-Zod error during validation:', {
        errorType: error.constructor.name,
        errorMessage: error.message,
        errorStack: error.stack,
        requestPath: `${req.method} ${req.path}`,
        requestData: dataToValidate ? JSON.stringify(dataToValidate, null, 2) : 'null/undefined',
        source,
        reqBody: req.body ? JSON.stringify(req.body, null, 2).substring(0, 500) : 'null/undefined',
      });
      
      return res.status(500).json({
        error: 'Internal server error',
        message: 'An error occurred during validation',
        details: process.env.NODE_ENV === 'development' ? {
          message: error.message,
          type: error.constructor.name,
          stack: error.stack,
        } : undefined
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

