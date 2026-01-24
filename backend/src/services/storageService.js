const { supabaseAdmin } = require('../config/supabase');
const { getFileExtension, getFileCategory } = require('./downloadService');
const pino = require('pino');
const logger = pino({ level: 'info' });

const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME || 'whatsapp-media-files';
const URL_EXPIRY = parseInt(process.env.SIGNED_URL_EXPIRY) || 604800; // 7 days

/**
 * Upload file to Supabase Storage
 * @param {Buffer} buffer - File buffer
 * @param {string} messageId - Message ID for unique naming
 * @param {string} agentId - Agent ID for folder organization
 * @param {string} mimetype - File MIME type
 * @returns {Promise<{url: string, storageKey: string, expiresAt: Date, publicUrl: string}>}
 */
async function uploadFile(buffer, messageId, agentId, mimetype) {
  try {
    // Generate file path
    const extension = getFileExtension(mimetype);
    const category = getFileCategory(mimetype);
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Path: {agentId}/{category}/{date}_{messageId}.{ext}
    const fileName = `${date}_${messageId}.${extension}`;
    const storagePath = `${agentId}/${category}/${fileName}`;
    
    logger.info({ storagePath, size: buffer.length }, 'Uploading file to storage');
    
    // ✅ FIX: Check if exact file already exists by listing files with exact name match
    try {
      const { data: fileList, error: listError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .list(`${agentId}/${category}`, {
          limit: 1000,
          search: fileName // Search for exact filename
        });
      
      // Check if exact file exists
      if (fileList && fileList.length > 0) {
        const exactMatch = fileList.find(file => file.name === fileName);
        if (exactMatch) {
          logger.info({ storagePath, messageId }, 'File already exists in storage, reusing existing file');
          
          // Generate signed URL for existing file
          const { data: signedUrlData, error: urlError } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .createSignedUrl(storagePath, URL_EXPIRY);
          
          if (urlError) {
            throw new Error(`Failed to generate signed URL: ${urlError.message}`);
          }
          
          const expiresAt = new Date(Date.now() + (URL_EXPIRY * 1000));
          
          return {
            url: signedUrlData.signedUrl,
            storageKey: storagePath,
            expiresAt: expiresAt.toISOString(),
            publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${storagePath}`
          };
        }
      }
    } catch (checkError) {
      // File doesn't exist or check failed - proceed with upload
      logger.debug({ messageId, error: checkError.message }, 'File does not exist, proceeding with upload');
    }
    
    // ✅ FIX: Use upsert: true to overwrite if exists (prevents duplicates with different names)
    // Upload to Supabase Storage (file doesn't exist, upload new)
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: mimetype,
        cacheControl: '3600',
        upsert: true // ✅ Overwrite if exists (prevents duplicate files with same path)
      });
    
    // ✅ FIX: If file already exists error, get the existing file instead of creating duplicate
    if (error) {
      // Check if it's a duplicate file error (even with upsert: true, some errors might occur)
      if (error.message?.includes('already exists') || error.message?.includes('duplicate') || error.statusCode === '409') {
        logger.warn({ storagePath, messageId }, 'File already exists (race condition), reusing existing file');
        
        // File exists - get signed URL for existing file
        const { data: signedUrlData, error: urlError } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .createSignedUrl(storagePath, URL_EXPIRY);
        
        if (urlError) {
          throw new Error(`Failed to generate signed URL for existing file: ${urlError.message}`);
        }
        
        const expiresAt = new Date(Date.now() + (URL_EXPIRY * 1000));
        
        return {
          url: signedUrlData.signedUrl,
          storageKey: storagePath,
          expiresAt: expiresAt.toISOString(),
          publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${storagePath}`
        };
      }
      
      throw new Error(`Storage upload failed: ${error.message}`);
    }
    
    logger.info({ storagePath }, 'File uploaded successfully');
    
    // Generate signed URL (expires in 7 days by default)
    const { data: signedUrlData, error: urlError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storagePath, URL_EXPIRY);
    
    if (urlError) {
      throw new Error(`Failed to generate signed URL: ${urlError.message}`);
    }
    
    const expiresAt = new Date(Date.now() + (URL_EXPIRY * 1000));
    
    return {
      url: signedUrlData.signedUrl,
      storageKey: storagePath,
      expiresAt: expiresAt.toISOString(),
      publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${storagePath}`
    };
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Failed to upload file');
    throw error;
  }
}

/**
 * Get public URL for a file (if bucket is public)
 */
function getPublicUrl(storagePath) {
  const { data } = supabaseAdmin.storage
    .from(BUCKET_NAME)
    .getPublicUrl(storagePath);
  
  return data.publicUrl;
}

/**
 * Delete file from storage
 */
async function deleteFile(storagePath) {
  try {
    const { error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .remove([storagePath]);
    
    if (error) throw error;
    
    logger.info({ storagePath }, 'File deleted from storage');
    return true;
  } catch (error) {
    logger.error({ storagePath, error: error.message }, 'Failed to delete file');
    throw error;
  }
}

module.exports = {
  uploadFile,
  getPublicUrl,
  deleteFile
};
