const { Pinecone } = require('@pinecone-database/pinecone');

const DEFAULT_CHUNK_TOKENS = parseInt(process.env.PINECONE_CHUNK_TOKENS || process.env.PINECONE_CHUNK_WORDS || '400', 10);
const DEFAULT_CHUNK_OVERLAP_TOKENS = parseInt(process.env.PINECONE_CHUNK_OVERLAP_TOKENS || process.env.PINECONE_CHUNK_OVERLAP || '60', 10);
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

let pineconeClient = null;
let pineconeIndex = null;

function assertEnvVar(name) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

async function getPineconeIndex() {
  if (pineconeIndex) {
    return pineconeIndex;
  }

  assertEnvVar('PINECONE_API_KEY');
  assertEnvVar('PINECONE_INDEX_NAME');

  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });
  }

  pineconeIndex = pineconeClient.index(process.env.PINECONE_INDEX_NAME);
  return pineconeIndex;
}

/**
 * Split text into overlapping chunks sized by approximate token counts.
 * Uses 1 token ≈ 4 chars heuristic and attempts to break on sentence boundaries.
 */
function splitIntoChunks(text, maxTokens = DEFAULT_CHUNK_TOKENS, overlapTokens = DEFAULT_CHUNK_OVERLAP_TOKENS) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const sanitizedMaxTokens = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 400;
  const sanitizedOverlapTokens = Number.isFinite(overlapTokens) && overlapTokens >= 0
    ? Math.min(overlapTokens, sanitizedMaxTokens - 1)
    : 0;

  const cleanText = text.replace(/\s+/g, ' ').trim();
  if (!cleanText) {
    return [];
  }

  // Approximate char budget per chunk using 4 chars per token heuristic.
  const maxChars = sanitizedMaxTokens * 4;
  const overlapChars = sanitizedOverlapTokens * 4;

  if (cleanText.length <= maxChars) {
    return [cleanText];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < cleanText.length) {
    let endIndex = startIndex + maxChars;

    if (endIndex < cleanText.length) {
      const searchStart = Math.max(startIndex, endIndex - Math.floor(maxChars * 0.2));
      const searchWindow = cleanText.substring(searchStart, endIndex);
      const sentenceEndings = /[.!?]\s+/g;
      let match;
      let lastSentenceEnd = -1;

      while ((match = sentenceEndings.exec(searchWindow)) !== null) {
        lastSentenceEnd = searchStart + match.index + match[0].length;
      }

      if (lastSentenceEnd > startIndex) {
        endIndex = lastSentenceEnd;
      }
    }

    const chunk = cleanText.substring(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (endIndex >= cleanText.length) {
      break;
    }

    startIndex = Math.max(startIndex + 1, endIndex - overlapChars);
  }

  return chunks.length > 0 ? chunks : [cleanText];
}

async function generateEmbedding(text) {
  assertEnvVar('OPENAI_API_KEY');

  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const trimmed = text.trim();

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      input: trimmed,
      model: OPENAI_EMBEDDING_MODEL
    })
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`OpenAI embedding error (${response.status}): ${errorPayload}`);
  }

  const json = await response.json();
  const embedding = json?.data?.[0]?.embedding;

  if (!Array.isArray(embedding)) {
    throw new Error('OpenAI embedding response is malformed');
  }

  return embedding;
}

function getNamespace(agentId) {
  const useNamespace = process.env.PINECONE_USE_NAMESPACE !== 'false';
  if (!useNamespace) {
    return null;
  }

  return agentId;
}

async function processAndStoreToPinecone({ agentId, content, fileMetadata }) {
  if (!agentId) {
    throw new Error('agentId is required for Pinecone processing');
  }

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Content is required for Pinecone processing');
  }

  const trimmedContent = content.trim();

  const chunks = splitIntoChunks(trimmedContent);
  const safeChunks = chunks.length > 0 ? chunks : [trimmedContent];

  console.log(`[PINECONE] Creating ${safeChunks.length} chunk(s) from ${trimmedContent.length} characters`);
  if (safeChunks.length > 0) {
    const preview = safeChunks[0].replace(/\s+/g, ' ').slice(0, 120);
    console.log(`[PINECONE] First chunk preview (${safeChunks[0].length} chars): "${preview}${safeChunks[0].length > 120 ? '…' : ''}"`);
  }

  const vectors = [];

  for (let i = 0; i < safeChunks.length; i += 1) {
    const chunkText = safeChunks[i];
    try {
      const embedding = await generateEmbedding(chunkText);
      vectors.push({
        id: `${agentId}_chunk_${i}`,
        values: embedding,
        metadata: {
          agent_id: agentId,
          file_id: fileMetadata?.id ?? null,
          file_name: fileMetadata?.name ?? fileMetadata?.fileName ?? null,
          storage_path: fileMetadata?.storagePath ?? fileMetadata?.path ?? null,
          chunk_index: i,
          total_chunks: safeChunks.length,
          text: chunkText,
          uploaded_at: fileMetadata?.uploadedAt ?? null,
          size: fileMetadata?.size ?? null,
          content_type: fileMetadata?.type ?? null
        }
      });
    } catch (error) {
      console.error(`[PINECONE] Failed to embed chunk ${i}:`, error.message);
      throw error;
    }
  }

  if (vectors.length === 0) {
    throw new Error('No vectors generated for Pinecone upsert');
  }

  const index = await getPineconeIndex();
  const namespace = getNamespace(agentId);
  const target = namespace ? index.namespace(namespace) : index;

  await target.upsert(vectors);

  console.log(`[PINECONE] Stored ${vectors.length} chunks for agent ${agentId}${namespace ? ` in namespace ${namespace}` : ''}`);

  return {
    success: true,
    chunksStored: vectors.length
  };
}

async function queryAgentDocuments(agentId, query, topK = 5) {
  if (!agentId) {
    throw new Error('agentId is required for query');
  }

  if (!query) {
    throw new Error('Query text is required');
  }

  const index = await getPineconeIndex();
  const namespace = getNamespace(agentId);
  const target = namespace ? index.namespace(namespace) : index;

  const embedding = await generateEmbedding(query);

  const response = await target.query({
    vector: embedding,
    topK,
    includeMetadata: true,
    filter: namespace ? undefined : {
      agent_id: { $eq: agentId }
    }
  });

  return response?.matches || [];
}

module.exports = {
  processAndStoreToPinecone,
  splitIntoChunks,
  generateEmbedding,
  queryAgentDocuments
};

