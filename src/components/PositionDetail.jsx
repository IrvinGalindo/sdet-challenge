import { Trash2, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import {
  doc, getDoc, deleteDoc, collection, onSnapshot, query, orderBy, where, updateDoc, Timestamp,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import ScheduleInterviewModal from './ScheduleInterviewModal';
import ConfirmDialog, { useConfirmDialog } from './ConfirmDialog';
import AdminNavbar from './AdminNavbar';

const SESSION_TTL_HOURS = 3;

function randomToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

// Detail view for one position. Shows parsed JD fields, the AI-generated
// question bank, and (later phases) candidate sessions and a compare panel.

export default function PositionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [position, setPosition] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState(new Set());
  const { dialogProps, openConfirm } = useConfirmDialog();

  const toggleSelected = (sid) => {
    setSelectedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else if (next.size < 3) next.add(sid);
      return next;
    });
  };

  const goCompare = () => {
    if (selectedSessionIds.size < 2) return;
    navigate(`/admin/positions/${id}/compare?sessions=${Array.from(selectedSessionIds).join(',')}`);
  };

  const deleteSession = async (s) => {
    const ok = await openConfirm({
      title: t('positions.deleteSessionConfirmTitle'),
      message: t('positions.deleteSessionConfirmMessage', { name: s.candidateName || t('common.unknown') }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'sessions', s.id));
      setSelectedSessionIds(prev => { const next = new Set(prev); next.delete(s.id); return next; });
    } catch (err) {
      console.error('Delete session error:', err);
      openConfirm({
        title: t('common.error', { defaultValue: 'Error' }),
        message: t('positions.deleteSessionError', { message: err.message }),
        confirmLabel: 'OK',
        cancelLabel: null,
        variant: 'danger',
      });
    }
  };

  const regenerateLink = async (s) => {
    const ok = await openConfirm({
      title: t('positions.regenerateLinkConfirmTitle'),
      message: t('positions.regenerateLinkConfirmMessage'),
      confirmLabel: t('positions.regenerateLinkBtn'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const newToken = randomToken();
      const newExpiry = Timestamp.fromMillis(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
      await updateDoc(doc(db, 'sessions', s.id), {
        candidateToken: newToken,
        candidateAuthUid: null,
        expiresAt: newExpiry,
      });
      const base = window.location.origin;
      const url = `${base}/room?session=${s.id}&role=candidate&token=${newToken}`;
      try {
        await navigator.clipboard.writeText(url);
        openConfirm({
          title: t('positions.regenerateLinkBtn'),
          message: `${t('positions.regenerateLinkSuccess')}\n\n${url}`,
          confirmLabel: 'OK',
          cancelLabel: null,
        });
      } catch {
        // Clipboard failed – show URL in dialog anyway
        openConfirm({
          title: t('positions.regenerateLinkBtn'),
          message: url,
          confirmLabel: 'OK',
          cancelLabel: null,
        });
      }
    } catch (err) {
      console.error('Regenerate link error:', err);
      openConfirm({
        title: t('common.error', { defaultValue: 'Error' }),
        message: t('positions.regenerateLinkError', { message: err.message }),
        confirmLabel: 'OK',
        cancelLabel: null,
        variant: 'danger',
      });
    }
  };


  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async u => {
      if (!u) { navigate('/login'); return; }
      setUser(u);
      try {
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        setRole(userDoc.exists() ? userDoc.data().role : 'interviewer');
      } catch (e) {
        setRole('interviewer');
      }
    });
    return () => unsub();
  }, [navigate]);

  const isAdminLike = role === 'admin' || role === 'superadmin';

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;

    getDoc(doc(db, 'positions', id)).then(snap => {
      if (cancelled) return;
      if (!snap.exists()) {
        setLoading(false);
        return;
      }
      setPosition({ id: snap.id, ...snap.data() });
      setLoading(false);
    });

    const qUnsub = onSnapshot(
      query(collection(db, 'positions', id, 'questions'), orderBy('createdAt', 'asc')),
      snap => setQuestions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const cUnsub = onSnapshot(
      query(collection(db, 'positions', id, 'challenges'), orderBy('createdAt', 'asc')),
      snap => setChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const sUnsub = onSnapshot(
      query(collection(db, 'sessions'), where('positionId', '==', id)),
      snap => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (b.scheduledAt?.toMillis?.() || 0) - (a.scheduledAt?.toMillis?.() || 0));
        setSessions(rows);
      },
      (err) => console.warn('Sessions listener:', err.code)
    );
    return () => { cancelled = true; qUnsub(); cUnsub(); sUnsub(); };
  }, [user, id]);

  if (loading) return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <div style={{ color: '#fff', padding: '2rem 0' }}>{t('positions.loading')}</div>
    </div>
  );
  if (!position) return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <div style={{ color: '#fff', padding: '2rem 0' }}>
        {t('positions.noPositions')} <button onClick={() => navigate('/admin')} style={linkBtn}>{t('positions.backToList')}</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <button onClick={() => navigate('/admin')} style={linkBtn}>{t('positions.backToList')}</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '1rem 0 2rem', gap: 16 }}>
        <div>
          <h1 style={{ margin: '0 0 4px' }}>{position.title}</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            <span style={{ textTransform: 'capitalize' }}>{position.seniority}</span> · {position.domain || t('positions.noDomain')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 12,
            background: position.status === 'closed' ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
            color:      position.status === 'closed' ? 'var(--accent-danger)'  : 'var(--accent-success)',
          }}>
            {position.status === 'closed' ? t('positions.status.closed') : t('positions.status.open')}
          </span>
          {position.status !== 'closed' && (
            <button
              onClick={() => setShowSchedule(true)}
              style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
            >
              {t('positions.scheduleInterviewBtn')}
            </button>
          )}
        </div>
      </div>

      <Section title={t('positions.wizard.summary')}>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{position.summary || '—'}</p>
      </Section>

      <Section title={t('positions.wizard.techStack')}>
        <ChipList items={position.techStack} />
      </Section>

      <Section title={t('positions.wizard.softSkills')}>
        <ChipList items={position.softSkills} />
      </Section>

      <Section title={t('positions.questionsCount', { count: questions.length })}>
        {questions.length === 0
          ? <Empty msg={t('positions.noQuestions')} />
          : questions.map((q, i) => (
              <div key={q.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <strong style={{ fontSize: 14 }}>{i + 1}. {q.title || 'Untitled'}</strong>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.07)', color: 'var(--text-muted)' }}>
                    {q.category} · W{q.weight}
                  </span>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 13, fontStyle: 'italic', color: 'var(--text-muted)' }}>"{q.prompt}"</p>
                {q.reference && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderLeft: '3px solid var(--accent-warning)', borderRadius: '0 4px 4px 0', marginTop: 8 }}>
                    <strong>{t('room.script.rubricLabel')}:</strong> {q.reference}
                  </div>
                )}
              </div>
            ))
        }
      </Section>

      <Section title={t('positions.challengesCount', { count: challenges.length })}>
        {challenges.length === 0
          ? <Empty msg={t('positions.noChallenges')} />
          : challenges.map((c, i) => (
              <div key={c.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <strong style={{ fontSize: 14 }}>{i + 1}. {c.title || 'Untitled'}</strong>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                    background: c.kind === 'mcq'  ? 'rgba(59,130,246,0.18)'
                              : c.kind === 'code' ? 'rgba(245,158,11,0.18)'
                              :                     'rgba(99,102,241,0.18)',
                    color:      c.kind === 'mcq'  ? '#60a5fa'
                              : c.kind === 'code' ? '#fbbf24'
                              :                     'var(--accent-primary)',
                  }}>
                    {c.kind?.toUpperCase()}
                  </span>
                </div>
                <p style={{ margin: '8px 0', fontSize: 13, lineHeight: 1.5 }}>{c.prompt}</p>
                {c.kind === 'mcq' && Array.isArray(c.options) && (
                  <ul style={{ margin: '4px 0', paddingLeft: '20px', fontSize: 13 }}>
                    {c.options.map((o, oi) => (
                      <li key={oi} style={{ color: o.correct ? 'var(--accent-success)' : 'var(--text-muted)' }}>
                        <strong>{o.label}.</strong> {o.text} {o.correct && ' ✓'}
                      </li>
                    ))}
                  </ul>
                )}
                {c.kind === 'code' && c.starterCode && (
                  <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)', overflow: 'auto', maxHeight: 200 }}>{c.starterCode}</pre>
                )}
              </div>
            ))
        }
      </Section>

      <Section title={t('positions.sessionsCount', { count: sessions.length })}>
        {selectedSessionIds.size > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', marginBottom: 10,
            background: 'rgba(99,102,241,0.08)', border: '1px solid var(--accent-primary)',
            borderRadius: 6, fontSize: 13,
          }}>
            <span>
              <strong>{t('positions.selectedCount', { count: selectedSessionIds.size })}</strong>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                {t('positions.selectLimitHint')}
              </span>
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setSelectedSessionIds(new Set())}
                style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
              >
                {t('positions.clearBtn')}
              </button>
              <button
                onClick={goCompare}
                disabled={selectedSessionIds.size < 2}
                style={{
                  background: selectedSessionIds.size < 2 ? 'var(--bg-card)' : 'var(--accent-primary)',
                  color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 4,
                  fontWeight: 700, cursor: selectedSessionIds.size < 2 ? 'not-allowed' : 'pointer',
                  fontSize: 12, opacity: selectedSessionIds.size < 2 ? 0.5 : 1,
                }}
              >
                {t('positions.compareBtn', { count: selectedSessionIds.size })}
              </button>
            </div>
          </div>
        )}

        {sessions.length === 0
          ? <Empty msg={t('positions.noSessionsEmpty')} />
          : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>{t('room.candidate')}</th>
                    <th>{t('candidates.status')}</th>
                    <th>{t('positions.outcomeLabel')}</th>
                    <th>{t('positions.scheduledLabel')}</th>
                    <th style={{ textAlign: 'right' }}>{t('positions.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => {
                    const completed = s.status === 'completed';
                    const checked = selectedSessionIds.has(s.id);
                    return (
                      <tr
                        key={s.id}
                        onClick={(e) => {
                          const isInteractive = e.target.tagName === 'INPUT' ||
                                                e.target.tagName === 'BUTTON' ||
                                                e.target.closest('input') ||
                                                e.target.closest('button');
                          if (!isInteractive && completed) {
                            navigate(`/admin/sessions/${s.id}`);
                          }
                        }}
                        style={{
                          cursor: completed ? 'pointer' : 'default',
                          ...(checked ? { background: 'rgba(99,102,241,0.06)' } : {})
                        }}
                      >
                        <td>
                          {completed ? (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelected(s.id)}
                              disabled={!checked && selectedSessionIds.size >= 3}
                            />
                          ) : null}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {s.candidateName || '—'}
                          {position.selectedSessionId === s.id && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--accent-success)', fontWeight: 700 }}>{t('positions.hiredLabel')}</span>
                          )}
                        </td>
                        <td><StatusPill status={s.status} /></td>
                        <td>{s.outcome ? <OutcomePill value={s.outcome} /> : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}</td>
                        <td className="cell-muted" style={{ fontSize: 12 }}>
                          {s.scheduledAt?.toDate?.().toLocaleString() || '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            {completed ? (
                              <button
                                className="btn-evaluate"
                                onClick={() => navigate(`/admin/sessions/${s.id}`)}
                              >
                                {t('positions.viewReportBtn')}
                              </button>
                            ) : (
                              <>
                                <button
                                  className="btn-evaluate"
                                  onClick={() => {
                                    const url = `/room?session=${s.id}&role=interviewer&token=${s.interviewerToken}`;
                                    window.open(url, '_blank');
                                  }}
                                >
                                  {t('positions.openRoomBtn')}
                                </button>
                                <button
                                  onClick={() => regenerateLink(s)}
                                  title={t('positions.regenerateLinkBtn')}
                                  style={{
                                    background: 'rgba(99,102,241,0.12)',
                                    border: '1px solid rgba(99,102,241,0.3)',
                                    color: 'var(--accent-primary)',
                                    padding: '4px 10px',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    lineHeight: 1.4,
                                    transition: 'background 0.15s',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.25)'}
                                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(99,102,241,0.12)'}
                                >
                                  <RefreshCw size={13} />
                                  {t('positions.regenerateLinkBtn')}
                                </button>
                              </>
                            )}
                            {isAdminLike && (
                              <button
                                onClick={() => deleteSession(s)}
                                title="Delete session"
                                style={{
                                  background: 'rgba(239,68,68,0.12)',
                                  border: '1px solid rgba(239,68,68,0.3)',
                                  color: 'var(--accent-danger)',
                                  padding: '4px 10px',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  lineHeight: 1.4,
                                  transition: 'background 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.25)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.12)'}
                              >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Trash2 size={14} /> {t('common.delete')}</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </Section>

      {showSchedule && (
        <ScheduleInterviewModal
          position={{ ...position, id, challenges }}
          currentUser={user}
          onClose={() => setShowSchedule(false)}
        />
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

function OutcomePill({ value }) {
  const { t } = useTranslation();
  const m = {
    selected:     { bg: 'rgba(16,185,129,0.18)', fg: 'var(--accent-success)', label: t('positions.hiredLabel') },
    not_selected: { bg: 'rgba(148,163,184,0.18)', fg: 'var(--text-muted)',    label: t('positions.notSelectedLabel') },
    rejected:     { bg: 'rgba(239,68,68,0.18)',  fg: 'var(--accent-danger)',  label: t('positions.rejectedLabel') },
  };
  const c = m[value] || m.not_selected;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 12, background: c.bg, color: c.fg }}>{c.label}</span>;
}

function StatusPill({ status }) {
  const { t } = useTranslation();
  const map = {
    scheduled: { bg: 'rgba(99,102,241,0.18)', fg: 'var(--accent-primary)', label: t('room.status.scheduled', { defaultValue: 'scheduled' }) },
    live:      { bg: 'rgba(16,185,129,0.18)', fg: 'var(--accent-success)', label: t('room.status.live', { defaultValue: 'live' }) },
    completed: { bg: 'rgba(148,163,184,0.18)', fg: 'var(--text-muted)', label: t('room.status.completed', { defaultValue: 'completed' }) },
    cancelled: { bg: 'rgba(239,68,68,0.18)',  fg: 'var(--accent-danger)', label: t('common.cancel', { defaultValue: 'cancelled' }) },
  };
  const c = map[status] || map.scheduled;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 12, background: c.bg, color: c.fg, textTransform: 'uppercase' }}>
      {c.label}
    </span>
  );
}

const linkBtn = { background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 14, padding: 0, fontFamily: 'inherit' };

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  padding: '12px 16px',
  marginBottom: '10px',
};

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h3>
      {children}
    </div>
  );
}

function ChipList({ items }) {
  if (!items || items.length === 0) return <Empty msg="—" />;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {items.map(t => (
        <span key={t} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 12, background: 'rgba(99,102,241,0.15)', color: 'var(--accent-primary)', fontWeight: 600 }}>
          {t}
        </span>
      ))}
    </div>
  );
}

function Empty({ msg }) {
  return <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>{msg}</div>;
}
