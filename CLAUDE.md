# CLAUDE.md — AI Interview Platform (SDET Challenge)

This file gives an AI assistant the full context needed to work in this codebase without asking repetitive questions. Read it before making any changes.

---

## 1. What This App Is

A **full-stack AI-assisted interview management platform** built with React + Firebase + Vite.
It lets interviewers manage job positions, schedule live interviews, run real-time
transcription/Q&A sessions with candidates, and generate AI-powered evaluation reports.

It also contains a legacy **SDET self-serve challenge** (REST Assured, SQL, Bug Finder)
reachable at `/challenge`, but the primary product is the live interview platform.

---

## 2. Tech Stack

| Layer          | Technology                                          |
|----------------|-----------------------------------------------------|
| Frontend       | React 18, React Router v7, **Vite** (not CRA)      |
| Styling        | Vanilla CSS — no Tailwind. Global tokens in `index.css`. Per-component `.css` files. |
| Database       | Firebase Firestore (real-time listeners)            |
| Auth           | Firebase Auth — email/password for staff, anonymous for candidates |
| AI/LLM         | Cloudflare Worker → OpenRouter → Claude Sonnet 4.5  |
| Video Calls    | **Jitsi External API** (element.io / jit.si mirror fallback) |
| Transcription  | Web Speech API (`useTranscription.js` custom hook)  |
| Charts         | Recharts                                            |
| Code editor    | Monaco Editor (`@monaco-editor/react`)              |
| PDF Processing | `pdfjs-dist` (lazy-loaded for candidate CV parsing) |
| Animations     | framer-motion (installed, not yet widely used)      |
| Icons          | lucide-react                                        |
| i18n           | react-i18next (English / Spanish)                   |
| Deployment     | Firebase Hosting (frontend), Cloudflare Workers (AI) |

> **Build tool is Vite, not CRA.** The dev command is `npm run dev` (or `npm start`), NOT `react-scripts start`. Environment variables use the `VITE_` prefix on the Vite side but the `.env` file still uses `REACT_APP_` keys because Firebase functions reference them directly through the build config.

---

## 3. Monorepo Layout

```
sdet-challenge/
├── index.html                  # Vite HTML entry — favicon links live here
├── src/                        # React app
│   ├── App.jsx                 # Route definitions + legacy challenge flow
│   ├── App.css                 # Shared component styles (header, layout, intro, final)
│   ├── index.css               # Global CSS design tokens + resets
│   ├── firebase.js             # Firebase init + callWorker helpers
│   ├── data.js                 # Bug Finder file trees / code files
│   ├── quizData.js             # REST Assured + SQL quiz questions
│   ├── scorecardData.js        # Legacy scorecard categories
│   ├── i18n.js                 # i18next initialization (EN/ES)
│   ├── locales/                # en.json / es.json translation files
│   └── components/             # All React components (see §6)
├── public/                     # Static assets / Favicon files
├── worker/                     # Cloudflare Worker (AI proxy)
│   ├── src/index.js            # Route handlers (POST /parseJD, /analyzeCV, etc.)
│   ├── src/openrouter.js       # OpenRouter fetch helper
│   ├── src/firebase-auth.js    # Firebase ID token verification
│   └── wrangler.toml           # Cloudflare config + model names
├── firestore.rules             # Firestore security rules
├── firebase.json               # Firebase Hosting config
├── vite.config.js              # Vite build config
├── CLAUDE.md                   # This file
├── spec.md                     # Feature specification (source of truth for product features)
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
REACT_APP_AI_WORKER_URL=https://sdet-ai-worker.yankees00000.workers.dev
```

> **Windows gotcha**: Do NOT wrap values in double quotes in `.env`. PowerShell/Vite will include the literal `"` character in the bundled string, breaking Firebase init.

**Cloudflare Worker** (`wrangler secret put OPENROUTER_KEY`):
- `OPENROUTER_KEY` — only secret; everything else lives in `wrangler.toml`.

---

## 5. Routes

| Path                              | Component             | Who can access          |
|-----------------------------------|-----------------------|-------------------------|
| `/`                               | `AdminLogin`          | Everyone (login page)   |
| `/challenge`                      | `ChallengeFlow`       | Candidates (link-based) |
| `/admin`                          | `AdminDashboard`      | Staff (all roles)       |
| `/admin/candidate/:id`            | `CandidateProfile`    | Staff                   |
| `/admin/positions/:id`            | `PositionDetail`      | Staff                   |
| `/admin/positions/:id/compare`    | `CompareCandidates`   | Staff                   |
| `/admin/sessions/:id`             | `SessionReport`       | Staff                   |
| `/room`                           | `Room`                | Staff (interviewer) + Candidates (anon) |

---

## 6. Component Map

### Admin / Dashboard
- **`AdminDashboard.jsx`** — Main shell. Tabs: Analytics, Positions, Manage Users, Questions, Settings.
- **`PositionsManager.jsx`** — CRUD for job positions. Admins can Create/Close/Reopen/Delete.
- **`PositionDetail.jsx`** — Single position: summary, tech stack, questions, challenges, sessions table.
- **`ScheduleInterviewModal.jsx`** — Creates a `sessions` doc. Requires attaching a candidate CV (.pdf or .txt) and selecting an interview date/time. Validates date is not in the past. Integrates `pdfjs-dist` dynamic import for PDF parsing, calls worker `/analyzeCV`, and sets session expiry (`expiresAt`) to 23:59:59 on the selected date.

### Live Room (Interview)

- **`Room.jsx`** — Live interview workspace. Contains:
  - Collapsible **"CV Pre-Screen Analysis"** panel showing Claude's assessment (fit score, strengths, red flags, verification questions, claimed tech).
  - Fullscreen blocking modal overlay when `ending` is true. Centered layout showing real-time stage progress: *closing session* → *generating AI report (20–40s)* → *saving report* → *running bias audit*.
  - Jitsi mirror-fallback `VideoCall` iframe with mic mute integration.
  - Web Speech API live translation / transcription streaming.

---

## 7. Firestore Collections & Schema

### `sessions/{id}`
```
positionId, positionTitle
candidateName, candidateEmail
interviewerId: uid
status: 'scheduled' | 'completed' | 'live'
phase: 'intro' | 'questions' | 'challenges'
currentQuestionIdx: number
interviewerToken, candidateToken: string
candidateAuthUid: uid | null
scheduledAt, expiresAt, startedAt, endedAt: Timestamp
interviewDate: string ('YYYY-MM-DD')
interviewTime: string | null ('HH:MM')
challengeOrder: string[]
cvText: string | null
cvAnalysis: {
  summary: string,
  claimedTechStack: string[],
  claimedExperience: { yearsTotal: number|null, senioritySignals: string },
  keyStrengths: string[],
  redFlags: string[],
  questionsToVerify: string[],
  fitScore: number,
  fitRationale: string
} | null
report: object | null
```

---

## 8. Role-Based Access

Same as legacy. Gated to `isAdminLike` or user role state.

---

## 9. AI Worker Endpoints

Base URL: `REACT_APP_AI_WORKER_URL`. Requires `Authorization: Bearer <Firebase ID token>`.

| Endpoint                 | Input                              | Output                                 |
|--------------------------|------------------------------------|----------------------------------------|
| `POST /parseJD`          | `{ jdText }`                       | Job description parsed JSON            |
| `POST /generateQuestionBank` | `{ position }`                 | Questions and coding challenges        |
| `POST /analyzeCV`        | `{ cvText, position }`             | Struct CV analysis (fitScore, tags...) |
| `POST /liveSuggestion`   | `{ transcript, askedTopics, cvClaims }` | Suggestion + topic + priority + reasoning |
| `POST /customPrompt`     | `{ question, transcript, position }` | Text copilot answer                    |
| `POST /evaluateSession`  | `{ ..., cvAnalysis, cvText }`      | Full evaluation JSON with `cvComparison` |
| `POST /biasAudit`        | `{ report }`                       | Audit flags JSON                       |

---

## 10. Design System

- **Global styling**: Core definitions reside in `src/index.css` with component overrides in separate `.css` files.
- **Premium design elements**:
  - **Ambient floaters**: Animated ambient background orbs on `AdminLogin` using floating keyframes.
  - **Glow & Gradients**: Buttons, active tabs, card hovers, active score radio buttons, and stage steps use layered gradient styles with box-shadow glow states.
  - **Card wrappers**: Login container uses a `padding: 1px` wrapper technique to display a glowing gradient border.
  - **Glass components**: Toasts, loaders, and panels utilize high-blur backdrops (`backdrop-filter`) with colored left-borders for semantic states.
  - **Title animations**: Live/intro headers use animated shifting gradients (`gradientShift` keyframe).
  - **Spinners**: Branded dual counter-rotating spinner loops.
  - **Brand Assets**: The login screen displays the official favicon brand logo (`/favicon/android-chrome-192x192.png`) and the subtitle `"Presto AI Interview Portal"`.

---

## 11. Interview Phase Flow

Intro (mic/Jitsi) → Questions (verbal transcript save) → Challenges (monaco/answers subcollection) → Completion (Fullscreen modal, AI generation, Bias audit, Redirect).

---

## 12. Key Patterns & Gotchas

### CV Text Extraction & AI Verification
- CV text is parsed directly in browser via client-side PDF/TXT parsing.
- Dynamic `pdfjs-dist` worker URL configuration is utilized to avoid loading it on application mount.
- Analysis outputs are cached in the Firestore session document.
- Unverified tech stack elements and verification questions are passed to `/liveSuggestion` to flag priority questions for interviewers dynamically.

### Session Validity
- Scheduler uses the local browser calendar to choose dates.
- The `expiresAt` Firestore timestamp is calculated to be midnight local time of the selected interview date (`23:59:59.999` local).
- Prevents candidates or stale interviewer links from accessing rooms after the scheduled day has passed.

### i18n Language Cache Clear
- Language detection order is `['querystring', 'localStorage', 'navigator']`.
- An immediately invoked cleanup function runs on mount inside `src/i18n.js`.
- If the cached `localStorage.getItem('i18nextLng')` value differs from the actual browser language (`navigator.language`), it removes the cache key to prevent users from getting stuck in a wrong auto-detected language.

### Dynamic Document Titles
- Tab titles are updated dynamically in mount `useEffect` or snapshot callbacks using `document.title` to provide distinct titles:
  - Admin Login: `Login | Presto AI`
  - Admin Dashboard: `Dashboard | Presto AI`
  - Position Detail: `[Job Title] | Presto AI`
  - Live Room: `Interview Room: [Candidate] | Presto AI`
  - Session Report: `Report: [Candidate] | Presto AI`

---

## 13. Files to Know First

When starting a new task, these are the most important files to read:

1. `spec.md` — product feature specification (start here for product context)
2. `src/App.jsx` — routes and legacy challenge flow
3. `src/firebase.js` — all AI worker call functions
4. `src/components/Room.jsx` — live interview logic (biggest file ~1860 lines)
5. `src/components/useTranscription.js` — Web Speech API hook
6. `src/components/AdminDashboard.jsx` — main shell + tabs
7. `src/components/PositionsManager.jsx` — CRUD + role guards
8. `src/index.css` — design tokens
9. `firestore.rules` — security model

---

## 14. React Principles & Clean Code

### Component Design
- **Single responsibility**: Each component does one thing. If a component needs a long comment explaining what it does, split it.
- **<500 lines per file**: `Room.jsx` (~1860 lines) is the exception, not the model.
- **Prefer named exports** for components; default exports only for route-level pages.
- **Co-locate related logic**: Keep a component's hook, types, and helper functions near the component.

### State Management
- **Derive, don't duplicate**: `const isAdminLike = role === 'admin' || role === 'superadmin'` — never store this in state.
- **One source of truth**: Firestore for session/position data; local state only for ephemeral UI.
- **Avoid `useEffect` for derived state**: Compute inline from props/state where possible.

### Hooks
- **Extract complex logic into custom hooks**: Follow the `useTranscription.js` pattern.
- **Cleanup all effects**: Every listener, timer, or event subscription must return a cleanup.
- **Avoid stale closures**: Use updater form `setState(prev => ...)` in async callbacks.
- **Stable callback refs**: When passing callbacks into long-lived effects (Jitsi, WebRTC), store them in `useRef` and keep the ref in sync via a short `useEffect`. This prevents re-running the heavy effect on every render.

### Naming Conventions
- Components: `PascalCase`
- Hooks: `camelCase` with `use` prefix
- Event handlers: `handle` prefix — `handleStartQuestions`, `handleTabChange`
- Constants: `SCREAMING_SNAKE_CASE` — `SUGGESTION_INTERVAL_MS`
- Booleans: `is`/`has`/`can`/`should` prefix — `isLoading`, `hasError`

### Anti-Patterns to Avoid
- ❌ `useEffect` with no dependency array — always use `[]` explicitly and justify with a comment
- ❌ Storing derived booleans in state
- ❌ Direct DOM manipulation — use refs
- ❌ Inline object/array literals as props in hot paths (new reference on every render)
- ❌ `console.log` in committed code
- ❌ Anonymous default exports
- ❌ `await` inside a `forEach` — use `Promise.all()`
- ❌ `navigate(-1)` for back navigation where URL shape could loop

---

## 15. i18n (Internationalization)

- Initialized in `src/i18n.js` using `i18next` + `i18next-browser-languagedetector`.
- Translation files: `src/locales/en.json` and `src/locales/es.json`.
- Usage: `const { t, i18n } = useTranslation()` → `t('room.welcome')`.
- Language detection: browser language. Spanish triggers `es-ES` in `useTranscription`.
- **Do not add hardcoded English strings** in components — always add a key to both locale files.
