# 🎨 Ultimate Design Unification Prompt for Cursor

## 🎯 Primary Mission
Create a fully unified, cohesive design system across ALL pages (Landing Page, Dashboard, Email IMAP/SMTP, Calendar, Create Agent, System Monitoring) with a modern WhatsApp-inspired green and white aesthetic, ensuring visual consistency, exceptional UX, and seamless user experience throughout the entire application.

---

## 🎨 Master Color Palette - WhatsApp Professional Edition

### Global Color System (Apply to ALL pages)

```css
/* ========================================
   PRIMARY COLORS - WhatsApp Inspired
   ======================================== */
--whatsapp-green-primary: #25D366;      /* Primary actions, CTAs, active states */
--whatsapp-green-dark: #128C7E;         /* Sidebar, navigation, headers */
--whatsapp-green-light: #DCF8C6;        /* Hover states, highlights, sent messages */
--whatsapp-teal: #075E54;               /* Deep accent, footer, badges */
--whatsapp-mint: #E7F9F0;               /* Subtle backgrounds, hover effects */

/* ========================================
   SECONDARY COLORS
   ======================================== */
--white: #FFFFFF;                        /* Cards, modals, primary backgrounds */
--off-white: #F7F8FA;                   /* Page backgrounds, subtle sections */
--light-gray: #F0F2F5;                  /* Dividers, borders, inactive states */
--chat-bg: #ECE5DD;                     /* Chat/message background (beige) */

/* ========================================
   TEXT COLORS
   ======================================== */
--text-primary: #1F1F1F;                /* Main headings, important text */
--text-secondary: #667781;              /* Body text, descriptions */
--text-muted: #8696A0;                  /* Timestamps, metadata, placeholders */
--text-white: #FFFFFF;                  /* Text on dark backgrounds */

/* ========================================
   SEMANTIC COLORS
   ======================================== */
--success: #25D366;                     /* Success messages, confirmations */
--warning: #F59E0B;                     /* Warnings, cautions */
--error: #EF4444;                       /* Errors, destructive actions */
--info: #3B82F6;                        /* Informational messages */

/* ========================================
   INTERACTIVE STATES
   ======================================== */
--hover-bg: #F0F2F5;                    /* Hover background for lists */
--active-bg: #E7F9F0;                   /* Active/selected items */
--focus-ring: rgba(37, 211, 102, 0.3);  /* Focus indicators */
--disabled: #D1D5DB;                    /* Disabled states */

/* ========================================
   BORDERS & DIVIDERS
   ======================================== */
--border-light: #E9EDEF;                /* Light borders */
--border-medium: #D1D7DB;               /* Medium borders */
--border-dark: #8696A0;                 /* Dark borders */
--divider: rgba(0, 0, 0, 0.08);         /* Section dividers */

/* ========================================
   SHADOWS
   ======================================== */
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.12);
--shadow-xl: 0 12px 24px rgba(0, 0, 0, 0.15);
--shadow-green: 0 4px 12px rgba(37, 211, 102, 0.25);

/* ========================================
   GRADIENTS
   ======================================== */
--gradient-green: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
--gradient-green-light: linear-gradient(135deg, #E7F9F0 0%, #DCF8C6 100%);
--gradient-overlay: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.05) 100%);
```

---

## 🏗️ Unified Layout Architecture

### Master Layout Structure

```css
/* Container Widths */
--container-max: 1440px;
--content-max: 1200px;
--sidebar-width: 280px;
--sidebar-collapsed: 72px;

/* Spacing Scale (8px base unit) */
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-3: 0.75rem;  /* 12px */
--space-4: 1rem;     /* 16px */
--space-5: 1.25rem;  /* 20px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
--space-10: 2.5rem;  /* 40px */
--space-12: 3rem;    /* 48px */
--space-16: 4rem;    /* 64px */
--space-20: 5rem;    /* 80px */

/* Border Radius Scale */
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 16px;
--radius-2xl: 20px;
--radius-full: 9999px;

/* Typography Scale */
--font-xs: 0.75rem;    /* 12px */
--font-sm: 0.875rem;   /* 14px */
--font-base: 1rem;     /* 16px */
--font-lg: 1.125rem;   /* 18px */
--font-xl: 1.25rem;    /* 20px */
--font-2xl: 1.5rem;    /* 24px */
--font-3xl: 1.875rem;  /* 30px */
--font-4xl: 2.25rem;   /* 36px */
--font-5xl: 3rem;      /* 48px */

/* Font Weights */
--font-regular: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

---

## 📐 Page-by-Page Unified Design Specifications

### 1️⃣ LANDING PAGE - Complete Redesign

**Current Issue:** Uses dark theme (black background) with glassmorphism
**Target:** Clean white background with WhatsApp green accents

```css
/* Landing Page Structure */
.landing-page {
  background: var(--off-white);
  min-height: 100vh;
}

/* Navigation Bar */
.landing-nav {
  background: var(--white);
  border-bottom: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
  position: sticky;
  top: 0;
  z-index: 1000;
}

.nav-logo {
  color: var(--whatsapp-green-dark);
  font-weight: var(--font-bold);
}

.nav-button-primary {
  background: var(--gradient-green);
  color: var(--text-white);
  box-shadow: var(--shadow-green);
}

/* Hero Section */
.hero-section {
  background: linear-gradient(135deg, var(--white) 0%, var(--off-white) 100%);
  padding: var(--space-20) var(--space-4);
}

.hero-title {
  color: var(--text-primary);
  font-size: var(--font-5xl);
  font-weight: var(--font-bold);
}

.hero-title-accent {
  background: var(--gradient-green);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-description {
  color: var(--text-secondary);
  font-size: var(--font-xl);
}

/* Feature Cards */
.feature-card {
  background: var(--white);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  transition: all 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-8px);
  box-shadow: var(--shadow-lg);
  border-color: var(--whatsapp-green-primary);
}

.feature-icon {
  width: 48px;
  height: 48px;
  background: var(--whatsapp-mint);
  color: var(--whatsapp-green-primary);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* CTA Section */
.cta-section {
  background: var(--gradient-green);
  color: var(--text-white);
  border-radius: var(--radius-2xl);
  padding: var(--space-16);
  box-shadow: var(--shadow-xl);
}
```

### 2️⃣ DASHBOARD PAGE - Enhanced Design

**Current Status:** Partially updated with green theme
**Enhancements Needed:**
- Improve stats card visual hierarchy
- Better agent card layout
- Enhanced search bar design
- Smoother animations

```css
/* Dashboard Stats Cards */
.dashboard-stat-card {
  background: var(--gradient-green);
  color: var(--text-white);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  box-shadow: var(--shadow-green);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.dashboard-stat-card:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: 0 12px 24px rgba(37, 211, 102, 0.35);
}

.stat-icon-wrapper {
  background: rgba(255, 255, 255, 0.2);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  animation: float 3s ease-in-out infinite;
}

/* Agent Cards */
.agent-card-enhanced {
  background: var(--white);
  border: 2px solid var(--border-light);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.agent-card-enhanced:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: var(--shadow-xl);
  border-color: var(--whatsapp-green-primary);
}

.agent-avatar {
  width: 56px;
  height: 56px;
  background: var(--gradient-green);
  color: var(--text-white);
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-bold);
  font-size: var(--font-xl);
  box-shadow: var(--shadow-md);
}
```

### 3️⃣ EMAIL IMAP/SMTP INBOX - Complete Redesign

**Current Issue:** Different design from Dashboard, inconsistent colors
**Target:** Match Dashboard design with unified sidebar and email list

```css
/* Email Page Layout */
.email-page-layout {
  display: flex;
  min-height: 100vh;
  background: var(--off-white);
}

/* Email Sidebar (Folders) */
.email-sidebar {
  width: 280px;
  background: var(--white);
  border-right: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
}

.email-account-header {
  padding: var(--space-6);
  border-bottom: 1px solid var(--border-light);
  background: var(--whatsapp-green-dark);
  color: var(--text-white);
}

.account-avatar {
  width: 48px;
  height: 48px;
  background: var(--white);
  color: var(--whatsapp-green-dark);
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-bold);
  font-size: var(--font-lg);
}

.compose-button {
  margin: var(--space-4);
  padding: var(--space-4);
  background: var(--gradient-green);
  color: var(--text-white);
  border: none;
  border-radius: var(--radius-lg);
  font-weight: var(--font-semibold);
  box-shadow: var(--shadow-green);
  transition: all 0.2s ease;
}

.compose-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(37, 211, 102, 0.35);
}

/* Folder List */
.folder-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4);
}

.folder-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.folder-item:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.folder-item.active {
  background: var(--whatsapp-mint);
  color: var(--whatsapp-green-dark);
  font-weight: var(--font-semibold);
}

.folder-count {
  padding: var(--space-1) var(--space-2);
  background: var(--whatsapp-green-primary);
  color: var(--text-white);
  font-size: var(--font-xs);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  min-width: 24px;
  text-align: center;
}

/* Email List Area */
.email-list-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--white);
}

.email-list-header {
  padding: var(--space-6);
  border-bottom: 1px solid var(--border-light);
  background: var(--white);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.email-search {
  flex: 1;
  max-width: 500px;
  padding: var(--space-3) var(--space-4);
  border: 2px solid var(--border-light);
  border-radius: var(--radius-lg);
  font-size: var(--font-base);
  transition: all 0.2s ease;
}

.email-search:focus {
  outline: none;
  border-color: var(--whatsapp-green-primary);
  box-shadow: 0 0 0 4px var(--focus-ring);
}

/* Email List Items */
.email-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4);
}

.email-item {
  background: var(--white);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  margin-bottom: var(--space-3);
  cursor: pointer;
  transition: all 0.2s ease;
}

.email-item:hover {
  background: var(--hover-bg);
  border-color: var(--whatsapp-green-primary);
  transform: translateX(4px);
  box-shadow: var(--shadow-sm);
}

.email-item.unread {
  background: var(--whatsapp-mint);
  border-left: 4px solid var(--whatsapp-green-primary);
  font-weight: var(--font-semibold);
}

.email-sender-avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  background: var(--gradient-green);
  color: var(--text-white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-bold);
  font-size: var(--font-sm);
}

.email-preview {
  flex: 1;
  margin-left: var(--space-4);
}

.email-sender {
  font-size: var(--font-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-1);
}

.email-subject {
  font-size: var(--font-sm);
  color: var(--text-primary);
  margin-bottom: var(--space-1);
}

.email-preview-text {
  font-size: var(--font-xs);
  color: var(--text-secondary);
  line-height: var(--leading-normal);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.email-time {
  font-size: var(--font-xs);
  color: var(--text-muted);
  white-space: nowrap;
}

/* Email Detail View */
.email-detail {
  width: 600px;
  background: var(--white);
  border-left: 1px solid var(--border-light);
  padding: var(--space-6);
  overflow-y: auto;
}

.email-detail-header {
  border-bottom: 1px solid var(--border-light);
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-6);
}

.email-detail-subject {
  font-size: var(--font-2xl);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin-bottom: var(--space-4);
}

.email-detail-meta {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.email-detail-body {
  color: var(--text-primary);
  line-height: var(--leading-relaxed);
  font-size: var(--font-base);
}
```

### 4️⃣ CALENDAR PAGE - Unified Design

```css
/* Calendar Container */
.calendar-page {
  background: var(--off-white);
  padding: var(--space-8);
}

.calendar-header {
  background: var(--white);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  margin-bottom: var(--space-6);
  box-shadow: var(--shadow-sm);
}

.calendar-grid {
  background: var(--white);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
}

.calendar-day {
  border-radius: var(--radius-md);
  padding: var(--space-3);
  transition: all 0.2s ease;
}

.calendar-day:hover {
  background: var(--hover-bg);
}

.calendar-day.today {
  background: var(--whatsapp-mint);
  border: 2px solid var(--whatsapp-green-primary);
  font-weight: var(--font-semibold);
}

.calendar-day.selected {
  background: var(--gradient-green);
  color: var(--text-white);
}

.meeting-indicator {
  width: 6px;
  height: 6px;
  background: var(--whatsapp-green-primary);
  border-radius: var(--radius-full);
  animation: pulse 2s infinite;
}
```

### 5️⃣ CREATE AGENT PAGE - Unified Design

```css
/* Form Sections */
.create-agent-section {
  background: var(--white);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  margin-bottom: var(--space-6);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
}

.section-title {
  font-size: var(--font-xl);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 2px solid var(--whatsapp-green-primary);
}

.form-input {
  border: 2px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  transition: all 0.2s ease;
}

.form-input:focus {
  border-color: var(--whatsapp-green-primary);
  box-shadow: 0 0 0 4px var(--focus-ring);
  outline: none;
}

.progress-indicator {
  background: var(--whatsapp-green-primary);
  height: 4px;
  border-radius: var(--radius-full);
  transition: width 0.3s ease;
}
```

### 6️⃣ SYSTEM MONITORING PAGE - Unified Design

```css
/* Monitoring Dashboard */
.monitoring-page {
  background: var(--off-white);
  padding: var(--space-8);
}

.metric-card {
  background: var(--white);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
  transition: all 0.3s ease;
}

.metric-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
  border-color: var(--whatsapp-green-primary);
}

.metric-value {
  font-size: var(--font-4xl);
  font-weight: var(--font-bold);
  color: var(--whatsapp-green-primary);
}

.chart-container {
  background: var(--white);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
}
```

---

## 🎬 Animation System

### Unified Animation Library

```css
/* Fade Animations */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeInDown {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Slide Animations */
@keyframes slideInLeft {
  from {
    opacity: 0;
    transform: translateX(-30px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(30px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* Scale Animations */
@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Pulse Animation */
@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.05);
  }
}

/* Float Animation */
@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

/* Count Up Animation */
@keyframes countUp {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

---

## 📱 Responsive Design Strategy

### Breakpoints

```css
/* Mobile First Approach */
@media (max-width: 639px) {
  /* Stack everything vertically */
  /* Larger touch targets (min 44px) */
  /* Full-width cards */
  /* Simplified navigation */
}

@media (min-width: 640px) and (max-width: 1023px) {
  /* 2-column grid for cards */
  /* Sidebar navigation */
  /* Moderate spacing */
}

@media (min-width: 1024px) {
  /* 3-column grid for cards */
  /* Full sidebar always visible */
  /* Generous spacing */
  /* Hover effects enabled */
}
```

---

## ✅ Implementation Checklist

### Phase 1: Foundation
- [x] Update global CSS variables with WhatsApp color palette
- [x] Update Tailwind config
- [x] Add animation keyframes library
- [x] Update core components (Button, Card, Input)

### Phase 2: Layout Components
- [x] Update AppLayout
- [x] Update AppSidebar with green theme
- [x] Update NavButton

### Phase 3: Pages
- [x] Dashboard page redesign
- [ ] Landing Page redesign (white background, green accents)
- [ ] Email IMAP/SMTP Inbox redesign
- [ ] Calendar page redesign
- [ ] Create Agent page redesign
- [ ] System Monitoring page redesign

### Phase 4: Polish
- [ ] Add micro-interactions
- [ ] Optimize animations for performance
- [ ] Test on all devices
- [ ] Accessibility audit

---

## 🎯 Success Criteria

After implementation:
- ✅ 100% visual consistency across all pages
- ✅ All animations run at 60fps
- ✅ WCAG AA compliance (minimum 4.5:1 contrast)
- ✅ Perfect rendering on mobile, tablet, desktop
- ✅ Smooth micro-interactions on every action
- ✅ WhatsApp-inspired, clean, friendly aesthetic

---

## 📝 Key Design Principles

1. **Consistency First:** Use the same color palette, spacing, and components everywhere
2. **Subtle Animations:** Enhance UX without distracting
3. **Mobile First:** Design for small screens, enhance for large
4. **Accessibility:** Always check contrast and focus states
5. **Performance:** Optimize animations, use CSS over JS when possible
6. **User Delight:** Every interaction should feel smooth and natural

---

## 🚀 Next Steps

1. Update Landing Page to white/green theme
2. Redesign Email Inbox to match Dashboard
3. Update remaining pages (Calendar, Create Agent, Monitoring)
4. Add consistent animations throughout
5. Test and optimize
