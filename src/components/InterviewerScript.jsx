import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const navBtn = {
  padding: '4px 12px', fontSize: 12, fontWeight: 600,
  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
  color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer',
};

// Shows the question bank as a script for the interviewer. Tracks which question
// is "current" and shows the candidate's live/saved verbal answer per question.
export function InterviewerScript({ questions, answers, transcript, currentQIdx, phase, onAdvance, onFinishQA }) {
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
              }}>{t('room.script.answered')}</span>
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
