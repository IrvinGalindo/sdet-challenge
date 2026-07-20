import { Settings, FileText } from 'lucide-react';
import React, { useEffect, useState, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db, callEvaluateSession } from '../firebase';
import { doc, onSnapshot, getDoc, collection, query, orderBy, getDocs, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { useTranslation } from 'react-i18next';
import ConfirmDialog, { useConfirmDialog } from './ConfirmDialog';
import AdminNavbar from './AdminNavbar';
import { useAuth } from '../context/AuthContext';

const Editor = React.lazy(() => import('@monaco-editor/react'));

// ─── Print styles injected once ──────────────────────────────────────────────
const PRINT_STYLE_ID = 'session-report-print-styles';
function injectPrintStyles() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body { background: #fff !important; color: #111 !important; font-family: 'Inter', sans-serif; }
      .no-print { display: none !important; }
      .print-page { max-width: 100% !important; padding: 0 !important; }
      a { color: inherit; text-decoration: none; }
    }
  `;
  document.head.appendChild(style);
}

// Renders the post-interview evaluation report saved at sessions/{id}.report.
// Read-only view used by HR/staff at /admin/sessions/:id.

export default function SessionReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { user, role, authReady } = useAuth();
  const [session, setSession] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [challenges, setChallenges] = useState({});
  const [loading, setLoading] = useState(true);
  const [showRawTranscript, setShowRawTranscript] = useState(false);
  const [position, setPosition] = useState(null);
  const [interviewerInfo, setInterviewerInfo] = useState(null);
  const [closing, setClosing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genStage, setGenStage] = useState('');
  const { dialogProps, openConfirm } = useConfirmDialog();

  useEffect(() => {
    if (authReady && !user) {
      navigate('/login');
    }
  }, [authReady, user, navigate]);

  useEffect(() => {
    if (!authReady || !user || !id) return;
    const unsub = onSnapshot(doc(db, 'sessions', id), snap => {
      if (!snap.exists()) { setLoading(false); return; }
      const data = { id: snap.id, ...snap.data() };
      setSession(data);
      if (data && data.candidateName) {
        document.title = `Report: ${data.candidateName} | Presto AI`;
      }
      setLoading(false);

      // Load related data (challenges from the position, transcript + answers from session).
      if (data.positionId) {
        getDocs(query(collection(db, 'positions', data.positionId, 'challenges'), orderBy('createdAt', 'asc'))).then(s => {
          const map = {};
          s.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
          setChallenges(map);
        }).catch(() => {});
        getDoc(doc(db, 'positions', data.positionId)).then(p => {
          if (p.exists()) setPosition({ id: p.id, ...p.data() });
        }).catch(() => {});
      }

      // Fetch interviewer/reviewer info from users collection
      if (data.interviewerId) {
        getDoc(doc(db, 'users', data.interviewerId)).then(uSnap => {
          if (uSnap.exists()) setInterviewerInfo(uSnap.data());
        }).catch(() => {});
      }
    });

    const tUnsub = onSnapshot(
      query(collection(db, 'sessions', id, 'transcript_chunks'), orderBy('createdAt', 'asc')),
      snap => setTranscript(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const aUnsub = onSnapshot(
      collection(db, 'sessions', id, 'answers'),
      snap => setAnswers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { unsub(); tUnsub(); aUnsub(); };
  }, [user, id]);

  if (loading) return (
    <div className="print-page" style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <div style={{ color: '#fff', padding: '2rem 0' }}>{t('common.loading')}</div>
    </div>
  );
  if (!session) return (
    <div className="print-page" style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <div style={{ color: '#fff', padding: '2rem 0' }}>
        {t('common.noData')} <button onClick={() => navigate('/admin')} style={linkBtn}>{t('report.backToPosition')}</button>
      </div>
    </div>
  );

  const report = session.report;
  const ansByChallenge = Object.fromEntries(answers.map(a => [a.challengeId, a]));

  const formatDateTime = (ts) => {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString(i18n.language === 'es' ? 'es-ES' : 'en-US');
  };

  // ── Export helpers ──────────────────────────────────────────────────────────

  const buildReportHTML = () => {
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const recMap = {
      proceed: { label: t('report.hiringRecommendation.proceed'), color: '#10b981' },
      hold: { label: t('report.hiringRecommendation.hold'), color: '#f59e0b' },
      decline: { label: t('report.hiringRecommendation.decline'), color: '#ef4444' }
    };
    const fitMap = {
      strong_fit: { label: t('report.fitAssessment.strongFit'), color: '#10b981' },
      conditional_fit: { label: t('report.fitAssessment.conditionalFit'), color: '#f59e0b' },
      not_a_fit: { label: t('report.fitAssessment.notAFit'), color: '#ef4444' }
    };
    const scoreColor = { Excellent: '#10b981', Good: '#6366f1', Fair: '#f59e0b', Poor: '#ef4444', 'Not Submitted': '#94a3b8' };
    const scoreLabels = {
      Excellent: t('report.scores.excellent'),
      Good: t('report.scores.good'),
      Fair: t('report.scores.fair'),
      Poor: t('report.scores.poor'),
      'Not Submitted': t('report.scores.notSubmitted')
    };
    const rec = recMap[report.hiringRecommendation] || { label: (report.hiringRecommendation || 'PENDING').toUpperCase(), color: '#94a3b8' };
    const fit = fitMap[report.fitAssessment]        || { label: (report.fitAssessment || '').replace(/_/g,' ').toUpperCase(), color: '#94a3b8' };

    const scoreChip = score => {
      const c = scoreColor[score] || '#94a3b8';
      const label = scoreLabels[score] || score || '—';
      return `<span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:700;background:${c}22;color:${c};letter-spacing:0.5px">${esc(label)}</span>`;
    };

    const buildRadarSVG = (depthMap) => {
      const entries = Object.entries(depthMap);
      const N = entries.length;
      if (N < 3) return '';
      const W = 520, H = 420, cx = W / 2, cy = H / 2, R = 155, maxScore = 5, levels = 5;
      const ang = i => (2 * Math.PI * i / N) - Math.PI / 2;
      const pt  = (i, r) => ({ x: cx + r * Math.cos(ang(i)), y: cy + r * Math.sin(ang(i)) });
      const poly = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z';

      // grid rings
      const rings = Array.from({ length: levels }, (_, l) => {
        const rad = R * (l + 1) / levels;
        return `<path d="${poly(Array.from({ length: N }, (_, i) => pt(i, rad)))}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`;
      }).join('');

      // spoke lines
      const spokes = Array.from({ length: N }, (_, i) => {
        const p = pt(i, R);
        return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(2)}" y2="${p.y.toFixed(2)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>`;
      }).join('');

      // data polygon
      const dataPts = entries.map(([, v], i) => pt(i, R * Math.min(Number(v?.score) || 0, maxScore) / maxScore));
      const dataPath = poly(dataPts);

      // dot markers
      const dots = dataPts.map(p => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="#818cf8" stroke="#c7d2fe" stroke-width="1.5"/>`).join('');

      // labels
      const labels = entries.map(([skill], i) => {
        const p = pt(i, R + 28);
        const anchor = p.x < cx - 8 ? 'end' : p.x > cx + 8 ? 'start' : 'middle';
        return `<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" text-anchor="${anchor}" dominant-baseline="middle" fill="#94a3b8" font-size="11.5" font-family="Inter,'Helvetica Neue',Arial,sans-serif" font-weight="500">${esc(skill)}</text>`;
      }).join('');

      return `
        <div style="background:#0f1629;border-radius:10px;padding:12px;margin-bottom:20px;display:flex;justify-content:center">
          <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%">
            ${rings}
            ${spokes}
            <path d="${dataPath}" fill="#6366f1" fill-opacity="0.35" stroke="#818cf8" stroke-width="2" stroke-linejoin="round"/>
            ${dots}
            ${labels}
          </svg>
        </div>`;
    };

    let challengeHTML = '';
    if (Array.isArray(report.challengePerformance) && report.challengePerformance.length) {
      challengeHTML = report.challengePerformance.map((cp, i) => {
        const ch  = challenges[cp.challengeId];
        const ans = ansByChallenge[cp.challengeId];
        let submissionHTML = '';
        if (ans) {
          if (ans.kind === 'mcq') {
            submissionHTML = `<div class="submission"><span class="sub-label">${esc(t('report.challenge.candidateAnswered'))}</span> <strong>${esc(ans.selectedOption)}</strong> — ${ans.isCorrect ? `<span style="color:#10b981">${esc(t('report.challenge.correct'))}</span>` : `<span style="color:#ef4444">${esc(t('report.challenge.incorrect'))}</span>`}</div>`;
          } else if (ans.kind === 'open') {
            submissionHTML = `<div class="submission"><span class="sub-label">${esc(t('report.challenge.candidateAnswer'))}</span><pre class="ans-pre">${esc(ans.text || '(empty)')}</pre></div>`;
          } else if (ans.kind === 'code') {
            submissionHTML = `<div class="submission"><span class="sub-label">${esc(t('report.challenge.candidateCode'))}</span><pre class="ans-pre code">${esc(ans.text || '(empty)')}</pre></div>`;
          }
        } else {
          submissionHTML = `<div class="submission" style="color:#94a3b8;font-style:italic">${esc(t('report.challenge.notSubmitted'))}</div>`;
        }
        return `
          <div class="challenge-card">
            <div class="challenge-header">
              <span class="challenge-num">${i + 1}</span>
              <strong>${esc(cp.title || ch?.title || `Challenge ${i + 1}`)}</strong>
              <span style="margin-left:auto">${scoreChip(cp.score)}</span>
            </div>
            ${ch?.prompt ? `<div class="challenge-prompt">${esc(ch.prompt)}</div>` : ''}
            ${cp.notes   ? `<div class="challenge-eval"><span class="sub-label">${esc(t('report.challenge.aiEvaluation'))}</span> ${esc(cp.notes)}</div>` : ''}
            ${submissionHTML}
          </div>`;
      }).join('');
    }

    let reviewerName = t('report.reviewerDefaultName', { defaultValue: 'Lopez' });
    let reviewerTitle = t('report.reviewerDefaultTitle', { defaultValue: 'Human Resources Manager' });
    if (interviewerInfo) {
      if (interviewerInfo.email) {
        const emailPrefix = interviewerInfo.email.split('@')[0];
        const nameParts = emailPrefix.split(/[._-]/);
        reviewerName = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      }
      if (interviewerInfo.role) {
        if (interviewerInfo.role === 'superadmin') {
          reviewerTitle = i18n.language === 'es' ? 'Super Administrador' : 'Super Admin Reviewer';
        } else if (interviewerInfo.role === 'admin') {
          reviewerTitle = i18n.language === 'es' ? 'Gerente de Contratación' : 'Hiring Manager';
        } else if (interviewerInfo.role === 'interviewer') {
          reviewerTitle = i18n.language === 'es' ? 'Entrevistador Técnico' : 'Technical Interviewer';
        }
      }
    }

    const recType = report.hiringRecommendation || 'default';
    const recSymbol = rec.label === 'PROCEED' || rec.label === 'PROCEDER' ? '✓' : rec.label === 'DECLINE' || rec.label === 'RECHAZAR' ? '✗' : '⏸';
    const recText = rec.label;
    const fitText = fit.label;
    const formattedDate = formatDateTime(session.reportGeneratedAt || session.endedAt);

    return `<!DOCTYPE html>
<html lang="${i18n.language === 'es' ? 'es' : 'en'}">
<head>
  <meta charset="utf-8"/>
  <title>${[session.positionTitle, session.candidateName].map(s => (s || '').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase()).join('_')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    @page { margin: 0; size: auto; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
    body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 13.5px; color: #1e293b; background: #f8fafc; line-height: 1.65; }

    /* ── Header ── */
    .report-header {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color: #fff;
      padding: 35px 0.75in 30px;
      margin-bottom: 0;
      display: flex; justify-content: space-between; align-items: center; gap: 20px;
      font-family: 'Inter', sans-serif;
    }
    .report-header.decline {
      background: #7f1d1d !important;
      background-image: linear-gradient(135deg, #7f1d1d 0%, #991b1b 50%, #b91c1c 100%) !important;
    }
    .report-header.proceed {
      background: #064e3b !important;
      background-image: linear-gradient(135deg, #064e3b 0%, #065f46 50%, #0f766e 100%) !important;
    }
    .report-header.hold {
      background: #78350f !important;
      background-image: linear-gradient(135deg, #78350f 0%, #d97706 50%, #f59e0b 100%) !important;
    }
    .report-header.default {
      background: #0f172a !important;
      background-image: linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #312e81 100%) !important;
    }
    .reviewer-meta {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: rgba(255, 255, 255, 0.85);
      margin-bottom: 8px;
      font-weight: 700;
    }
    .reviewer-name {
      font-size: 15px;
      font-weight: 800;
      color: #fff;
      display: inline-block;
      margin-right: 8px;
    }
    .reviewer-title {
      font-size: 12px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.75);
    }
    .report-header h1 { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -0.5px; margin-top: 4px; margin-bottom: 4px; line-height: 1.2; }
    .report-header .meta { font-size: 13.5px; color: rgba(255,255,255,0.8); display: flex; gap: 8px; align-items: center; }
    .header-badges { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
    .decision-stamp {
      background: rgba(255, 255, 255, 0.15) !important;
      border: 1px solid rgba(255, 255, 255, 0.35) !important;
      color: #fff !important;
      padding: 5px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .fit-stamp {
      background: rgba(255, 255, 255, 0.22) !important;
      border: 1.5px dashed rgba(255, 255, 255, 0.5) !important;
      color: #fff !important;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 1px;
      text-transform: uppercase;
      white-space: nowrap;
    }

    /* ── Layout ── */
    .page-body { padding: 24px 0.75in 0.65in; }

    /* ── Section cards ── */
    .section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 22px; margin-bottom: 16px; page-break-inside: avoid; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .section-title {
      font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
      color: #6366f1; margin-bottom: 14px; padding-bottom: 10px;
      border-bottom: 2px solid #eef2ff; display: flex; align-items: center; gap: 8px;
    }
    .section-title::before { content: ''; display: inline-block; width: 3px; height: 14px; background: #6366f1; border-radius: 2px; flex-shrink: 0; }

    /* ── Typography ── */
    p { font-size: 13.5px; color: #334155; line-height: 1.7; }
    ul { padding-left: 20px; }
    li { font-size: 13.5px; color: #334155; margin-bottom: 4px; line-height: 1.6; }

    /* ── Grids ── */
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

    /* ── Info cards (soft skills, behavioral) ── */
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
    .card-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 6px; font-weight: 600; }
    .card-value { font-size: 13px; color: #1e293b; line-height: 1.55; }
    .card-score { font-size: 12px; font-weight: 700; color: #6366f1; margin-top: 6px; }

    /* ── Skill rows (technical depth) ── */
    .skill-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; border-left: 3px solid #6366f1; }
    .skill-name { font-size: 13px; font-weight: 600; color: #1e293b; }
    .skill-score { font-size: 12px; font-weight: 700; color: #6366f1; white-space: nowrap; margin-left: 12px; }
    .skill-note { font-size: 11.5px; color: #64748b; margin-top: 3px; line-height: 1.45; }

    /* ── Pros/cons ── */
    .panel { padding: 14px 16px; border-radius: 8px; }
    .panel-pro  { background: #f0fdf4; border-left: 3px solid #10b981; }
    .panel-con  { background: #fef2f2; border-left: 3px solid #ef4444; }
    .panel-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .panel-pro .panel-title  { color: #059669; }
    .panel-con .panel-title  { color: #dc2626; }
    li.pro { color: #065f46; }
    li.con { color: #991b1b; }

    /* ── Challenge cards ── */
    .challenge-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; page-break-inside: avoid; background: #fafbfc; }
    .challenge-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .challenge-num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#818cf8); color: #fff; font-size: 11px; font-weight: 700; flex-shrink: 0; }
    .challenge-title { font-size: 14px; font-weight: 700; color: #0f172a; flex: 1; }
    .challenge-prompt { font-size: 12px; color: #64748b; font-style: italic; margin-bottom: 8px; padding: 6px 10px; background: #f1f5f9; border-radius: 6px; }
    .challenge-eval { font-size: 12.5px; color: #334155; margin-bottom: 8px; line-height: 1.55; padding: 8px 12px; background: #f8fafc; border-radius: 6px; border-left: 2px solid #6366f1; }
    .sub-label { font-weight: 700; color: #475569; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; }
    .submission { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e2e8f0; font-size: 12.5px; }
    pre.ans-pre { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; font-size: 12px; font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace; white-space: pre-wrap; word-break: break-word; margin-top: 6px; color: #1e293b; line-height: 1.55; }
    pre.ans-pre.code { border-left: 3px solid #6366f1; }

    /* ── Score chips ── */
    .score-chip { display: inline-block; padding: 3px 10px; border-radius: 5px; font-size: 11px; font-weight: 700; letter-spacing: 0.4px; }

    /* ── AI Detection ── */
    .ai-section { border-left: 3px solid; }
    .ai-level-badge { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 12px; }
    .ai-signals-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6366f1; margin-bottom: 6px; }
    .ai-signal-list { margin: 0 0 12px; padding-left: 18px; font-size: 13px; color: #334155; line-height: 1.65; }
    .ai-calibration { font-size: 12px; color: #64748b; font-style: italic; padding: 10px 14px; border-left: 3px solid #6366f1; background: #eef2ff; border-radius: 0 6px 6px 0; line-height: 1.55; }

    /* ── Follow-up questions ── */
    .followup-list { list-style: none; padding: 0; }
    .followup-list li { display: flex; gap: 12px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13.5px; }
    .followup-list li:last-child { border-bottom: none; }
    .followup-num { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background: #eef2ff; color: #6366f1; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }

    /* ── Footer ── */
    .footer { margin-top: 32px; padding-top: 14px; border-top: 2px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; letter-spacing: 0.3px; }
    .footer strong { color: #6366f1; }
  </style>
</head>
<body>

  <!-- ── Header ── -->
  <div class="report-header ${recType}">
    <div>
      <div class="reviewer-meta">
        <span class="reviewer-name">${esc(reviewerName)}</span>
        <span class="reviewer-title">${esc(reviewerTitle)} &middot; ${esc(formattedDate)}</span>
      </div>
      <h1>${esc(session.candidateName || 'Candidate')}</h1>
      <div class="meta">
        <span>${esc(session.positionTitle || 'Interview')}</span>
      </div>
    </div>
    <div class="header-badges">
      <div class="decision-stamp">
        <span>${recSymbol}</span> ${esc(recText)}
      </div>
      <div class="fit-stamp">${esc(fitText)}</div>
    </div>
  </div>

  <div class="page-body">

  ${report.executiveSummary ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.executiveSummary'))}</div>
      <p>${esc(report.executiveSummary)}</p>
    </div>` : ''}

  ${report.demonstratedExperience ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.demonstratedExperience'))}</div>
      <p>${esc(report.demonstratedExperience)}</p>
    </div>` : ''}

  ${report.aiUsageDetection ? (() => {
    const ai  = report.aiUsageDetection;
    const lvl = ai.suspicionLevel || 'None';
    const lvlColor = lvl === 'High' ? '#ef4444' : lvl === 'Medium' ? '#f59e0b' : lvl === 'Low' ? '#6366f1' : '#10b981';
    const lvlBg    = lvl === 'High' ? '#fef2f2' : lvl === 'Medium' ? '#fffbeb' : lvl === 'Low' ? '#eef2ff'  : '#f0fdf4';
    const lvlBorder= lvl === 'High' ? '#fca5a5' : lvl === 'Medium' ? '#fcd34d' : lvl === 'Low' ? '#a5b4fc'  : '#6ee7b7';
    return `
    <div class="section ai-section" style="border-left-color:${lvlColor}">
      <div class="section-title">${esc(t('report.sections.aiUsageDetection'))}</div>
      <span class="ai-level-badge" style="background:${lvlBg};color:${lvlColor};border:1px solid ${lvlBorder}">${esc(t(`report.ai.${lvl.toLowerCase()}`, { defaultValue: lvl }).toUpperCase())} ${esc(t('report.ai.suspicion'))}</span>
      ${Array.isArray(ai.signals) && ai.signals.length ? `
        <div class="ai-signals-title">${esc(t('report.ai.signalsDetected'))}</div>
        <ul class="ai-signal-list">${ai.signals.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${ai.evidence ? `<p style="margin-bottom:10px">${esc(ai.evidence)}</p>` : ''}
      ${ai.calibrationNote ? `<div class="ai-calibration">${esc(ai.calibrationNote)}</div>` : ''}
    </div>`;
  })() : ''}

  ${report.technicalDepth && Object.keys(report.technicalDepth).length ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.technicalDepth'))}</div>
      ${buildRadarSVG(report.technicalDepth)}
      ${Object.entries(report.technicalDepth).map(([skill, v]) => `
        <div class="skill-row">
          <div>
            <div class="skill-name">${esc(skill)}</div>
            ${v?.notes ? `<div class="skill-note">${esc(v.notes)}</div>` : ''}
          </div>
          <div class="skill-score">${v?.score ?? '—'} / 5</div>
        </div>`).join('')}
    </div>` : ''}

  ${report.softSkills && Object.keys(report.softSkills).length ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.softSkills'))}</div>
      <div class="grid2">
        ${Object.entries(report.softSkills).map(([skill, v]) => `
          <div class="card">
            <div class="card-label">${esc(skill)}</div>
            <div class="card-value">${esc(v?.notes || '—')}</div>
            <div class="card-score">${v?.score ?? '—'} / 5</div>
          </div>`).join('')}
      </div>
    </div>` : ''}

  ${(report.pros?.length || report.cons?.length) ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.strengthsAndConcerns'))}</div>
      <div class="grid2">
        <div class="panel panel-pro">
          <div class="panel-title">${esc(t('report.sections.strengths'))}</div>
          <ul>${(report.pros || []).map(p => `<li class="pro">+ ${esc(p)}</li>`).join('')}</ul>
        </div>
        <div class="panel panel-con">
          <div class="panel-title">${esc(t('report.sections.concerns'))}</div>
          <ul>${(report.cons || []).map(c => `<li class="con">- ${esc(c)}</li>`).join('')}</ul>
        </div>
      </div>
    </div>` : ''}

  ${report.behavioralIndicators ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.behavioralIndicators'))}</div>
      <div class="grid3">
        ${report.behavioralIndicators.communication  ? `<div class="card"><div class="card-label">${esc(t('report.behavioral.communication'))}</div><div class="card-value">${esc(report.behavioralIndicators.communication)}</div></div>` : ''}
        ${report.behavioralIndicators.problemSolving ? `<div class="card"><div class="card-label">${esc(t('report.behavioral.problemSolving'))}</div><div class="card-value">${esc(report.behavioralIndicators.problemSolving)}</div></div>` : ''}
        ${report.behavioralIndicators.cultureSignals ? `<div class="card"><div class="card-label">${esc(t('report.behavioral.cultureSignals'))}</div><div class="card-value">${esc(report.behavioralIndicators.cultureSignals)}</div></div>` : ''}
      </div>
    </div>` : ''}

  ${challengeHTML ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.challengePerformance'))}</div>
      ${challengeHTML}
    </div>` : ''}

  ${report.fitRationale ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.fitRationale'))}</div>
      <p>${esc(report.fitRationale)}</p>
    </div>` : ''}

  ${Array.isArray(report.followUpQuestions) && report.followUpQuestions.length ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.followUpQuestions'))}</div>
      <ul class="followup-list">
        ${report.followUpQuestions.map((q, i) => `
          <li>
            <span class="followup-num">${i + 1}</span>
            <span>${esc(q)}</span>
          </li>`).join('')}
      </ul>
    </div>` : ''}

  ${report.conclusion ? `
    <div class="section">
      <div class="section-title">${esc(t('report.sections.conclusion'))}</div>
      <p>${esc(report.conclusion)}</p>
    </div>` : ''}

  <div class="footer">
    ${esc(t('report.footer'))} &nbsp;·&nbsp; ${new Date().toLocaleString()}
  </div>

  </div><!-- /page-body -->

</body>
</html>`;
  };

  const handleExportPDF = () => {
    if (!report) return;
    const html = buildReportHTML();

    const slug = s => (s || '').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
    const filename = `${slug(session.positionTitle)}_${slug(session.candidateName)}`;

    const originalTitle = document.title;
    document.title = filename;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;';
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    iframe.contentWindow.focus();
    iframe.contentWindow.onload = () => {
      iframe.contentWindow.print();
      
      const restoreTitle = () => {
        document.title = originalTitle;
        try {
          document.body.removeChild(iframe);
        } catch (e) {}
        window.removeEventListener('focus', restoreTitle);
      };
      
      window.addEventListener('focus', restoreTitle);
      setTimeout(restoreTitle, 5000);
    };
  };

  const handleHireAndClose = async () => {
    if (!position) {
      await openConfirm({
        title: t('common.loading'),
        message: t('positions.noPositions'),
        confirmLabel: 'OK',
        cancelLabel: null,
        variant: 'warning',
      });
      return;
    }
    if (position.status === 'closed') return;
    const ok = await openConfirm({
      title: t('report.hireConfirmTitle', { name: session.candidateName }),
      message: t('report.hireConfirmMessage', { title: position.title }),
      confirmLabel: t('report.hireConfirmBtn'),
      cancelLabel: t('common.cancel'),
      variant: 'warning',
    });
    if (!ok) return;
    setClosing(true);
    try {
      const others = await getDocs(query(collection(db, 'sessions'), where('positionId', '==', position.id)));
      const updates = others.docs.map(d =>
        updateDoc(d.ref, { outcome: d.id === session.id ? 'selected' : 'not_selected' })
      );
      updates.push(updateDoc(doc(db, 'positions', position.id), {
        status: 'closed',
        closedAt: serverTimestamp(),
        selectedSessionId: session.id,
        selectedCandidateName: session.candidateName || null,
      }));
      await Promise.all(updates);
    } catch (e) {
      openConfirm({
        title: 'Error',
        message: 'Failed to close position: ' + e.message,
        confirmLabel: 'OK',
        cancelLabel: null,
        variant: 'danger',
      });
    } finally {
      setClosing(false);
    }
  };

  const handleDiscardCandidate = async () => {
    const ok = await openConfirm({
      title: t('report.discardConfirmTitle', { name: session.candidateName }),
      message: t('report.discardConfirmMessage', { name: session.candidateName }),
      confirmLabel: t('report.discardConfirmBtn'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    setClosing(true);
    try {
      await updateDoc(doc(db, 'sessions', session.id), { outcome: 'rejected' });
    } catch (e) {
      openConfirm({
        title: 'Error',
        message: 'Failed to discard candidate: ' + e.message,
        confirmLabel: 'OK',
        cancelLabel: null,
        variant: 'danger',
      });
    } finally {
      setClosing(false);
    }
  };

  const handleGenerateReport = async () => {
    if (generating) return;
    setGenerating(true);
    setGenStage('evaluating');
    try {
      const challengeList = Object.values(challenges).map(c => ({
        id: c.id, kind: c.kind, title: c.title, prompt: c.prompt,
        rubric: c.rubric || '', language: c.language || null,
      }));
      const transcriptList = transcript.map(c => ({ speaker: c.speaker, text: c.text }));
      const answersList = answers;

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

      setGenStage('saving');
      await updateDoc(doc(db, 'sessions', id), {
        report,
        reportGeneratedAt: serverTimestamp(),
      });
      // session listener will pick up the new report automatically
    } catch (e) {
      console.error('Generate report failed:', e);
      openConfirm({
        title: 'Generation failed',
        message: 'Could not generate the report: ' + (e.message || 'unknown error'),
        confirmLabel: 'OK',
        cancelLabel: null,
        variant: 'danger',
      });
    } finally {
      setGenerating(false);
      setGenStage('');
    }
  };

  let reviewerName = t('report.reviewerDefaultName', { defaultValue: 'Lopez' });
  let reviewerTitle = t('report.reviewerDefaultTitle', { defaultValue: 'Human Resources Manager' });
  if (interviewerInfo) {
    if (interviewerInfo.email) {
      const emailPrefix = interviewerInfo.email.split('@')[0];
      const nameParts = emailPrefix.split(/[._-]/);
      reviewerName = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }
    if (interviewerInfo.role) {
      if (interviewerInfo.role === 'superadmin') {
        reviewerTitle = i18n.language === 'es' ? 'Super Administrador' : 'Super Admin Reviewer';
      } else if (interviewerInfo.role === 'admin') {
        reviewerTitle = i18n.language === 'es' ? 'Gerente de Contratación' : 'Hiring Manager';
      } else if (interviewerInfo.role === 'interviewer') {
        reviewerTitle = i18n.language === 'es' ? 'Entrevistador Técnico' : 'Technical Interviewer';
      }
    }
  }

  const recType = report?.hiringRecommendation || 'default';
  const recSymbol = recType === 'proceed' ? '✓' : recType === 'decline' ? '✗' : '⏸';
  const recLabel = recType === 'proceed' ? t('report.hiringRecommendation.proceed') : recType === 'decline' ? t('report.hiringRecommendation.decline') : t('report.hiringRecommendation.hold');
  
  const fitType = report?.fitAssessment || 'none';
  const fitLabel = fitType === 'strong_fit' ? t('report.fitAssessment.strongFit') : fitType === 'conditional_fit' ? t('report.fitAssessment.conditionalFit') : t('report.fitAssessment.notAFit');

  let bannerBg = 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #312e81 100%)';
  if (recType === 'decline') {
    bannerBg = 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 60%, #b91c1c 100%)';
  } else if (recType === 'proceed') {
    bannerBg = 'linear-gradient(135deg, #064e3b 0%, #065f46 60%, #0f766e 100%)';
  } else if (recType === 'hold') {
    bannerBg = 'linear-gradient(135deg, #78350f 0%, #d97706 60%, #f59e0b 100%)';
  }

  const formattedDate = formatDateTime(session.reportGeneratedAt || session.endedAt);

  return (
    <div className="print-page" style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: 16 }}>
        <button onClick={() => navigate(`/admin/positions/${session.positionId}`)} style={linkBtn}>
          {t('report.backToPosition')}
        </button>

        {report && (
          <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              id="export-pdf-btn"
              onClick={handleExportPDF}
              title="Print / Save report as PDF"
              style={{
                padding: '8px 14px', background: 'var(--accent-primary)', color: '#fff',
                border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12,
                cursor: 'pointer', fontFamily: 'var(--font-ui)',
                transition: 'background 0.15s, transform 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-primary)'; e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              {t('report.exportPDF')}
            </button>

            {position && position.status !== 'closed' && session.outcome !== 'rejected' && (
              <>
                <button
                  onClick={handleDiscardCandidate}
                  disabled={closing}
                  style={{
                    padding: '8px 14px', background: 'var(--accent-danger, #ef4444)', color: '#fff',
                    border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12,
                    cursor: closing ? 'wait' : 'pointer',
                    transition: 'background 0.15s, transform 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-danger-hover, #dc2626)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-danger, #ef4444)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  {closing ? t('report.discarding') : t('report.discardCandidate')}
                </button>

                <button
                  onClick={handleHireAndClose}
                  disabled={closing}
                  style={{
                    padding: '8px 14px', background: 'var(--accent-success)', color: '#fff',
                    border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12,
                    cursor: closing ? 'wait' : 'pointer',
                    transition: 'background 0.15s, transform 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-success-hover)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-success)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  {closing ? t('report.closing') : t('report.hireAndClose')}
                </button>
              </>
            )}

            {position?.selectedSessionId === session.id && (
              <span style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 12, background: 'rgba(16,185,129,0.18)', color: 'var(--accent-success)', letterSpacing: 0.5 }}>
                {t('report.hired')}
              </span>
            )}

            {session.outcome === 'rejected' && (
              <span style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 12, background: 'rgba(239,68,68,0.18)', color: 'var(--accent-danger)', letterSpacing: 0.5 }}>
                {t('report.discarded')}
              </span>
            )}
          </div>
        )}
      </div>

      {report ? (
        <div style={{
          background: bannerBg,
          borderRadius: 12,
          padding: '24px 32px',
          marginBottom: '2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          border: '1px solid rgba(255,255,255,0.08)'
        }}>
          <div>
            <div style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              color: 'rgba(255, 255, 255, 0.85)',
              fontWeight: 700,
              marginBottom: 4
            }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginRight: 8 }}>{reviewerName}</span>
              {reviewerTitle} &middot; {formattedDate}
            </div>
            <h1 style={{ margin: '4px 0', fontSize: 32, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.2 }}>
              {session.candidateName || 'Candidate'}
            </h1>
            <div style={{ color: 'rgba(255, 255, 255, 0.75)', fontSize: 15, fontWeight: 500 }}>
              {session.positionTitle || 'Interview'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div style={{
              background: 'rgba(255, 255, 255, 0.15)',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              color: '#fff',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <span>{recSymbol}</span> {recLabel}
            </div>
            <div style={{
              background: 'rgba(255, 255, 255, 0.22)',
              border: '1.5px dashed rgba(255, 255, 255, 0.5)',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap'
            }}>
              {fitLabel}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '1rem 0 2rem', gap: 16 }}>
          <div>
            <h1 style={{ margin: '0 0 4px', color: '#fff' }}>{session.candidateName || 'Candidate'}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {session.positionTitle || 'Interview'} &middot;
              <span style={{ marginLeft: 6 }}>{formattedDate}</span>
            </div>
          </div>
        </div>
      )}

      {!report ? (
        <div style={emptyCard}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>
            {generating ? <Settings size={16} className="animate-spin" style={{ animation: 'vc-spin 1.5s linear infinite' }} /> : <FileText size={16} />}
          </div>
          <strong style={{ fontSize: 16 }}>
            {generating
              ? (genStage === 'saving' ? t('report.savingReport') : t('report.generatingReport'))
              : t('report.noReportYet')}
          </strong>
          <div style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
            {generating
              ? t('report.runningAiEval')
              : session.status === 'completed'
                ? t('report.sessionCompletedNoReport')
                : t('report.evalRunsAutomatically')}
          </div>
          {!generating && session.status === 'completed' && (
            <button
              onClick={handleGenerateReport}
              style={{
                marginTop: 20,
                padding: '10px 24px',
                background: 'var(--accent-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                transition: 'background 0.2s, transform 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-primary)'; e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Settings size={14} /> {t('report.generateReport')}</span>
            </button>
          )}
          {generating && (
            <div style={{
              marginTop: 20,
              width: 32, height: 32,
              border: '3px solid var(--border-color)',
              borderTopColor: 'var(--accent-primary)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <>
          {/* Top: summary + fit assessment */}
          <CollapsibleSection title={t('report.sections.executiveSummary')} headerExtra={<FitBadge value={report.fitAssessment} />}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{report.executiveSummary}</p>
          </CollapsibleSection>

          {report.demonstratedExperience && (
            <CollapsibleSection title={t('report.sections.demonstratedExperience')}>
              <p style={{ margin: 0, lineHeight: 1.6 }}>{report.demonstratedExperience}</p>
            </CollapsibleSection>
          )}

          {report.aiUsageDetection && (
            <CollapsibleSection
              title={t('report.sections.aiUsageDetection')}
              headerExtra={
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 4, letterSpacing: 0.5,
                  background: report.aiUsageDetection.suspicionLevel === 'High' ? 'rgba(239,68,68,0.15)'
                            : report.aiUsageDetection.suspicionLevel === 'Medium' ? 'rgba(245,158,11,0.15)'
                            : report.aiUsageDetection.suspicionLevel === 'Low' ? 'rgba(99,102,241,0.15)'
                            : 'rgba(16,185,129,0.15)',
                  color: report.aiUsageDetection.suspicionLevel === 'High' ? '#ef4444'
                       : report.aiUsageDetection.suspicionLevel === 'Medium' ? '#f59e0b'
                       : report.aiUsageDetection.suspicionLevel === 'Low' ? 'var(--accent-primary)'
                       : '#10b981',
                }}>
                  {t(`report.ai.${report.aiUsageDetection.suspicionLevel?.toLowerCase()}`, { defaultValue: report.aiUsageDetection.suspicionLevel }).toUpperCase()} {t('report.ai.suspicion')}
                </span>
              }
            >
              {Array.isArray(report.aiUsageDetection.signals) && report.aiUsageDetection.signals.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    {t('report.ai.signalsDetected')}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6, fontSize: 13 }}>
                    {report.aiUsageDetection.signals.map((s, i) => (
                      <li key={i} style={{ marginBottom: 4, color: 'var(--text-highlight)' }}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {report.aiUsageDetection.evidence && (
                <p style={{ margin: '0 0 12px', lineHeight: 1.6, color: 'var(--text-highlight)', fontSize: 14 }}>
                  {report.aiUsageDetection.evidence}
                </p>
              )}

              {report.aiUsageDetection.calibrationNote && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderLeft: '3px solid var(--accent-primary)', borderRadius: '0 4px 4px 0' }}>
                  {report.aiUsageDetection.calibrationNote}
                </div>
              )}
            </CollapsibleSection>
          )}

          {/* Technical depth radar */}
          {report.technicalDepth && Object.keys(report.technicalDepth).length > 0 && (
            <CollapsibleSection title={t('report.sections.technicalDepth')}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 1fr', gap: 24, alignItems: 'center', marginTop: 12 }}>
                <div style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={Object.entries(report.technicalDepth).map(([skill, v]) => ({
                      skill, score: Number(v?.score) || 0,
                    }))}>
                      <PolarGrid stroke="var(--border-color)" />
                      <PolarAngleAxis dataKey="skill" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Radar dataKey="score" stroke="var(--accent-primary)" fill="var(--accent-primary)" fillOpacity={0.3} />
                      <Tooltip
                        contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: '#fff', fontSize: 12 }}
                        labelStyle={{ color: 'var(--text-highlight)' }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(report.technicalDepth).map(([skill, v]) => (
                    <div key={skill} style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 6, padding: '8px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong style={{ fontSize: 13 }}>{skill}</strong>
                        <span style={{ fontSize: 12, color: 'var(--accent-primary)', fontWeight: 700 }}>{v?.score ?? '—'} / 5</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{v?.notes}</div>
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* Pros/cons */}
          {(report.pros?.length || report.cons?.length) && (
            <CollapsibleSection title={t('report.sections.strengthsAndConcerns')}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                <BulletPanel title={t('report.sections.strengths')} items={report.pros} accent="var(--accent-success)" />
                <BulletPanel title={t('report.sections.concerns')}  items={report.cons} accent="var(--accent-danger)" />
              </div>
            </CollapsibleSection>
          )}

          {/* Behavioral */}
          {report.behavioralIndicators && (
            <CollapsibleSection title={t('report.sections.behavioralIndicators')}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
                <BehaviorCard label={t('report.behavioral.communication')}   text={report.behavioralIndicators.communication} />
                <BehaviorCard label={t('report.behavioral.problemSolving')} text={report.behavioralIndicators.problemSolving} />
                <BehaviorCard label={t('report.behavioral.cultureSignals')} text={report.behavioralIndicators.cultureSignals} />
              </div>
            </CollapsibleSection>
          )}

          {/* Soft Skills */}
          {report.softSkills && Object.keys(report.softSkills).length > 0 && (
            <CollapsibleSection title={t('report.sections.softSkills')}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginTop: 12 }}>
                {Object.entries(report.softSkills).map(([skill, v]) => (
                  <div key={skill} style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 6, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <strong style={{ fontSize: 14 }}>{skill}</strong>
                      <span style={{ fontSize: 13, color: 'var(--accent-primary)', fontWeight: 700 }}>{v?.score ?? '—'} / 5</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-highlight)', lineHeight: 1.5 }}>{v?.notes}</div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Challenge performance */}
          {Array.isArray(report.challengePerformance) && report.challengePerformance.length > 0 && (
            <CollapsibleSection title={t('report.sections.challengePerformance')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {report.challengePerformance.map((cp, i) => {
                  const ch  = challenges[cp.challengeId];
                  const ans = ansByChallenge[cp.challengeId];
                  return (
                    <div key={cp.challengeId || i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '12px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <strong style={{ fontSize: 14 }}>{cp.title || ch?.title || `Challenge ${i + 1}`}</strong>
                        <ScoreBadge score={cp.score} />
                      </div>
                      {ch?.prompt && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0', fontStyle: 'italic' }}>{ch.prompt}</div>
                      )}
                      {cp.notes && <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>{cp.notes}</div>}
                      {ans && ch && (
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--accent-primary)' }}>{t('report.challenge.showSubmission', { defaultValue: 'Show submission' })}</summary>
                          <div style={{ marginTop: 8 }}>
                            {ans.kind === 'mcq' && (
                              <div style={{ fontSize: 13 }}>{t('report.challenge.candidateAnswered')} <strong>{ans.selectedOption}</strong> — {ans.isCorrect ? t('report.challenge.correct') : t('report.challenge.incorrect')}</div>
                            )}
                            {ans.kind === 'open' && (
                              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, background: 'var(--bg-main)', padding: 10, borderRadius: 4 }}>{ans.text}</pre>
                            )}
                            {ans.kind === 'code' && (
                              <div style={{ height: 240, border: '1px solid var(--border-color)', borderRadius: 4, overflow: 'hidden' }}>
                                <Suspense fallback={<div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 13 }}>Loading editor…</div>}>
                                  <Editor
                                    height="240px"
                                    language={ans.language || ch.language || 'javascript'}
                                    value={ans.text || ''}
                                    theme="vs-dark"
                                    options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, automaticLayout: true, scrollBeyondLastLine: false, wordWrap: 'on' }}
                                  />
                                </Suspense>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}

          {/* Fit rationale + follow-ups */}
          {report.fitRationale && (
            <CollapsibleSection title={t('report.sections.fitRationale')}>
              <p style={{ margin: 0, lineHeight: 1.6 }}>{report.fitRationale}</p>
            </CollapsibleSection>
          )}

          {Array.isArray(report.followUpQuestions) && report.followUpQuestions.length > 0 && (
            <CollapsibleSection title={t('report.sections.followUpQuestions')}>
              <ul style={{ margin: 0, paddingLeft: 22, lineHeight: 1.7 }}>
                {report.followUpQuestions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            </CollapsibleSection>
          )}

          {/* Bias audit — Phase 6 */}
          {session.biasAudit && <BiasAuditSection audit={session.biasAudit} />}

          {report.conclusion && (
            <CollapsibleSection
              title={t('report.sections.conclusion')}
              accentLeft="linear-gradient(to bottom, var(--accent-primary), #A855F7)"
              style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.08) 100%)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                boxShadow: '0 8px 32px 0 rgba(99, 102, 241, 0.08)'
              }}
            >
              <p style={{
                margin: 0,
                lineHeight: 1.65,
                fontSize: '14.5px',
                color: '#e2e8f0',
                fontWeight: 500
              }}>
                {report.conclusion}
              </p>
            </CollapsibleSection>
          )}
        </>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function CollapsibleSection({ title, headerExtra = null, defaultExpanded = true, style = {}, accentLeft = null, children }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const containerStyle = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    marginBottom: 16,
    overflow: 'hidden',
    position: 'relative',
    ...style
  };

  return (
    <div style={containerStyle}>
      {accentLeft && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '4px',
          height: '100%',
          background: accentLeft
        }} />
      )}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.25rem 1.5rem',
          cursor: 'pointer',
          userSelect: 'none',
          background: 'rgba(255, 255, 255, 0.01)',
          transition: 'background 0.2s',
          paddingLeft: accentLeft ? '1.75rem' : '1.5rem',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.01)'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
            {title}
          </h2>
          {headerExtra}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          ▼
        </span>
      </div>

      {expanded && (
        <div style={{
          padding: accentLeft ? '1rem 1.5rem 1.25rem 1.75rem' : '1rem 1.5rem 1.25rem 1.5rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.04)'
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Section({ children }) {
  return <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '1.25rem 1.5rem', marginBottom: 16 }}>{children}</div>;
}

function BiasAuditSection({ audit }) {
  const { t, i18n } = useTranslation();
  const overall = audit.overall || 'clean';
  const flags = Array.isArray(audit.flags) ? audit.flags : [];
  const tone = {
    clean:               { bg: 'rgba(16,185,129,0.15)', fg: 'var(--accent-success)', label: t('report.bias.noBiasedLanguageLabel') },
    minor_concerns:      { bg: 'rgba(245,158,11,0.15)', fg: 'var(--accent-warning)', label: t('report.bias.minorConcernsLabel') },
    rewrite_recommended: { bg: 'rgba(239,68,68,0.15)',  fg: 'var(--accent-danger)',  label: t('report.bias.rewriteRecommendedLabel') },
  }[overall] || { bg: 'rgba(148,163,184,0.15)', fg: 'var(--text-muted)', label: overall.toUpperCase() };

  return (
    <CollapsibleSection
      title={t('report.sections.biasAudit')}
      headerExtra={
        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 12, background: tone.bg, color: tone.fg, letterSpacing: 0.5 }}>
          {tone.label}
        </span>
      }
    >
      {flags.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          {t('report.bias.noBiasDetected')}
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
            {t(flags.length === 1 ? 'report.bias.passagesFlagged' : 'report.bias.passagesFlagged_plural', { count: flags.length })}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {flags.map((f, i) => (
              <div key={i} style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderLeft: `3px solid ${tone.fg}`, borderRadius: '0 6px 6px 0', padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: tone.fg, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  {f.section || 'report'}
                </div>
                <blockquote style={{ margin: '0 0 8px', padding: '6px 10px', borderLeft: '2px solid var(--text-muted)', background: 'rgba(0,0,0,0.2)', fontSize: 13, fontStyle: 'italic', lineHeight: 1.5 }}>
                  "{f.excerpt}"
                </blockquote>
                {f.issue && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
                    <strong style={{ color: tone.fg }}>{i18n.language === 'es' ? 'Problema:' : 'Issue:'}</strong> {f.issue}
                  </div>
                )}
                {f.suggestion && (
                  <div style={{ fontSize: 12, color: 'var(--text-highlight)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--accent-success)' }}>{i18n.language === 'es' ? 'Sugerencia:' : 'Suggestion:'}</strong> {f.suggestion}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}

function BulletPanel({ title, items, accent }) {
  return (
    <div style={{ background: 'var(--bg-main)', borderLeft: `3px solid ${accent}`, padding: '10px 14px', borderRadius: '0 6px 6px 0' }}>
      <strong style={{ color: accent, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</strong>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
        {(items || []).map((p, i) => <li key={i} style={{ fontSize: 13 }}>{p}</li>)}
      </ul>
    </div>
  );
}

function BehaviorCard({ label, text }) {
  return (
    <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 6, padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{text || '—'}</div>
    </div>
  );
}

function FitBadge({ value }) {
  const { t } = useTranslation();
  const m = {
    strong_fit:      { bg: 'rgba(16,185,129,0.18)', fg: 'var(--accent-success)', label: t('report.fitAssessment.strongFit') },
    conditional_fit: { bg: 'rgba(245,158,11,0.18)', fg: 'var(--accent-warning)', label: t('report.fitAssessment.conditionalFit') },
    not_a_fit:       { bg: 'rgba(239,68,68,0.18)',  fg: 'var(--accent-danger)',  label: t('report.fitAssessment.notAFit') },
  };
  const c = m[value] || { bg: 'rgba(148,163,184,0.18)', fg: 'var(--text-muted)', label: (value || 'PENDING').toUpperCase() };
  return <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 12, background: c.bg, color: c.fg, letterSpacing: 0.5 }}>{c.label}</span>;
}

function RecommendationBadge({ value }) {
  const { t } = useTranslation();
  const m = {
    proceed: { bg: 'rgba(16,185,129,0.18)', fg: 'var(--accent-success)', label: t('report.hiringRecommendation.proceed'), icon: '✓' },
    hold:    { bg: 'rgba(245,158,11,0.18)', fg: 'var(--accent-warning)', label: t('report.hiringRecommendation.hold'),    icon: '⏸' },
    decline: { bg: 'rgba(239,68,68,0.18)',  fg: 'var(--accent-danger)',  label: t('report.hiringRecommendation.decline'), icon: '✗' },
  };
  const c = m[value] || m.hold;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 8, background: c.bg, color: c.fg, border: `1px solid ${c.fg}` }}>
      <span style={{ fontSize: 16 }}>{c.icon}</span>
      <span>{t('report.recommendationLabel')} {c.label}</span>
    </div>
  );
}

function ScoreBadge({ score }) {
  const { t } = useTranslation();
  const m = {
    Excellent:        { bg: 'rgba(16,185,129,0.18)', fg: 'var(--accent-success)', label: t('report.scores.excellent', { defaultValue: 'Excellent' }) },
    Good:             { bg: 'rgba(99,102,241,0.18)', fg: 'var(--accent-primary)', label: t('report.scores.good', { defaultValue: 'Good' }) },
    Fair:             { bg: 'rgba(245,158,11,0.18)', fg: 'var(--accent-warning)', label: t('report.scores.fair', { defaultValue: 'Fair' }) },
    Poor:             { bg: 'rgba(239,68,68,0.18)',  fg: 'var(--accent-danger)',  label: t('report.scores.poor', { defaultValue: 'Poor' }) },
    'Not Submitted':  { bg: 'rgba(148,163,184,0.18)', fg: 'var(--text-muted)',    label: t('report.scores.notSubmitted', { defaultValue: 'Not Submitted' }) },
  };
  const c = m[score] || { bg: 'rgba(148,163,184,0.18)', fg: 'var(--text-muted)', label: score };
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4, background: c.bg, color: c.fg, letterSpacing: 0.5 }}>{c.label || '—'}</span>;
}

const sectionTitle = { margin: 0, fontSize: 17, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 };
const linkBtn = { background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' };
const emptyCard = { background: 'var(--bg-card)', border: '1px dashed var(--border-color)', borderRadius: 10, padding: '2rem', textAlign: 'center' };
