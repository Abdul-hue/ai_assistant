# Agent File Processing QA Checklist

**Updated:** November 12, 2025  
**Purpose:** Validate end-to-end processing of uploaded agent documents, Pinecone storage, and query retrieval.

---

## ✅ Preconditions

- Backend running with required environment variables:
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`
  - Index must be **dense**, dimension `1536`, metric `dotproduct` or `cosine`
- (`PINECONE_ENVIRONMENT` is no longer required with Pinecone Serverless SDK v2+)
  - `OPENAI_API_KEY` (and optional `OPENAI_EMBEDDING_MODEL`)
- Frontend running with authenticated session.
- Supabase bucket `agent-files` created.

---

## 🧪 Test Flow

### 1. Create Agent & Upload Document
1. Navigate to `Create Agent`.
2. Enter required fields and upload a PDF (≤10 MB).
3. Submit form.
4. **Expected:** Toasts indicate agent creation and either confirm document processing or warn about failures.

### 2. Verify Supabase Storage & Metadata
1. In Supabase dashboard, open `Storage › agent-files` and confirm the uploaded object path matches `uploaded_files[*].storagePath`.
2. Check `agents` table `uploaded_files` JSON includes `id`, `storagePath`, and `type`.
3. Confirm `agent_document_contents` table contains one row for the agent/file with non-empty `content`.

### 3. Validate Pinecone Upsert
1. Use Pinecone console or API:
   ```js
   await index.query({
     vector: new Array(1536).fill(0),
     topK: 1,
     filter: { agent_id: { $eq: "<AGENT_ID>" } },
     includeMetadata: true,
   })
   ```
2. **Expected:** At least one match with metadata fields (`file_id`, `chunk_index`, `text`, etc.).

### 4. Query via API Helper
1. From frontend devtools or integration tests call:
   ```ts
   const matches = await queryAgentDocuments("<AGENT_ID>", "search phrase", { topK: 3 });
   ```
2. **Expected:** Array of matches ordered by score, each including `file_name`, `chunk_index`, and `text`.

---

## ⚠️ Error Handling Scenarios

- **Unsupported type:** Upload `.doc` to confirm UI toast shows failure (backend responds `Unsupported file type`).
- **Expired credentials:** Temporarily unset `OPENAI_API_KEY` → `/api/process-agent-file` should return 500 with error message logged.
- **Large file:** Upload >25 MB file → backend responds `413` (file exceeds limit) and toast indicates failure.

---

## 🔁 Retry Guidance

- Retrying file processing can be done via new endpoint:
  ```bash
  curl -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{"agent_id":"<AGENT_ID>","file_id":"<FILE_ID>"}' \
    http://localhost:3001/api/process-agent-file
  ```
- For failed Pinecone writes, re-run once environment issues are resolved. Existing vectors are overwritten (`upsert`).

---

## ✅ Pass Criteria

- Agent creation completes with success toast.
- `agent_document_contents` contains extracted text.
- Pinecone index returns ≥1 chunk for the agent.
- `queryAgentDocuments` helper returns relevant matches with metadata.


