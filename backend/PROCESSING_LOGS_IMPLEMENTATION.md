# Processing Logs Service - Implementation Summary

## ✅ Implementation Complete

The processing logs service has been fully implemented to track all stages of message processing with detailed timing, status, and error information.

## 📁 Files Created/Updated

### New Files
- ✅ `backend/src/services/loggingService.js` - Complete logging service with timing helpers

### Updated Files
- ✅ `backend/src/routes/mediaWebhook.js` - Added logging for webhook reception and queuing
- ✅ `backend/src/workers/mediaWorker.js` - Added comprehensive logging for all processing stages

## 🎯 Features

### Logging Stages

The system tracks these processing stages:

1. **RECEIVED** - Webhook payload received
2. **QUEUED** - Message queued for async processing
3. **DOWNLOADING** - Downloading media file from WhatsApp
4. **DOWNLOADED** - File downloaded successfully
5. **UPLOADING** - Uploading file to Supabase Storage
6. **UPLOADED** - File uploaded successfully
7. **FORWARDING** - Forwarding data to N8N webhook
8. **FORWARDED** - Successfully forwarded to N8N
9. **COMPLETED** - Message processing completed
10. **FAILED** - Processing failed

### Log Statuses

- **STARTED** - Stage has begun
- **SUCCESS** - Stage completed successfully
- **FAILED** - Stage failed with error
- **SKIPPED** - Stage was skipped (e.g., text-only message, audio already has URL)

## 📊 Database Schema

The system uses the existing `processing_logs` table:

```sql
CREATE TABLE public.processing_logs (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  message_id VARCHAR(255) NOT NULL,
  report_id UUID NULL,              -- Always NULL (not using reports table)
  stage VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL,
  message TEXT NULL,
  metadata JSONB NULL,
  duration_ms INTEGER NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 🔧 Usage Examples

### Basic Logging

```javascript
const { logProcessingStep, STAGES, STATUS } = require('../services/loggingService');

// Log a simple step
await logProcessingStep(
  'MESSAGE123',
  STAGES.RECEIVED,
  STATUS.SUCCESS,
  'Webhook received',
  {
    metadata: { from: '1234567890' }
  }
);
```

### Timed Logging

```javascript
const { startTiming, STAGES } = require('../services/loggingService');

// Start timing a stage
const timer = startTiming('MESSAGE123', STAGES.DOWNLOADING, {
  mimetype: 'application/pdf'
});

try {
  // Perform operation
  const result = await downloadFile();
  
  // Log success with duration
  await timer.success('File downloaded', {
    fileSize: result.size
  });
} catch (error) {
  // Log failure with duration and error
  await timer.failed(error);
}
```

### Skipped Stages

```javascript
// Log when a stage is skipped
await logProcessingStep(
  'MESSAGE123',
  STAGES.DOWNLOADING,
  STATUS.SKIPPED,
  'No media file - text-only message',
  {
    metadata: { messageType: 'text' }
  }
);
```

## 📈 Monitoring Endpoints

### Get Processing History

```
GET /logs/:messageId
```

Returns complete processing history and statistics for a message.

**Response:**
```json
{
  "messageId": "PDF456",
  "history": [
    {
      "id": "uuid1",
      "message_id": "PDF456",
      "stage": "received",
      "status": "success",
      "message": "Webhook payload received",
      "duration_ms": null,
      "created_at": "2025-01-15T10:00:00Z",
      "metadata": { "from": "1234567890" }
    },
    // ... more logs
  ],
  "stats": {
    "messageId": "PDF456",
    "totalSteps": 9,
    "successfulSteps": 8,
    "failedSteps": 0,
    "totalDurationMs": 2500,
    "stages": [...],
    "firstLog": "2025-01-15T10:00:00Z",
    "lastLog": "2025-01-15T10:00:08Z"
  }
}
```

### Get Failed Logs

```
GET /logs/failed?limit=50&since=2025-01-15T00:00:00Z
```

Returns recent failed processing logs for monitoring.

**Query Parameters:**
- `limit` - Number of logs to return (default: 100)
- `since` - ISO timestamp to filter logs (optional)

**Response:**
```json
{
  "count": 5,
  "logs": [
    {
      "id": "uuid1",
      "message_id": "PDF456",
      "stage": "downloading",
      "status": "failed",
      "message": "downloading failed: Socket not found",
      "duration_ms": 1200,
      "created_at": "2025-01-15T10:00:05Z",
      "metadata": {
        "error_message": "Socket not found",
        "error_stack": "..."
      }
    }
  ]
}
```

## 📝 Example Log Flow

For a PDF document message, the logs will look like:

| Stage | Status | Message | Duration |
|-------|--------|---------|----------|
| received | success | Webhook payload received | - |
| queued | success | Message queued for async processing | - |
| downloading | started | downloading started | - |
| downloading | success | File downloaded successfully | 1200ms |
| uploading | started | uploading started | - |
| uploading | success | File uploaded to storage | 850ms |
| forwarding | started | forwarding started | - |
| forwarding | success | Successfully forwarded to N8N | 450ms |
| completed | success | Processing completed successfully | - |

## 🎯 Benefits

✅ **Complete Audit Trail** - See exactly what happened to every message
✅ **Performance Monitoring** - Track how long each step takes
✅ **Error Debugging** - Detailed error messages and stack traces
✅ **Retry Tracking** - See how many attempts were made
✅ **Analytics Ready** - Query logs for insights (avg processing time, failure rates)
✅ **Non-Blocking** - Logging failures don't break message processing

## 🔍 Querying Logs

### Get All Logs for a Message

```sql
SELECT * FROM processing_logs 
WHERE message_id = 'PDF456' 
ORDER BY created_at ASC;
```

### Get Processing Statistics

```sql
SELECT 
  message_id,
  COUNT(*) as total_steps,
  COUNT(*) FILTER (WHERE status = 'success') as successful_steps,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_steps,
  SUM(duration_ms) as total_duration_ms
FROM processing_logs
WHERE message_id = 'PDF456'
GROUP BY message_id;
```

### Get Average Processing Times

```sql
SELECT 
  stage,
  AVG(duration_ms) as avg_duration_ms,
  MIN(duration_ms) as min_duration_ms,
  MAX(duration_ms) as max_duration_ms,
  COUNT(*) as total_operations
FROM processing_logs
WHERE duration_ms IS NOT NULL
GROUP BY stage
ORDER BY avg_duration_ms DESC;
```

### Get Failure Rates

```sql
SELECT 
  stage,
  COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*) as failure_rate_percent,
  COUNT(*) as total_attempts
FROM processing_logs
GROUP BY stage
ORDER BY failure_rate_percent DESC;
```

## 🚨 Error Handling

The logging service is designed to never break message processing:

- ✅ Logging errors are caught and logged to console
- ✅ Failed log writes return `null` instead of throwing
- ✅ All logging calls are wrapped in try-catch
- ✅ Async logging doesn't block main flow

## 📊 Monitoring Dashboard Ideas

1. **Processing Timeline** - Visual timeline of all stages for a message
2. **Performance Metrics** - Average processing times per stage
3. **Failure Analysis** - Most common failure points and reasons
4. **Throughput Monitoring** - Messages processed per hour/day
5. **Retry Analysis** - How many retries are typically needed

## 🔧 Configuration

No additional configuration needed. The service uses:
- Existing Supabase connection (`supabaseAdmin`)
- Existing `processing_logs` table
- Standard logging levels (info, error, warn)

## ✨ Next Steps

1. ✅ Logging service implemented
2. ✅ Webhook handler updated
3. ✅ Media worker updated
4. ✅ Monitoring endpoints added
5. 🔄 Optional: Create dashboard to visualize logs
6. 🔄 Optional: Set up alerts for high failure rates

---

**Status**: ✅ Implementation Complete - Ready for Use
