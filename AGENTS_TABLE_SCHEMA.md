# Agents Table Schema

## Updated Schema (After Migration 012)

The `agents` table in the `public` schema has been updated to include avatar and persona fields.

### Complete Column List

| Column Name | Type | Nullable | Default | Description |
|------------|------|----------|---------|-------------|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NOT NULL | - | Foreign key to `profiles(id)` |
| `agent_name` | TEXT | NOT NULL | - | Name of the agent |
| `description` | TEXT | NULL | - | Description of the agent |
| `whatsapp_phone_number` | TEXT | NULL | - | WhatsApp phone number for the agent |
| `status` | TEXT | NULL | `'inactive'` | Agent status: 'active' or 'inactive' |
| `qr_token` | TEXT | NULL | - | Unique QR token for WhatsApp connection |
| `webhook_url` | TEXT | NULL | - | Webhook URL for agent events |
| `webhook_secret` | TEXT | NULL | - | Secret for webhook authentication |
| `chat_history_enabled` | BOOLEAN | NULL | `true` | Whether chat history is enabled |
| `retention_days` | INTEGER | NULL | `30` | Number of days to retain messages |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | `now()` | Creation timestamp |
| `connected_at` | TIMESTAMP WITH TIME ZONE | NULL | - | Last connection timestamp |
| `session_data` | JSONB | NULL | - | WhatsApp session data |
| `company_data` | JSONB | NULL | - | Company integration data |
| `features` | JSONB | NULL | `'{"calendar": true, "chatHistory": true, "taskManagement": true, "fileSharing": false}'` | Feature flags |
| `initial_prompt` | TEXT | NULL | - | Initial prompt for the agent |
| `response_language` | TEXT | NULL | `'en'` | Response language |
| `agent_type` | TEXT | NULL | `'custom'` | Type of agent |
| `avatar_url` | TEXT | NULL | - | **NEW** - URL to agent avatar image in `agent_avatars` bucket |
| `persona` | TEXT | NULL | - | **NEW** - Agent persona and behavior description |

### Storage Bucket

**Bucket Name:** `agent_avatars`

- **Type:** Public bucket
- **Purpose:** Stores agent avatar images
- **File Naming:** `{agentId}_{timestamp}.{extension}`
- **Supported Formats:** JPEG, PNG, GIF, WEBP
- **Max File Size:** 5MB

### Indexes

- Primary key index on `id`
- Index on `user_id` (for user ownership queries)
- Index on `avatar_url` (where `avatar_url IS NOT NULL`)

### Row Level Security (RLS)

RLS is enabled on the `agents` table with the following policies:

1. **Users can view own agents** - SELECT policy using `auth.uid() = user_id`
2. **Users can create own agents** - INSERT policy using `auth.uid() = user_id`
3. **Users can update own agents** - UPDATE policy using `auth.uid() = user_id`
4. **Users can delete own agents** - DELETE policy using `auth.uid() = user_id`

### API Endpoints

#### Avatar Management

- **POST** `/api/agents/:agentId/avatar` - Upload agent avatar
  - Requires: Multipart form data with `avatar` file
  - Returns: `{ avatar_url: string, agent: Agent }`

- **DELETE** `/api/agents/:agentId/avatar` - Delete agent avatar
  - Returns: `{ success: boolean }`

#### Agent Update

- **PUT** `/api/agents/:agentId` - Update agent fields
  - Body: `{ agent_name?: string, persona?: string, whatsapp_phone_number?: string }`
  - Returns: `{ agent: Agent }`

### Migration

The migration file `012_add_agent_avatar_and_persona.sql` adds:
- `avatar_url` column (TEXT, nullable)
- `persona` column (TEXT, nullable)
- Index on `avatar_url` for faster lookups

The storage bucket `agent_avatars` is created automatically by the backend when the first avatar is uploaded.

