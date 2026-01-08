const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { validateUUID } = require('../validators/middleware');
const { supabaseAdmin } = require('../config/supabase');
const { processAgentFile } = require('../services/agentFileProcessingService');
const { Pinecone } = require('@pinecone-database/pinecone');

const router = express.Router();

// Log route registration (for debugging)
console.log('✅ Agent file routes registered:');
console.log('   DELETE /api/agents/:agentId/files/:fileId');
console.log('   POST /api/agents/:agentId/upload-files');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, and DOCX files are allowed.'));
    }
  },
});

// Helper function to get Pinecone index
async function getPineconeIndex() {
  const { Pinecone } = require('@pinecone-database/pinecone');
  if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
    throw new Error('Pinecone configuration missing');
  }
  const client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  return client.index(process.env.PINECONE_INDEX_NAME);
}

// Helper function to get namespace
function getNamespace(agentId) {
  const useNamespace = process.env.PINECONE_USE_NAMESPACE !== 'false';
  return useNamespace ? agentId : null;
}

// DELETE /api/agents/:agentId/files/:fileId
router.delete('/:agentId/files/:fileId', authMiddleware, validateUUID('agentId'), validateUUID('fileId'), async (req, res) => {
  console.log('🗑️ [DELETE-FILE] Route matched:', { agentId: req.params.agentId, fileId: req.params.fileId });
  try {
    const { agentId, fileId } = req.params;
    const userId = req.user.id;

    console.log('🗑️ Deleting file:', { agentId, fileId, userId });

    // Verify agent belongs to user
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, user_id, uploaded_files')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (agentError || !agent) {
      console.error('❌ Agent not found or unauthorized:', agentError);
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Agent not found or you do not have permission to delete files',
      });
    }

    // Find the file in uploaded_files array
    const uploadedFiles = agent.uploaded_files || [];
    const fileToDelete = uploadedFiles.find((f) => f.id === fileId);

    if (!fileToDelete) {
      console.error('❌ File not found in agent:', fileId);
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'File not found',
      });
    }

    console.log('📄 [DELETE-FILE] File to delete:', {
      fileId,
      fileName: fileToDelete.name,
      fileSize: fileToDelete.size,
      storagePath: fileToDelete.storagePath,
      agentId,
      userId,
    });

    // 1. Delete from Supabase Storage
    if (fileToDelete.storagePath) {
      const storagePath = fileToDelete.storagePath.replace('agent-files/', '');
      console.log(`🗑️ [SUPABASE] Deleting from bucket 'agent-files': ${storagePath}`);
      
      const { data: deleteData, error: storageError } = await supabaseAdmin.storage
        .from('agent-files')
        .remove([storagePath]);

      if (storageError) {
        console.error(`❌ [SUPABASE] Error deleting file from storage:`, {
          error: storageError.message,
          code: storageError.statusCode,
          storagePath,
          fileId,
        });
        // Continue with other deletions even if storage deletion fails
      } else {
        console.log(`✅ [SUPABASE] File deleted from storage successfully:`, {
          storagePath,
          deletedPaths: deleteData,
          fileId,
        });
      }
    } else {
      console.warn(`⚠️ [SUPABASE] No storagePath found for file, skipping storage deletion:`, fileToDelete);
    }

    // 2. Delete from Pinecone
    try {
      console.log(`🗑️ [PINECONE] Starting deletion from vector store`, {
        agentId,
        fileId,
        indexName: process.env.PINECONE_INDEX_NAME,
        useNamespace: process.env.PINECONE_USE_NAMESPACE !== 'false',
      });

      const index = await getPineconeIndex();
      const namespace = getNamespace(agentId);
      const target = namespace ? index.namespace(namespace) : index;

      console.log(`🗑️ [PINECONE] Using ${namespace ? `namespace: ${namespace}` : 'default namespace (no namespace)'}`);

      // Delete vectors with file_id filter
      const deleteFilter = namespace
        ? { file_id: { $eq: fileId } }
        : { agent_id: { $eq: agentId }, file_id: { $eq: fileId } };

      console.log(`🗑️ [PINECONE] Delete filter:`, JSON.stringify(deleteFilter, null, 2));

      const deleteResult = await target.deleteMany(deleteFilter);
      
      console.log(`✅ [PINECONE] Vectors deleted successfully:`, {
        fileId,
        agentId,
        namespace: namespace || 'default',
        deleteResult,
      });
    } catch (pineconeError) {
      console.error(`❌ [PINECONE] Error deleting vectors:`, {
        error: pineconeError.message,
        stack: pineconeError.stack,
        fileId,
        agentId,
      });
      // Continue with other deletions
    }

    // 3. Delete from agent_document_contents table
    console.log(`🗑️ [DATABASE] Deleting from agent_document_contents table`, {
      agentId,
      fileId,
    });

    const { data: deletedContent, error: contentError } = await supabaseAdmin
      .from('agent_document_contents')
      .delete()
      .eq('agent_id', agentId)
      .eq('file_id', fileId)
      .select();

    if (contentError) {
      console.error(`❌ [DATABASE] Error deleting from agent_document_contents:`, {
        error: contentError.message,
        code: contentError.code,
        agentId,
        fileId,
      });
    } else {
      console.log(`✅ [DATABASE] Deleted from agent_document_contents:`, {
        rowsDeleted: deletedContent?.length || 0,
        agentId,
        fileId,
      });
    }

    // 4. Update agent's uploaded_files array
    const updatedFiles = uploadedFiles.filter((f) => f.id !== fileId);
    console.log(`🗑️ [DATABASE] Updating agent's uploaded_files array`, {
      agentId,
      originalFileCount: uploadedFiles.length,
      newFileCount: updatedFiles.length,
      fileId,
    });

    const { data: updatedAgent, error: updateError } = await supabaseAdmin
      .from('agents')
      .update({ uploaded_files: updatedFiles })
      .eq('id', agentId)
      .select('uploaded_files');

    if (updateError) {
      console.error(`❌ [DATABASE] Error updating agent uploaded_files:`, {
        error: updateError.message,
        code: updateError.code,
        agentId,
      });
      return res.status(500).json({
        error: 'UPDATE_FAILED',
        message: 'Failed to update agent files list',
      });
    }

    console.log(`✅ [DATABASE] Agent uploaded_files updated successfully`, {
      agentId,
      fileCount: updatedFiles.length,
    });

    console.log(`✅ [DELETE-FILE] File deletion completed successfully: ${fileToDelete.name}`, {
      fileId,
      agentId,
      deletedFrom: ['Supabase Storage', 'Pinecone', 'agent_document_contents', 'agents.uploaded_files'],
    });
    res.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error in delete file route:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to delete file',
    });
  }
});

// POST /api/agents/:agentId/upload-files
router.post('/:agentId/upload-files', authMiddleware, validateUUID('agentId'), upload.array('files', 10), async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    const files = req.files || [];

    console.log('📤 [UPLOAD-FILES] Route matched:', { 
      agentId, 
      userId, 
      fileCount: files.length,
      path: req.path,
      method: req.method 
    });

    if (files.length === 0) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'No files provided',
      });
    }

    // Verify agent belongs to user
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, user_id, uploaded_files')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (agentError || !agent) {
      console.error('❌ Agent not found or unauthorized:', agentError);
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Agent not found or you do not have permission to upload files',
      });
    }

    const uploadedFiles = agent.uploaded_files || [];
    const newFiles = [];

    // Upload each file to Supabase Storage
    for (const file of files) {
      const fileId = randomUUID();
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `${agentId}/${timestamp}_${safeName}`;

      console.log(`📤 [UPLOAD-FILE] Starting upload for: ${file.originalname}`, {
        fileId,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        storagePath,
        agentId,
        userId,
      });

      // Upload to Supabase Storage
      console.log(`📦 [SUPABASE] Uploading to bucket 'agent-files': ${storagePath}`);
      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from('agent-files')
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error(`❌ [SUPABASE] Upload failed for ${file.originalname}:`, {
          error: uploadError.message,
          code: uploadError.statusCode,
          storagePath,
        });
        continue; // Skip this file and continue with others
      }

      console.log(`✅ [SUPABASE] File uploaded successfully: ${storagePath}`, {
        path: uploadData?.path,
        id: uploadData?.id,
      });

      // Create signed URL
      const { data: signedUrlData, error: urlError } = await supabaseAdmin.storage
        .from('agent-files')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365);

      if (urlError) {
        console.error(`❌ [SUPABASE] Failed to create signed URL for ${file.originalname}:`, urlError);
      } else {
        console.log(`✅ [SUPABASE] Signed URL created for: ${file.originalname}`);
      }

      const fileMetadata = {
        id: fileId,
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
        url: signedUrlData?.signedUrl || null,
        uploadedAt: new Date().toISOString(),
        storagePath: `agent-files/${storagePath}`,
      };

      newFiles.push(fileMetadata);
      console.log(`✅ [UPLOAD-FILE] File metadata created: ${file.originalname}`, fileMetadata);
    }

    if (newFiles.length === 0) {
      return res.status(500).json({
        error: 'UPLOAD_FAILED',
        message: 'Failed to upload any files',
      });
    }

    // Update agent's uploaded_files array
    const updatedFiles = [...uploadedFiles, ...newFiles];
    console.log(`📝 [DATABASE] Updating agent's uploaded_files array`, {
      agentId,
      previousFileCount: uploadedFiles.length,
      newFileCount: updatedFiles.length,
      filesAdded: newFiles.length,
    });

    const { data: updatedAgent, error: updateError } = await supabaseAdmin
      .from('agents')
      .update({ uploaded_files: updatedFiles })
      .eq('id', agentId)
      .select('uploaded_files');

    if (updateError) {
      console.error(`❌ [DATABASE] Error updating agent uploaded_files:`, {
        error: updateError.message,
        code: updateError.code,
        agentId,
      });
      return res.status(500).json({
        error: 'UPDATE_FAILED',
        message: 'Files uploaded but failed to update agent',
      });
    }

    console.log(`✅ [DATABASE] Agent uploaded_files updated successfully`, {
      agentId,
      totalFiles: updatedFiles.length,
    });

    // Process files asynchronously (don't block response)
    console.log(`🔄 [PINECONE] Starting async processing for ${newFiles.length} file(s)`);
    setImmediate(async () => {
      for (const fileMetadata of newFiles) {
        try {
          console.log(`🔄 [PINECONE] Processing file: ${fileMetadata.name} (${fileMetadata.id})`);
          console.log(`📝 [PINECONE] Calling processAgentFile with:`, {
            agentId,
            fileId: fileMetadata.id,
            fileName: fileMetadata.name,
            storagePath: fileMetadata.storagePath,
          });

          const result = await processAgentFile({
            agentId,
            fileId: fileMetadata.id,
            agentRecord: {
              id: agentId,
              uploaded_files: updatedFiles,
            },
            skipAgentFetch: true,
          });

          console.log(`✅ [PINECONE] File processed successfully: ${fileMetadata.name}`, {
            chunksStored: result?.chunksStored || 'unknown',
            contentLength: result?.contentLength || 'unknown',
          });
        } catch (error) {
          console.error(`❌ [PINECONE] Error processing file ${fileMetadata.name}:`, {
            error: error.message,
            stack: error.stack,
            fileId: fileMetadata.id,
          });
        }
      }
      console.log(`✅ [PINECONE] Completed processing all ${newFiles.length} file(s)`);
    });

    console.log(`✅ [UPLOAD-FILES] All files uploaded successfully`, {
      totalFiles: newFiles.length,
      files: newFiles.map(f => ({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        storagePath: f.storagePath,
      })),
      agentId,
      userId,
    });

    res.json({
      success: true,
      message: 'Files uploaded successfully',
      data: {
        filesUploaded: newFiles.length,
        files: newFiles,
      },
    });
  } catch (error) {
    console.error('❌ Error in upload files route:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message || 'Failed to upload files',
    });
  }
});

module.exports = router;

