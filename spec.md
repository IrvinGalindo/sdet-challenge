# spec.md — AI Interview Platform Feature Specification

This file is the canonical product specification. It documents every feature, its current implementation status, and any known behaviour details. AI assistants should read this alongside `CLAUDE.md` before making changes.

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [Admin Dashboard](#2-admin-dashboard)
3. [Position Management](#3-position-management)
4. [Interview Scheduling](#4-interview-scheduling)
5. [Live Interview Room](#5-live-interview-room)
6. [Video Conferencing](#6-video-conferencing)
7. [Live Transcription](#7-live-transcription)
8. [AI Co-Pilot (Interviewer)](#8-ai-co-pilot-interviewer)
9. [Session Evaluation & Reports](#9-session-evaluation--reports)
10. [Candidate Experience](#10-candidate-experience)
11. [Internationalization](#11-internationalization)
12. [Favicon & PWA Metadata](#12-favicon--pwa-metadata)
13. [Legacy SDET Challenge](#13-legacy-sdet-challenge)

---

## 1. Authentication & Authorization

### Staff (Interviewers / Admins)
- **Login**: Email + password via Firebase Auth (`AdminLogin.jsx`).
- **Roles**: `superadmin`, `admin`, `interviewer` stored in `users/{uid}.role`.
- **Role derivation**: `isAdminLike = role === 'admin' || role === 'superadmin'` is computed inline, not stored in state.
- **Guards**: Interviewer-only actions (schedule, run room) available to all staff. Destructive actions (close/delete positions, delete sessions, manage users) gated to `isAdminLike`.

### Candidates
- **Anonymous auth**: `signInAnonymously(auth)` called when `role === 'candidate'`.
- **Session claim**: Candidate writes their `anon uid` to `sessions/{id}.candidateAuthUid` once (Firestore rule allows single claim).
- **Token validation**: URL token must match `candidateToken` on session doc. Expired sessions (`expiresAt < now`) show an error screen.

---

## 2. Admin Dashboard

- **Component**: `AdminDashboard.jsx` — tab shell.
- **Tabs**: Analytics, Positions, Manage Users, Questions, Settings.
- **Tab persistence**: Active tab stored in `localStorage` key `adminActiveTab`. Restored on mount.
- **Tab change**: Always use `handleTabChange(tab)`, not `setActiveTab`, so persistence works.
- **Analytics tab**: KPI cards + Recharts Bar/Pie charts. Reads `positions` and `sessions` collections.
- **Manage Users tab**: Create / delete staff accounts. Admins can only create `interviewer` accounts. Only `superadmin` can delete users.
- **Questions tab**: CRUD for global and scoped interview questions (`QuestionsManager.jsx`).
- **Settings tab**: Language toggle (EN/ES), theme preferences.
- **Audit Trail**: `AuditTrail.jsx` — displays `ai_audit` collection entries (promptType, model, tokens used, timestamp).

---

## 3. Position Management

- **Component**: `PositionsManager.jsx`.
- **CRUD**: Create, Close, Reopen, Delete. Create/Close/Reopen/Delete only for `isAdminLike`.
- **Position fields**: title, seniority, domain, techStack[], softSkills[], summary, status.
- **AI generation**: "Parse JD" button calls `POST /parseJD` to extract position fields from a job description text.
- **Question bank**: "Generate Question Bank" button calls `POST /generateQuestionBank`.
- **Challenges**: Code, MCQ, and Open-ended challenges stored in `positions/{id}/challenges/`.
- **Deletion cascade**: `deleteSubcollection()` deletes challenges + questions + sessions (including all sub-collections) before deleting the position doc.
- **Selected candidate**: `selectedSessionId` + `selectedCandidateName` stored on position when a hire is made.
- **Position Detail** (`PositionDetail.jsx`): Sessions table, schedule button, candidate comparison link.
- **Back navigation**: Always `navigate('/admin')` — NOT `navigate(-1)`. Dashboard restores Positions tab from localStorage.

---

## 4. Interview Scheduling

- **Modal**: `ScheduleInterviewModal.jsx` — shown via a "Schedule Interview" button in `PositionDetail`.
- **CV Pre-Screen**:
  - Requires uploading a candidate CV (.pdf or .txt file).
  - Browser extracts text client-side (uses dynamic lazy-loading for `pdfjs-dist` to keep the bundle size small).
  - Triggers a call to `POST /analyzeCV` at the worker layer to pre-screen the CV against the position requirements.
  - Displays the resulting fit score (1-5) and checks for red flags before allowing session creation.
- **Date Selector**:
  - The interviewer selects the intended interview date and start time.
  - Expiration is set based on this selection: `expiresAt` is calculated as midnight local time of that date (`23:59:59.999` local) rather than a fixed 3-hour TTL.
  - Blocks past dates at form validation level.
- **Session doc created** with:
  - `interviewerToken` and `candidateToken` (crypto random UUIDs).
  - `status: 'scheduled'`, `phase: 'intro'`.
  - `challengeOrder` array.
  - `cvText` and `cvAnalysis` object (summary, key strengths, red flags, claimed tech, questions to verify).
  - `interviewDate` (YYYY-MM-DD) and `interviewTime` (HH:MM).
- **Candidate link**: Only the candidate link is shown in the modal. Interviewer clicks "Open my room →" to go directly.
- **Regenerate Candidate Link** (`RegenerateLinkModal`):
  - Available in `Room.jsx` (interviewer view, non-completed sessions) and `PositionDetail.jsx`.
  - Creates a new `candidateToken`, resets `candidateAuthUid` to `null`, extends `expiresAt` to midnight of the scheduled date.
  - Shows the new URL in a styled modal with a copy button.

---

## 5. Live Interview Room

- **Component**: `Room.jsx` — the largest component (~1860 lines).
- **URL shape**: `/room?session=<id>&role=interviewer|candidate&token=<token>`

### Phase Flow
```
'intro'  →  handleStartQuestions()  →  'questions'  →  handleFinishQA()  →  'challenges'
```

### Interviewer View
- **Intro phase**: Welcome card with "Start Interview Questions" button.
- **Questions phase**: `InterviewerScript` sub-component (defined at bottom of `Room.jsx`):
  - Numbered question navigator bubbles.
  - Active question card with the prompt to ask the candidate.
  - Live speech preview of candidate's answer (from transcript chunks scoped to current question).
  - "Next Question" / "Finish Q&A" button.
- **CV Analysis panel**: Collapsible pre-screen drawer displaying overall profile summary, fit score badge, key strengths, warning flags, claimed technology chips, and specific CV claims/questions to verify.
- **AI suggestions & Co-pilot**:
  - Probes and live suggestions prioritize verifying unconfirmed CV claims and technology items (passed via `cvClaims` config to worker).
- **Challenges phase**: Read-only progress view of each challenge (submitted / pending).
- **End Interview button**: Confirms, sets `status: 'completed'`, and triggers a **fullscreen blocking overlay** detailing evaluation progress stages (*closing session* → *generating AI report* → *saving report* → *running bias audit*). The modal centers on the screen with blur styling to prevent premature navigation.
- **Generate Report button**: Shown post-completion if report is missing (re-triggers evaluation).

### Candidate View
- **Layout**: Vertical stack — video call on top, workspace below.
- **Intro phase**: "Your interviewer will begin shortly" placeholder.
- **Questions phase**: `CandidateQAPhase` — shows current question + live transcript preview.
- **Challenges phase**: `ChallengeRunner` — one challenge at a time (MCQ, Open, Code).
- **Completed screen**: "Interview ended" message.

### Leaving the Video Call
- Leaving the Jitsi call sets `videoLeft: true` (local UI state only).
- **Does NOT set `status: 'completed'`** — this was a bug that was fixed. Candidates can continue working on challenges after a video call disconnect.
- Rejoining: "Join Video Call" / "Start Call" buttons appear when `videoLeft === true`.

---

## 6. Video Conferencing

- **Component**: `VideoCall` sub-component (inside `Room.jsx` ~L1630+).
- **Service**: Jitsi External API (embedded iframe).
- **Script loading**: Sequential mirror fallback system:
  1. Try `https://meet.element.io/external_api.js` (10-second timeout)
  2. Fall back to `https://meet.jit.si/external_api.js` (10-second timeout)
  3. If both fail: show error with Retry button.
- **`activeDomain` state**: Set to whichever mirror loaded first. The Jitsi API constructor uses `activeDomain` (NOT hardcoded `meet.element.io`).
- **`retryTrigger` state**: Incremented by the Retry button. The loading `useEffect` depends on it, so clicking Retry fully re-runs the mirror loading sequence.
- **Retry button**: Resets `jitsiError`, `jitsiReady: false`, `activeDomain: null`, then `setRetryTrigger(prev => prev + 1)`.
- **Config**: `prejoinPageEnabled: false`, `startWithVideoMuted: true`, toolbar limited to `['microphone', 'camera', 'hangup', 'tileview', 'settings']`.
- **Room name**: `sdet-challenge-<sessionId>` (unique per session).
- **Firestore signaling** (for interviewer left detection):
  - `sessions/{id}/videoRoom/room.interviewerLeft: boolean`
  - Candidates subscribe to this doc; when `interviewerLeft === true`, `onLeft()` fires.
  - Only staff can write to this path (Firestore rule: `isStaff()`).
- **Stable callback refs**: `onLeftRef` and `onMuteStatusChangedRef` — updated via small `useEffect`s to avoid re-initializing the Jitsi iframe on parent re-renders.

### Events Listened
| Jitsi Event | Handler |
|---|---|
| `videoConferenceLeft` | Marks `interviewerLeft: true` in Firestore (interviewer only), calls `onLeft()` |
| `videoConferenceJoined` | Reads initial `api.isAudioMuted()`, fires `onMuteStatusChanged(muted)` |
| `audioMuteStatusChanged` | Fires `onMuteStatusChanged(event.muted)` |

---

## 7. Live Transcription

- **Hook**: `useTranscription.js` — wraps the Web Speech API.
- **`enabled` prop**: When `false`, recognition is not started (cleanup fires). Controlled by:
  - Session must be non-null and non-completed: `!!session && session.status !== 'completed'`
  - Mic gate must be dismissed: `micGateDismissed`
  - Meeting must not be muted: `!meetingMuted`
- **Mute sync**: `meetingMuted` state in `Room` is set by the `onMuteStatusChanged` callback from `VideoCall`. When the user mutes their mic in Jitsi, `meetingMuted` becomes `true`, which disables `useTranscription` automatically.
- **Auto-restart**: On `no-speech` or `aborted` errors (Chrome behaviour), the engine auto-restarts.
- **Permission gate**: `MicPermissionDialog` shown when `permissionState !== 'granted'`. If `permissionState === 'granted'` (browser already granted), the gate is auto-dismissed on mount.
- **Speaker tagging**: Chunks are written to `transcript_chunks/` with `speaker: 'interviewer' | 'candidate'`.
- **Deduplication**: Cross-speaker duplicate detection (word overlap ≥ 70% within 4 seconds) prevents echo from being transcribed twice.
- **Language**: `en-US` (default) or `es-ES` (when i18n locale is Spanish).

---

## 8. AI Co-Pilot (Interviewer)

- **Auto suggestions**: Every `SUGGESTION_INTERVAL_MS = 90_000` ms (90 s), if at least `SUGGESTION_MIN_CHUNKS = 4` new transcript chunks have appeared since the last call.
- **On-demand**: Interviewer clicks "Ask Claude now" → `callLiveSuggestion()`.
- **Free-text prompt**: "Ask Claude anything" textarea → `callCustomPrompt()`. Sends `Ctrl+Enter` or submit button.
- **Models**: Live suggestion + custom prompt use `claude-haiku-3.5` for speed. Evaluation uses `claude-sonnet-4.5`.
- **Suggestions stored**: Each suggestion saved to `sessions/{id}/suggestions/` for real-time display.
- **Transcript scope**: AI calls use the last 60 chunks (suggestions) or 40 chunks (custom prompt) to fit context window.

---

## 9. Session Evaluation & Reports

- **Trigger**: `handleEnd()` → `handleGenerateReport()` in `Room.jsx`.
- **Steps**:
  1. Set `status: 'completed'`, `endedAt: serverTimestamp()`.
  2. Call `POST /evaluateSession` with position, candidateName, full transcript, answers, challenges, and CV context (`cvAnalysis` + `cvText`).
  3. Save report to `sessions/{id}.report`.
  4. Log AI usage to `ai_audit` collection.
  5. Call `POST /biasAudit` on the generated report (best-effort, non-fatal).
  6. Save bias audit to `sessions/{id}.biasAudit`.
  7. Navigate to `/admin/sessions/<id>`.
- **Report component**: `SessionReport.jsx` — executive summary, technical depth radar chart, bias flags, pros/cons, hire decision badge, and a **CV Comparison** section comparing claims verified, claims unverified, and discrepancies.
- **Outcome**: `'Strong Hire' | 'Hire' | 'No Hire'` stored as `sessions/{id}.outcome`.
- **Candidate comparison**: `CompareCandidates.jsx` — side-by-side view of up to 3 sessions for a position.

---

## 10. Candidate Experience

- Anonymous sign-in on room entry.
- Token + expiry validation before any content is shown.
- **Video call**: Full Jitsi video call at the top of the page.
- **Mic permission gate**: Shown if browser has not granted mic access.
- **Q&A Phase**: `CandidateQAPhase` shows the current question text and a live preview of their own transcribed speech.
- **Challenges**: `ChallengeRunner` presents one challenge at a time. MCQ: radio buttons + submit. Open: textarea + submit. Code: Monaco editor + submit.
- **Challenge state reset**: `key={active.id}` ensures full React remount on challenge change.
- **Disconnecting video**: Does NOT end the session. Candidate can continue challenges.

---

- **Libraries**: `i18next`, `i18next-browser-languagedetector`, `react-i18next`.
- **Init file**: `src/i18n.js`.
- **Locale files**: `src/locales/en.json`, `src/locales/es.json`.
- **Language Detection Order**: `['querystring', 'localStorage', 'navigator']`.
- **Stale Language Cache Fix**:
  - Auto-detected cache mismatch fixer runs on load.
  - If a cached language preference in `localStorage` doesn't match the active browser environment (`navigator.language`), the stale key is cleared. This prevents users from getting stuck in a wrong auto-detected locale.
- **Usage**: `const { t, i18n } = useTranslation()` → `t('room.welcome')`.
- **Transcription language**: `i18n.language === 'es' ? 'es-ES' : 'en-US'` passed to `useTranscription`.
- **Dynamic Document Titles**:
  - Sets the browser tab title dynamically depending on the active view:
    - Login: `Login | Presto AI`
    - Admin Dashboard: `Dashboard | Presto AI`
    - Position Detail: `[Job Title] | Presto AI`
    - Live Room: `Interview Room: [Candidate Name] | Presto AI`
    - Session Report: `Report: [Candidate Name] | Presto AI`
- **Rule**: No hardcoded English strings in components — always use a `t()` key.

---

## 12. Favicon & PWA Metadata

- **Favicon files**: All stored in `public/favicon/`.
  - `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`
  - `apple-touch-icon.png`
  - `android-chrome-192x192.png`, `android-chrome-512x512.png`
  - `site.webmanifest`
- **`index.html` links** (in `<head>`):
  ```html
  <link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-32x32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon/favicon-16x16.png" />
  <link rel="manifest" href="/favicon/site.webmanifest" />
  <link rel="shortcut icon" href="/favicon/favicon.ico" />
  ```
- **Root fallback**: `public/favicon.ico` (copy) handles browser default `/favicon.ico` requests.
- **Manifest icon paths**: Use `/favicon/` prefix (e.g. `/favicon/android-chrome-192x192.png`).

---

## 13. Legacy SDET Challenge

- **Route**: `/challenge` — accessible via a shared link (no auth required).
- **Stages**: REST Assured quiz → SQL quiz → Bug Finder → Result.
- **Components**: `QuizChallenge.jsx`, `CodeChallenge.jsx`, `FileTree.jsx`, `CodePanel.jsx`, `Leaderboard.jsx`.
- **Submission**: Final score saved to `leaderboard/{id}`.
- **Status**: Legacy / maintenance mode. Primary product is the live interview platform.

---

## Change Log

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | 2026-07 | Initial spec capturing all features as of project launch |
| 1.1 | 2026-07 | Added: Jitsi migration, mute sync, session auto-completion bug fix, link regeneration modal, favicon, i18n |
| 1.2 | 2026-07 | Added: CV pre-screen analysis integration, date-based session expiry, fullscreen AI loading overlay modal, browser-to-locale sync logic |
| 1.3 | 2026-07 | Added: Premium CSS UI design refresh (ambient floating orbs, pill tabs, glowing inputs/buttons), updated Admin Login header with branding logo, and deployed production Cloudflare AI worker |
