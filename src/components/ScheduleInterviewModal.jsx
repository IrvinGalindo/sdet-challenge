import React, { useMemo, useState } from 'react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';

// Modal that creates a sessions/{id} doc and shows the resulting interviewer
// + candidate links for the HR user to copy.

const SESSION_TTL_HOURS = 3; // matches locked decision #8

function randomToken() {
  // crypto.randomUUID is available in CRA's modern target browsers.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  // Fallback: 24 hex chars from random.
  return Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

export default function ScheduleInterviewModal({ position, currentUser, onClose, onCreated }) {
  const { t } = useTranslation();
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null); // { id, interviewerUrl, candidateUrl }

  const challengeOrder = useMemo(
    () => Array.isArray(position.challenges) ? position.challenges.map(c => c.id) : [],
    [position.challenges]
  );

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const interviewerToken = randomToken();
      const candidateToken   = randomToken();
      const expiresAt = Timestamp.fromMillis(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

      const ref = await addDoc(collection(db, 'sessions'), {
        positionId:          position.id,
        positionTitle:       position.title || '',
        candidateName:       name.trim(),
        candidateEmail:      email.trim() || null,
        interviewerId:       currentUser.uid,
        status:              'scheduled',
        phase:               'intro', // 'intro' → 'questions' → 'challenges' controlled by interviewer
        currentQuestionIdx:  0,
        interviewerToken,
        candidateToken,
        candidateAuthUid:    null,
        scheduledAt:         serverTimestamp(),
        expiresAt,
        startedAt:           null,
        endedAt:             null,
        challengeOrder,
        createdAt:           serverTimestamp(),
      });

      const base = window.location.origin;
      const interviewerUrl = `${base}/room?session=${ref.id}&role=interviewer&token=${interviewerToken}`;
      const candidateUrl   = `${base}/room?session=${ref.id}&role=candidate&token=${candidateToken}`;

      setCreated({ id: ref.id, interviewerUrl, candidateUrl });
      onCreated?.(ref.id);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{t('schedule.title')}</h3>
          <button onClick={onClose} style={closeBtn}>✕</button>
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
            <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5, margin: '12px 0' }}>
              {t('schedule.ttlHint', { hours: SESSION_TTL_HOURS })}
            </p>
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--accent-danger)', color: 'var(--accent-danger)', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
              <button type="button" onClick={onClose} style={btnGhost}>{t('common.cancel')}</button>
              <button type="submit" disabled={creating || !name.trim()} style={{ ...btnPrimary, opacity: !name.trim() || creating ? 0.5 : 1 }}>
                {creating ? t('schedule.creating') : t('schedule.createSession')}
              </button>
            </div>
          </form>
        )}

        {created && (
          <div>
            <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid var(--accent-success)', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
              <strong style={{ color: 'var(--accent-success)' }}>{t('schedule.success')}</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 8 }}>{t('schedule.validFor', { hours: SESSION_TTL_HOURS })}</span>
            </div>

            <LinkRow label={t('schedule.candidateLinkLabel')}          url={created.candidateUrl}   accent="var(--accent-warning)" />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <button
                onClick={() => window.open(created.interviewerUrl, '_blank')}
                style={btnPrimary}
              >
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

/**
 * RegenerateLinkModal — shown after regenerating a candidate link.
 * Mirrors the ScheduleInterviewModal success screen.
 * Props: url {string}, onClose {fn}
 */
export function RegenerateLinkModal({ url, onClose }) {
  const { t } = useTranslation();
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{t('positions.regenerateLinkBtn')}</h3>
          <button onClick={onClose} style={closeBtn}>✕</button>
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
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: '20px',
};
const modal = {
  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
  borderRadius: 10, padding: '1.5rem', width: '100%', maxWidth: 560, color: '#fff',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
};
const closeBtn = { background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' };
const input = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  background: 'var(--bg-main)', border: '1px solid var(--border-color)',
  borderRadius: 6, color: '#fff', fontFamily: 'inherit', fontSize: 14,
};
const btnPrimary = {
  padding: '10px 20px', background: 'var(--accent-primary)', color: '#fff',
  border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer',
};
const btnGhost = {
  padding: '10px 18px', background: 'transparent', color: 'var(--text-muted)',
  border: '1px solid var(--border-color)', borderRadius: 6, cursor: 'pointer',
};
