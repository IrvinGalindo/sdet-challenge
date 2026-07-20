import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { useTranslation } from 'react-i18next';
import ConfirmDialog, { useConfirmDialog } from './ConfirmDialog';
import AdminNavbar from './AdminNavbar';
import { useAuth } from '../context/AuthContext';

// Side-by-side comparison of up to 3 candidate sessions for one position.
// Radar overlay of technical depth + recommendation grid + pros/cons.
//
// URL: /admin/positions/:id/compare?sessions=<sid1>,<sid2>,<sid3>

const COLORS = ['#6366F1', '#10B981', '#F59E0B'];
const MAX_COMPARE = 3;

export default function CompareCandidates() {
  const { id: positionId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { user, role, authReady } = useAuth();
  const [position, setPosition] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const { dialogProps, openConfirm } = useConfirmDialog();

  const sessionIds = useMemo(() => {
    const raw = params.get('sessions') || '';
    return raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_COMPARE);
  }, [params]);

  useEffect(() => {
    if (authReady && !user) {
      navigate('/login');
    }
  }, [authReady, user, navigate]);

  useEffect(() => {
    if (!authReady || !user || !positionId) return;
    let cancelled = false;
    (async () => {
      try {
        const [posSnap, ...sessSnaps] = await Promise.all([
          getDoc(doc(db, 'positions', positionId)),
          ...sessionIds.map(sid => getDoc(doc(db, 'sessions', sid))),
        ]);
        if (cancelled) return;
        if (posSnap.exists()) setPosition({ id: posSnap.id, ...posSnap.data() });
        setSessions(sessSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() })));
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, positionId, sessionIds]);

  // Build radar data: union of all skills across candidates, value per candidate.
  const radarData = useMemo(() => {
    const skills = new Set();
    sessions.forEach(s => {
      const td = s.report?.technicalDepth;
      if (td) Object.keys(td).forEach(sk => skills.add(sk));
    });
    return Array.from(skills).map(skill => {
      const row = { skill };
      sessions.forEach((s, i) => {
        row[`c${i}`] = Number(s.report?.technicalDepth?.[skill]?.score) || 0;
      });
      return row;
    });
  }, [sessions]);

  const handleClosePosition = async (winnerSession) => {
    if (!position) return;
    const ok = await openConfirm({
      title: t('report.hireConfirmTitle', { name: winnerSession.candidateName }),
      message: t('report.hireConfirmMessage', { title: position.title }),
      confirmLabel: t('report.hireConfirmBtn'),
      cancelLabel: t('common.cancel'),
      variant: 'warning',
    });
    if (!ok) return;
    setClosing(true);
    try {
      // Mark all other sessions for this position as not_selected.
      const otherSnap = await getDocs(query(collection(db, 'sessions'), where('positionId', '==', positionId)));
      const updates = [];
      otherSnap.docs.forEach(d => {
        if (d.id === winnerSession.id) {
          updates.push(updateDoc(d.ref, { outcome: 'selected' }));
        } else {
          updates.push(updateDoc(d.ref, { outcome: 'not_selected' }));
        }
      });
      // Close the position.
      updates.push(updateDoc(doc(db, 'positions', positionId), {
        status: 'closed',
        closedAt: serverTimestamp(),
        selectedSessionId: winnerSession.id,
        selectedCandidateName: winnerSession.candidateName || null,
      }));
      await Promise.all(updates);
      navigate(`/admin/positions/${positionId}`);
    } catch (e) {
      openConfirm({
        title: t('common.error', { defaultValue: 'Error' }),
        message: t('positions.notification.error', { message: e.message }),
        confirmLabel: 'OK',
        cancelLabel: null,
        variant: 'danger',
      });
      setClosing(false);
    }
  };

  if (loading) return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <div style={{ color: '#fff', padding: '2rem 0' }}>{t('compare.loading')}</div>
    </div>
  );
  if (!position) return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <div style={{ color: '#fff', padding: '2rem 0' }}>
        {t('positions.noPositions')} <button onClick={() => navigate('/admin')} style={linkBtn}>{t('common.back')}</button>
      </div>
    </div>
  );
  if (sessions.length < 2) return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <button onClick={() => navigate(`/admin/positions/${positionId}`)} style={linkBtn}>{t('report.backToPosition')}</button>
      <h2 style={{ marginTop: 12 }}>{t('compare.pickMinimum')}</h2>
      <p style={{ color: 'var(--text-muted)' }}>
        {t('compare.pickMinimumHint')}
      </p>
    </div>
  );

  return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <button onClick={() => navigate(`/admin/positions/${positionId}`)} style={linkBtn}>{t('report.backToPosition')}</button>

      <div style={{ margin: '1rem 0 2rem' }}>
        <h1 style={{ margin: '0 0 4px' }}>{t('compare.subtitle', { count: sessions.length })}</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{position.title}</div>
      </div>

      {/* Top-line cards */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sessions.length}, 1fr)`, gap: 16, marginBottom: 24 }}>
        {sessions.map((s, i) => (
          <CandidateCard
            key={s.id}
            session={s}
            color={COLORS[i]}
            onSelect={() => handleClosePosition(s)}
            disabled={closing || position.status === 'closed'}
            alreadyClosed={position.status === 'closed'}
            isWinner={position.selectedSessionId === s.id}
          />
        ))}
      </div>

      {/* Radar overlay */}
      {radarData.length > 0 && (
        <Section title={t('compare.radarTitle')}>
          <div style={{ height: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="var(--border-color)" />
                <PolarAngleAxis dataKey="skill" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                {sessions.map((s, i) => (
                  <Radar
                    key={s.id}
                    name={s.candidateName || `${t('room.candidate')} ${i + 1}`}
                    dataKey={`c${i}`}
                    stroke={COLORS[i]}
                    fill={COLORS[i]}
                    fillOpacity={0.18}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: '#fff', fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-highlight)' }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* Side-by-side details */}
      <Section title={t('compare.breakdownTitle')}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sessions.length}, 1fr)`, gap: 16 }}>
          {sessions.map((s, i) => (
            <DetailColumn key={s.id} session={s} color={COLORS[i]} />
          ))}
        </div>
      </Section>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function CandidateCard({ session, color, onSelect, disabled, alreadyClosed, isWinner }) {
  const { t } = useTranslation();
  const r = session.report;
  const techScores = r?.technicalDepth ? Object.values(r.technicalDepth).map(v => Number(v?.score) || 0) : [];
  const avg = techScores.length ? (techScores.reduce((a, b) => a + b, 0) / techScores.length) : null;

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${isWinner ? 'var(--accent-success)' : 'var(--border-color)'}`,
      borderTop: `4px solid ${color}`,
      borderRadius: 10,
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      position: 'relative',
    }}>
      {isWinner && (
        <span style={{
          position: 'absolute', top: -10, right: 12, background: 'var(--accent-success)', color: '#fff',
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, letterSpacing: 0.5,
        }}>
          {t('positions.hiredLabel')}
        </span>
      )}
      <div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{session.candidateName || t('room.candidate')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {session.endedAt?.toDate?.().toLocaleString() || '—'}
        </div>
      </div>

      <RecPill value={r?.hiringRecommendation} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('compare.techAvg')}</span>
        <strong style={{ color }}>{avg !== null ? `${avg.toFixed(1)} / 5` : '—'}</strong>
      </div>

      {r?.fitAssessment && <FitPill value={r.fitAssessment} />}

      {r?.executiveSummary && (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)', maxHeight: 120, overflowY: 'auto', paddingRight: 4 }}>
          {r.executiveSummary}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
        <button
          onClick={() => window.open(`/admin/sessions/${session.id}`, '_blank')}
          style={btnGhost}
        >
          {t('compare.fullReportBtn')}
        </button>
        {!alreadyClosed && (
          <button onClick={onSelect} disabled={disabled} style={{ ...btnSelect, background: color }}>
            {t('compare.hireCloseBtn')}
          </button>
        )}
      </div>
    </div>
  );
}

function DetailColumn({ session, color }) {
  const { t } = useTranslation();
  const r = session.report;
  if (!r) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('compare.noReport', { name: session.candidateName })}</div>;
  }
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderTop: `3px solid ${color}`, borderRadius: 8, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <strong style={{ fontSize: 14, color }}>{session.candidateName}</strong>

      <Block heading={t('report.sections.strengths')} items={r.pros} accent="var(--accent-success)" />
      <Block heading={t('report.sections.concerns')}  items={r.cons} accent="var(--accent-danger)" />

      {r.fitRationale && (
        <div>
          <div style={blockHeading}>{t('report.sections.fitRationale')}</div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>{r.fitRationale}</p>
        </div>
      )}

      {r.followUpQuestions?.length > 0 && (
        <div>
          <div style={blockHeading}>{t('report.sections.followUpQuestions')}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
            {r.followUpQuestions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Block({ heading, items, accent }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div style={{ ...blockHeading, color: accent }}>{heading}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
        {items.map((p, i) => <li key={i}>{p}</li>)}
      </ul>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h2>
      {children}
    </div>
  );
}

function FitPill({ value }) {
  const { t } = useTranslation();
  const m = {
    strong_fit:      { bg: 'rgba(16,185,129,0.18)', fg: 'var(--accent-success)', label: t('report.fitAssessment.strongFit') },
    conditional_fit: { bg: 'rgba(245,158,11,0.18)', fg: 'var(--accent-warning)', label: t('report.fitAssessment.conditionalFit') },
    not_a_fit:       { bg: 'rgba(239,68,68,0.18)',  fg: 'var(--accent-danger)',  label: t('report.fitAssessment.notAFit') },
  };
  const c = m[value] || { bg: 'rgba(148,163,184,0.18)', fg: 'var(--text-muted)', label: value || '—' };
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: c.bg, color: c.fg, alignSelf: 'flex-start' }}>{c.label}</span>;
}

function RecPill({ value }) {
  const { t } = useTranslation();
  const m = {
    proceed: { bg: 'rgba(16,185,129,0.18)', fg: 'var(--accent-success)', label: '✓ ' + t('report.hiringRecommendation.proceed') },
    hold:    { bg: 'rgba(245,158,11,0.18)', fg: 'var(--accent-warning)', label: '⏸ ' + t('report.hiringRecommendation.hold') },
    decline: { bg: 'rgba(239,68,68,0.18)',  fg: 'var(--accent-danger)',  label: '✗ ' + t('report.hiringRecommendation.decline') },
  };
  const c = m[value] || { bg: 'rgba(148,163,184,0.18)', fg: 'var(--text-muted)', label: t('common.loading') };
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 4, background: c.bg, color: c.fg, alignSelf: 'flex-start', letterSpacing: 0.5 }}>{c.label}</span>;
}

const linkBtn = { background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' };
const btnGhost = { flex: 1, padding: '6px 10px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 4, fontSize: 12, cursor: 'pointer' };
const btnSelect = { flex: 1, padding: '6px 10px', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const blockHeading = { fontSize: 11, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, fontWeight: 700 };
