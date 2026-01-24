# WhatsApp Contacts & Groups Sync Mechanism

## Overview
The sync system uses **event-driven architecture** - data flows from WhatsApp via Baileys events, not polling.

## Contacts Sync

### Initial Sync
- **Trigger**: WhatsApp connection opens (`connection.update` event)
- **Event**: `contacts.set` (sent 10-30s after connection)
- **Process**: 
  1. WhatsApp sends ALL contacts via `contacts.set` event
  2. Filter to only **saved contacts** (have `name` or `verifiedName`)
  3. Extract phone from JID format (`1234567890@s.whatsapp.net`)
  4. Normalize phone numbers to `+1234567890` format
  5. Batch upsert to `public.contacts` table (50 per batch)

### Real-time Updates
- **`contacts.upsert`**: New contacts added → sync immediately
- **`contacts.update`**: Existing contacts changed → update database
- **Filtering**: Only saved contacts (with names) are stored

## Groups Sync

### Initial Sync
- **Trigger**: WhatsApp connection opens
- **Method**: `sock.groupFetchAllParticipating()` - fetches ALL active groups
- **Process**:
  1. Fetch groups via Baileys API call
  2. Extract group metadata (name, JID, participants, admin status)
  3. Upsert to `public.groups` table
  4. Sync participants to `public.group_participants` table

### Real-time Updates
- **`groups.set`**: All groups sent via event → sync to database
- **`groups.upsert`**: New/updated groups → sync immediately
- **`groups.update`**: Group changes (name, participants) → update database

## Data Flow

```
WhatsApp → Baileys Events → Sync Services → Supabase Database
                ↓
         Event Listeners
                ↓
    Filter & Normalize Data
                ↓
         Batch Upsert (50 items)
```

## Key Features

- **Event-Driven**: No polling - data arrives via events
- **Filtered**: Only saved contacts stored (not unsaved numbers)
- **Batched**: 50 items per database operation for performance
- **Real-time**: Updates sync immediately when changes occur
- **Resilient**: Continues listening even if individual syncs fail

## Database Tables

- `public.contacts`: Synced WhatsApp contacts (name, phone, metadata)
- `public.groups`: Synced WhatsApp groups (name, JID, metadata)
- `public.group_participants`: Group members (JID, admin status)

## API Endpoints

- `GET /api/whatsapp/contacts/:agentId`: Reads from `public.contacts` table
- `GET /api/whatsapp/groups/:agentId`: Fetches live groups + matches with contacts
