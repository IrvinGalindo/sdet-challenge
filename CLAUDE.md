# CLAUDE.md — AI Interview Platform (SDET Challenge)

This file gives an AI assistant (Claude, Gemini, etc.) the full context needed to work
in this codebase without asking repetitive questions.

---

## 1. What This App Is

A **full-stack AI-assisted interview management platform** built with React + Firebase.
It lets interviewers manage job positions, schedule live interviews, run real-time
transcription/Q&A sessions with candidates, and generate AI-powered evaluation reports.

It also contains a legacy **SDET self-serve challenge** (REST Assured, SQL, Bug Finder)
reachable at `/challenge`, but the primary product is the live interview platform.

---

## 2. Tech Stack

| Layer          | Technology                                          |
|----------------|-----------------------------------------------------|
| Frontend       | React 18 (Create React App), React Router v7        |
| Styling        | Vanilla CSS — no Tailwind. Global tokens in `index.css`. Per-component `.css` files. |
| Database       | Firebase Firestore (real-time listeners)            |
| Auth           | Firebase Auth — email/password for staff, anonymous for candidates |
| AI/LLM         | Cloudflare Worker → OpenRouter → Claude Sonnet 4.5  |
| Charts         | Recharts                                            |
| Code editor    | Monaco Editor (`@monaco-editor/react`)              |
| Animations     | framer-motion (installed, not yet widely used)      |
| Icons          | lucide-react (installed, not yet widely used)       |
| Deployment     | Firebase Hosting (frontend), Cloudflare Workers (AI) |

---

## 3. Monorepo Layout

```
sdet-challenge/
├── src/                        # React app
│   ├── App.jsx                 # Route definitions + legacy challenge flow
│   ├── App.css                 # Shared component styles (header, layout, intro, final)
│   ├── index.css               # Global CSS design tokens + resets
│   ├── firebase.js             # Firebase init + callWorker helpers
│   ├── data.js                 # Bug Finder file trees / code files
│   ├── quizData.js             # REST Assured + SQL quiz questions
│   ├── scorecardData.js        # Legacy scorecard categories
│   └── components/             # All React components (see §6)
├── worker/                     # Cloudflare Worker (AI proxy)
│   ├── src/index.js            # Route handlers (POST /parseJD, /generateQuestionBank, etc.)
│   ├── src/openrouter.js       # OpenRouter fetch helper
│   ├── src/firebase-auth.js    # Firebase ID token verification
│   └── wrangler.toml           # Cloudflare config + model names
├── firestore.rules             # Firestore security rules
├── firebase.json               # Firebase Hosting config
└── .env                        # REACT_APP_* env vars (never commit)
```

---

## 4. Environment Variables

**React app** (`.env`):
```
REACT_APP_FIREBASE_API_KEY=
REACT_APP_FIREBASE_AUTH_DOMAIN=
REACT_APP_FIREBASE_PROJECT_ID=
REACT_APP_FIREBASE_STORAGE_BUCKET=
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=
REACT_APP_FIREBASE_APP_ID=
REACT_APP_AI_WORKER_URL=https://sdet-ai-worker.<subdomain>.workers.dev
```

**Cloudflare Worker** (`wrangler secret put OPENROUTER_KEY`):
- `OPENROUTER_KEY` — only secret; everything else lives in `wrangler.toml`.

---

## 5. Routes

| Path                              | Component             | Who can access          |
|-----------------------------------|-----------------------|-------------------------|
| `/`                               | `AdminLogin`          | Everyone (login page)   |
| `/challenge`                      | `ChallengeFlow` (App.jsx) | Candidates (link-based) |
| `/admin`                          | `AdminDashboard`      | Staff (all roles)       |
| `/admin/candidate/:id`            | `CandidateProfile`    | Staff                   |
| `/admin/positions/:id`            | `PositionDetail`      | Staff                   |
| `/admin/positions/:id/compare`    | `CompareCandidates`   | Staff                   |
| `/admin/sessions/:id`             | `SessionReport`       | Staff                   |
| `/room`                           | `Room`                | Staff (interviewer) + Candidates (anon) |

**Room URL shape:** `/room?session=<id>&role=interviewer|candidate&token=<token>`

---

## 6. Component Map

### Admin / Dashboard
- **`AdminDashboard.jsx`** — Main shell. Tabs: Analytics, Positions, Manage Users, Questions, Settings.
  Active tab is persisted in `localStorage` key `adminActiveTab`.
- **`OverviewAnalytics.jsx`** — KPI cards + Recharts Bar/Pie charts for platform-wide data.
  Reads from `positions` and `sessions` collections.
- **`PositionsManager.jsx`** — CRUD for job positions. Admin can Create, Close, Reopen, Delete.
  Interviewers have read-only view (no Close/Delete/Reopen buttons shown).
- **`PositionDetail.jsx`** — Single position: summary, tech stack, questions, challenges, sessions table.
  `+ Schedule Interview` button shown for any open position regardless of challenges.
  Back button navigates to `/admin` (localStorage restores the Positions tab).
- **`ScheduleInterviewModal.jsx`** — Creates a `sessions` doc with two tokens (interviewer, candidate).
  Shows only the **candidate link** to copy. Interviewer clicks "Open my room →".
- **`QuestionsManager.jsx`** — CRUD for global/scoped interview questions.
- **`ScorecardBuilder.jsx`** — Legacy scorecard editor.
- **`AdminLogin.jsx`** — Email/password login for staff.
- **`AuditTrail.jsx`** — Displays `ai_audit` collection logs.

### Live Room (Interview)
- **`Room.jsx`** — Central live interview component (~1150 lines). Handles:
  - Token validation and anonymous candidate auth claim
  - Real-time Firestore listeners (session, answers, transcript_chunks, suggestions)
  - Three phases: `intro` → `questions` → `challenges`
  - Interviewer panel: intro script, `InterviewerScript`, candidate progress panel
  - Candidate panel: welcome screen / `CandidateQAPhase` / `ChallengeRunner`
  - Transcription start/stop (mic gate enforced — cannot skip)
  - AI co-pilot suggestions every 90 s (min 4 new transcript chunks)
  - End Interview → generate AI report → navigate to SessionReport

- **`CandidateQAPhase.jsx`** — Shown to candidate during Q&A phase. Displays current question,
  live transcript preview scoped to the current question (resets on `currentQIdx` change).

- **`ChallengeRunner.jsx`** — Sequences challenges for the candidate (one at a time).
  Each sub-component gets `key={active.id}` so all state resets when question changes.
  Sub-components: `MCQChallenge`, `OpenChallenge`, `CodeChallenge`.

- **`useTranscription.js`** — Custom hook wrapping Web Speech API (continuous recognition,
  bilingual Spanish/English).

- **`MicPermissionDialog.jsx`** — Hard gate modal before candidate enters. No skip/close buttons —
  user must grant microphone access to proceed.

- **`AISuggestions.jsx`** — Renders AI co-pilot suggestion cards in the interviewer sidebar.
- **`TranscriptStream.jsx`** — Scrolling live transcript feed.

### Reports / Evaluation
- **`SessionReport.jsx`** — Full AI evaluation report for a completed session. Includes
  executive summary, technical depth radar, bias audit flags, pros/cons, hire decision.
- **`CompareCandidates.jsx`** — Side-by-side comparison of up to 3 sessions for a position.
  Summary section has `overflowY: auto` for long AI text.
- **`CandidateProfile.jsx`** — Legacy manual scorecard for leaderboard candidates.

### Challenge (Legacy SDET Flow)
- **`QuizChallenge.jsx`** — Multiple-choice quiz (REST Assured / SQL stages).
- **`CodeChallenge.jsx`** — Monaco editor code challenge.
- **`MCQChallenge.jsx`** — MCQ component used in both legacy and live room.
- **`OpenChallenge.jsx`** — Free-text answer component.
- **`FileTree.jsx`** / **`CodePanel.jsx`** — Bug Finder stage UI.
- **`Leaderboard.jsx`** — Displays leaderboard entries.

### Shared UI
- **`ConfirmDialog.jsx`** + `useConfirmDialog` hook — Reusable modal. Always use this for
  destructive actions (delete, close, end interview).
- **`ScoreBar.jsx`** — Simple score bar.
- **`ResultModal.jsx`** — Post-challenge result modal.
- **`ModeSelector.jsx`** — Legacy mode selector.

---

## 7. Firestore Collections & Schema

### `users/{uid}`
```
role: 'superadmin' | 'admin' | 'interviewer'
email: string
createdBy: uid  // uid of the admin who created this account
```

### `questions/{id}`
```
title: string
prompt: string
category: string
weight: number
level: string
scope: 'global' | uid   // global = visible to all; uid = visible to creator + their staff
reference: string       // rubric / ideal answer
isNA: boolean
createdBy: uid
```

### `positions/{id}`
```
title: string
seniority: string
domain: string
techStack: string[]
softSkills: string[]
summary: string
status: 'open' | 'closed'
createdBy: uid
closedAt: Timestamp
selectedSessionId: string  // the hired candidate's session
selectedCandidateName: string
```
Sub-collections: `questions/`, `challenges/`

### `sessions/{id}`
```
positionId: string
positionTitle: string
candidateName: string
candidateEmail: string | null
interviewerId: uid
status: 'scheduled' | 'completed'
phase: 'intro' | 'questions' | 'challenges'
currentQuestionIdx: number
interviewerToken: string
candidateToken: string
candidateAuthUid: uid | null   // null until candidate claims
scheduledAt: Timestamp
expiresAt: Timestamp           // 3 hours from creation
startedAt: Timestamp | null
endedAt: Timestamp | null
challengeOrder: string[]       // ordered challenge IDs
report: object | null          // AI evaluation output (see §9)
biasAudit: object | null
outcome: 'Strong Hire' | 'Hire' | 'No Hire' | null
```
Sub-collections: `answers/`, `transcript_chunks/`, `suggestions/`

### `leaderboard/{id}` (Legacy)
```
name: string
date: string
score: number
total: number
pct: number
interviewerId: uid
breakdown: { restassured: {}, sql: {}, bugfinder: {} }
manualEvaluation: object
```

### `ai_audit/{id}`
```
promptType: 'parseJD' | 'generateQuestionBank' | 'liveSuggestion' | 'evaluate_session' | 'bias_audit'
createdBy: uid
sessionId: string
positionId: string
tokensUsed: number
model: string
createdAt: Timestamp
```

---

## 8. Role-Based Access

| Action                        | superadmin | admin | interviewer |
|-------------------------------|:---:|:---:|:---:|
| View Analytics tab            | ✓ | ✓ | ✓ |
| View Positions tab            | ✓ | ✓ | ✗ |
| Create / Delete positions     | ✓ | ✓ | ✗ |
| Close / Reopen positions      | ✓ | ✓ | ✗ |
| Delete session                | ✓ | ✓ | ✗ |
| Manage Users tab              | ✓ | ✓ | ✗ |
| Create staff accounts         | ✓ | ✓ (interviewer only) | ✗ |
| Delete users                  | ✓ | ✗ | ✗ |
| Schedule interview            | ✓ | ✓ | ✓ |
| Run live interview            | ✓ | ✓ | ✓ |

**Pattern:** In components, fetch the user doc (`getDoc(doc(db, 'users', u.uid))`), set
`role` state, then derive `const isAdminLike = role === 'admin' || role === 'superadmin'`.
Hide destructive buttons with `{isAdminLike && <button>…</button>}`.

---

## 9. AI Worker Endpoints

Base URL: `REACT_APP_AI_WORKER_URL`. All requests require `Authorization: Bearer <Firebase ID token>`.

| Endpoint                 | Input                              | Output                                 |
|--------------------------|------------------------------------|----------------------------------------|
| `POST /parseJD`          | `{ jdText }`                       | `{ title, seniority, domain, techStack, softSkills, summary }` |
| `POST /generateQuestionBank` | `{ position }`                 | `{ questions[], challenges[] }`        |
| `POST /liveSuggestion`   | `{ transcript, question, position }` | `{ suggestion }` (real-time co-pilot) |
| `POST /customPrompt`     | `{ question, transcript, position }` | `{ answer }` (free-text AI co-pilot query) |
| `POST /evaluateSession`  | `{ position, candidateName, transcript, answers, challenges }` | Full report object |
| `POST /biasAudit`        | `{ report }`                       | `{ flags[], overall }`                 |

**Models (configurable in `wrangler.toml`):**
- Parse / Generate / Evaluate / Bias: `anthropic/claude-sonnet-4.5`
- Live suggestion (auto, every 90s): `anthropic/claude-haiku-3.5`
- Custom prompt (interviewer free-text): `anthropic/claude-haiku-3.5`

---

## 10. Design System

All CSS tokens live in `src/index.css` under `:root`.

**Key colours:**
```css
--bg-main:        #030712  /* page background */
--bg-panel:       #0f172a
--bg-card:        #1e293b
--bg-glass:       rgba(15,23,42,0.7)
--accent-primary: #6366f1  /* indigo */
--accent-success: #10b981  /* emerald */
--accent-danger:  #f43f5e  /* rose */
--accent-warning: #f59e0b  /* amber */
--accent-info:    #0ea5e9  /* sky */
--border-color:   rgba(255,255,255,0.1)
```

**Fonts:**
```css
--font-ui:      'Inter'       /* body / UI text */
--font-display: 'Outfit'      /* headings (h1–h6) */
--font-mono:    'JetBrains Mono'
```

**Glassmorphism pattern** (used on cards, navbar, panels):
```css
background: var(--bg-glass);
backdrop-filter: blur(16px);
border: 1px solid var(--border-color);
border-radius: var(--radius-lg);  /* 20px */
box-shadow: var(--shadow-lg);
```

**Global checkbox:** All `input[type="checkbox"]` are auto-styled via `index.css` —
indigo fill + SVG checkmark + glow on checked. Never add custom inline checkbox markup.

**Shadows:** `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-glow`.  
**Radii:** `--radius-sm` (8px), `--radius-md` (12px), `--radius-lg` (20px), `--radius-full`.

---

## 11. Interview Phase Flow

```
Session created (status: 'scheduled', phase: 'intro')
        │
        ▼
Interviewer opens room → intro panel shown
        │  handleStartQuestions()
        ▼
phase = 'questions', currentQuestionIdx = 0
        │  handleAdvanceQuestion(newIdx)   ← saves verbal answer to answers sub-collection
        ▼
phase = 'questions', currentQuestionIdx = N
        │  handleFinishQA()
        ▼
phase = 'challenges'
        │  Candidate submits all challenges
        │  handleEnd() (interviewer)
        ▼
status = 'completed' → AI report generated → navigate to SessionReport
```

---

## 12. Key Patterns & Gotchas

### Deleting positions
Position deletion must cascade: delete `challenges/` + `questions/` sub-collections, then
each session's `answers/`, `transcript_chunks/`, `suggestions/` sub-collections, then the
session docs, then the position doc. Firestore does NOT auto-delete sub-collections.
The helper `deleteSubcollection()` in `PositionsManager.jsx` does this in batches of 400.
Firestore rules must explicitly allow `delete` on all these sub-collections for `isAdmin()`.

### Anonymous candidate auth
Candidates sign in anonymously via `signInAnonymously(auth)`. On first load they "claim"
the session by writing their `anon uid` into `sessions/{id}.candidateAuthUid`.
The Firestore rule allows this one-time claim transition.

### Tab persistence
`AdminDashboard` saves the active tab to `localStorage` key `adminActiveTab`.
Always use `handleTabChange(tab)` (not `setActiveTab`) to change tabs so persistence works.

### Challenge state reset
Each challenge sub-component (`MCQChallenge`, `OpenChallenge`, `CodeChallenge`) receives
`key={active.id}`. This is intentional — it forces React to fully remount and clear all
local state when the interviewer changes the active challenge.

### Session token validation
Room validates: URL token must match `interviewerToken` (for interviewer role) or
`candidateToken` (for candidate role) stored on the session doc. Mismatch → error screen.
Expired sessions (`expiresAt < now`) also show the error screen.

### Back navigation in PositionDetail
The `← Back to positions` button navigates to `/admin`. Because `AdminDashboard` reads
`localStorage.adminActiveTab` on mount, this correctly restores the Positions tab.
Do NOT use `navigate(-1)` — it causes a loop between the report and the position page.

### Firestore rules deployment
```bash
firebase deploy --only firestore:rules
```

### Dev server
```bash
npm start          # React app on :3000
wrangler dev       # Worker on :8787 (in /worker directory)
```

---

## 13. Files to Know First

When starting a new task, these are the most important files to read:

1. `src/App.jsx` — routes and legacy challenge flow
2. `src/firebase.js` — all AI worker call functions
3. `src/components/Room.jsx` — live interview logic (biggest file)
4. `src/components/AdminDashboard.jsx` — main shell + tabs
5. `src/components/PositionsManager.jsx` — CRUD + role guards
6. `src/index.css` — design tokens
7. `firestore.rules` — security model

## 14. React Principles & Clean Code

### Component Design
- **Single responsibility**: Each component does one thing. If a component needs a long comment explaining what it does, split it.
- **<500 lines per file**: `Room.jsx` (~1150 lines) is the exception, not the model. New components must stay lean.
- **Prefer named exports** for components; default exports only for route-level pages.
- **Co-locate related logic**: Keep a component's hook, types, and helper functions near the component, not scattered globally.

### State Management
- **Lift state only as needed**: Don't push state to `AdminDashboard` if it only matters inside one tab's child.
- **Derive, don't duplicate**: Compute values from existing state rather than keeping parallel state in sync. E.g., `const isAdminLike = role === 'admin' || role === 'superadmin'` — never store this in state.
- **Avoid `useEffect` for derived state**: If a value can be computed from props/state during render, compute it inline instead of syncing via `useEffect`.
- **One source of truth per piece of data**: Firestore is the source of truth for session/position data; local state is only for ephemeral UI (loading flags, modal open/close, form drafts).

### Hooks
- **Extract complex logic into custom hooks**: Transcription logic lives in `useTranscription.js` — follow this pattern. If a `useEffect` block is more than ~10 lines, it belongs in a custom hook.
- **Name hooks descriptively**: `useSessionListener`, `useRoleGuard`, not `useData` or `useThing`.
- **Cleanup all effects**: Every `useEffect` that sets up a Firestore listener, timer, or event listener must return a cleanup function.
- **Avoid stale closures**: Pass updater functions (`setState(prev => ...)`) rather than reading state inside async callbacks.

### Props & Interfaces
- **Destructure props at the top** of every component.
- **No prop drilling past 2 levels**: If a prop passes through an intermediary that doesn't use it, introduce a context or restructure.
- **Keep prop surfaces small**: If a component needs 8+ props, consider passing a single structured object or splitting the component.
- **Boolean props use `is`/`has`/`can` prefixes**: `isLoading`, `hasError`, `canDelete`.

### Naming Conventions
- **Components**: `PascalCase` — `ScheduleInterviewModal`
- **Hooks**: `camelCase` prefixed with `use` — `useTranscription`
- **Event handlers**: `handle` prefix — `handleStartQuestions`, `handleTabChange`
- **Firestore helpers**: verb-noun — `deleteSubcollection`, `fetchPosition`
- **Boolean flags**: `is`/`has`/`can`/`should` — never bare nouns like `loading` or `error`
- **Constants**: `SCREAMING_SNAKE_CASE` — `MAX_TRANSCRIPT_CHUNKS`

### Async & Side Effects
- **Always handle loading and error states** when calling `callWorker` or Firestore. Never leave the UI in a frozen state on failure.
- **Debounce or gate expensive calls**: AI co-pilot suggestions are gated (min 4 new chunks, 90 s interval). Apply the same discipline to any Firestore write triggered by user input.
- **Prefer `async/await` over `.then()` chains** for readability. Handle errors with `try/catch`.
- **Never `await` inside a loop** over Firestore docs — use `Promise.all()` instead.

### Conditionals & Early Returns
- **Use early returns** to handle loading/error/null states at the top of a component before the main render.
- **Avoid deeply nested ternaries**: More than two levels of `? :` must be extracted into a named variable or helper function.
- **Use optional chaining and nullish coalescing**: `session?.phase ?? 'intro'` over `session && session.phase ? session.phase : 'intro'`.

### Performance
- **Memoize selectively**: Use `useMemo` / `useCallback` only when profiling shows a real cost — premature memoization adds noise.
- **`key` prop must be stable and unique**: Never use array index as `key` for lists that reorder or filter. IDs from Firestore are always preferred.
- **Forced remount is intentional**: `key={active.id}` on challenge sub-components is a deliberate reset pattern — document any similar usage with a comment.

### Code Clarity
- **Delete dead code, don't comment it out**: Git history is the undo button.
- **Comments explain *why*, not *what***: `// mic gate — cannot be skipped per design spec` not `// check if mic is enabled`.
- **Magic numbers get named constants**: `const SUGGESTION_INTERVAL_MS = 90_000` not `setTimeout(fn, 90000)`.
- **Consistent import order**: (1) React/libraries, (2) Firebase/worker helpers, (3) components, (4) styles/assets.

### Anti-Patterns to Avoid
- ❌ `useEffect` with no dependency array to "run once" — use `[]` explicitly and justify it with a comment.
- ❌ Storing derived booleans (`isAdmin`, `isEmpty`) in state.
- ❌ Direct DOM manipulation (`document.querySelector`) — use refs.
- ❌ Inline object/array literals as props (`<Comp style={{ color: 'red' }} />`) in render-heavy paths — they create new references every render.
- ❌ `console.log` left in committed code — use a `DEBUG` flag or remove before merge.
- ❌ Anonymous default exports (`export default function() {}`) — always name your functions.
