const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Download a file from a URL and return its Buffer representation.
 * @param {string} fileUrl
 * @returns {Promise<Buffer>}
 */
async function downloadFileAsBuffer(fileUrl) {
  console.log('[EXTRACTOR] Starting download', { url: fileUrl });
  const response = await fetch(fileUrl);

  if (!response.ok) {
    throw new Error(`Failed to download file. Status: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  console.log('[EXTRACTOR] Download complete', {
    url: fileUrl,
    byteLength: arrayBuffer.byteLength,
  });
  return Buffer.from(arrayBuffer);
}

/**
 * Extracts text content from a file stored at a signed Supabase URL.
 * Supports PDF, TXT, and DOCX (Microsoft Word) formats.
 *
 * @param {string} fileUrl - Signed URL pointing to the file in Supabase storage.
 * @param {string} mimeType - MIME type of the file (e.g. application/pdf).
 * @returns {Promise<string>} - Extracted text content.
 */
async function extractBufferContent(buffer, mimeType) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Buffer is required to extract content');
  }

  if (!mimeType) {
    throw new Error('MIME type is required to extract content');
  }

  switch (mimeType) {
    case 'application/pdf': {
      const pdfData = await pdfParse(buffer);
      return pdfData.text || '';
    }
    case 'text/plain':
    case 'text/markdown': {
      return buffer.toString('utf-8');
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }
    default: {
      throw new Error(`Unsupported file type for extraction: ${mimeType}`);
    }
  }
}

async function extractFileContent(fileUrl, mimeType) {
  if (!fileUrl) {
    throw new Error('File URL is required to extract content');
  }

  if (!mimeType) {
    throw new Error('MIME type is required to extract content');
  }

  const buffer = await downloadFileAsBuffer(fileUrl);
  return extractBufferContent(buffer, mimeType);
}

module.exports = {
  extractFileContent,
  extractBufferContent,
  downloadFileAsBuffer,
};

