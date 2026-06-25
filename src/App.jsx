import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, useSearchParams, Navigate } from 'react-router-dom';
import { FILES, TREES } from './data';
import { QUIZZES } from './quizData';
import { db } from './firebase';
import { collection, addDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import FileTree from './components/FileTree';
import CodePanel from './components/CodePanel';
import ScoreBar from './components/ScoreBar';
import Leaderboard from './components/Leaderboard';
import ResultModal from './components/ResultModal';
import QuizChallenge from './components/QuizChallenge';
import AdminLogin from './components/AdminLogin';
import AdminDashboard from './components/AdminDashboard';
import CandidateProfile from './components/CandidateProfile';
import PositionDetail from './components/PositionDetail';
import Room from './components/Room';
import SessionReport from './components/SessionReport';
import CompareCandidates from './components/CompareCandidates';
import './App.css';

// ─── Helpers ────────────────────────────────────────────────────────────────

function totalBugs(lang) {
  let count = 0;
  Object.values(FILES[lang]).forEach(f => {
    if (f.bugs) count += Object.keys(f.bugs).length;
    if (f.fileBugs) count += Object.keys(f.fileBugs).length;
  });
  TREES[lang].forEach(node => {
    if (node.bugs) count += Object.keys(node.bugs).length;
  });
  return count;
}

async function saveToLeaderboard(entry, candidateId) {
  try {
    if (candidateId) {
      // When updating a pre-registered doc, never overwrite interviewerId with null —
      // the interviewer's UID was already stored at pre-registration time.
      const updateData = { ...entry };
      if (updateData.interviewerId == null) {
        delete updateData.interviewerId;
      }
      await updateDoc(doc(db, 'leaderboard', candidateId), updateData);
    } else {
      await addDoc(collection(db, 'leaderboard'), entry);
    }
  } catch (e) {
    console.error("Error saving to leaderboard", e);
  }
}

// ─── Stages ─────────────────────────────────────────────────────────────────
// 'intro'        → Welcome screen
// 'restassured'  → Quiz 1
// 'sql'          → Quiz 2
// 'bugfinder'    → Bug finder
// 'final'        → Grand finale results
// ────────────────────────────────────────────────────────────────────────────

const STAGE_ORDER = ['intro', 'restassured', 'sql', 'bugfinder', 'final'];
const STAGE_LABELS_EN = {
  restassured: { icon: '🔗', num: 1 },
  sql:         { icon: '🗄️', num: 2 },
  bugfinder:   { icon: '🐛', num: 3 },
};

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<AdminLogin />} />
      <Route path="/challenge" element={<ChallengeFlow />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/admin/candidate/:id" element={<CandidateProfile />} />
      <Route path="/admin/positions/:id" element={<PositionDetail />} />
      <Route path="/room" element={<Room />} />
      <Route path="/admin/sessions/:id" element={<SessionReport />} />
      <Route path="/admin/positions/:id/compare" element={<CompareCandidates />} />
    </Routes>
  );
}

function ChallengeFlow() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const interviewerId = searchParams.get('interviewer');
  const candidateId = searchParams.get('candidateId');

  const [stage, setStage]               = useState('intro');
  const [candidateName, setCandidateName] = useState('');
  const [candidateLoading, setCandidateLoading] = useState(!!candidateId);
  const [showLB, setShowLB]             = useState(false);

  // Scores accumulated across stages
  const [scores, setScores] = useState({
    restassured: null, // { score, total, answers }
    sql:         null,
    bugfinder:   null, // { score, total, wrongN, foundKeys, lang }
  });

  // Bug-finder state
  const [lang, setLang]           = useState('java');
  const [activeFile, setActiveFile] = useState(null);
  const [found,    setFound]      = useState(new Set());
  const [recentBugs, setRecentBugs] = useState(new Set());
  const [wrong,    setWrong]      = useState(new Set());
  const [toast,    setToast]      = useState(null);
  const [bfResult, setBfResult]   = useState(null); // intermediate result modal

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    if (!candidateId) return;
    getDoc(doc(db, 'leaderboard', candidateId))
      .then(snap => {
        if (snap.exists()) {
          setCandidateName(snap.data().name || '');
        }
      })
      .catch(e => console.warn('Could not pre-fetch candidate name (rules may block unauthenticated reads):', e.code))
      .finally(() => setCandidateLoading(false));
  }, [candidateId]);

  const bugTotal = totalBugs(lang);

  // ── Navigation ────────────────────────────────────────────────────────────

  const goNext = () => {
    const idx = STAGE_ORDER.indexOf(stage);
    setStage(STAGE_ORDER[idx + 1]);
  };

  const resetAll = () => {
    setStage('intro');
    setCandidateName('');
    setScores({ restassured: null, sql: null, bugfinder: null });
    setFound(new Set()); setWrong(new Set()); setRecentBugs(new Set());
    setActiveFile(null); setBfResult(null); setLang('java');
  };

  // ── Quiz complete ──────────────────────────────────────────────────────────

  const handleQuizComplete = (quizId, result) => {
    setScores(prev => ({ ...prev, [quizId]: result }));
    goNext();
  };

  // ── Bug-finder actions ─────────────────────────────────────────────────────

  const handleLangChange = (l) => {
    setLang(l); setActiveFile(null);
    setFound(new Set()); setWrong(new Set()); setBfResult(null);
  };

  const handleBugGuess = useCallback((fname, ln, bugDesc) => {
    const key = fname + '-' + ln;
    if (bugDesc) {
      setFound(prev => { const n = new Set(prev); n.add(key); return n; });
      setRecentBugs(prev => { const n = new Set(prev); n.add(key); return n; });
      setTimeout(() => {
        setRecentBugs(prev => { const n = new Set(prev); n.delete(key); return n; });
      }, 6000);
      setToast({ type: 'success', msg: bugDesc });
    } else {
      setWrong(prev => { const n = new Set(prev); n.add(key); return n; });
      setToast({ type: 'error', msg: 'Incorrect — that is not a bug.' });
    }
  }, []);

  const handleBugSubmit = () => {
    const score = found.size;
    const wrongN = wrong.size;
    const foundKeys = Array.from(found);
    const wrongKeys = Array.from(wrong);
    const pct = Math.round((score / bugTotal) * 100);
    const result = { score, total: bugTotal, wrongN, foundKeys, wrongKeys, lang, pct };
    setScores(prev => ({ ...prev, bugfinder: result }));
    setBfResult({ name: candidateName || 'Anonymous', score, wrongN, pct, total: bugTotal, foundKeys, wrongKeys, lang });
  };

  const handleBugFinalize = () => {
    setBfResult(null);
    const finalScores = { ...scores, bugfinder: scores.bugfinder };
    saveFinalToLeaderboard(candidateName, finalScores, lang, interviewerId, candidateId);
    setStage('final');
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const STAGE_LABELS = {
    restassured: { label: t('challenge.stages.restassured'), icon: '🔗', num: 1 },
    sql:         { label: t('challenge.stages.sql'),         icon: '🗄️', num: 2 },
    bugfinder:   { label: t('challenge.stages.bugfinder'),   icon: '🐛', num: 3 },
  };

  if (stage === 'intro') {
    if (candidateLoading) return <div style={{ color: '#fff', padding: '2rem' }}>Loading...</div>;

    return (
      <div className="intro-screen">
        <div className="intro-card">
          <div className="intro-badge">Tech Lead Assessment</div>
          <h1 className="intro-title">SDET Challenge</h1>
          <p className="intro-desc">
            A three-stage technical evaluation covering API testing, database queries,
            and live code review. Complete all stages to receive your final score.
          </p>

          <div className="intro-stages">
            {Object.entries(STAGE_LABELS).map(([id, s]) => (
              <div className="intro-stage-row" key={id}>
                <span className="intro-stage-num">{s.num}</span>
                <span className="intro-stage-icon">{s.icon}</span>
                <span className="intro-stage-label">{s.label}</span>
              </div>
            ))}
          </div>

          {candidateId ? (
            // Pre-registered candidate: name comes from DB, no input needed
            <div className="intro-form">
              <p style={{ color: 'var(--text-highlight)', fontWeight: 'bold', marginBottom: '0.5rem', fontSize: '20px' }}>
                {candidateName ? `Welcome, ${candidateName}! 👋` : 'Welcome! 👋'}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '1.5rem' }}>
                Your interviewer has set up this assessment for you. Click below when you're ready to begin.
              </p>
              <button className="submit-btn intro-btn" onClick={goNext}>
                Start Challenge →
              </button>
            </div>
          ) : (
            // Open/public link: candidate must enter their name
            <div className="intro-form">
              <input
                className="candidate-input intro-input"
                value={candidateName}
                onChange={e => setCandidateName(e.target.value)}
                placeholder="Enter your name to begin..."
                onKeyDown={e => e.key === 'Enter' && candidateName.trim() && goNext()}
              />
              <button
                className="submit-btn intro-btn"
                disabled={!candidateName.trim()}
                onClick={goNext}
              >
                Start Challenge →
              </button>
            </div>
          )}

          <button className="link-btn" onClick={() => setShowLB(v => !v)}>
            {showLB ? 'Hide previous results' : '📊 View previous results'}
          </button>
        </div>

        {showLB && (
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 2rem 2rem' }}>
            <Leaderboard onClose={() => setShowLB(false)} />
          </div>
        )}

        <Branding />
      </div>
    );
  }

  // QUIZ STAGES
  if (stage === 'restassured' || stage === 'sql') {
    const currentStage = stage; // capture for closure
    const quiz = QUIZZES[currentStage];
    if (!quiz) return null;
    return (
      <div>
        <StageHeader stage={currentStage} candidateName={candidateName} scores={scores} />
        <QuizChallenge
          key={currentStage}
          quiz={quiz}
          candidateName={candidateName}
          onComplete={(result) => handleQuizComplete(currentStage, result)}
          onBack={null}
        />
        <Branding />
      </div>
    );
  }

  // BUG FINDER
  if (stage === 'bugfinder') {
    return (
      <div className="app">
        <StageHeader stage={stage} candidateName={candidateName} scores={scores} stageLabels={STAGE_LABELS} />

        <div className="header" style={{ marginTop: '0.5rem' }}>
          <h1 className="title">{t('challenge.bugFinderTitle')}</h1>
          <div className="lang-btns">
            <button className={`lang-btn ${lang === 'java' ? 'active' : ''}`} onClick={() => handleLangChange('java')}>Java</button>
            <button className={`lang-btn ${lang === 'js' ? 'active' : ''}`} onClick={() => handleLangChange('js')}>JavaScript</button>
          </div>
        </div>

        <div className="candidate-bar">
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>👤 <strong style={{ color: 'var(--text-highlight)' }}>{candidateName}</strong></span>
          <button className="submit-btn finish" onClick={handleBugSubmit}>{t('challenge.submitScore')}</button>
          <button className="link-btn" onClick={() => setShowLB(v => !v)}>
            {showLB ? t('challenge.hideResultsBtn') : t('challenge.viewResultsBtn')}
          </button>
        </div>

        <ScoreBar found={found.size} wrong={wrong.size} remaining={bugTotal - found.size} />
        <p className="hint">{t('challenge.hint')}</p>

        <div className="layout">
          <FileTree lang={lang} trees={TREES} activeFile={activeFile} found={found} recentBugs={recentBugs} wrong={wrong} files={FILES} onSelect={setActiveFile} onGuess={handleBugGuess} />
          <CodePanel lang={lang} activeFile={activeFile} files={FILES} found={found} recentBugs={recentBugs} wrong={wrong} onGuess={handleBugGuess} />
        </div>

        {showLB && <Leaderboard onClose={() => setShowLB(false)} />}

        {bfResult && (
          <ResultModal
            result={bfResult}
            onClose={() => setBfResult(null)}
            onReset={() => { setBfResult(null); setFound(new Set()); setWrong(new Set()); }}
            customAction={{ label: t('challenge.finishFinalScore'), onClick: handleBugFinalize }}
          />
        )}

        {toast && (
          <div className={`toast-alert ${toast.type}`}>
            <span className="toast-icon">{toast.type === 'success' ? '✅' : '❌'}</span>
            <span className="toast-msg">{toast.msg}</span>
          </div>
        )}
        <Branding />
      </div>
    );
  }

  // FINAL RESULTS
  if (stage === 'final') {
    return <FinalResults scores={scores} candidateName={candidateName} bugLang={lang} onReset={resetAll} />;
  }

  return null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Branding() {
  return (
    <div className="branding-container">
      <img src="/created_with.png" alt="Signature" className="signature-img" />
    </div>
  );
}

function StageHeader({ stage, candidateName, scores, stageLabels }) {
  const { t } = useTranslation();
  const LABELS = stageLabels || {
    restassured: { label: t('challenge.stages.restassured'), icon: '🔗', num: 1 },
    sql:         { label: t('challenge.stages.sql'),         icon: '🗄️', num: 2 },
    bugfinder:   { label: t('challenge.stages.bugfinder'),   icon: '🐛', num: 3 },
  };
  const steps = ['restassured', 'sql', 'bugfinder'];
  return (
    <div className="stage-header">
      <div className="stage-steps">
        {steps.map((s, i) => {
          const info = LABELS[s];
          const isDone = scores[s] !== null;
          const isCurrent = s === stage;
          return (
            <div key={s} className={`stage-step ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}`}>
              <div className="stage-step-num">{isDone ? '✓' : info.num}</div>
              <span className="stage-step-label">{info.icon} {info.label}</span>
              {i < steps.length - 1 && <div className="stage-step-connector" />}
            </div>
          );
        })}
      </div>
      <span className="stage-candidate">👤 {candidateName}</span>
    </div>
  );
}

function FinalResults({ scores, candidateName, bugLang, onReset }) {
  const { t } = useTranslation();
  const raScore  = scores.restassured ? scores.restassured.score : 0;
  const raTotal  = scores.restassured ? scores.restassured.total : QUIZZES.restassured.questions.length;
  const sqlScore = scores.sql ? scores.sql.score : 0;
  const sqlTotal = scores.sql ? scores.sql.total : QUIZZES.sql.questions.length;
  const bfScore  = scores.bugfinder ? scores.bugfinder.score : 0;
  const bfTotal  = scores.bugfinder ? scores.bugfinder.total : 1;

  const grandTotal = raTotal + sqlTotal + bfTotal;
  const grandScore = raScore + sqlScore + bfScore;
  const grandPct = Math.round((grandScore / grandTotal) * 100);

  const grade =
    grandPct >= 90 ? { label: t('finalResults.grades.exceptional'), color: '#10B981', emoji: '🏆' } :
    grandPct >= 75 ? { label: t('finalResults.grades.strong'),       color: '#3B82F6', emoji: '⭐' } :
    grandPct >= 55 ? { label: t('finalResults.grades.average'),      color: '#F59E0B', emoji: '📊' } :
                     { label: t('finalResults.grades.needsReview'),  color: '#EF4444', emoji: '📚' };

  const breakdown = [
    { label: t('challenge.stages.restassured'), icon: '🔗', score: raScore,  total: raTotal,  pct: Math.round((raScore/raTotal)*100) },
    { label: t('challenge.stages.sql'),         icon: '🗄️', score: sqlScore, total: sqlTotal, pct: Math.round((sqlScore/sqlTotal)*100) },
    { label: t('challenge.stages.bugfinder'),   icon: '🐛', score: bfScore,  total: bfTotal,  pct: Math.round((bfScore/bfTotal)*100) },
  ];

  return (
    <div className="final-screen">
      <div className="final-card">
        <div className="final-grade-emoji">{grade.emoji}</div>
        <h1 className="final-title">{t('finalResults.title')}</h1>
        <p className="final-name">{t('finalResults.resultsFor')} <strong>{candidateName}</strong></p>

        <div className="final-score-ring">
          <svg viewBox="0 0 120 120" width="160" height="160">
            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border-color)" strokeWidth="8" />
            <circle
              cx="60" cy="60" r="52" fill="none"
              stroke={grade.color} strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 52}`}
              strokeDashoffset={`${2 * Math.PI * 52 * (1 - grandPct / 100)}`}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dashoffset 1s ease' }}
            />
            <text x="60" y="54" textAnchor="middle" fill="white" fontSize="22" fontWeight="800" fontFamily="monospace">{grandPct}%</text>
            <text x="60" y="72" textAnchor="middle" fill="#94A3B8" fontSize="10" fontFamily="monospace">{grandScore}/{grandTotal}</text>
          </svg>
        </div>

        <div className="final-grade-badge" style={{ color: grade.color, borderColor: grade.color }}>
          {grade.label}
        </div>

        <div className="final-breakdown">
          {breakdown.map(b => (
            <div key={b.label} className="final-breakdown-row">
              <span className="fb-icon">{b.icon}</span>
              <span className="fb-label">{b.label}</span>
              <div className="fb-bar-track">
                <div className="fb-bar-fill" style={{ width: `${b.pct}%`, background: b.pct >= 75 ? '#10B981' : b.pct >= 50 ? '#F59E0B' : '#EF4444' }} />
              </div>
              <span className="fb-score">{b.score}/{b.total} <span className="fb-pct">({b.pct}%)</span></span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

function saveFinalToLeaderboard(name, scores, bugLang, interviewerId, candidateId) {
  const raTotal  = QUIZZES.restassured.questions.length;
  const sqlTotal = QUIZZES.sql.questions.length;
  const bfTotal  = scores.bugfinder ? scores.bugfinder.total : 1;
  const grandTotal = raTotal + sqlTotal + bfTotal;

  const raScore  = scores.restassured ? scores.restassured.score : 0;
  const sqlScore = scores.sql ? scores.sql.score : 0;
  const bfScore  = scores.bugfinder ? scores.bugfinder.score : 0;
  const grandScore = raScore + sqlScore + bfScore;

  const entry = {
    interviewerId: interviewerId || null,
    name: name || 'Anonymous',
    score: grandScore,
    total: grandTotal,
    wrongN: scores.bugfinder ? scores.bugfinder.wrongN : 0,
    pct: Math.round((grandScore / grandTotal) * 100),
    lang: `Full Challenge (${bugLang})`,
    type: 'full',
    foundKeys: scores.bugfinder ? scores.bugfinder.foundKeys : [],
    wrongKeys: scores.bugfinder && scores.bugfinder.wrongKeys ? scores.bugfinder.wrongKeys : [],
    date: new Date().toLocaleDateString(),
    breakdown: {
      restassured: { score: raScore, total: raTotal, answers: scores.restassured?.answers },
      sql:         { score: sqlScore, total: sqlTotal, answers: scores.sql?.answers },
      bugfinder:   { score: bfScore, total: bfTotal, foundKeys: scores.bugfinder?.foundKeys, wrongKeys: scores.bugfinder?.wrongKeys },
    }
  };
  saveToLeaderboard(entry, candidateId);
}
