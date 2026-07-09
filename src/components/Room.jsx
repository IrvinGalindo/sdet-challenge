import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'; import {
  Mic, MicOff, Video, VideoOff, PhoneOff, AlertTriangle, RefreshCw,
  Ban, CheckCircle2, User, Mail, Clock, Bot, Zap, Briefcase, Camera, VolumeX, Check, X
} from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { auth, db, callLiveSuggestion, callCustomPrompt, callEvaluateSession, callBiasAudit } from '../firebase';
import {
  doc, onSnapshot, updateDoc, getDoc, setDoc, collection, addDoc,
  query, orderBy, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import Editor from '@monaco-editor/react';
import { useTranslation } from 'react-i18next';
import ChallengeRunner from './ChallengeRunner';
import { useTranscription } from './useTranscription';
import TranscriptStream from './TranscriptStream';
import AISuggestions from './AISuggestions';
import MicPermissionDialog from './MicPermissionDialog';
import ConfirmDialog, { useConfirmDialog } from './ConfirmDialog';
import CandidateQAPhase from './CandidateQAPhase';
import { RegenerateLinkModal } from './ScheduleInterviewModal';

const SUGGESTION_INTERVAL_MS = 90_000; // 90 seconds
const SUGGESTION_MIN_CHUNKS = 4;      // need at least this many chunks since last call

// Live interview room. Single component that reads role + token from the URL,
// validates against sessions/{id}, and renders the appropriate panel.
//   /room?session=<id>&role=interviewer&token=<...>
//   /room?session=<id>&role=candidate  &token=<...>
//
// Auth model: candidates sign in anonymously and "claim" the session.
// Interviewers must already be signed in as staff.

export default function Room() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const sessionId = searchParams.get('session');
  const role = searchParams.get('role');
  const token = searchParams.get('token');

  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [challenges, setChallenges] = useState([]);
  const [answers, setAnswers] = useState({}); // { challengeId: answerDoc }
  const [transcript, setTranscript] = useState([]);     // chronological chunks
  const [suggestions, setSuggestions] = useState([]);   // newest first
  const [position, setPosition] = useState(null);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(true);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [customBusy, setCustomBusy] = useState(false);
  const [customQuestion, setCustomQuestion] = useState('');
  const [micGateDismissed, setMicGateDismissed] = useState(false);
  const [questions, setQuestions] = useState([]);  // position interview questions
  const [regeneratedUrl, setRegeneratedUrl] = useState(null);
  const [meetingMuted, setMeetingMuted] = useState(false);
  const { dialogProps, openConfirm } = useConfirmDialog();


  // ── Auth bootstrap ─────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        setAuthReady(true);
      } else if (role === 'candidate') {
        // Candidates auto sign in anonymously.
        try {
          await signInAnonymously(auth);
        } catch (e) {
          let msg = e.message || 'unknown error';
          if (e.code === 'auth/admin-restricted-operation' || e.code === 'auth/operation-not-allowed') {
            msg = 'Anonymous sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method → Anonymous.';
          }
          setError(t('room.couldNotJoin', { message: msg }));
          setAuthReady(true);
          setLoading(false);
        }
      } else {
        // Interviewer must be signed in. Bounce to login.
        setAuthReady(true);
        setError(t('room.signInRequired'));
        setLoading(false);
      }
    });
    return () => unsub();
  }, [role]);

  // ── Validate URL + load session ────────────────────────────────────────────
  useEffect(() => {
    if (!authReady || !user) return;
    if (!sessionId || !role || !token) {
      setError(t('room.invalidRoomLink'));
      setLoading(false);
      return;
    }
    if (role !== 'interviewer' && role !== 'candidate') {
      setError(t('room.unknownRole', { role }));
      setLoading(false);
      return;
    }

    const ref = doc(db, 'sessions', sessionId);
    const unsub = onSnapshot(ref, async (snap) => {
      if (!snap.exists()) {
        setError(t('room.sessionNotFound'));
        setLoading(false);
        return;
      }
      const data = { id: snap.id, ...snap.data() };

      // Token check
      const expected = role === 'interviewer' ? data.interviewerToken : data.candidateToken;
      if (!expected || token !== expected) {
        setError(t('room.invalidToken'));
        setLoading(false);
        return;
      }

      // Expiry check
      const expMs = data.expiresAt?.toMillis?.();
      if (expMs && Date.now() > expMs) {
        setError(t('room.linkExpired'));
        setLoading(false);
        return;
      }

      // Candidate claim flow
      if (role === 'candidate') {
        if (!data.candidateAuthUid) {
          try {
            await updateDoc(ref, {
              candidateAuthUid: user.uid,
              status: 'live',
              startedAt: serverTimestamp(),
            });
          } catch (e) {
            setError(t('room.couldNotJoin', { message: e.message }));
            setLoading(false);
            return;
          }
        } else if (data.candidateAuthUid !== user.uid) {
          setError(t('room.sessionClaimed'));
          setLoading(false);
          return;
        }
      } else if (role === 'interviewer' && data.status === 'scheduled') {
        // Optional: nudge to live when interviewer opens the room.
        try { await updateDoc(ref, { status: data.status === 'completed' ? 'completed' : 'live' }); } catch { }
      }

      setSession(data);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setError(t('room.failedToReadSession', { message: err.message }));
      setLoading(false);
    });

    return () => unsub();
  }, [authReady, user, sessionId, role, token]);

  // ── Load challenges + position metadata ────────────────────────────────────
  // Challenges are readable by both sides. Position metadata is staff-only
  // (and only used by the AI suggestion prompt on the interviewer side), so
  // we skip the position fetch for candidates.
  useEffect(() => {
    if (!session?.positionId) return;
    const cUnsub = onSnapshot(
      query(collection(db, 'positions', session.positionId, 'challenges'), orderBy('createdAt', 'asc')),
      snap => setChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.warn('Challenges listener:', err.code, err.message)
    );

    // Load interview questions for both sides (candidate needs to see them).
    const qUnsub = onSnapshot(
      query(collection(db, 'positions', session.positionId, 'questions'), orderBy('createdAt', 'asc')),
      snap => setQuestions(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.warn('Questions listener:', err.code, err.message)
    );

    let cancelled = false;
    if (role === 'interviewer') {
      getDoc(doc(db, 'positions', session.positionId)).then(snap => {
        if (!cancelled && snap.exists()) setPosition({ id: snap.id, ...snap.data() });
      }).catch(err => console.warn('Position fetch:', err.code, err.message));
    }
    return () => { cancelled = true; cUnsub(); qUnsub(); };
  }, [session?.positionId, role]);

  // ── Live transcript stream (both sides subscribe) ──────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(
      query(collection(db, 'sessions', sessionId, 'transcript_chunks'), orderBy('createdAt', 'asc'), limit(500)),
      snap => setTranscript(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.warn('Transcript listener:', err.code, err.message)
    );
    return () => unsub();
  }, [sessionId]);

  // ── AI suggestions stream (interviewer only — rules block candidates) ─────
  useEffect(() => {
    if (!sessionId || role !== 'interviewer') return;
    const unsub = onSnapshot(
      query(collection(db, 'sessions', sessionId, 'suggestions'), orderBy('createdAt', 'desc'), limit(20)),
      snap => setSuggestions(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.warn('Suggestions listener:', err.code, err.message)
    );
    return () => unsub();
  }, [sessionId, role]);

  // ── Video left state ────────────────────────────────────────────────────────
  // Set to true by the VideoCall component's onLeft callback when the local
  // user hangs up. Immediately unmounts the panel so no stale video UI lingers.
  const [videoLeft, setVideoLeft] = useState(false);

  useEffect(() => {
    if (session?.status === 'live') setVideoLeft(false);
  }, [session?.status]);



  // ── Listen to answers ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'answers'),
      snap => {
        const map = {};
        snap.docs.forEach(d => { const data = d.data(); if (data.challengeId) map[data.challengeId] = { id: d.id, ...data }; });
        setAnswers(map);
      },
      err => console.warn('Answers listener:', err.code, err.message)
    );
    return () => unsub();
  }, [sessionId]);

  // ── Order challenges per session.challengeOrder if available ───────────────
  const orderedChallenges = useMemo(() => {
    if (!challenges.length) return [];
    if (!session?.challengeOrder?.length) return challenges;
    const byId = Object.fromEntries(challenges.map(c => [c.id, c]));
    const ordered = session.challengeOrder.map(id => byId[id]).filter(Boolean);
    // Append any challenges added after the session was scheduled.
    challenges.forEach(c => { if (!session.challengeOrder.includes(c.id)) ordered.push(c); });
    return ordered;
  }, [challenges, session?.challengeOrder]);

  // ── Transcription (Web Speech API on each side) ────────────────────────────
  const speakerTag = role === 'interviewer' ? 'interviewer' : 'candidate';
  const handleFinalChunk = useCallback(async (text) => {
    if (!sessionId || !text) return;

    // Normalise text for comparison (lowercase, alphanumeric, no extra spaces)
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const normalizedText = norm(text);
    if (!normalizedText) return;

    // Check for duplicates in the existing transcript state from the other speaker within the last 4s
    const now = Date.now();
    const isDuplicate = transcript.some(chunk => {
      const otherNormalized = norm(chunk.text);
      if (!otherNormalized) return false;

      // Only deduplicate if it's from the other speaker (i.e. echo/cross-talk)
      if (chunk.speaker === speakerTag) return false;

      // 1. Check exact match or substring containment
      let match = (otherNormalized === normalizedText) ||
        (otherNormalized.includes(normalizedText) && normalizedText.length > 5) ||
        (normalizedText.includes(otherNormalized) && otherNormalized.length > 5);

      // 2. Word overlap check if not matched yet
      if (!match) {
        const w1 = normalizedText.split(/\s+/).filter(Boolean);
        const w2 = otherNormalized.split(/\s+/).filter(Boolean);
        if (w1.length >= 2 && w2.length >= 2) {
          const set2 = new Set(w2);
          const common = w1.filter(w => set2.has(w)).length;
          const maxLen = Math.max(w1.length, w2.length);
          if ((common / maxLen) >= 0.7) {
            match = true;
          }
        }
      }

      if (match) {
        // Calculate the chunk age
        let chunkTime = now;
        if (chunk.createdAt) {
          if (typeof chunk.createdAt.toMillis === 'function') {
            chunkTime = chunk.createdAt.toMillis();
          } else if (chunk.createdAt.seconds != null) {
            chunkTime = chunk.createdAt.seconds * 1000;
          } else {
            chunkTime = new Date(chunk.createdAt).getTime();
          }
        }
        // If the duplicate is within 4 seconds, mark as duplicate
        if (Math.abs(now - chunkTime) < 4000) {
          return true;
        }
      }
      return false;
    });

    if (isDuplicate) {
      console.log(`[Speech Debug] Skipped duplicate chunk from other speaker: "${text}"`);
      return;
    }

    console.log(`[Speech Debug] Captured final chunk: "${text}" (Speaker: ${speakerTag})`);
    try {
      console.log(`[Speech Debug] Attempting to write chunk to Firestore...`);
      const docRef = await addDoc(collection(db, 'sessions', sessionId, 'transcript_chunks'), {
        speaker: speakerTag,
        authorUid: user?.uid || null,
        text,
        createdAt: serverTimestamp(),
      });
      console.log(`[Speech Debug] Chunk saved successfully. Doc ID: ${docRef.id}`);
    } catch (e) {
      console.error('[Speech Debug] Firestore write failed:', e.code, e.message);
    }
  }, [sessionId, speakerTag, user, transcript]);

  const transcribe = useTranscription({
    enabled: !!session && session.status !== 'completed' && micGateDismissed && !meetingMuted,
    lang: i18n.language === 'es' ? 'es-ES' : 'en-US',
    onFinalChunk: handleFinalChunk,
  });


  // Auto-dismiss the gate if permission is already granted from a previous visit.
  useEffect(() => {
    console.log(`[Speech Debug] Mic permission state is: ${transcribe.permissionState}`);
    if (transcribe.permissionState === 'granted') {
      console.log(`[Speech Debug] Permission granted. Enabling transcription.`);
      setMicGateDismissed(true);
    }
  }, [transcribe.permissionState]);

  // ── AI suggestion loop (interviewer only) ──────────────────────────────────
  const lastChunkCountAtCallRef = useRef(0);
  const suggestionTickRef = useRef(0);

  useEffect(() => {
    if (role !== 'interviewer' || !position || !sessionId) return;
    if (session?.status === 'completed') return;

    let cancelled = false;

    const tick = async () => {
      // Skip if there aren't enough new chunks since last call.
      const newSinceLast = transcript.length - lastChunkCountAtCallRef.current;
      if (transcript.length === 0 || newSinceLast < SUGGESTION_MIN_CHUNKS) return;

      lastChunkCountAtCallRef.current = transcript.length;
      suggestionTickRef.current += 1;
      const myTick = suggestionTickRef.current;
      setSuggestionBusy(true);

      try {
        const askedTopics = challenges.map(c => c.title).filter(Boolean);
        const recent = transcript.slice(-60).map(c => ({ speaker: c.speaker, text: c.text }));
        const result = await callLiveSuggestion({
          position: {
            title: position.title, seniority: position.seniority,
            techStack: position.techStack, softSkills: position.softSkills,
          },
          transcript: recent,
          askedTopics,
        });

        if (cancelled || myTick !== suggestionTickRef.current) return;

        await addDoc(collection(db, 'sessions', sessionId, 'suggestions'), {
          suggestion: result.suggestion || '',
          topic: result.topic || '',
          priority: result.priority || 'low',
          reasoning: result.reasoning || '',
          model: result._model || null,
          tokensUsed: result._tokensUsed || 0,
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('Live suggestion failed:', e.message || e);
      } finally {
        if (!cancelled) setSuggestionBusy(false);
      }
    };

    const id = setInterval(tick, SUGGESTION_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [role, position, sessionId, session?.status, transcript, challenges]);

  // ── On-demand AI suggestion (interviewer clicks "Ask AI now") ─────────────
  const handleTriggerSuggestion = useCallback(async () => {
    if (suggestionBusy || !position || !sessionId || transcript.length === 0) return;
    setSuggestionBusy(true);
    try {
      const askedTopics = challenges.map(c => c.title).filter(Boolean);
      const recent = transcript.slice(-60).map(c => ({ speaker: c.speaker, text: c.text }));
      const result = await callLiveSuggestion({
        position: {
          title: position.title, seniority: position.seniority,
          techStack: position.techStack, softSkills: position.softSkills,
        },
        transcript: recent,
        askedTopics,
      });
      await addDoc(collection(db, 'sessions', sessionId, 'suggestions'), {
        suggestion: result.suggestion || '',
        topic: result.topic || '',
        priority: result.priority || 'low',
        reasoning: result.reasoning || '',
        model: result._model || null,
        tokensUsed: result._tokensUsed || 0,
        isCustom: false,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('On-demand suggestion failed:', e.message || e);
    } finally {
      setSuggestionBusy(false);
    }
  }, [suggestionBusy, position, sessionId, transcript, challenges]);

  // ── Custom AI prompt (interviewer asks a free-text question) ──────────────
  const handleCustomPrompt = useCallback(async (e) => {
    e.preventDefault();
    const q = customQuestion.trim();
    if (!q || customBusy || !sessionId) return;
    setCustomBusy(true);
    setCustomQuestion('');
    try {
      const recent = transcript.slice(-40).map(c => ({ speaker: c.speaker, text: c.text }));
      const result = await callCustomPrompt({
        question: q,
        transcript: recent,
        position: position
          ? { title: position.title, seniority: position.seniority, techStack: position.techStack }
          : null,
      });
      await addDoc(collection(db, 'sessions', sessionId, 'suggestions'), {
        suggestion: result.answer || '',
        topic: 'Custom prompt',
        priority: 'low',
        reasoning: '',
        question: q,
        model: result._model || null,
        tokensUsed: result._tokensUsed || 0,
        isCustom: true,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('Custom prompt failed:', e.message || e);
    } finally {
      setCustomBusy(false);
    }
  }, [customQuestion, customBusy, sessionId, transcript, position]);

  // ── Phase control (interviewer only) ─────────────────────────────────────
  // phase: 'intro' | 'questions' | 'challenges' — stored on session doc so candidate reacts in real-time.
  const phase = session?.phase || 'intro';
  const currentQIdx = session?.currentQuestionIdx ?? 0;
  const isIntroPhase = phase === 'intro';
  const isQuestionsPhase = phase === 'questions';

  const handleStartQuestions = async () => {
    try {
      await updateDoc(doc(db, 'sessions', sessionId), {
        phase: 'questions',
        currentQuestionIdx: 0,
      });
    } catch (e) {
      console.error('Start questions failed:', e);
    }
  };

  const handleAdvanceQuestion = useCallback(async (newIdx, questionId, answerText) => {
    try {
      // Save the candidate's verbal answer for the current question (accumulated on interviewer side).
      if (questionId && answerText) {
        await addDoc(collection(db, 'sessions', sessionId, 'answers'), {
          challengeId: questionId,
          kind: 'verbal',
          text: answerText,
          candidateAuthUid: session?.candidateAuthUid || null,
          submittedAt: serverTimestamp(),
        });
      }
      await updateDoc(doc(db, 'sessions', sessionId), { currentQuestionIdx: newIdx });
    } catch (e) {
      console.error('Advance question failed:', e);
    }
  }, [sessionId, session?.candidateAuthUid]);

  const handleFinishQA = useCallback(async (lastQuestionId, lastAnswerText) => {
    try {
      if (lastQuestionId && lastAnswerText) {
        await addDoc(collection(db, 'sessions', sessionId, 'answers'), {
          challengeId: lastQuestionId,
          kind: 'verbal',
          text: lastAnswerText,
          candidateAuthUid: session?.candidateAuthUid || null,
          submittedAt: serverTimestamp(),
        });
      }
      await updateDoc(doc(db, 'sessions', sessionId), {
        phase: 'challenges',
        currentQuestionIdx: questions.length,
      });
    } catch (e) {
      console.error('Finish Q&A failed:', e);
    }
  }, [sessionId, session?.candidateAuthUid, questions.length]);

  // ── Save verbal (transcript-based) answer for an interview question ─────────
  const handleVerbalAnswer = useCallback(async (questionId, text) => {
    try {
      await addDoc(collection(db, 'sessions', sessionId, 'answers'), {
        challengeId: questionId,
        kind: 'verbal',
        text: text || '',
        candidateAuthUid: user?.uid || null,
        submittedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('Verbal answer save failed:', e);
    }
  }, [sessionId, user]);

  const handleAnswer = async (challengeId, submission) => {
    try {
      await addDoc(collection(db, 'sessions', sessionId, 'answers'), {
        challengeId,
        candidateAuthUid: user.uid,
        kind: submission.kind,
        selectedOption: submission.selectedOption || null,
        isCorrect: submission.isCorrect ?? null,
        text: submission.text || null,
        language: submission.language || null,
        forensics: submission.forensics || null,
        submittedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('Submit failed', e);
      openConfirm({
        title: t('room.submitError'),
        message: t('room.couldNotSaveAnswer', { message: e.message }),
        confirmLabel: 'OK',
        cancelLabel: null,
        variant: 'danger',
      });
    }
  };

  // ── End interview (interviewer) ────────────────────────────────────────────
  const [ending, setEnding] = useState(false);
  const [endingStage, setEndingStage] = useState(null); // 'closing' | 'evaluating' | 'saving'

  const handleGenerateReport = async () => {
    setEnding(true);
    setEndingStage('evaluating');
    try {
      const answersList = Object.values(answers);
      const transcriptList = transcript.map(c => ({ speaker: c.speaker, text: c.text }));
      const challengeList = orderedChallenges.map(c => ({
        id: c.id, kind: c.kind, title: c.title, prompt: c.prompt, rubric: c.rubric || '', language: c.language || null,
      }));
      const report = await callEvaluateSession({
        position: position
          ? {
            title: position.title, seniority: position.seniority, domain: position.domain,
            techStack: position.techStack, softSkills: position.softSkills
          }
          : { title: session.positionTitle || 'Unknown', seniority: 'unknown' },
        candidateName: session.candidateName,
        transcript: transcriptList,
        answers: answersList,
        challenges: challengeList,
      });

      // 3. Save report on the session doc.
      setEndingStage('saving');
      await updateDoc(doc(db, 'sessions', sessionId), {
        report,
        reportGeneratedAt: serverTimestamp(),
      });

      // 4. Best-effort audit row for the evaluation call.
      try {
        await addDoc(collection(db, 'ai_audit'), {
          promptType: 'evaluate_session',
          createdBy: user.uid,
          sessionId,
          positionId: session.positionId || null,
          tokensUsed: report._tokensUsed || 0,
          model: report._model || null,
          createdAt: serverTimestamp(),
        });
      } catch { }

      // 5. Run bias audit on the generated report (Phase 6).
      // Best-effort — if it fails, the report still saved successfully.
      try {
        setEndingStage('auditing');
        const audit = await callBiasAudit(report);
        await updateDoc(doc(db, 'sessions', sessionId), {
          biasAudit: {
            flags: audit.flags || [],
            overall: audit.overall || 'clean',
            model: audit._model || null,
            generatedAt: serverTimestamp(),
          },
        });
        try {
          await addDoc(collection(db, 'ai_audit'), {
            promptType: 'bias_audit',
            createdBy: user.uid,
            sessionId,
            positionId: session.positionId || null,
            tokensUsed: audit._tokensUsed || 0,
            model: audit._model || null,
            flagCount: (audit.flags || []).length,
            overall: audit.overall || 'clean',
            createdAt: serverTimestamp(),
          });
        } catch { }
      } catch (auditErr) {
        console.warn('Bias audit failed (non-fatal):', auditErr.message || auditErr);
      }

      // 6. Navigate to the report.
      navigate(`/admin/sessions/${sessionId}`);
    } catch (e) {
      console.error('End interview failed:', e);
      const msg = e.message || 'unknown error';
      openConfirm({
        title: t('room.reportGenFailedTitle'),
        message: t('room.reportGenFailed', { message: msg }),
        confirmLabel: 'OK',
        cancelLabel: null,
        variant: 'warning',
      });
      navigate(`/admin/sessions/${sessionId}`);
    } finally {
      setEnding(false);
      setEndingStage('');
    }
  };

  const handleEnd = async () => {
    const ok = await openConfirm({
      title: t('room.endConfirmTitle'),
      message: t('room.endConfirmMessage'),
      note: t('room.endConfirmNote'),
      confirmLabel: t('room.endInterview'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    setEnding(true);
    try {
      setEndingStage('closing');
      await updateDoc(doc(db, 'sessions', sessionId), {
        status: 'completed',
        endedAt: serverTimestamp(),
      });
      await handleGenerateReport();
    } catch (e) {
      console.error(e);
      setError('Failed to end interview: ' + e.message);
      setEnding(false);
    }
  };

  const handleRegenerateLink = async () => {
    const ok = await openConfirm({
      title: t('positions.regenerateLinkConfirmTitle'),
      message: t('positions.regenerateLinkConfirmMessage'),
      confirmLabel: t('positions.regenerateLinkBtn'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const newToken = (() => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID)
          return crypto.randomUUID().replace(/-/g, '');
        return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      })();
      const newExpiry = Timestamp.fromMillis(Date.now() + 3 * 3600 * 1000);
      await updateDoc(doc(db, 'sessions', sessionId), {
        candidateToken: newToken,
        candidateAuthUid: null,
        expiresAt: newExpiry,
      });
      const url = `${window.location.origin}/room?session=${sessionId}&role=candidate&token=${newToken}`;
      try { await navigator.clipboard.writeText(url); } catch { }
      setRegeneratedUrl(url);
    } catch (err) {
      console.error('Regenerate link error:', err);
      setError(t('positions.regenerateLinkError', { message: err.message }));
    }
  };

  // Check error before loading — auth failures can leave loading true.
  if (error) {
    return (
      <Center>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Ban size={36} style={{ color: 'var(--accent-danger)' }} />
          </div>
          <h2 style={{ margin: '0 0 8px' }}>{t('room.cannotEnterRoom')}</h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{error}</p>
          {role === 'interviewer' ? (
            <button onClick={() => navigate('/admin')} style={{ marginTop: 20, padding: '10px 20px', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {t('room.backToDashboardBtn')}
            </button>
          ) : (
            <div style={{ marginTop: 20, padding: '10px 20px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 6, display: 'inline-block' }}>
              {t('room.safelyCloseTab')}
            </div>
          )}
        </div>
      </Center>
    );
  }
  if (loading) {
    return <Center><div style={{ color: 'var(--text-muted)' }}>{t('room.loadingSession')}</div></Center>;
  }
  if (!session) return null;

  const isCandidate = role === 'candidate';
  const isInterviewer = role === 'interviewer';
  const isCompleted = session.status === 'completed';

  return (
    <div style={pageWrap}>
      {/* Top bar */}
      <header style={topBar}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {isInterviewer ? t('room.interviewerRoom') : t('room.candidateRoom')}
          </div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {session.positionTitle || 'Interview'} — {session.candidateName || 'Candidate'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SessionStatus status={session.status} />
          {isInterviewer && !isCompleted && (
            <button
              onClick={handleRegenerateLink}
              title={t('positions.regenerateLinkBtn')}
              style={{
                padding: '6px 12px',
                background: 'rgba(99,102,241,0.12)',
                color: 'var(--accent-primary)',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12,
                display: 'inline-flex', alignItems: 'center', gap: 6,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(99,102,241,0.12)'}
            >
              <RefreshCw size={13} />
              {t('positions.regenerateLinkBtn')}
            </button>
          )}
          {isInterviewer && !isCompleted && (
            <button
              onClick={handleEnd}
              disabled={ending}
              style={{
                padding: '8px 16px',
                background: ending ? 'var(--bg-card)' : 'var(--accent-danger)',
                color: '#fff', border: ending ? '1px solid var(--border-color)' : 'none',
                borderRadius: 6, fontWeight: 700, cursor: ending ? 'wait' : 'pointer',
              }}
            >
              {ending
                ? (endingStage === 'closing' ? t('room.closingSession')
                  : endingStage === 'evaluating' ? t('room.generatingReport')
                    : endingStage === 'saving' ? t('room.savingReport')
                      : endingStage === 'auditing' ? t('room.runningBiasAudit')
                        : t('room.ending'))
                : t('room.endInterview')}
            </button>
          )}
          {isInterviewer && isCompleted && session.report && (
            <button
              onClick={() => navigate(`/admin/sessions/${sessionId}`)}
              style={{
                padding: '8px 16px', background: 'var(--accent-primary)',
                color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer'
              }}
            >
              {t('room.viewReportBtn')}
            </button>
          )}
          {isInterviewer && isCompleted && !session.report && (
            <button
              onClick={handleGenerateReport}
              disabled={ending}
              style={{
                padding: '8px 16px', background: ending ? 'var(--bg-card)' : 'var(--accent-primary)',
                color: '#fff', border: ending ? '1px solid var(--border-color)' : 'none',
                borderRadius: 6, fontWeight: 700, cursor: ending ? 'wait' : 'pointer'
              }}
            >
              {ending
                ? (endingStage === 'evaluating' ? t('room.generatingReport') : t('room.savingReport'))
                : t('room.generateReportBtn')}
            </button>
          )}
        </div>
      </header>

      <div style={{ ...layout, gridTemplateColumns: isCandidate ? '1fr' : 'minmax(0,1.2fr) 580px', maxWidth: '100%', gap: 16 }}>
        {/* Main: candidate workspace OR interviewer view */}
        <main style={mainPanel}>


          {isCandidate && (
            <div style={candidateRoomLayout}>
              {!isCompleted && !ending && sessionId && (
                <div style={candidateVideoCol}>
                  {videoLeft ? (
                    <div style={{
                      background: 'rgba(25, 26, 28, 0.4)',
                      border: '1px dashed var(--border-color)',
                      borderRadius: 12,
                      padding: '24px 16px',
                      fontSize: 14,
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      backdropFilter: 'blur(8px)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
                    }}>
                      <VolumeX size={24} style={{ color: 'var(--text-muted)' }} />
                      <strong style={{ color: 'var(--text-highlight)' }}>{t('room.meetingEnded')}</strong>
                      <span style={{ fontSize: 12 }}>{t('room.meetingEndedDesc')}</span>
                      <button
                        onClick={() => setVideoLeft(false)}
                        style={{
                          marginTop: 8,
                          padding: '6px 14px',
                          background: 'var(--accent-primary)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: '600'
                        }}
                      >
                        Join Video Call
                      </button>
                    </div>

                  ) : (
                    <VideoCall
                      sessionId={sessionId}
                      role="candidate"
                      displayName={session.candidateName || 'Candidate'}
                      remoteDisplayName="Interviewer"
                      onLeft={() => setVideoLeft(true)}
                      onMuteStatusChanged={setMeetingMuted}
                    />

                  )}
                </div>
              )}

              {/* Workspace (below video) */}
              <div style={{ minWidth: 0, flex: 1 }}>
                {isCompleted ? (
                  <div style={{ background: 'rgba(148,163,184,0.1)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 36, textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                      <CheckCircle2 size={48} style={{ color: 'var(--accent-success)' }} />
                    </div>
                    <strong style={{ fontSize: 20 }}>{t('room.interviewEnded')}</strong>
                    <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8 }}>{t('room.closeTab')}</div>
                  </div>
                ) : isIntroPhase ? (
                  <div style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(6,182,212,0.05))', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: 36, textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                      <User size={48} style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <h2 style={{ margin: '0 0 10px', color: 'var(--text-highlight)' }}>{t('room.welcome')}</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: 0, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                      {t('room.interviewerBeginShortly')}
                    </p>
                  </div>
                ) : isQuestionsPhase ? (
                  <CandidateQAPhase
                    questions={questions}
                    currentQIdx={currentQIdx}
                    transcript={transcript}
                  />
                ) : (
                  <>
                    <h2 style={{ margin: '0 0 12px' }}>{t('room.yourChallenges')}</h2>
                    <ChallengeRunner
                      challenges={orderedChallenges}
                      answers={answers}
                      onAnswer={handleAnswer}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {isInterviewer && (
            <>
              {/* ── Interview Script ──────────────────────────────────────── */}
              {isIntroPhase ? (
                <div style={{
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(6,182,212,0.05))',
                  border: '1px solid rgba(99,102,241,0.25)',
                  borderRadius: 14, padding: 32, marginBottom: 24,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
                    <div style={{
                      width: 52, height: 52, borderRadius: 14,
                      background: 'rgba(99,102,241,0.18)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}><Mic size={26} style={{ color: 'var(--accent-primary)' }} /></div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--accent-primary)', textTransform: 'uppercase', marginBottom: 4 }}>SESSION READY</div>
                      <h2 style={{ margin: '0 0 6px', color: 'var(--text-highlight)', fontSize: 20 }}>{t('room.introGreeting')}</h2>
                      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, lineHeight: 1.6 }}>
                        {t('room.introGreetingDesc')}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
                    <div style={{ ...infoChip, display: 'flex', alignItems: 'center' }}><User size={13} style={{ marginRight: 6 }} />{session.candidateName}</div>
                    <div style={{ ...infoChip, display: 'flex', alignItems: 'center' }}><Briefcase size={13} style={{ marginRight: 6 }} />{session.positionTitle}</div>
                    {session.candidateEmail && (
                      <div style={{ ...infoChip, display: 'flex', alignItems: 'center' }}><Mail size={13} style={{ marginRight: 6 }} />{session.candidateEmail}</div>
                    )}
                  </div>
                  <button
                    onClick={handleStartQuestions}
                    style={{
                      padding: '12px 28px',
                      background: 'linear-gradient(135deg, var(--accent-primary), #818cf8)',
                      color: '#fff', border: 'none', borderRadius: 10,
                      fontWeight: 700, cursor: 'pointer', fontSize: 15,
                      boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(99,102,241,0.5)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,0.4)'; }}
                  >
                    {t('room.startInterviewQuestionsBtn')}
                  </button>
                </div>
              ) : questions.length > 0 && (
                <InterviewerScript
                  questions={questions}
                  answers={answers}
                  transcript={transcript}
                  currentQIdx={currentQIdx}
                  phase={phase}
                  onAdvance={handleAdvanceQuestion}
                  onFinishQA={handleFinishQA}
                />
              )}

              {/* ── Candidate challenge progress ──────────────────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '24px 0 8px' }}>
                <h2 style={{ margin: 0 }}>{t('room.candidateProgress')}</h2>
                {orderedChallenges.length > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {Object.keys(answers).length}/{orderedChallenges.length} submitted
                  </span>
                )}
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
                {t('room.candidateProgressDesc')}
              </p>
              {orderedChallenges.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px dashed var(--border-color)', borderRadius: 8, padding: 16, fontSize: 13, textAlign: 'center' }}>{t('room.noChallengesInPosition')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {orderedChallenges.map((c, i) => {
                    const ans = answers[c.id];
                    const kindLabel = c.kind === 'mcq' ? 'MCQ' : c.kind === 'code' ? 'CODE' : 'OPEN';
                    const kindColor = c.kind === 'mcq' ? 'var(--accent-info)' : c.kind === 'code' ? '#a78bfa' : 'var(--accent-warning)';
                    return (
                      <div key={c.id} style={{
                        background: ans ? 'rgba(16,185,129,0.04)' : 'var(--bg-card)',
                        border: `1px solid ${ans ? 'rgba(16,185,129,0.25)' : 'var(--border-color)'}`,
                        borderRadius: 10, padding: '12px 16px',
                        transition: 'border-color 0.3s',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: '2px 6px',
                              borderRadius: 4, background: `${kindColor}22`, color: kindColor,
                            }}>{kindLabel}</span>
                            <strong style={{ fontSize: 13 }}>{i + 1}. {c.title}</strong>
                          </div>
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                            background: ans ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.1)',
                            color: ans ? 'var(--accent-success)' : 'var(--text-muted)',
                          }}>
                            {ans ? '✓ Submitted' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> Pending</span>}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: ans ? 10 : 0 }}>{c.prompt}</div>
                        {ans && (
                          <div style={{ background: 'rgba(0,0,0,0.3)', borderLeft: '3px solid var(--accent-primary)', borderRadius: '0 6px 6px 0', padding: '8px 12px', fontSize: 13 }}>
                            {ans.kind === 'mcq' && (
                              <span>
                                <strong style={{ color: 'var(--text-muted)' }}>Selected: </strong>
                                {ans.selectedOption}{' '}
                                <span style={{ color: ans.isCorrect ? 'var(--accent-success)' : 'var(--accent-danger)', fontWeight: 700 }}>
                                  {ans.isCorrect ? '✔ Correct' : '✘ Incorrect'}
                                </span>
                              </span>
                            )}
                            {ans.kind === 'open' && (
                              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.6 }}>{ans.text}</pre>
                            )}
                            {ans.kind === 'code' && (
                              <div style={{ height: 240, border: '1px solid var(--border-color)', borderRadius: 6, overflow: 'hidden', marginTop: 6 }}>
                                <Editor
                                  height="240px"
                                  language={ans.language || c.language || 'javascript'}
                                  value={ans.text}
                                  theme="vs-dark"
                                  options={{
                                    readOnly: true, minimap: { enabled: false }, fontSize: 12,
                                    fontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
                                    lineNumbers: 'on', scrollBeyondLastLine: false,
                                    automaticLayout: true, wordWrap: 'on', padding: { top: 8, bottom: 8 },
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── AI Suggestions & Co-pilot (Interviewer only, horizontal grid layout) ── */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.05), rgba(6,182,212,0.02))',
                border: '1px solid var(--border-color)',
                borderRadius: 14, padding: 20, marginTop: 32,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
                  {/* Left: AI suggestions list */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginRight: 4 }}><Bot size={16} /></span>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-highlight)', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                          Claude Suggestions
                        </div>
                      </div>
                      <button
                        onClick={handleTriggerSuggestion}
                        disabled={suggestionBusy || transcript.length === 0}
                        style={{
                          padding: '4px 10px', fontSize: 10, fontWeight: 700,
                          background: suggestionBusy || transcript.length === 0 ? 'var(--bg-card)' : 'rgba(99,102,241,0.15)',
                          border: '1px solid rgba(99,102,241,0.35)',
                          color: suggestionBusy || transcript.length === 0 ? 'var(--text-muted)' : 'var(--accent-primary)',
                          borderRadius: 6, cursor: suggestionBusy || transcript.length === 0 ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        {suggestionBusy ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Clock size={14} style={{ animation: 'vc-spin 1.5s linear infinite' }} />
                            Claude is thinking…
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Zap size={14} />
                            Ask Claude now
                          </span>
                        )}
                      </button>
                    </div>

                    <div style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 6 }}>
                      <AISuggestions suggestions={suggestions} busy={suggestionBusy} customBusy={customBusy} />
                    </div>
                  </div>

                  {/* Right: Ask Claude anything form */}
                  <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                          Ask Claude anything
                        </div>
                        {/* Mic status inside form header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                            background: transcribe.permissionState === 'granted' ? 'var(--accent-success)' : 'var(--accent-warning)',
                          }} />
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {transcribe.permissionState === 'granted' ? 'Live Transcribing' : 'Muted'}
                          </span>
                        </div>
                      </div>

                      <form onSubmit={handleCustomPrompt}>
                        <textarea
                          value={customQuestion}
                          onChange={e => setCustomQuestion(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCustomPrompt(e); }}
                          placeholder={'e.g. Evaluate last answer about Docker…\nCtrl+Enter to send'}
                          disabled={customBusy}
                          rows={3}
                          style={{
                            width: '100%', padding: '8px 10px', fontSize: 12,
                            background: 'var(--bg-main)', border: '1px solid var(--border-color)',
                            borderRadius: 8, color: 'var(--text-highlight)', outline: 'none',
                            resize: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                            opacity: customBusy ? 0.5 : 1, boxSizing: 'border-box',
                          }}
                        />
                        <button
                          type="submit"
                          disabled={!customQuestion.trim() || customBusy}
                          style={{
                            marginTop: 8, width: '100%', padding: '8px', fontSize: 12, fontWeight: 700,
                            background: customQuestion.trim() && !customBusy ? 'linear-gradient(135deg, #06b6d4, #0891b2)' : 'var(--bg-card)',
                            border: '1px solid rgba(6,182,212,0.4)',
                            color: customQuestion.trim() && !customBusy ? '#fff' : 'var(--text-muted)',
                            borderRadius: 8, cursor: customQuestion.trim() && !customBusy ? 'pointer' : 'not-allowed',
                            transition: 'all 0.2s',
                          }}
                        >
                          {customBusy ? 'Claude is thinking…' : 'Send to Claude →'}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Session Info Horizontal Footer Bar (Interviewer only) ── */}
              <div style={{
                display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'space-between',
                marginTop: 20, padding: '10px 20px', background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border-color)', borderRadius: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <User size={14} style={{ marginRight: 6 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>CANDIDATE:</span>
                  <span style={{ fontSize: 12, color: 'var(--text-highlight)', fontWeight: 600 }}>{session.candidateName}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Briefcase size={14} style={{ marginRight: 6 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>POSITION:</span>
                  <span style={{ fontSize: 12, color: 'var(--text-highlight)', fontWeight: 600 }}>{session.positionTitle}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block', marginRight: 6 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>STATUS:</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(16,185,129,0.15)', color: 'var(--accent-success)',
                  }}>{session.status?.toUpperCase()}</span>
                </div>
              </div>
            </>
          )}
        </main>

        {/* Sidebar Column 1: Video Call + Live Transcript (Interviewer only) */}
        {isInterviewer && (
          <aside style={{ ...sidePanel, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 'calc(100vh - 100px)', overflowY: 'auto', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.8, textTransform: 'uppercase' }}>
              LIVE VIDEO CALL
            </div>
            {!isCompleted && !ending && !videoLeft && sessionId ? (
              <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-color)', background: '#000', aspectRatio: '16/9', flexShrink: 0 }}>
                <VideoCall
                  sessionId={sessionId}
                  role="interviewer"
                  displayName="Interviewer"
                  remoteDisplayName={session.candidateName || 'Candidate'}
                  onLeft={() => setVideoLeft(true)}
                  onMuteStatusChanged={setMeetingMuted}
                />

              </div>
            ) : (isCompleted || ending || videoLeft) ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', background: 'var(--bg-main)', border: '1px dashed var(--border-color)', borderRadius: 8, padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                <span>Video Call Ended</span>
                {!isCompleted && !ending && (
                  <button
                    onClick={() => setVideoLeft(false)}
                    style={{
                      padding: '4px 10px',
                      background: 'var(--accent-primary)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: '600'
                    }}
                  >
                    Start Call
                  </button>
                )}
              </div>

            ) : (
              <div style={{ background: 'var(--bg-main)', border: '1px dashed var(--border-color)', borderRadius: 8, padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                Connecting to video...
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                  LIVE TRANSCRIPT ({transcript.length})
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                  background: transcribe.listening ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                  color: transcribe.listening ? 'var(--accent-success)' : 'var(--accent-warning)',
                }}>
                  {transcribe.listening ? '● Listening' : '■ Idle'} ({transcribe.permissionState})
                </span>
              </div>
              {!transcribe.supported && (
                <div style={{ fontSize: 10, color: 'var(--accent-danger)' }}>
                  <span><AlertTriangle size={14} style={{ color: '#fbbf24', marginRight: 6, verticalAlign: 'middle' }} /> Web Speech API not supported in this browser. Please use Google Chrome or Edge.</span>
                </div>
              )}
              {transcribe.error && (
                <div style={{ fontSize: 10, color: 'var(--accent-danger)', background: 'rgba(244,63,94,0.08)', padding: '4px 8px', borderRadius: 4, marginTop: 4 }}>
                  <span><AlertTriangle size={14} style={{ color: '#ef4444', marginRight: 6, verticalAlign: 'middle' }} /> speech error: {transcribe.error}</span>
                </div>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 240, overflowY: 'auto' }}>
              <TranscriptStream chunks={transcript} />
            </div>
          </aside>
        )}


      </div>

      {/* Meet-style permission gate — while not granted */}
      {!isCompleted && !micGateDismissed && transcribe.supported &&
        (transcribe.permissionState === 'prompt' || transcribe.permissionState === 'denied' || transcribe.permissionState === 'unknown') && (
          <MicPermissionDialog
            error={transcribe.error}
            onAllow={async () => {
              const ok = await transcribe.requestPermission();
              if (ok) setMicGateDismissed(true);
              // If denied, stay open so the user can retry or skip.
            }}
            onSkip={() => {
              setMicGateDismissed(true);
              setTranscriptionEnabled(false);
            }}
          />
        )}
      <ConfirmDialog {...dialogProps} />
      {regeneratedUrl && (
        <RegenerateLinkModal
          url={regeneratedUrl}
          onClose={() => setRegeneratedUrl(null)}
        />
      )}
    </div>
  );
}



// ─── Sidebar pieces ─────────────────────────────────────────────────────────

function SidebarHeader({ title, mic, muted, onToggleMute }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <MicStatusDot supported={mic.supported} listening={mic.listening} muted={muted} />
        <button onClick={onToggleMute} title={muted ? t('room.sidebar.resumeTranscription') : t('room.sidebar.muteTranscription')}
          style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
          {muted ? t('room.sidebar.mutedText') : t('room.sidebar.liveText')}
        </button>
      </div>
    </div>
  );
}

function MicStatusDot({ supported, listening, muted }) {
  const { t } = useTranslation();
  if (!supported) {
    return <span title={t('room.micStatus.unsupported')} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-muted)' }} />;
  }
  if (muted) {
    return <span title={t('room.micStatus.muted')} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-muted)' }} />;
  }
  return (
    <span
      title={listening ? t('room.micStatus.listening') : t('room.micStatus.idle')}
      style={{
        width: 8, height: 8, borderRadius: '50%',
        background: listening ? 'var(--accent-success)' : 'var(--accent-warning)',
        boxShadow: listening ? '0 0 8px var(--accent-success)' : 'none',
      }}
    />
  );
}

function SectionHeading({ children }) {
  return (
    <h3 style={{ margin: '20px 0 10px', fontSize: 13, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </h3>
  );
}

// ─── InterviewerScript ────────────────────────────────────────────────────────
// Shows the question bank as a script for the interviewer. Tracks which question
// is "current" and shows the candidate's live/saved verbal answer per question.

function InterviewerScript({ questions, answers, transcript, currentQIdx, phase, onAdvance, onFinishQA }) {
  const { t } = useTranslation();
  const total = questions.length;
  const [saving, setSaving] = useState(false);
  const questionStartIdxRef = useRef(0);
  const [candidateText, setCandidateText] = useState('');

  const active = questions[currentQIdx];
  const verbalAnswer = active ? answers[active.id] : null;

  // Re-compute accumulated candidate speech whenever transcript grows or question changes.
  useEffect(() => {
    const chunks = transcript.slice(questionStartIdxRef.current);
    const text = chunks
      .filter(c => c.speaker === 'candidate')
      .map(c => c.text)
      .join(' ')
      .trim();
    setCandidateText(text);
  }, [transcript, currentQIdx]);

  // When advancing, we tell the parent what the new index should be, and the answer text.
  // The parent will save the answer and update the index in Firestore.
  const handleNext = async () => {
    if (!active || saving) return;
    setSaving(true);
    try {
      if (currentQIdx < total - 1) {
        await onAdvance(currentQIdx + 1, active.id, candidateText || '(' + t('report.challenge.notSubmitted') + ')');
        questionStartIdxRef.current = transcript.length;
      } else {
        await onFinishQA(active.id, candidateText || '(' + t('report.challenge.notSubmitted') + ')');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!total) return null;

  // If we are in challenges phase, Q&A is done.
  if (phase === 'challenges') {
    return (
      <div style={{ marginBottom: 28, padding: 16, background: 'rgba(16,185,129,0.1)', border: '1px solid var(--accent-success)', borderRadius: 8 }}>
        <h3 style={{ margin: '0 0 8px', color: 'var(--accent-success)' }}>{t('room.script.qaCompleted')}</h3>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('room.script.qaCompletedDesc')}</span>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('room.script.interviewScript')}</h2>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 4,
          letterSpacing: 0.6, background: 'rgba(245,158,11,0.15)', color: '#fbbf24',
        }}>{t('room.script.verbalQuestions', { count: total })}</span>
      </div>

      {/* Question navigator */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {questions.map((q, i) => {
          const answered = !!answers[q.id];
          const current = i === currentQIdx;
          return (
            <div
              key={q.id}
              title={q.title}
              style={{
                width: 30, height: 30, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: current
                  ? '2px solid var(--accent-primary)'
                  : `1px solid ${answered ? 'var(--accent-success)' : 'var(--border-color)'}`,
                background: answered
                  ? 'rgba(16,185,129,0.15)'
                  : current ? 'rgba(99,102,241,0.15)' : 'var(--bg-card)',
                color: answered
                  ? 'var(--accent-success)'
                  : current ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}
            >
              {answered ? '✓' : i + 1}
            </div>
          );
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={handleNext}
            disabled={saving}
            style={{ ...navBtn, background: currentQIdx === total - 1 ? 'var(--accent-success)' : 'var(--accent-primary)', color: '#fff', border: 'none' }}
          >
            {saving ? t('room.script.saving') : currentQIdx === total - 1 ? t('room.script.finishQaBtn') : t('room.script.nextQuestionBtn')}
          </button>
        </div>
      </div>

      {/* Active question card */}
      {active && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-primary)',
          borderRadius: 10, padding: '1.25rem 1.5rem',
        }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.4 }}>
                {t('room.script.questionProgress', { current: currentQIdx + 1, total })}
                {active.category && ` · ${active.category.toUpperCase()}`}
              </span>
              <h3 style={{ margin: '4px 0 0', fontSize: 16 }}>{active.title}</h3>
            </div>
            {answers[active.id] && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4,
                background: 'rgba(16,185,129,0.15)', color: 'var(--accent-success)', flexShrink: 0,
              }}>✓ {t('room.script.answered')}</span>
            )}
          </div>

          {/* Prompt — this is what the interviewer should ask */}
          <div style={{
            background: 'rgba(99,102,241,0.07)',
            border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 6, padding: '12px 14px', marginBottom: 14,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)', letterSpacing: 0.5, marginBottom: 6 }}>
              {t('room.script.askCandidateLabel')}
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--text-highlight)' }}>
              {active.prompt}
            </p>
          </div>

          {/* Candidate's saved verbal answer */}
          {verbalAnswer ? (
            <div style={{
              background: 'rgba(0,0,0,0.2)',
              borderLeft: '3px solid var(--accent-success)',
              borderRadius: '0 6px 6px 0', padding: '10px 14px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-success)', letterSpacing: 0.5, marginBottom: 6 }}>
                {t('room.script.candidateAnswerLabel')}
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {verbalAnswer.text}
              </p>
            </div>
          ) : (
            /* Live speech preview while candidate is still answering */
            candidateText && (
              <div style={{
                background: 'rgba(0,0,0,0.15)',
                borderLeft: '3px solid var(--accent-warning)',
                borderRadius: '0 6px 6px 0', padding: '10px 14px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', letterSpacing: 0.5, marginBottom: 6 }}>
                  {t('room.script.liveSpeakingLabel')}
                </div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--text-highlight)', fontStyle: 'italic' }}>
                  {candidateText}
                </p>
              </div>
            )
          )}

          {/* Rubric hint */}
          {active.rubric && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                {t('room.script.rubricLabel')}
              </summary>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {active.rubric}
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

const navBtn = {
  padding: '4px 12px', fontSize: 12, fontWeight: 600,
  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
  color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────


function SessionStatus({ status }) {
  const { t } = useTranslation();
  const m = {
    scheduled: { bg: 'rgba(99,102,241,0.18)', fg: 'var(--accent-primary)', label: t('room.status.scheduled') },
    live: { bg: 'rgba(16,185,129,0.18)', fg: 'var(--accent-success)', label: t('room.status.live') },
    completed: { bg: 'rgba(148,163,184,0.18)', fg: 'var(--text-muted)', label: t('room.status.completed') },
  };
  const c = m[status] || { bg: 'rgba(99,102,241,0.18)', fg: 'var(--accent-primary)', label: status };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 12, background: c.bg, color: c.fg, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {c.label || 'scheduled'}
    </span>
  );
}

function SessionMeta({ session }) {
  const { t } = useTranslation();
  const exp = session.expiresAt?.toDate?.();
  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
      <div><strong style={{ color: 'var(--text-highlight)' }}>{t('room.meta.candidate')}</strong> {session.candidateName}</div>
      {session.candidateEmail && <div><strong style={{ color: 'var(--text-highlight)' }}>{t('room.meta.email')}</strong> {session.candidateEmail}</div>}
      <div><strong style={{ color: 'var(--text-highlight)' }}>{t('room.meta.started')}</strong> {session.startedAt?.toDate?.().toLocaleString() || '—'}</div>
      {exp && <div><strong style={{ color: 'var(--text-highlight)' }}>{t('room.meta.expires')}</strong> {exp.toLocaleString()}</div>}
    </div>
  );
}

function Center({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: '#fff' }}>
      {children}
    </div>
  );
}

const pageWrap = { minHeight: '100vh', display: 'flex', flexDirection: 'column', color: '#fff' };
const topBar = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '14px 24px', background: 'var(--bg-panel)',
  borderBottom: '1px solid var(--border-color)',
};
const layout = { flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 24, padding: 24, alignItems: 'start' };
const mainPanel = { minWidth: 0 };
const sidePanel = {
  background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
  borderRadius: 10, padding: '1.25rem', position: 'sticky', top: 24,
};
const infoChip = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', borderRadius: 20, fontSize: 13,
  background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
  color: 'var(--text-highlight)', fontWeight: 500,
};


// Candidate: video on top, workspace below
const candidateRoomLayout = {
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  width: '100%',
  alignItems: 'stretch',
};

const candidateVideoCol = {
  width: '100%',
  maxWidth: 960,
  margin: '0 auto 12px',
  flexShrink: 0,
};


// ─── VideoCall (WebRTC + Firestore signaling) ─────────────────────────────────
//
// Pure WebRTC video call — no third-party service required.
// Signaling (SDP offer/answer + ICE candidates) is exchanged via Firestore
// under:  sessions/{sessionId}/videoRoom/room
//          └── offerCandidates/{id}   (ICE from interviewer)
//          └── answerCandidates/{id}  (ICE from candidate)
//
// The interviewer is the WebRTC "caller"; the candidate is the "callee".
// Google's free STUN servers are used for NAT traversal.
//
// Props
//   sessionId   – Firestore session document ID (used as room key)
//   role        – 'interviewer' | 'candidate'
//   displayName – label shown in the local video tile
//   onLeft      – callback fired when the user clicks Hang Up

function VideoCall({ sessionId, role, displayName, onLeft, onMuteStatusChanged }) {
  const containerRef = useRef(null);
  const jitsiApiRef = useRef(null);
  const [jitsiReady, setJitsiReady] = useState(false);
  const [jitsiError, setJitsiError] = useState('');
  const [activeDomain, setActiveDomain] = useState(null);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const isInterviewer = role === 'interviewer';

  // Keep stable reference to callbacks to prevent iframe from restarting on parent re-renders
  const onLeftRef = useRef(onLeft);
  useEffect(() => {
    onLeftRef.current = onLeft;
  }, [onLeft]);

  const onMuteStatusChangedRef = useRef(onMuteStatusChanged);
  useEffect(() => {
    onMuteStatusChangedRef.current = onMuteStatusChanged;
  }, [onMuteStatusChanged]);


  // 1. Load Jitsi script and check until window.JitsiMeetExternalAPI is a constructor
  useEffect(() => {
    let pollInterval = null;
    let isCancelled = false;

    const checkReady = (domain) => {
      if (typeof window.JitsiMeetExternalAPI === 'function') {
        clearInterval(pollInterval);
        if (!isCancelled) {
          setActiveDomain(domain);
          setJitsiReady(true);
        }
        return true;
      }
      return false;
    };

    if (checkReady('meet.element.io')) {
      return;
    }

    const mirrors = [
      { domain: 'meet.element.io', src: 'https://meet.element.io/external_api.js' },
      { domain: 'meet.jit.si', src: 'https://meet.jit.si/external_api.js' }
    ];

    let timeoutId = null;

    const tryLoadMirror = (index) => {
      if (index >= mirrors.length) {
        if (!isCancelled) {
          setJitsiError('Video conference mirrors took too long to load or are blocked. Please check your network or adblocker settings.');
        }
        return;
      }

      const { domain, src } = mirrors[index];
      console.log(`[VideoCall] Attempting to load Jitsi API script from: ${src}`);

      // Clean up previous script tag with data-jitsi if any
      const existing = document.querySelector('script[data-jitsi]');
      if (existing) {
        existing.remove();
      }

      const script = document.createElement('script');
      script.src = src;
      script.setAttribute('data-jitsi', '1');
      script.async = true;
      document.body.appendChild(script);

      // Start polling for JitsiMeetExternalAPI to become available
      clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (checkReady(domain)) {
          clearTimeout(timeoutId);
        }
      }, 200);

      // Timeout for this specific mirror
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        clearInterval(pollInterval);
        console.warn(`[VideoCall] Timeout loading mirror: ${src}. Trying next mirror...`);
        if (!isCancelled) {
          tryLoadMirror(index + 1);
        }
      }, 10000); // 10 seconds per mirror
    };

    tryLoadMirror(0);

    return () => {
      isCancelled = true;
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  }, [retryTrigger]);

  // 2. Initialize Jitsi once the API constructor is available
  useEffect(() => {
    if (!jitsiReady || !activeDomain || !containerRef.current || !sessionId) return;
    if (typeof window.JitsiMeetExternalAPI !== 'function') return;

    containerRef.current.innerHTML = '';

    const roomDocRef = doc(db, 'sessions', sessionId, 'videoRoom', 'room');
    if (isInterviewer) {
      setDoc(roomDocRef, { interviewerLeft: false }).catch(() => {});
    }

    let api;
    try {
      api = new window.JitsiMeetExternalAPI(activeDomain, {
        roomName: `sdet-challenge-${sessionId}`,
        width: '100%',
        height: '100%',
        parentNode: containerRef.current,
        userInfo: { displayName },
        configOverwrite: {
          prejoinPageEnabled: false,
          startWithAudioMuted: false,
          startWithVideoMuted: true,
          disableDeepLinking: true,
          disableInviteFunctions: true,
          hideConferenceSubject: true,
          toolbarButtons: ['microphone', 'camera', 'hangup', 'tileview', 'settings'],
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          SHOW_BRAND_WATERMARK: false,
          HIDE_INVITE_MORE_HEADER: true,
        },
      });
    } catch (err) {
      console.error('[VideoCall] Failed to initialize Jitsi:', err);
      setJitsiError('Could not start video conference. ' + err.message);
      return;
    }

    jitsiApiRef.current = api;

    api.addEventListener('videoConferenceLeft', async () => {
      if (isInterviewer) {
        try { await updateDoc(roomDocRef, { interviewerLeft: true }); } catch (e) {}
      }
      if (onLeftRef.current) onLeftRef.current();
    });

    api.addEventListener('videoConferenceJoined', async () => {
      try {
        const muted = await api.isAudioMuted();
        console.log(`[VideoCall] Joined conference, initial mute state:`, muted);
        if (onMuteStatusChangedRef.current) {
          onMuteStatusChangedRef.current(muted);
        }
      } catch (e) {
        console.warn('[VideoCall] Failed to check initial mute status on join:', e);
      }
    });

    api.addEventListener('audioMuteStatusChanged', (event) => {
      console.log(`[VideoCall] audioMuteStatusChanged event:`, event.muted);
      if (onMuteStatusChangedRef.current) {
        onMuteStatusChangedRef.current(event.muted);
      }
    });

    return () => {
      try { api.dispose(); } catch (e) {}
      jitsiApiRef.current = null;
    };
  }, [jitsiReady, activeDomain, sessionId, displayName, isInterviewer]);


  // 3. Candidate: listen for interviewer leaving via Firestore
  useEffect(() => {
    if (!sessionId || isInterviewer) return;
    const roomDocRef = doc(db, 'sessions', sessionId, 'videoRoom', 'room');
    const unsub = onSnapshot(roomDocRef, (snap) => {
      if (snap.data()?.interviewerLeft && onLeftRef.current) {
        onLeftRef.current();
      }
    });
    return () => unsub();
  }, [sessionId, isInterviewer]);


  return (
    <div style={{ width: '100%', aspectRatio: '16/9', background: '#111214', position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      {jitsiError ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', gap: 12, padding: 24, zIndex: 10 }}>
          <AlertTriangle size={32} style={{ color: '#fbbf24' }} />
          <p style={{ textAlignment: 'center', fontSize: 13, color: 'rgba(255,255,255,0.7)', maxWidth: 300 }}>{jitsiError}</p>
          <button onClick={() => { setJitsiError(''); setJitsiReady(false); setActiveDomain(null); setRetryTrigger(prev => prev + 1); }} style={{ padding: '8px 18px', borderRadius: 20, border: 'none', background: '#5b5fc7', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Retry
          </button>
        </div>
      ) : !jitsiReady ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, gap: 8, zIndex: 5 }}>
          <RefreshCw size={14} style={{ animation: 'spin 1.5s linear infinite' }} />
          Loading video conference…
        </div>
      ) : null}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}





