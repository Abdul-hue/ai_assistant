# Supabase Storage Setup – `agent-files` Bucket

Use these commands to provision the secure storage bucket required for agent knowledge base uploads.

## Bucket Creation (JavaScript)

```javascript
await supabase.storage.createBucket('agent-files', {
  public: false,
  fileSizeLimit: 10 * 1024 * 1024, // 10MB per object
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
});
```

## Storage Policies (SQL)

```sql
-- Allow authenticated users to upload to the bucket
CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'agent-files');

-- Allow authenticated users to read files they upload
CREATE POLICY "Users can read files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'agent-files');

-- Allow authenticated users to delete files they uploaded
CREATE POLICY "Users can delete files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'agent-files');
```

Make sure to run these statements in the Supabase SQL editor before deploying the new file upload workflow.

