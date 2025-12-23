# Agent Chat Enhancement Plan

A comprehensive guide to enhancing the Agent Chat experience with contacts, calendar integration, and advanced features.

---

## 📋 Table of Contents

1. [Current State](#current-state)
2. [Quick Wins (Easy Improvements)](#quick-wins)
3. [Contact Integration](#contact-integration)
4. [Calendar Integration](#calendar-integration)
5. [Enhanced Chat Features](#enhanced-chat-features)
6. [UI/UX Improvements](#uiux-improvements)
7. [Implementation Priority](#implementation-priority)

---

## 🎯 Current State

The Agent Chat currently provides:
- ✅ Agent selection dropdown
- ✅ Message sending/receiving
- ✅ WhatsApp connection status
- ✅ Button parsing for AI responses
- ✅ Real-time polling (3s interval)

**Limitations:**
- ❌ No contact context (who is the user chatting about?)
- ❌ No calendar visibility (upcoming meetings)
- ❌ No quick actions (add contact, schedule meeting)
- ❌ No conversation history search
- ❌ No message templates

---

## ⚡ Quick Wins

### 1. Add Contact Quick Actions Panel

**File:** `frontend/src/components/chat/ChatInterface.tsx`

Add a collapsible sidebar showing:
- Recent contacts (from `contacts` table filtered by `agent_id`)
- Quick "Send to" action
- Contact search

```tsx
// New component: ContactQuickPanel.tsx
interface Contact {
  id: string;
  name: string;
  phone_number: string;
  agent_id: string;
  last_contacted_at: string;
}

const ContactQuickPanel: React.FC<{ agentId: string }> = ({ agentId }) => {
  const { data: contacts } = useQuery({
    queryKey: ['contacts', agentId],
    queryFn: () => fetchContacts(agentId),
  });

  return (
    <div className="w-64 border-l border-white/10 p-4">
      <h3 className="text-sm font-medium text-gray-400 mb-3">Quick Contacts</h3>
      <div className="space-y-2">
        {contacts?.slice(0, 5).map(contact => (
          <button 
            key={contact.id}
            className="w-full p-2 rounded-lg bg-white/5 hover:bg-white/10 text-left"
          >
            <p className="text-sm text-white">{contact.name}</p>
            <p className="text-xs text-gray-500">{contact.phone_number}</p>
          </button>
        ))}
      </div>
    </div>
  );
};
```

### 2. Add "Send Message to Contact" Command

When user types `/send` or clicks a contact, show a compose dialog:

```tsx
// Message compose with contact selection
<Dialog>
  <DialogContent>
    <DialogHeader>Send Message to Contact</DialogHeader>
    <Select>
      <SelectTrigger>Select Contact</SelectTrigger>
      <SelectContent>
        {contacts.map(c => (
          <SelectItem key={c.id} value={c.phone_number}>
            {c.name} - {c.phone_number}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Textarea placeholder="Your message..." />
    <Button>Send via WhatsApp</Button>
  </DialogContent>
</Dialog>
```

### 3. Add Calendar Preview Widget

Show upcoming events from the calendar:

```tsx
// New component: UpcomingMeetings.tsx
const UpcomingMeetings: React.FC<{ agentId: string }> = ({ agentId }) => {
  const { data: events } = useQuery({
    queryKey: ['upcoming-events', agentId],
    queryFn: () => fetchUpcomingEvents(agentId, 5),
  });

  return (
    <div className="p-3 rounded-xl bg-white/5 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-medium text-gray-400">Upcoming</span>
      </div>
      <div className="space-y-2">
        {events?.map(event => (
          <div key={event.id} className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">
              {format(new Date(event.start_time), 'MMM d, h:mm a')}
            </span>
            <span className="text-gray-300">{event.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## 👥 Contact Integration

### Database Schema Reference

```sql
-- contacts table structure
CREATE TABLE contacts (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  user_id UUID REFERENCES auth.users(id),
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50),
  email VARCHAR(255),
  company VARCHAR(255),
  notes TEXT,
  tags TEXT[],
  last_contacted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Backend API Endpoints Needed

```javascript
// routes/contacts.js - Add these endpoints

// GET /api/agents/:agentId/contacts - List contacts
router.get('/agents/:agentId/contacts', async (req, res) => {
  const { agentId } = req.params;
  const { search, limit = 50 } = req.query;
  
  let query = supabase
    .from('contacts')
    .select('*')
    .eq('agent_id', agentId)
    .order('last_contacted_at', { ascending: false })
    .limit(limit);
  
  if (search) {
    query = query.or(`name.ilike.%${search}%,phone_number.ilike.%${search}%`);
  }
  
  const { data, error } = await query;
  res.json({ contacts: data });
});

// POST /api/agents/:agentId/contacts - Add contact
router.post('/agents/:agentId/contacts', async (req, res) => {
  const { agentId } = req.params;
  const { name, phone_number, email, company, notes, tags } = req.body;
  
  const { data, error } = await supabase
    .from('contacts')
    .insert({ agent_id: agentId, name, phone_number, email, company, notes, tags })
    .select()
    .single();
  
  res.json({ contact: data });
});

// POST /api/agents/:agentId/contacts/:contactId/send-message
router.post('/agents/:agentId/contacts/:contactId/send-message', async (req, res) => {
  const { agentId, contactId } = req.params;
  const { message } = req.body;
  
  // Get contact phone number
  const { data: contact } = await supabase
    .from('contacts')
    .select('phone_number')
    .eq('id', contactId)
    .single();
  
  // Send via WhatsApp
  const result = await sendMessage(agentId, contact.phone_number, message);
  
  // Update last_contacted_at
  await supabase
    .from('contacts')
    .update({ last_contacted_at: new Date().toISOString() })
    .eq('id', contactId);
  
  res.json({ success: true, messageId: result.messageId });
});
```

### Frontend Hook

```typescript
// hooks/useContacts.ts
export const useContacts = (agentId: string) => {
  return useQuery({
    queryKey: ['contacts', agentId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/contacts`, {
        credentials: 'include',
      });
      const data = await res.json();
      return data.contacts;
    },
    enabled: !!agentId,
  });
};

export const useSendToContact = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ agentId, contactId, message }) => {
      const res = await fetch(
        `${API_URL}/api/agents/${agentId}/contacts/${contactId}/send-message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message }),
        }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['contacts']);
    },
  });
};
```

---

## 📅 Calendar Integration

### Display Upcoming Events in Chat

```tsx
// components/chat/CalendarWidget.tsx
import { useQuery } from '@tanstack/react-query';
import { Calendar, Clock, Users } from 'lucide-react';
import { format, isToday, isTomorrow } from 'date-fns';

interface CalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  attendees?: string[];
  location?: string;
}

export const CalendarWidget: React.FC<{ agentId: string }> = ({ agentId }) => {
  const { data: events } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar-events', agentId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/calendar/events?agentId=${agentId}&upcoming=true&limit=5`, {
        credentials: 'include',
      });
      const data = await res.json();
      return data.events;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const formatEventDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return `Today at ${format(date, 'h:mm a')}`;
    if (isTomorrow(date)) return `Tomorrow at ${format(date, 'h:mm a')}`;
    return format(date, 'MMM d at h:mm a');
  };

  if (!events?.length) return null;

  return (
    <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-medium text-violet-300">Upcoming Meetings</span>
      </div>
      <div className="space-y-3">
        {events.map((event) => (
          <div 
            key={event.id} 
            className="flex items-start gap-3 p-2 rounded-lg bg-black/20 hover:bg-black/30 transition-colors cursor-pointer"
          >
            <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{event.title}</p>
              <p className="text-xs text-gray-400">{formatEventDate(event.start_time)}</p>
              {event.attendees?.length > 0 && (
                <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                  <Users className="w-3 h-3" />
                  <span>{event.attendees.length} attendee(s)</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### Quick Schedule Action

Add a command to schedule meetings from chat:

```tsx
// When user types "/schedule" or clicks schedule button
const QuickScheduleDialog: React.FC<{ agentId: string; onClose: () => void }> = ({ agentId, onClose }) => {
  const [title, setTitle] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [contact, setContact] = useState('');
  
  const { data: contacts } = useContacts(agentId);
  const scheduleMutation = useScheduleMeeting();

  const handleSchedule = () => {
    scheduleMutation.mutate({
      agentId,
      title,
      start_time: dateTime,
      attendees: contact ? [contact] : [],
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick Schedule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input 
            placeholder="Meeting title" 
            value={title} 
            onChange={(e) => setTitle(e.target.value)} 
          />
          <Input 
            type="datetime-local" 
            value={dateTime} 
            onChange={(e) => setDateTime(e.target.value)} 
          />
          <Select value={contact} onValueChange={setContact}>
            <SelectTrigger>
              <SelectValue placeholder="Add attendee (optional)" />
            </SelectTrigger>
            <SelectContent>
              {contacts?.map((c) => (
                <SelectItem key={c.id} value={c.email || c.phone_number}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleSchedule} className="w-full">
            Schedule Meeting
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
```

---

## 💬 Enhanced Chat Features

### 1. Message Templates

```tsx
// components/chat/MessageTemplates.tsx
const templates = [
  { id: 'greeting', label: 'Greeting', text: 'Hello! How can I help you today?' },
  { id: 'followup', label: 'Follow-up', text: 'Just following up on our previous conversation...' },
  { id: 'meeting', label: 'Meeting Request', text: 'Would you be available for a quick call?' },
  { id: 'thanks', label: 'Thank You', text: 'Thank you for your time. Looking forward to connecting!' },
];

const MessageTemplates: React.FC<{ onSelect: (text: string) => void }> = ({ onSelect }) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <FileText className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Quick Templates</DropdownMenuLabel>
        {templates.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => onSelect(t.text)}>
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
```

### 2. Slash Commands

```tsx
// utils/slashCommands.ts
export const slashCommands = [
  { command: '/send', description: 'Send message to a contact', action: 'open_send_dialog' },
  { command: '/schedule', description: 'Schedule a meeting', action: 'open_schedule_dialog' },
  { command: '/contact', description: 'Add a new contact', action: 'open_contact_dialog' },
  { command: '/search', description: 'Search conversations', action: 'open_search' },
  { command: '/menu', description: 'Show main menu', action: 'send_menu' },
];

// In ChatInterface.tsx, detect slash commands:
const handleInputChange = (value: string) => {
  setMessage(value);
  
  if (value.startsWith('/')) {
    const matchingCommands = slashCommands.filter(c => 
      c.command.startsWith(value.toLowerCase())
    );
    setShowCommandSuggestions(matchingCommands);
  } else {
    setShowCommandSuggestions([]);
  }
};
```

### 3. Message Search

```tsx
// components/chat/MessageSearch.tsx
const MessageSearch: React.FC<{ agentId: string }> = ({ agentId }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);

  const handleSearch = async () => {
    const res = await fetch(
      `${API_URL}/api/agents/${agentId}/messages/search?q=${encodeURIComponent(query)}`,
      { credentials: 'include' }
    );
    const data = await res.json();
    setResults(data.messages);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Search className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Search Messages</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2 mb-4">
          <Input 
            placeholder="Search..." 
            value={query} 
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <Button onClick={handleSearch}>Search</Button>
        </div>
        <div className="space-y-2 overflow-y-auto max-h-[400px]">
          {results.map((msg) => (
            <div key={msg.id} className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-300">{msg.message}</p>
              <p className="text-xs text-gray-500 mt-1">
                {format(new Date(msg.timestamp), 'MMM d, yyyy h:mm a')}
              </p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
```

---

## 🎨 UI/UX Improvements

### 1. Enhanced Chat Layout

```tsx
// Updated ChatInterface layout with sidebars
<div className="flex h-full">
  {/* Left Sidebar - Contacts */}
  <div className="w-64 border-r border-white/10 hidden lg:block">
    <ContactQuickPanel agentId={selectedAgentId} />
  </div>
  
  {/* Main Chat Area */}
  <div className="flex-1 flex flex-col">
    {/* Calendar Widget */}
    <CalendarWidget agentId={selectedAgentId} />
    
    {/* Messages */}
    <div className="flex-1 overflow-y-auto">
      {/* ... messages ... */}
    </div>
    
    {/* Enhanced Input Area */}
    <div className="border-t border-white/10 p-4">
      <div className="flex items-center gap-2 mb-2">
        <MessageTemplates onSelect={setMessage} />
        <MessageSearch agentId={selectedAgentId} />
        <AttachmentButton />
      </div>
      <Textarea ... />
    </div>
  </div>
  
  {/* Right Sidebar - Context */}
  <div className="w-72 border-l border-white/10 hidden xl:block">
    <ConversationContext agentId={selectedAgentId} />
  </div>
</div>
```

### 2. Conversation Context Panel

```tsx
// components/chat/ConversationContext.tsx
const ConversationContext: React.FC<{ agentId: string }> = ({ agentId }) => {
  const { data: stats } = useAgentStats(agentId);
  const { data: recentContacts } = useRecentContacts(agentId);

  return (
    <div className="p-4 space-y-6">
      {/* Quick Stats */}
      <div>
        <h3 className="text-xs font-medium text-gray-500 uppercase mb-3">Today's Activity</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-2xl font-bold text-white">{stats?.messagestoday || 0}</p>
            <p className="text-xs text-gray-500">Messages</p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-2xl font-bold text-white">{stats?.meetingsToday || 0}</p>
            <p className="text-xs text-gray-500">Meetings</p>
          </div>
        </div>
      </div>

      {/* Recent Contacts */}
      <div>
        <h3 className="text-xs font-medium text-gray-500 uppercase mb-3">Recent Contacts</h3>
        <div className="space-y-2">
          {recentContacts?.slice(0, 5).map((contact) => (
            <div key={contact.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5">
              <Avatar className="w-8 h-8">
                <AvatarFallback>{contact.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{contact.name}</p>
                <p className="text-xs text-gray-500">{contact.phone_number}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-xs font-medium text-gray-500 uppercase mb-3">Quick Actions</h3>
        <div className="space-y-2">
          <Button variant="outline" className="w-full justify-start" size="sm">
            <UserPlus className="w-4 h-4 mr-2" />
            Add Contact
          </Button>
          <Button variant="outline" className="w-full justify-start" size="sm">
            <Calendar className="w-4 h-4 mr-2" />
            Schedule Meeting
          </Button>
          <Button variant="outline" className="w-full justify-start" size="sm">
            <FileText className="w-4 h-4 mr-2" />
            View Documents
          </Button>
        </div>
      </div>
    </div>
  );
};
```

---

## 📊 Implementation Priority

### Phase 1: Quick Wins (1-2 days)
1. ✅ Fix message alignment (user right, agent left)
2. Add message templates dropdown
3. Add slash command hints

### Phase 2: Contact Integration (3-5 days)
1. Create contacts API endpoints
2. Build ContactQuickPanel component
3. Implement "Send to Contact" feature
4. Add contact search

### Phase 3: Calendar Integration (3-5 days)
1. Create calendar API endpoints
2. Build CalendarWidget component
3. Implement QuickSchedule dialog
4. Add meeting reminders in chat

### Phase 4: Advanced Features (5-7 days)
1. Message search with full-text
2. Conversation context panel
3. Attachment support
4. Voice message support
5. Read receipts and typing indicators

---

## 🔧 Backend Requirements

### New API Endpoints Needed

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agents/:id/contacts` | GET | List contacts for agent |
| `/api/agents/:id/contacts` | POST | Create new contact |
| `/api/agents/:id/contacts/:contactId` | PUT | Update contact |
| `/api/agents/:id/contacts/:contactId/send` | POST | Send message to contact |
| `/api/agents/:id/messages/search` | GET | Search messages |
| `/api/calendar/events` | GET | Get upcoming events |
| `/api/calendar/quick-schedule` | POST | Quick schedule meeting |

### Database Indexes for Performance

```sql
-- Add indexes for efficient queries
CREATE INDEX idx_contacts_agent_id ON contacts(agent_id);
CREATE INDEX idx_contacts_last_contacted ON contacts(agent_id, last_contacted_at DESC);
CREATE INDEX idx_message_log_search ON message_log USING gin(to_tsvector('english', message_text));
CREATE INDEX idx_calendar_events_upcoming ON calendar_events(agent_id, start_time) WHERE start_time > NOW();
```

---

## 📝 Notes

- All components should follow the existing design system (dark theme, violet accents)
- Use React Query for data fetching and caching
- Implement optimistic updates for better UX
- Add loading states and error boundaries
- Consider mobile responsiveness for future

