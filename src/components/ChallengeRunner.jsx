import { Trophy } from 'lucide-react';
import React, { useState } from 'react';
import MCQChallenge from './MCQChallenge';
import OpenChallenge from './OpenChallenge';
import CodeChallenge from './CodeChallenge';
import { useTranslation } from 'react-i18next';

// Sequences a list of challenges. The candidate sees one at a time; submits
// before advancing. Each submission is persisted by the parent via onAnswer.
//
// Code challenges (Sandpack) will be added in Phase 2c — for now they render
// a placeholder so they don't block the flow.

export default function ChallengeRunner({ challenges, answers, onAnswer, onComplete }) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(() => {
    const idx = (challenges || []).findIndex(c => !answers?.[c.id]);
    return idx === -1 ? Math.max(0, (challenges?.length || 1) - 1) : idx;
  });

  // Optimistic set of submitted IDs — updated immediately on submit so the
  // "all done" check doesn't have to wait for the Firestore onSnapshot round-trip.
  const [optimisticDone, setOptimisticDone] = useState(() =>
    new Set(Object.keys(answers || {}))
  );

  const total = challenges?.length || 0;
  // allDone is true when every challenge ID is in either answers OR optimisticDone.
  const allDoneIds = new Set([...Object.keys(answers || {}), ...optimisticDone]);
  const allDone = total > 0 && (challenges || []).every(c => allDoneIds.has(c.id));

  const active = allDone ? null : challenges?.[activeIndex];
  const previousAnswer = active ? answers?.[active.id] : null;

  const handleSubmit = async (submission) => {
    if (!active) return;
    const submittedId = active.id;

    // Mark optimistically so allDone triggers immediately.
    setOptimisticDone(prev => new Set([...prev, submittedId]));

    // Advance to next unanswered challenge right away (no stale-prop issue).
    const remainingIdx = (challenges || []).findIndex(
      (c, i) => i !== activeIndex && !allDoneIds.has(c.id) && c.id !== submittedId
    );
    if (remainingIdx !== -1) setActiveIndex(remainingIdx);

    // Persist to Firestore (fire-and-forget — errors surfaced by parent).
    await onAnswer(submittedId, { ...submission, challengeId: submittedId });
  };

  if (!total) {
    return (
      <div style={empty}>
        {t('challenge.noChallengesToRun', 'This position has no challenges yet. Generate the question bank from the position page first.')}
      </div>
    );
  }

  // ── All done ─────────────────────────────────────────────────────────────
  if (allDone) {
    return (
      <div>
        {/* Stepper — all green */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {challenges.map((c) => (
            <button
              key={c.id}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                border: '1px solid var(--accent-success)',
                background: 'rgba(16,185,129,0.15)',
                color: 'var(--accent-success)',
                fontWeight: 700, fontSize: 13, cursor: 'default',
              }}
              title={c.title}
            >✓</button>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>
            {total} / {total} {t('challenge.answered', 'answered')}
          </div>
        </div>

        {/* Done banner */}
        <div style={{
          padding: '2rem', textAlign: 'center',
          background: 'rgba(16,185,129,0.07)',
          border: '1px solid var(--accent-success)',
          borderRadius: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><Trophy size={48} style={{ color: '#fbbf24' }} /></div>
          <strong style={{ fontSize: 18, color: 'var(--accent-success)' }}>
            {t('challenge.allSubmitted', 'All challenges submitted!')}
          </strong>
          <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
            {t('challenge.greatWork', 'Great work. The interviewer will review your answers and end the session shortly.')}
          </div>
          {onComplete && (
            <button
              onClick={onComplete}
              style={{
                marginTop: 20, padding: '10px 24px',
                background: 'var(--accent-success)', color: '#fff',
                border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {t('challenge.markDoneBtn', 'Mark me as done')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {challenges.map((c, i) => {
          const done = allDoneIds.has(c.id);
          const current = i === activeIndex;
          return (
            <button
              key={c.id}
              onClick={() => setActiveIndex(i)}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                border: current ? '2px solid var(--accent-primary)' : `1px solid ${done ? 'var(--accent-success)' : 'var(--border-color)'}`,
                background: done ? 'rgba(16,185,129,0.15)' : current ? 'rgba(99,102,241,0.15)' : 'var(--bg-card)',
                color: done ? 'var(--accent-success)' : current ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}
              title={c.title}
            >
              {done ? '✓' : i + 1}
            </button>
          );
        })}
        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>
          {allDoneIds.size} / {total} {t('challenge.answered', 'answered')}
        </div>
      </div>

      {/* Active challenge */}
      {active && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {activeIndex + 1}. {active.title || t('challenge.challengeLabel', 'Challenge')}
            </h2>
            <KindBadge kind={active.kind} t={t} />
          </div>

          {active.kind === 'mcq' && (
            <MCQChallenge
              key={active.id}
              challenge={active}
              onSubmit={handleSubmit}
              locked={!!previousAnswer}
              previousAnswer={previousAnswer}
            />
          )}
          {active.kind === 'open' && (
            <OpenChallenge
              key={active.id}
              challenge={active}
              onSubmit={handleSubmit}
              locked={!!previousAnswer}
              previousAnswer={previousAnswer}
            />
          )}
          {active.kind === 'code' && (
            <CodeChallenge
              key={active.id}
              challenge={active}
              onSubmit={handleSubmit}
              locked={!!previousAnswer}
              previousAnswer={previousAnswer}
            />
          )}
        </div>
      )}
    </div>
  );
}


function KindBadge({ kind, t }) {
  const m = {
    mcq:  { bg: 'rgba(59,130,246,0.18)', fg: '#60a5fa', labelKey: 'challenge.kindMcq', labelDefault: 'MULTI-CHOICE' },
    open: { bg: 'rgba(99,102,241,0.18)', fg: 'var(--accent-primary)', labelKey: 'challenge.kindOpen', labelDefault: 'OPEN ANSWER' },
    code: { bg: 'rgba(245,158,11,0.18)', fg: '#fbbf24', labelKey: 'challenge.kindCode', labelDefault: 'CODE' },
  };
  const c = m[kind] || m.open;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4, background: c.bg, color: c.fg, letterSpacing: 0.5 }}>{t(c.labelKey, c.labelDefault)}</span>;
}

const empty = {
  background: 'var(--bg-card)', border: '1px dashed var(--border-color)',
  borderRadius: 8, padding: '2rem', textAlign: 'center', color: 'var(--text-muted)',
};
