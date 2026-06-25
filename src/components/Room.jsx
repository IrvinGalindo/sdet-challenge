import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { auth, db, callLiveSuggestion, callEvaluateSession, callBiasAudit } from '../firebase';
import {
  doc, onSnapshot, updateDoc, getDoc, collection, addDoc,
  query, orderBy, limit, serverTimestamp,
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

const SUGGESTION_INTERVAL_MS  = 90_000; // 90 seconds
const SUGGESTION_MIN_CHUNKS   = 4;      // need at least this many chunks since last call

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
  const role      = searchParams.get('role');
  const token     = searchParams.get('token');

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
  const [micGateDismissed, setMicGateDismissed] = useState(false);
  const [questions, setQuestions] = useState([]);  // position interview questions
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
        try { await updateDoc(ref, { status: data.status === 'completed' ? 'completed' : 'live' }); } catch {}
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
    try {
      await addDoc(collection(db, 'sessions', sessionId, 'transcript_chunks'), {
        speaker:   speakerTag,
        authorUid: user?.uid || null,
        text,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('Transcript write failed:', e.code || e.message);
    }
  }, [sessionId, speakerTag, user]);

  const transcribe = useTranscription({
    enabled: !!session && session.status !== 'completed' && transcriptionEnabled && micGateDismissed,
    onFinalChunk: handleFinalChunk,
  });

  // Auto-dismiss the gate if permission is already granted from a previous visit.
  useEffect(() => {
    if (transcribe.permissionState === 'granted') {
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
          topic:      result.topic || '',
          priority:   result.priority || 'low',
          reasoning:  result.reasoning || '',
          model:      result._model || null,
          tokensUsed: result._tokensUsed || 0,
          createdAt:  serverTimestamp(),
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

  // ── Phase control (interviewer only) ─────────────────────────────────────
  // phase: 'intro' | 'questions' | 'challenges' — stored on session doc so candidate reacts in real-time.
  const phase            = session?.phase || 'intro';
  const currentQIdx      = session?.currentQuestionIdx ?? 0;
  const isIntroPhase     = phase === 'intro';
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
          challengeId:      questionId,
          kind:             'verbal',
          text:             answerText,
          candidateAuthUid: session?.candidateAuthUid || null,
          submittedAt:      serverTimestamp(),
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
          challengeId:      lastQuestionId,
          kind:             'verbal',
          text:             lastAnswerText,
          candidateAuthUid: session?.candidateAuthUid || null,
          submittedAt:      serverTimestamp(),
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
        challengeId:      questionId,
        kind:             'verbal',
        text:             text || '',
        candidateAuthUid: user?.uid || null,
        submittedAt:      serverTimestamp(),
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
        isCorrect:      submission.isCorrect ?? null,
        text:           submission.text || null,
        language:       submission.language || null,
        forensics:      submission.forensics || null,
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
          ? { title: position.title, seniority: position.seniority, domain: position.domain,
              techStack: position.techStack, softSkills: position.softSkills }
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
          promptType:  'evaluate_session',
          createdBy:   user.uid,
          sessionId,
          positionId:  session.positionId || null,
          tokensUsed:  report._tokensUsed || 0,
          model:       report._model || null,
          createdAt:   serverTimestamp(),
        });
      } catch {}

      // 5. Run bias audit on the generated report (Phase 6).
      // Best-effort — if it fails, the report still saved successfully.
      try {
        setEndingStage('auditing');
        const audit = await callBiasAudit(report);
        await updateDoc(doc(db, 'sessions', sessionId), {
          biasAudit: {
            flags:   audit.flags || [],
            overall: audit.overall || 'clean',
            model:   audit._model || null,
            generatedAt: serverTimestamp(),
          },
        });
        try {
          await addDoc(collection(db, 'ai_audit'), {
            promptType: 'bias_audit',
            createdBy:  user.uid,
            sessionId,
            positionId: session.positionId || null,
            tokensUsed: audit._tokensUsed || 0,
            model:      audit._model || null,
            flagCount:  (audit.flags || []).length,
            overall:    audit.overall || 'clean',
            createdAt:  serverTimestamp(),
          });
        } catch {}
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

  // ── Render ─────────────────────────────────────────────────────────────────
  // Check error before loading — auth failures can leave loading true.
  if (error) {
    return (
      <Center>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🚫</div>
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

  const isCandidate   = role === 'candidate';
  const isInterviewer = role === 'interviewer';
  const isCompleted   = session.status === 'completed';

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
                ? (endingStage === 'closing'    ? t('room.closingSession')
                  : endingStage === 'evaluating' ? t('room.generatingReport')
                  : endingStage === 'saving'     ? t('room.savingReport')
                  : endingStage === 'auditing'   ? t('room.runningBiasAudit')
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

      <div style={{ ...layout, gridTemplateColumns: isInterviewer ? 'minmax(0,1fr) 320px' : 'minmax(0,1fr)' }}>
        {/* Main: candidate workspace OR interviewer view */}
        <main style={mainPanel}>
          {/* Transcription banner — shown to both while live */}
          {!isCompleted && (
            <MicBanner
              transcribe={transcribe}
              transcriptionEnabled={transcriptionEnabled}
              onToggleMute={() => setTranscriptionEnabled(v => !v)}
            />
          )}

          {isCandidate && (
            <>
              {isCompleted ? (
                <div style={{ background: 'rgba(148,163,184,0.1)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 24, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                  <strong>{t('room.interviewEnded')}</strong>
                  <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 6 }}>{t('room.closeTab')}</div>
                </div>
              ) : isIntroPhase ? (
                <div style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: 32, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>👋</div>
                  <h2 style={{ margin: '0 0 8px', color: 'var(--text-highlight)' }}>{t('room.welcome')}</h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: 0, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                    {t('room.interviewerBeginShortly')}
                  </p>
                </div>
              ) : isQuestionsPhase ? (
                /* ── PHASE 1: Q&A ──────────────────────────────────────────── */
                <CandidateQAPhase
                  questions={questions}
                  currentQIdx={currentQIdx}
                  transcript={transcript}
                />
              ) : (
                /* ── PHASE 2: Challenges ──────────────────────────────────── */
                <>
                  <h2 style={{ margin: '0 0 12px' }}>{t('room.yourChallenges')}</h2>
                  <ChallengeRunner
                    challenges={orderedChallenges}
                    answers={answers}
                    onAnswer={handleAnswer}
                  />
                </>
              )}
            </>
          )}

          {isInterviewer && (
            <>
              {/* ── Interview Script ──────────────────────────────────────── */}
              {isIntroPhase ? (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 24, marginBottom: 24 }}>
                  <h2 style={{ margin: '0 0 12px', color: 'var(--text-highlight)' }}>{t('room.introGreeting')}</h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px', lineHeight: 1.6 }}>
                    {t('room.introGreetingDesc')}
                  </p>
                  <button
                    onClick={handleStartQuestions}
                    style={{
                      padding: '10px 20px', background: 'var(--accent-primary)',
                      color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer',
                      fontSize: 14
                    }}
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
              <h2 style={{ margin: '0 0 8px' }}>{t('room.candidateProgress')}</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
                {t('room.candidateProgressDesc')}
              </p>
              {orderedChallenges.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>{t('room.noChallengesInPosition')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {orderedChallenges.map((c, i) => {
                    const ans = answers[c.id];
                    return (
                      <div key={c.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <strong style={{ fontSize: 14 }}>{i + 1}. {c.title}</strong>
                          <span style={{ fontSize: 11, color: ans ? 'var(--accent-success)' : 'var(--text-muted)' }}>
                            {ans ? t('room.submitted') : t('room.pending')}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>{c.prompt}</div>
                        {ans && (
                          <div style={{ background: 'rgba(0,0,0,0.25)', borderLeft: '3px solid var(--accent-primary)', borderRadius: '0 4px 4px 0', padding: '8px 12px', fontSize: 13 }}>
                            {ans.kind === 'mcq' && <span><strong>{t('room.selected')}</strong> {ans.selectedOption} {ans.isCorrect ? '✓' : '✗'}</span>}
                            {ans.kind === 'open' && <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{ans.text}</pre>}
                            {ans.kind === 'code' && (
                              <div style={{ height: 280, border: '1px solid var(--border-color)', borderRadius: 4, overflow: 'hidden' }}>
                                <Editor
                                  height="280px"
                                  language={ans.language || c.language || 'javascript'}
                                  value={ans.text}
                                  theme="vs-dark"
                                  options={{
                                    readOnly: true,
                                    minimap: { enabled: false },
                                    fontSize: 12,
                                    fontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
                                    lineNumbers: 'on',
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    wordWrap: 'on',
                                    padding: { top: 8, bottom: 8 },
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
            </>
          )}

        </main>

        {/* Sidebar: AI co-pilot (interviewer only) */}
        {isInterviewer && (
          <aside style={sidePanel}>
            <SidebarHeader title="AI Co-pilot" mic={transcribe} muted={!transcriptionEnabled} onToggleMute={() => setTranscriptionEnabled(v => !v)} />
            <AISuggestions suggestions={suggestions} busy={suggestionBusy} />

            <SectionHeading>{t('room.liveTranscript')}</SectionHeading>
            <TranscriptStream chunks={transcript} />

            <SectionHeading>{t('room.video')}</SectionHeading>
            <div style={{ background: 'var(--bg-main)', border: '1px dashed var(--border-color)', borderRadius: 6, padding: 12, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {t('room.videoEmbedPlaceholder')}
            </div>

            <SectionHeading>{t('room.session')}</SectionHeading>
            <SessionMeta session={session} />
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
    </div>
  );
}

// ─── Candidate mic banner ──────────────────────────────────────────────────
// Top-of-page strip that handles all four states cleanly:
//   - prompt    → "Allow microphone" button that opens the browser's prompt
//   - granted   → green confirmation of live transcription with mute/resume
//   - denied    → red banner pointing to the lock icon (browser won't reshow
//                 the prompt; only manual unblock works)
//   - unsupported → fallback message for Firefox / unknown browsers

function MicBanner({ transcribe, transcriptionEnabled, onToggleMute }) {
  const { supported, permissionState } = transcribe;
  const { t } = useTranslation();

  if (!supported) {
    return (
      <div style={{ ...bannerBase, background: 'rgba(148,163,184,0.08)', border: '1px solid var(--border-color)' }}>
        <span>{t('room.micBanner.unsupported')}</span>
      </div>
    );
  }

  // Permission still ungranted — the MicPermissionDialog modal handles it.
  if (permissionState !== 'granted') return null;

  // Granted: show live status with mute toggle and language select.
  return (
    <div style={{
      ...bannerBase,
      background: transcriptionEnabled ? 'rgba(99,102,241,0.08)' : 'rgba(148,163,184,0.08)',
      border: `1px solid ${transcriptionEnabled ? 'rgba(99,102,241,0.4)' : 'var(--border-color)'}`,
    }}>
      <span>
        {transcriptionEnabled
          ? <>🎤 <strong style={{ color: 'var(--accent-primary)' }}>{t('room.micBanner.transcribing')}</strong></>
          : <>{t('room.micBanner.muted')}</>}
      </span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={onToggleMute}
          style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '4px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {transcriptionEnabled ? t('room.micBanner.muteBtn') : t('room.micBanner.resumeBtn')}
        </button>
      </div>
    </div>
  );
}

const bannerBase = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  borderRadius: 6,
  padding: '10px 14px',
  marginBottom: 16,
  fontSize: 13,
};

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
          const current  = i === currentQIdx;
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
    live:      { bg: 'rgba(16,185,129,0.18)', fg: 'var(--accent-success)', label: t('room.status.live') },
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
