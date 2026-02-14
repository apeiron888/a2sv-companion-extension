# A2SV Companion — System Design & Implementation Plan

> **Date:** February 14, 2026  
> **Version:** 2.0  
> **Status:** Ready for Implementation  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current System Analysis](#2-current-system-analysis)
3. [Problem Statement](#3-problem-statement)
4. [Proposed Architecture](#4-proposed-architecture)
5. [Google Sheets Structure](#5-google-sheets-structure)
6. [Backend Changes](#6-backend-changes)
7. [Extension Changes](#7-extension-changes)
8. [Admin Dashboard Redesign](#8-admin-dashboard-redesign)
9. [Data Flow Diagrams](#9-data-flow-diagrams)
10. [Implementation Phases](#10-implementation-phases)
11. [API Reference](#11-api-reference)
12. [Environment Variables](#12-environment-variables)
13. [Deployment Notes](#13-deployment-notes)

---

## 1. Executive Summary

The A2SV Companion system automates the workflow of tracking student problem-solving progress. Students solve problems on **LeetCode** or **Codeforces**, and a Chrome extension captures their code, pushes it to their **GitHub** repository, and updates their row in a **Google Sheets** progress tracker — all in one click.

**This plan upgrades the system to:**

- Write new questions to a **Master Tracker** sheet (with proper formatting & colors), which automatically propagates to all linked student group sheets.
- Support **multiple educational phases** (Onboarding, Phase 1, Phase 2, etc.) as separate tabs within a single spreadsheet.
- **Auto-detect the next available column** so admins never manually track column positions.
- Embed a **polished, native-looking widget** directly into LeetCode and Codeforces pages (no floating overlay).
- Redesign the admin dashboard with a modern, premium UI.

---

## 2. Current System Analysis

### 2.1 Repository Structure

```
A2SV/
├── a2sv-companion-backend/       # Node.js + Express + TypeScript API
│   ├── src/
│   │   ├── config/               # env.ts, db.ts, redis.ts, monitoring.ts
│   │   ├── middleware/           # admin.ts, auth.ts, error.ts, extension.ts
│   │   ├── models/              # MongoDB schemas (7 models)
│   │   ├── queue/               # BullMQ submission queue
│   │   ├── routes/              # admin, auth, extension, health, submissions, users
│   │   ├── services/            # github.ts, googleSheets.ts, submissionProcessor.ts,
│   │   │                        # crypto.ts, jwt.ts, refreshTokens.ts
│   │   ├── app.ts               # Express app factory
│   │   └── index.ts             # Server entry point
│   └── public/admin/            # Static admin dashboard (HTML/CSS/JS)
│
└── a2sv-companion-extension/     # Chrome Extension (Manifest V3)
    ├── manifest.json
    ├── background.js
    ├── content/
    │   ├── leetcode.js           # Content script for LeetCode problem pages
    │   ├── codeforces.js         # Content script for Codeforces submission pages
    │   ├── codeforces-problem.js # Content script for Codeforces problem pages
    │   └── styles.css            # Widget styling
    ├── register.html/.js/.css    # Registration page
    ├── popup.html/.js/.css       # Browser action popup
    ├── success.html/.js/.css     # OAuth success page
    └── error.html/.js/.css       # OAuth error page
```

### 2.2 Current Data Models (MongoDB)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `User` | Registered students | fullName, email, groupName, sheetRow, githubUsername, githubRepo, githubAccessTokenEnc, status |
| `GroupSheet` | Maps groups → Google Sheet | groupName, sheetId, nameColumn, nameStartRow, nameEndRow, active |
| `Question` | Problem metadata | platform (leetcode/codeforces), questionKey, title, url |
| `QuestionGroupMapping` | Maps question↔group to columns | questionId, groupId, trialColumn, timeColumn |
| `Submission` | Student solution records | userId, questionId, code, trialCount, timeMinutes, language, githubCommitUrl, status, sheetUpdated |
| `ExtensionInstall` | Extension registrations | installId, keyHash, extensionVersion |
| `OAuthExchange` | GitHub OAuth token exchange | tempTokenHash, tokenEnc, refreshTokenEnc, expiresAt |
| `RefreshToken` | JWT refresh tokens | userId, tokenHash, expiresAt |

### 2.3 Current Submission Flow

```
Student clicks "Submit to A2SV" on LeetCode/Codeforces
    │
    ▼
Extension sends POST /api/submissions/{platform}
    │  (question_url, question_key, title, code, language, trial_count, time_minutes)
    │
    ▼
Backend creates Submission (status: "pending") → Adds to BullMQ queue
    │
    ▼
Worker: processSubmission()
    ├── 1. Find User → decrypt GitHub token
    ├── 2. Find Question by questionKey + platform
    ├── 3. Find GroupSheet by user.groupName
    ├── 4. Find QuestionGroupMapping (questionId + groupId) → get trialColumn, timeColumn
    ├── 5. Push code to GitHub repo via GitHub API (upsertRepoFile)
    ├── 6. Update Google Sheet cell: trialColumn + user.sheetRow = HYPERLINK(commitUrl, trialCount)
    │                                timeColumn + user.sheetRow = timeMinutes
    └── 7. Mark Submission as "completed"
```

### 2.4 Current Limitations

1. **No Master Sheet integration** — Questions are only added to the DB; no row/column is auto-created in the Master Sheet.
2. **Manual column tracking** — Admin must manually figure out which column each question maps to and type it in (e.g., "H", "I").
3. **No phase/tab support** — Single flat structure; no concept of Onboarding, Phase 1, Phase 2 tabs.
4. **No sheet formatting** — No colors, no difficulty labels, no platform badges, no tags in the sheet header rows.
5. **Widget UX is basic** — Floating dark box at bottom-right; not embedded in the platform's native UI.
6. **Admin UI is minimal** — No visual feedback for Master Sheet sync, no phase management.

---

## 3. Problem Statement

### What needs to happen when an admin adds a question:

1. The question gets added to the **Master Tracker** sheet in the correct tab (phase).
2. The question occupies **two columns**: one for "Attempts" (trial count) and one for "Time (min)".
3. **Header rows 1–5** are populated with metadata:
   - **Row 1:** Difficulty (Easy/Medium/Hard) — with color coding (green/orange/red)
   - **Row 2:** Completion percentage (starts at 0%)
   - **Row 3:** Tags (Math, String, DP, etc.)
   - **Row 4:** Platform (HackerRank/LeetCode/Codeforces) — with color coding (green/orange/light-blue)
   - **Row 5:** Question title + "⏱ min" label
4. Because all student group sheets are **linked to the Master Sheet** (via `IMPORTRANGE` or sheet references), adding to the Master automatically propagates to all groups.
5. The system must **track the last-used column** per tab so it always appends in the right place.

---

## 4. Proposed Architecture

### 4.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CHROME EXTENSION                                │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │  LeetCode    │  │  Codeforces      │  │  Codeforces Problem      │  │
│  │  Content     │  │  Submission       │  │  Content Script          │  │
│  │  Script      │  │  Content Script   │  │                          │  │
│  │              │  │                   │  │                          │  │
│  │ [Embedded    │  │ [Embedded         │  │ [Embedded                │  │
│  │  A2SV Panel] │  │  A2SV Panel]      │  │  A2SV Panel]             │  │
│  └──────┬───────┘  └────────┬──────────┘  └───────────┬──────────────┘  │
│         │                   │                         │                │
│         └───────────────────┼─────────────────────────┘                │
│                             │                                          │
│                    POST /api/submissions/{platform}                     │
└─────────────────────────────┼──────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     BACKEND (Node.js / Express)                        │
│                                                                        │
│  ┌────────────┐   ┌────────────────┐   ┌──────────────────────────┐   │
│  │ Admin      │   │ Submissions    │   │ Auth                     │   │
│  │ Routes     │   │ Routes         │   │ Routes                   │   │
│  │            │   │                │   │                          │   │
│  │ - Phases   │   │ - POST leetcode│   │ - Register               │   │
│  │ - Questions│   │ - POST cf      │   │ - Login (GitHub OAuth)   │   │
│  │ - Groups   │   │ - GET history  │   │ - Token refresh          │   │
│  │ - Mappings │   │ - GET status   │   │                          │   │
│  └─────┬──────┘   └───────┬────────┘   └──────────────────────────┘   │
│        │                  │                                            │
│        ▼                  ▼                                            │
│  ┌──────────────────────────────────────┐                              │
│  │         Services Layer               │                              │
│  │                                      │                              │
│  │  ┌─────────────────────────────────┐ │                              │
│  │  │ masterSheetService.ts  [NEW]    │ │                              │
│  │  │ - addQuestionToMasterSheet()    │ │                              │
│  │  │ - getNextAvailableColumn()      │ │                              │
│  │  │ - formatHeaderRows()           │ │                              │
│  │  │ - applyConditionalFormatting() │ │                              │
│  │  └─────────────────────────────────┘ │                              │
│  │  ┌─────────────────────┐             │                              │
│  │  │ googleSheets.ts     │             │  ┌──────────────────────┐   │
│  │  │ (enhanced)          │             │  │   github.ts          │   │
│  │  │ - findUserRow()     │             │  │   - upsertRepoFile() │   │
│  │  │ - updateTrialAndTime│             │  └──────────────────────┘   │
│  │  │ - batchFormat()     │             │                              │
│  │  └─────────────────────┘             │                              │
│  └──────────────────────────────────────┘                              │
│        │                                                               │
│        ▼                                                               │
│  ┌──────────────┐   ┌──────────────────┐                              │
│  │  MongoDB     │   │  Redis + BullMQ  │                              │
│  │              │   │  (Job Queue)     │                              │
│  └──────────────┘   └──────────────────┘                              │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               GOOGLE SHEETS ECOSYSTEM                                  │
│                                                                        │
│  ┌────────────────────────────────────────────────────┐                │
│  │ MASTER TRACKER (single spreadsheet)                │                │
│  │                                                    │                │
│  │  Tab: "Onboarding"                                 │                │
│  │  Tab: "Phase 1"                                    │                │
│  │  Tab: "Phase 2"                                    │                │
│  │  Tab: "Phase 3"                                    │                │
│  │                                                    │                │
│  │  Each tab has:                                     │                │
│  │    Row 1: Difficulty        (color-coded)          │                │
│  │    Row 2: Completion %      (formula-driven)       │                │
│  │    Row 3: Tags              (topic tags)           │                │
│  │    Row 4: Platform          (color-coded)          │                │
│  │    Row 5: Question Title + Time label              │                │
│  │    Row 6+: (linked to student sheets)              │                │
│  └──────────────────┬─────────────────────────────────┘                │
│                     │ IMPORTRANGE / sheet reference                     │
│    ┌────────────────┼────────────────────────────────┐                 │
│    ▼                ▼                                ▼                 │
│  ┌──────────┐  ┌──────────┐                   ┌──────────┐           │
│  │ G7A      │  │ G7B      │       ...         │ G7C      │           │
│  │ Progress │  │ Progress │                   │ Progress │           │
│  │ Sheet    │  │ Sheet    │                   │ Sheet    │           │
│  └──────────┘  └──────────┘                   └──────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Google Sheets Structure

### 5.1 Master Sheet — Column Layout per Question

Each question occupies **2 columns** (e.g., H and I):

| Row | Column H (Question Column) | Column I (Time Column) |
|-----|---------------------------|----------------------|
| 1   | `Easy` *(bg: #00FF00)* | *(empty)* |
| 2   | `0%` | `0` |
| 3   | `Math` | *(empty)* |
| 4   | `LeetCode` *(bg: #FFA500)* | *(empty)* |
| 5   | `Arithmetic Operators` *(bg: #4A86C8)* | `⏱ min` *(bg: #B4C7DC)* |
| 6+  | *(student data from group sheets)* | *(student time data)* |

### 5.2 Color Scheme Reference

**Difficulty Colors (Row 1):**
| Difficulty | Background | Text |
|-----------|-----------|------|
| Easy | `#00FF00` (green) | Black |
| Medium | `#FFA500` (orange) | Black |
| Hard | `#FF0000` (red) | White |

**Platform Colors (Row 4):**
| Platform | Background | Text |
|----------|-----------|------|
| LeetCode | `#FFA500` (orange) | White |
| Codeforces | `#1E90FF` (dodger blue) | White |
| HackerRank | `#00C853` (green) | White |

**Question Title (Row 5):**
| Column Type | Background |
|------------|-----------|
| Question name | `#4A86C8` (steel blue) |
| Time label | `#B4C7DC` (light steel) |

### 5.3 Tab (Phase) Naming Convention

| Phase | Tab Name |
|-------|----------|
| Onboarding | `Onboarding` |
| Phase 1 | `Phase 1` |
| Phase 2 | `Phase 2` |
| Phase 3 | `Phase 3` |

---

## 6. Backend Changes

### 6.1 New Model: `Phase`

**File:** `src/models/Phase.ts`

```typescript
// Schema fields:
{
  name: String,           // "Onboarding", "Phase 1", etc.
  tabName: String,        // Exact Google Sheets tab name
  masterSheetId: String,  // Google Sheet ID of the master tracker
  lastQuestionColumn: String, // e.g., "P" — last column used for a question
  order: Number,          // Display order (0 = Onboarding, 1 = Phase 1, ...)
  active: Boolean         // Whether this phase is currently active
}
```

**Why `lastQuestionColumn`?** This is the efficient tracking mechanism. Instead of scanning the entire sheet each time, we store the last column letter used. When adding a new question, we calculate `lastQuestionColumn + 2` (since each question uses 2 columns). We also verify by reading the sheet header to ensure consistency.

### 6.2 Enhanced `Question` Model

**File:** `src/models/Question.ts` — Add fields:

```typescript
{
  // ... existing fields ...
  platform: String,       // "leetcode" | "codeforces" | "hackerrank"  ← add hackerrank
  difficulty: String,     // "Easy" | "Medium" | "Hard"
  tags: [String],         // ["Math", "String", "DP", ...]
  phaseId: ObjectId,      // Reference to Phase
  masterColumn: String,   // The column letter in master sheet (e.g., "H")
  timeColumn: String      // The time column letter (e.g., "I")
}
```

### 6.3 New Service: `masterSheetService.ts`

**File:** `src/services/masterSheetService.ts`

This is the core new service. Key functions:

#### `addQuestionToMasterSheet(params)`

```
Input:  { phaseId, title, platform, difficulty, tags, questionKey, url }
Output: { questionColumn: "H", timeColumn: "I" }

Steps:
  1. Load Phase from DB → get masterSheetId, tabName, lastQuestionColumn
  2. Calculate nextCol = columnToNumber(lastQuestionColumn) + 2
  3. Convert back to letter: newQuestionCol, newTimeCol
  4. VERIFY by reading row 5 of the sheet at newQuestionCol to ensure it's empty
     - If not empty, scan rightward to find first empty pair
  5. Write header data using batchUpdate:
     - Row 1 at newQuestionCol: difficulty text + background color
     - Row 2 at newQuestionCol: "0%"
     - Row 3 at newQuestionCol: tags joined by ", "
     - Row 4 at newQuestionCol: platform name + background color
     - Row 5 at newQuestionCol: question title (with link)
     - Row 5 at newTimeCol: "⏱ min"
  6. Apply formatting via spreadsheets.batchUpdate (not values.batchUpdate):
     - Background colors for difficulty, platform, question title, time label
     - Font: Nunito 11pt
     - Text alignment: center
     - Bold for row 1 and row 4
     - Column width: 120px for question col, 60px for time col
  7. Update Phase.lastQuestionColumn = newQuestionCol
  8. Return { questionColumn: newQuestionCol, timeColumn: newTimeCol }
```

#### `getNextAvailableColumn(phaseId)`

```
Input:  phaseId
Output: { nextQuestionCol: "R", nextTimeCol: "S" }

Steps:
  1. Load Phase → get lastQuestionColumn
  2. If lastQuestionColumn is null (first question), return the configured start column (e.g., "H")
  3. Otherwise: nextCol = letterToNumber(lastQuestionColumn) + 2
  4. Return as letter pair
```

#### Column Utility Functions

```typescript
function columnToNumber(col: string): number
  // "A" → 1, "Z" → 26, "AA" → 27, "AZ" → 52

function numberToColumn(num: number): string
  // 1 → "A", 27 → "AA", 52 → "AZ"
```

### 6.4 Enhanced `googleSheets.ts`

Add these new functions:

```typescript
// Write values + formatting to specific cells with colors
async function batchWriteWithFormatting(params: {
  sheetId: string;
  tabName: string;
  updates: Array<{
    range: string;
    values: string[][];
    backgroundColor?: { red: number; green: number; blue: number };
    textColor?: { red: number; green: number; blue: number };
    bold?: boolean;
    fontSize?: number;
    horizontalAlignment?: string;
  }>;
})

// Get the sheet's gid (tab ID) by tab name
async function getSheetGidByName(sheetId: string, tabName: string): Promise<number>

// Read a range to check if cells are empty
async function readRange(sheetId: string, range: string): Promise<string[][]>
```

### 6.5 Updated Admin Routes

**File:** `src/routes/admin.ts` — Add new endpoints:

```
POST   /api/admin/phases              — Create a new phase (tab)
GET    /api/admin/phases              — List all phases
PUT    /api/admin/phases/:id          — Update phase
DELETE /api/admin/phases/:id          — Delete phase

POST   /api/admin/questions/add-to-sheet  — Add question + write to Master Sheet
  Body: {
    phase_id: string,
    platform: "leetcode" | "codeforces" | "hackerrank",
    question_key: string,
    title: string,
    url: string,
    difficulty: "Easy" | "Medium" | "Hard",
    tags: string[]   // e.g., ["Math", "String"]
  }
  Response: {
    question_id: string,
    master_column: string,   // e.g., "H"
    time_column: string,     // e.g., "I"
    mappings_created: number // auto-created mappings for all active groups
  }
```

### 6.6 Auto-Mapping on Question Add

When `POST /api/admin/questions/add-to-sheet` is called:

1. Create the Question document in MongoDB
2. Call `addQuestionToMasterSheet()` → writes to Google Sheets
3. **Auto-create QuestionGroupMapping** for every active GroupSheet in the same phase
   - Since the Master Sheet propagates to all group sheets, the column positions are the same
   - For each active group: create mapping with `trialColumn = masterColumn`, `timeColumn = timeColumn`
4. Return the created question + all mappings

This eliminates the need for manual mapping creation.

### 6.7 Submission Processor Update

**File:** `src/services/submissionProcessor.ts`

Update the processor to handle the new Question model fields. The core flow remains the same, but the `masterColumn` and `timeColumn` are now stored directly on the Question for the master sheet, and the QuestionGroupMapping still handles per-group column overrides if needed.

---

## 7. Extension Changes

### 7.1 Embedded Widget Design (LeetCode)

Instead of a floating overlay widget, embed the A2SV panel **inline** within the LeetCode page layout.

**Injection target:** Insert into the right sidebar of the problem page, above or below the editorial section.

```
┌─────────────────────────────────────────────────────┐
│  LeetCode Problem Page                              │
│  ┌──────────────────────┐  ┌──────────────────────┐ │
│  │                      │  │ Description / Code   │ │
│  │                      │  │                      │ │
│  │   Problem Statement  │  │  [Monaco Editor]     │ │
│  │                      │  │                      │ │
│  │                      │  │                      │ │
│  │                      │  ├──────────────────────┤ │
│  │                      │  │ ┌──────────────────┐ │ │
│  │                      │  │ │  A2SV TRACKER    │ │ │
│  │                      │  │ │  ───────────────  │ │ │
│  │                      │  │ │  Trials: [1]     │ │ │
│  │                      │  │ │  Time:   [15]min │ │ │
│  │                      │  │ │                  │ │ │
│  │                      │  │ │  [✔ Auto-detect] │ │ │
│  │                      │  │ │                  │ │ │
│  │                      │  │ │  [Submit to A2SV]│ │ │
│  │                      │  │ │  ✓ Pushed to GH  │ │ │
│  │                      │  │ │  ✓ Sheet updated │ │ │
│  │                      │  │ └──────────────────┘ │ │
│  │                      │  │                      │ │
│  └──────────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Key UX improvements:**
- **Auto-extract code** from Monaco editor (already implemented, keep it)
- **Auto-detect language** from the editor (already implemented)
- **Auto-detect acceptance** status (already implemented)
- **Show step-by-step progress**: "Submitting → Pushing to GitHub → Updating Sheet → Done ✓"
- **Collapsed by default** — small A2SV icon that expands on click
- **Theme-aware** — detect LeetCode's dark/light mode and match

### 7.2 Embedded Widget Design (Codeforces)

Insert the widget into the Codeforces page near the submission verdict area:

```
┌─────────────────────────────────────────┐
│  Codeforces Submission Page             │
│                                         │
│  Verdict: Accepted ✓                    │
│  Time: 46 ms | Memory: 3800 KB         │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │  A2SV TRACKER                      ││
│  │  Trials: [2]    Time: [20] min     ││
│  │  [Submit to A2SV]                  ││
│  │  Status: ✓ Completed               ││
│  └─────────────────────────────────────┘│
│                                         │
│  Source Code:                           │
│  ┌─────────────────────────────────────┐│
│  │ #include <bits/stdc++.h>           ││
│  │ ...                                 ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

### 7.3 Content Script Refactor

Create a shared utility module to eliminate code duplication across content scripts:

**New file: `content/shared.js`**
- Common API call functions (with token refresh)
- Extension key management
- Widget creation and status management
- Theme detection utility

**Updated files:**
- `content/leetcode.js` — Use shared utilities, implement embedded injection
- `content/codeforces.js` — Use shared utilities, implement embedded injection
- `content/codeforces-problem.js` — Use shared utilities, implement embedded injection

### 7.4 Updated `manifest.json`

```json
{
  "host_permissions": [
    "https://leetcode.com/*",
    "https://codeforces.com/*",
    "https://www.hackerrank.com/*",        // NEW
    "https://a2sv-companion-backend.onrender.com/*"
  ],
  "content_scripts": [
    // ... existing entries ...
    {
      "matches": ["https://www.hackerrank.com/challenges/*/problem"],
      "js": ["content/hackerrank.js"],      // NEW
      "css": ["content/styles.css"]
    }
  ]
}
```

### 7.5 New: HackerRank Support

**New file: `content/hackerrank.js`**

- Extract code from HackerRank's CodeMirror/Monaco editor
- Parse question key from URL path: `/challenges/{question-key}/problem`
- Detect "Congratulations" / test pass status
- Same submission flow as LeetCode/Codeforces

---

## 8. Admin Dashboard Redesign

### 8.1 New Layout — Tab-Based Navigation

```
┌─────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  🎓 A2SV COMPANION ADMIN                        [Settings]  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌───────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │Phases │ │Questions │ │ Groups   │ │Mappings  │ │Analytics │   │
│  └───────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                                     │
│  ═══════════════════════════════════════════════════════════════     │
│                                                                     │
│  PHASES TAB:                                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  + Create New Phase                                          │   │
│  │  ┌────────────────────────────────────────────────────────┐  │   │
│  │  │ Phase Name: [________________]                         │  │   │
│  │  │ Tab Name:   [________________]                         │  │   │
│  │  │ Master Sheet ID: [________________________________]    │  │   │
│  │  │ Start Column: [H]  (first question column)             │  │   │
│  │  │                                      [Create Phase]    │  │   │
│  │  └────────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  │  Active Phases:                                              │   │
│  │  ┌──────────┬────────────┬──────────┬──────────┬──────────┐ │   │
│  │  │ Name     │ Tab Name   │ Last Col │ Questions│ Status   │ │   │
│  │  ├──────────┼────────────┼──────────┼──────────┼──────────┤ │   │
│  │  │Onboarding│ Onboarding │ P        │ 5        │ ● Active │ │   │
│  │  │Phase 1   │ Phase 1    │ —        │ 0        │ ○ Pending│ │   │
│  │  └──────────┴────────────┴──────────┴──────────┴──────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  QUESTIONS TAB (per selected phase):                                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Phase: [Onboarding ▼]                                       │   │
│  │                                                              │   │
│  │  + Add Question to Master Sheet                              │   │
│  │  ┌────────────────────────────────────────────────────────┐  │   │
│  │  │ Platform:   [LeetCode ▼]                               │  │   │
│  │  │ Title:      [Two Sum_____________________]             │  │   │
│  │  │ Key:        [two-sum_____________________]             │  │   │
│  │  │ URL:        [https://leetcode.com/problems/two-sum]    │  │   │
│  │  │ Difficulty: [Easy ▼]                                   │  │   │
│  │  │ Tags:       [Array] [Hash Table] [+ Add Tag]           │  │   │
│  │  │                                                        │  │   │
│  │  │ Preview:                                               │  │   │
│  │  │ ┌───────────────────┬──────────┐                       │  │   │
│  │  │ │ Easy      (green) │          │                       │  │   │
│  │  │ │ 0%                │ 0        │                       │  │   │
│  │  │ │ Array, Hash Table │          │                       │  │   │
│  │  │ │ LeetCode (orange) │          │                       │  │   │
│  │  │ │ Two Sum   (blue)  │ ⏱ min    │                       │  │   │
│  │  │ └───────────────────┴──────────┘                       │  │   │
│  │  │                                                        │  │   │
│  │  │       Next column: R (auto-detected)                   │  │   │
│  │  │                       [Add to Master Sheet & DB]       │  │   │
│  │  └────────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  │  Questions in this Phase:                                    │   │
│  │  ┌────────┬────────────────────┬──────┬──────┬────────────┐ │   │
│  │  │Platform│ Title              │ Diff │ Col  │ Status     │ │   │
│  │  ├────────┼────────────────────┼──────┼──────┼────────────┤ │   │
│  │  │LC      │ Arithmetic Ops     │ Easy │ H    │ ✓ Synced   │ │   │
│  │  │LC      │ Division           │ Easy │ J    │ ✓ Synced   │ │   │
│  │  │CF      │ Convert the Temper │ Easy │ L    │ ✓ Synced   │ │   │
│  │  │LC      │ Palindrome Number  │ Easy │ N    │ ✓ Synced   │ │   │
│  │  │HR      │ sWAP cASE          │ Easy │ P    │ ✓ Synced   │ │   │
│  │  └────────┴────────────────────┴──────┴──────┴────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 Design System

- **Font:** Inter (via Google Fonts)
- **Background:** `#0b1120` (deep navy)
- **Cards:** `#0f172a` with `#1e293b` border, `border-radius: 14px`
- **Primary accent:** `#22c55e` (green) for CTAs
- **Secondary accent:** `#3b82f6` (blue) for info
- **Text:** `#e2e8f0` (primary), `#94a3b8` (muted)
- **Success toasts:** slide-in from top-right, auto-dismiss after 3s
- **Loading states:** skeleton loaders for tables
- **Animations:** fade-in on tab switch, slide-up on card mount

---

## 9. Data Flow Diagrams

### 9.1 Admin Adds a Question (New Flow)

```
Admin fills form on Admin Dashboard
    │
    ▼
POST /api/admin/questions/add-to-sheet
    │
    ├──→ 1. Validate input (zod schema)
    │
    ├──→ 2. Load Phase from DB
    │       - Get masterSheetId, tabName, lastQuestionColumn
    │
    ├──→ 3. Calculate next column pair
    │       - lastQuestionColumn = "P" → next = "R", "S"
    │       - Verify by reading sheet row 5 at column R (should be empty)
    │
    ├──→ 4. Write to Master Sheet (Google Sheets API)
    │       - batchUpdate values: difficulty, completion, tags, platform, title
    │       - batchUpdate formatting: colors, fonts, alignment, column widths
    │
    ├──→ 5. Create Question in MongoDB
    │       - Store masterColumn = "R", timeColumn = "S"
    │
    ├──→ 6. Update Phase.lastQuestionColumn = "R"
    │
    ├──→ 7. Auto-create QuestionGroupMapping for all active groups
    │       - For each GroupSheet with matching phase:
    │         create mapping { questionId, groupId, trialColumn: "R", timeColumn: "S" }
    │
    └──→ 8. Return success + question details + column info
```

### 9.2 Student Submits Solution (Enhanced Flow)

```
Student on LeetCode sees embedded A2SV panel
    │
    ├── Panel auto-detects: question accepted ✓, code extracted, language detected
    │
    ▼
Student enters trials=2, time=15min, clicks "Submit to A2SV"
    │
    ▼
POST /api/submissions/leetcode
    │  { question_key, code, language, trial_count: 2, time_minutes: 15 }
    │
    ├──→ Find Question by platform+questionKey
    │     - If NOT found → 404 "Question not registered by admin"
    │
    ├──→ Create Submission (status: "pending") → BullMQ
    │
    ▼
Worker: processSubmission()
    │
    ├──→ 1. Push code to GitHub
    │       path: "leetcode/two-sum.py"
    │       message: "Add solution for two-sum"
    │       → Returns commitUrl
    │
    ├──→ 2. Find user's GroupSheet
    ├──→ 3. Find QuestionGroupMapping → trialColumn, timeColumn
    │
    ├──→ 4. Update student's Google Sheet row
    │       cell R{row} = HYPERLINK(commitUrl, "2")
    │       cell S{row} = 15
    │
    └──→ 5. Mark submission "completed"
    
    Extension polls GET /api/submissions/:id/status
    → Shows "✓ Pushed to GitHub" + "✓ Sheet updated"
```

---

## 10. Implementation Phases

### Phase A: Backend Foundation (Priority: HIGH)

| # | Task | Files | Estimated Effort |
|---|------|-------|-----------------|
| A1 | Create `Phase` model | `src/models/Phase.ts` | 30 min |
| A2 | Add `difficulty`, `tags`, `phaseId`, `masterColumn`, `timeColumn` to Question model | `src/models/Question.ts` | 30 min |
| A3 | Add column utility functions (letterToNumber, numberToColumn) | `src/services/columnUtils.ts` | 30 min |
| A4 | Create `masterSheetService.ts` with `addQuestionToMasterSheet()` | `src/services/masterSheetService.ts` | 2 hours |
| A5 | Enhance `googleSheets.ts` with `batchWriteWithFormatting()`, `readRange()`, `getSheetGidByName()` | `src/services/googleSheets.ts` | 1.5 hours |
| A6 | Add Phase CRUD routes | `src/routes/admin.ts` | 1 hour |
| A7 | Add `POST /api/admin/questions/add-to-sheet` endpoint | `src/routes/admin.ts` | 1.5 hours |
| A8 | Update Question schema validation (add hackerrank platform, difficulty, tags) | `src/routes/admin.ts` | 30 min |
| A9 | Add `MASTER_SHEET_ID` to env config | `src/config/env.ts` | 10 min |

### Phase B: Admin Dashboard Redesign (Priority: HIGH)

| # | Task | Files |
|---|------|-------|
| B1 | Redesign admin HTML with tab navigation | `public/admin/index.html` |
| B2 | Implement premium CSS design system | `public/admin/styles.css` |
| B3 | Add Phases tab with CRUD | `public/admin/admin.js` |
| B4 | Add Questions tab with Master Sheet preview | `public/admin/admin.js` |
| B5 | Add tag input component (chip-style) | `public/admin/admin.js` |
| B6 | Add loading skeletons and toast notifications | `public/admin/admin.js` |
| B7 | Add question column preview display | `public/admin/admin.js` |

### Phase C: Extension UX Overhaul (Priority: MEDIUM)

| # | Task | Files |
|---|------|-------|
| C1 | Create `content/shared.js` with common utilities | `content/shared.js` |
| C2 | Refactor `leetcode.js` — embed widget in page, theme-aware | `content/leetcode.js` |
| C3 | Refactor `codeforces.js` — embed widget in page | `content/codeforces.js` |
| C4 | Refactor `codeforces-problem.js` — embed widget | `content/codeforces-problem.js` |
| C5 | Create `content/hackerrank.js` | `content/hackerrank.js` |
| C6 | Update `styles.css` for embedded, theme-aware design | `content/styles.css` |
| C7 | Update `manifest.json` with HackerRank permissions | `manifest.json` |
| C8 | Add multi-step progress indicator to widget | `content/shared.js` |

### Phase D: Testing & Deployment (Priority: HIGH)

| # | Task |
|---|------|
| D1 | Test Master Sheet write with real Google Sheet |
| D2 | Test column auto-detection and formatting |
| D3 | Test auto-mapping creation for multiple groups |
| D4 | Test full submission flow (extension → backend → GitHub → Sheet) |
| D5 | Test HackerRank content script |
| D6 | Re-enable admin API key authentication |
| D7 | Deploy backend to Render |
| D8 | Package and submit extension |

---

## 11. API Reference

### 11.1 Phase Endpoints

```
POST /api/admin/phases
  Headers: x-admin-key
  Body: {
    "name": "Onboarding",
    "tab_name": "Onboarding",
    "master_sheet_id": "1ABC...xyz",
    "start_column": "H",
    "order": 0
  }
  Response: { "id": "..." }

GET /api/admin/phases
  Response: { "phases": [...] }

PUT /api/admin/phases/:id
  Body: { "active": false }

DELETE /api/admin/phases/:id
```

### 11.2 Question + Master Sheet Endpoint

```
POST /api/admin/questions/add-to-sheet
  Headers: x-admin-key
  Body: {
    "phase_id": "65a1b2c3...",
    "platform": "leetcode",
    "question_key": "two-sum",
    "title": "Two Sum",
    "url": "https://leetcode.com/problems/two-sum",
    "difficulty": "Easy",
    "tags": ["Array", "Hash Table"]
  }
  Response: {
    "question_id": "65a1b2c4...",
    "master_column": "R",
    "time_column": "S",
    "mappings_created": 3,
    "sheet_updated": true
  }
```

### 11.3 Existing Endpoints (Unchanged)

```
POST /api/submissions/leetcode     — Submit LeetCode solution
POST /api/submissions/codeforces   — Submit Codeforces solution
POST /api/submissions/hackerrank   — Submit HackerRank solution (NEW)
GET  /api/submissions/history      — Get submission history
GET  /api/submissions/:id/status   — Poll submission status
POST /api/auth/register            — Register student
POST /api/auth/login/start         — Start login flow
GET  /api/auth/github/oauth        — GitHub OAuth redirect
GET  /api/auth/github/callback     — GitHub OAuth callback
POST /api/auth/exchange            — Exchange temp token for JWT
POST /api/auth/refresh             — Refresh JWT
POST /api/auth/logout              — Logout
```

---

## 12. Environment Variables

### Existing (No Change)
```
PORT=4000
NODE_ENV=production
MONGODB_URI=mongodb+srv://...
JWT_SECRET=...
JWT_EXPIRES_IN=15m
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=...
GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=...
REDIS_URL=redis://...
ADMIN_API_KEY=...
ENCRYPTION_KEY=...
REFRESH_TOKEN_TTL_DAYS=30
SENTRY_DSN=...
CORS_ORIGINS=...
```

### New
```
MASTER_SHEET_ID=...       # Default master sheet ID (can be overridden per-phase)
```

---

## 13. Deployment Notes

### 13.1 Google Sheets Service Account Setup

The existing service account (referenced by `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`) must have:
- **Editor** access to the Master Tracker spreadsheet
- The service account email must be shared as an editor on the Master Sheet

### 13.2 Migration Steps

1. Deploy backend with new models (Phase, updated Question)
2. Create initial Phase via admin API: `POST /api/admin/phases` for "Onboarding"
3. Re-add existing questions via `POST /api/admin/questions/add-to-sheet` to populate the Master Sheet
4. Verify auto-mapping creation
5. Test with a student submission
6. Update extension and re-publish to Chrome Web Store

### 13.3 Rollback Strategy

- All new features are additive (new models, new routes, new service)
- Existing submission flow continues to work via existing Question + QuestionGroupMapping
- Phase-based flow is opt-in: only triggered by the new `add-to-sheet` endpoint
- Can disable by reverting admin dashboard to old version

---

## Summary of Deliverables

| # | Deliverable | Type |
|---|-------------|------|
| 1 | `Phase` model | New file |
| 2 | Updated `Question` model | Modified |
| 3 | `columnUtils.ts` | New file |
| 4 | `masterSheetService.ts` | New file |
| 5 | Enhanced `googleSheets.ts` | Modified |
| 6 | Phase CRUD + add-to-sheet route | Modified `admin.ts` |
| 7 | HackerRank submission route | Modified `submissions.ts` |
| 8 | Redesigned admin dashboard (HTML/CSS/JS) | Modified (3 files) |
| 9 | `content/shared.js` | New file |
| 10 | Embedded LeetCode widget | Modified `leetcode.js` |
| 11 | Embedded Codeforces widget | Modified `codeforces.js` + `codeforces-problem.js` |
| 12 | HackerRank content script | New file |
| 13 | Updated `manifest.json` | Modified |
| 14 | Updated `styles.css` | Modified |
| 15 | Updated `env.ts` | Modified |
