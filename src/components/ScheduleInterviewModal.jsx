import React, { useMemo, useRef, useState } from 'react';
import { db, callAnalyzeCV } from '../firebase';
import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { Upload, CheckCircle, AlertCircle, Loader, X } from 'lucide-react';

const MAX_CV_CHARS = 15_000;

// Returns 'YYYY-MM-DD' in local time
function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Returns Timestamp at 23:59:59 local time on the given 'YYYY-MM-DD' string
function endOfDayTimestamp(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const eod = new Date(y, m - 1, d, 23, 59, 59, 999);
  return Timestamp.fromMillis(eod.getTime());
}

function randomToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

async function extractPdfText(file) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).href;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const textParts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    textParts.push(pageText);
  }
  return textParts.join('\n');
}

export default function ScheduleInterviewModal({ position, currentUser, onClose, onCreated }) {
  const { t } = useTranslation();
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [interviewDate, setInterviewDate] = useState(toLocalDateStr(new Date())); // 'YYYY-MM-DD'
  const [interviewTime, setInterviewTime] = useState('10:00'); // HH:MM, just for display
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const [cvFile, setCvFile]         = useState(null);
  const [cvText, setCvText]         = useState('');
  const [cvAnalysis, setCvAnalysis] = useState(null);
  const [cvStatus, setCvStatus]     = useState('idle');
  const [cvError, setCvError]       = useState(null);
  const fileInputRef = useRef(null);

  const challengeOrder = useMemo(
    () => Array.isArray(position.challenges) ? position.challenges.map(c => c.id) : [],
    [position.challenges]
  );

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === 'application/pdf';
    const isTxt = file.type === 'text/plain' || file.name.endsWith('.txt');
    if (!isPdf && !isTxt) {
      setCvError(t('schedule.cvTypeError'));
      return;
    }
    setCvFile(file);
    setCvError(null);
    setCvAnalysis(null);
    setCvText('');
    setCvStatus('extracting');
    try {
      let text = '';
      if (isPdf) {
        text = await extractPdfText(file);
      } else {
        text = await file.text();
      }
      if (!text.trim()) {
        setCvError(t('schedule.cvEmptyError'));
        setCvStatus('error');
        return;
      }
      const trimmed = text.slice(0, MAX_CV_CHARS);
      setCvText(trimmed);
      setCvStatus('analyzing');
      const analysis = await callAnalyzeCV({
        cvText: trimmed,
        position: position
          ? { title: position.title, seniority: position.seniority, techStack: position.techStack, softSkills: position.softSkills }
          : null,
      });
      setCvAnalysis(analysis);
      setCvStatus('done');
    } catch (err) {
      console.error('CV analysis failed:', err);
      setCvError(err.message || t('schedule.cvAnalysisError'));
      setCvStatus('error');
    }
  };

  const handleRemoveCv = () => {
    setCvFile(null);
    setCvText('');
    setCvAnalysis(null);
    setCvStatus('idle');
    setCvError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!cvText) { setError(t('schedule.cvRequired')); return; }
    setCreating(true);
    setError(null);
    try {
      const interviewerToken = randomToken();
      const candidateToken   = randomToken();
      // Session is valid until end-of-day (23:59:59) on the selected interview date
      const expiresAt = endOfDayTimestamp(interviewDate);
      if (expiresAt.toMillis() < Date.now()) {
        setError(t('schedule.dateInPastError'));
        setCreating(false);
        return;
      }
      const ref = await addDoc(collection(db, 'sessions'), {
        positionId:          position.id,
        positionTitle:       position.title || '',
        candidateName:       name.trim(),
        candidateEmail:      email.trim() || null,
        interviewerId:       currentUser.uid,
        status:              'scheduled',
        phase:               'intro',
        currentQuestionIdx:  0,
        interviewerToken,
        candidateToken,
        candidateAuthUid:    null,
        scheduledAt:         serverTimestamp(),
        interviewDate:       interviewDate,        // 'YYYY-MM-DD' — the intended day
        interviewTime:       interviewTime || null, // 'HH:MM' — display only
        expiresAt,
        startedAt:           null,
        endedAt:             null,
        challengeOrder,
        createdAt:           serverTimestamp(),
        cvText:     cvText || null,
        cvAnalysis: cvAnalysis
          ? {
              summary:           cvAnalysis.summary,
              claimedTechStack:  cvAnalysis.claimedTechStack,
              claimedExperience: cvAnalysis.claimedExperience,
              keyStrengths:      cvAnalysis.keyStrengths,
              redFlags:          cvAnalysis.redFlags,
              questionsToVerify: cvAnalysis.questionsToVerify,
              fitScore:          cvAnalysis.fitScore,
              fitRationale:      cvAnalysis.fitRationale,
            }
          : null,
      });
      const base = window.location.origin;
      const interviewerUrl = `${base}/room?session=${ref.id}&role=interviewer&token=${interviewerToken}`;
      const candidateUrl   = `${base}/room?session=${ref.id}&role=candidate&token=${candidateToken}`;
      setCreated({ id: ref.id, interviewerUrl, candidateUrl, interviewDate });
      onCreated?.(ref.id);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  const isBusy = cvStatus === 'extracting' || cvStatus === 'analyzing';
  const today = toLocalDateStr(new Date());
  const canSubmit = !creating && name.trim() && cvText && !isBusy && interviewDate >= today;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: '"Outfit", "Inter", sans-serif', fontSize: 18, fontWeight: 700, letterSpacing: '-0.03em', color: '#f0f6ff' }}>
              {t('schedule.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={closeBtn}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {!created && (
          <form onSubmit={handleCreate}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
              {t('schedule.forPosition')} <strong style={{ color: 'var(--text-highlight)' }}>{position.title}</strong>
            </p>
            <Field label={t('schedule.candidateNameLabel')}>
              <input
                value={name} onChange={e => setName(e.target.value)} required autoFocus
                style={input} placeholder={t('schedule.candidateNamePlaceholder')}
              />
            </Field>
            <Field label={t('schedule.candidateEmailLabel')}>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                style={input} placeholder={t('schedule.candidateEmailPlaceholder')}
              />
            </Field>

            {/* ── Interview Date & Time ───────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, marginBottom: 12 }}>
              <Field label={t('schedule.interviewDateLabel')}>
                <input
                  type="date"
                  value={interviewDate}
                  min={today}
                  onChange={e => setInterviewDate(e.target.value)}
                  required
                  style={{ ...input, colorScheme: 'dark' }}
                />
                {interviewDate < today && (
                  <div style={{ fontSize: 11, color: 'var(--accent-danger)', marginTop: 3 }}>
                    {t('schedule.dateInPastError')}
                  </div>
                )}
              </Field>
              <Field label={t('schedule.interviewTimeLabel')}>
                <input
                  type="time"
                  value={interviewTime}
                  onChange={e => setInterviewTime(e.target.value)}
                  style={{ ...input, colorScheme: 'dark' }}
                />
              </Field>
            </div>

            <Field label={t('schedule.cvLabel')}>
              {(cvStatus === 'idle' || cvStatus === 'error') ? (
                <label style={uploadZone}>
                  <Upload size={18} style={{ marginBottom: 4, opacity: 0.7 }} />
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('schedule.cvHint')}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>.pdf or .txt</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,application/pdf,text/plain"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                </label>
              ) : (
                <div style={cvStatusBox}>
                  {isBusy && (
                    <>
                      <Loader size={16} style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {cvStatus === 'extracting' ? t('schedule.cvExtracting') : t('schedule.cvAnalyzing')}
                      </span>
                    </>
                  )}
                  {cvStatus === 'done' && cvAnalysis && (
                    <>
                      <CheckCircle size={16} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--accent-success)', fontWeight: 600 }}>
                          {t('schedule.cvAnalyzed')} &mdash; {t('schedule.cvFitScore')}: {cvAnalysis.fitScore}/5
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{cvFile?.name}</div>
                        {cvAnalysis.redFlags?.length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--accent-warning)', marginTop: 4 }}>
                            &#9888; {cvAnalysis.redFlags.length} {t('schedule.cvRedFlags')}
                          </div>
                        )}
                      </div>
                      <button type="button" onClick={handleRemoveCv} style={removeCvBtn}>
                        <X size={14} />
                      </button>
                    </>
                  )}
                </div>
              )}
              {cvError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--accent-danger)' }}>
                  <AlertCircle size={13} /> {cvError}
                </div>
              )}
            </Field>

            <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5, margin: '12px 0' }}>
              {t('schedule.ttlHint2')}
            </p>
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--accent-danger)', color: 'var(--accent-danger)', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
              <button type="button" onClick={onClose} style={btnGhost}>{t('common.cancel')}</button>
              <button type="submit" disabled={!canSubmit} style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.5 }}>
                {creating ? t('schedule.creating') : t('schedule.createSession')}
              </button>
            </div>
          </form>
        )}

        {created && (
          <div>
            <div style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle size={16} style={{ color: '#06b6d4', flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#06b6d4', display: 'block', marginBottom: 2 }}>{t('schedule.success')}</strong>
                <span style={{ color: 'rgba(180,200,240,0.6)', fontSize: 12 }}>
                  {t('schedule.validUntilDate', { date: created.interviewDate })}
                </span>
              </div>
            </div>
            <LinkRow label={t('schedule.candidateLinkLabel')} url={created.candidateUrl} accent="var(--accent-warning)" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <button onClick={() => window.open(created.interviewerUrl, '_blank')} style={btnPrimary}>
                {t('schedule.openRoomBtn')}
              </button>
              <button onClick={onClose} style={btnGhost}>{t('schedule.close')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LinkRow({ label, url, accent }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-main)', border: `1px solid ${accent}33`, borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: '8px 12px' }}>
        <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-highlight)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {url}
        </code>
        <button onClick={copy} style={{ ...btnGhost, padding: '4px 10px', fontSize: 12 }}>
          {copied ? t('schedule.copied') : t('schedule.copy')}
        </button>
      </div>
    </div>
  );
}

export function RegenerateLinkModal({ url, onClose }) {
  const { t } = useTranslation();
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{t('positions.regenerateLinkBtn')}</h3>
          <button onClick={onClose} style={closeBtn}>&#x2715;</button>
        </div>
        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid var(--accent-success)', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
          <strong style={{ color: 'var(--accent-success)' }}>{t('positions.regenerateLinkSuccess')}</strong>
          <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 8 }}>{t('schedule.validFor', { hours: 3 })}</span>
        </div>
        <LinkRow label={t('schedule.candidateLinkLabel')} url={url} accent="var(--accent-warning)" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={btnGhost}>{t('schedule.close')}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.82)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: '20px',
};
const modal = {
  background: '#080f1e',
  border: '1px solid rgba(6,182,212,0.15)',
  borderTop: '2px solid #06b6d4',
  borderRadius: 14,
  padding: '1.75rem',
  width: '100%', maxWidth: 580,
  color: '#f0f6ff',
  boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 60px rgba(6,182,212,0.08)',
  maxHeight: '90vh', overflowY: 'auto',
};
const closeBtn = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'rgba(180,200,240,0.6)',
  width: 32, height: 32,
  borderRadius: 8,
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.18s, color 0.18s',
  flexShrink: 0,
};
const input = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(6,182,212,0.15)',
  borderRadius: 8,
  color: '#f0f6ff',
  fontFamily: 'inherit', fontSize: 14,
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
};
const uploadZone = {
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 4,
  width: '100%', boxSizing: 'border-box',
  padding: '20px 12px',
  background: 'rgba(6,182,212,0.03)',
  border: '1px dashed rgba(6,182,212,0.3)',
  borderRadius: 10, cursor: 'pointer',
  transition: 'border-color 0.2s, background 0.2s',
};
const cvStatusBox = {
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%', boxSizing: 'border-box',
  padding: '10px 12px',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(6,182,212,0.15)',
  borderRadius: 8,
};
const removeCvBtn = {
  background: 'transparent', border: 'none',
  color: 'rgba(180,200,240,0.4)', cursor: 'pointer',
  padding: 4, display: 'flex', alignItems: 'center',
};
const btnPrimary = {
  padding: '10px 22px',
  background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #7c3aed 100%)',
  color: '#fff', border: 'none', borderRadius: 8,
  fontWeight: 700, cursor: 'pointer',
  boxShadow: '0 4px 16px rgba(6,182,212,0.3)',
  transition: 'box-shadow 0.2s ease, opacity 0.2s ease',
};
const btnGhost = {
  padding: '10px 18px',
  background: 'transparent',
  color: 'rgba(180,200,240,0.5)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8, cursor: 'pointer',
  transition: 'color 0.2s, border-color 0.2s',
};

