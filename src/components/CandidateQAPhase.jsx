import { Mic } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

/**
 * CandidateQAPhase — shown to the CANDIDATE in the live room during phase 1.
 *
 * Displays the current interview question dictated by the interviewer (currentQIdx).
 * As the candidate speaks, live transcript chunks appear.
 */
export default function CandidateQAPhase({ questions, currentQIdx, transcript }) {
  // Chunk watermark: the transcript index at which this question started.
  const questionStartIdxRef = useRef(0);
  const [candidateText, setCandidateText] = useState('');
  
  const total = questions.length;
  const active = questions[currentQIdx];

  // When the question changes, reset the watermark to current transcript length
  // We do this by tracking the previous question index.
  const prevQIdxRef = useRef(currentQIdx);
  useEffect(() => {
    if (prevQIdxRef.current !== currentQIdx) {
      questionStartIdxRef.current = transcript.length;
      prevQIdxRef.current = currentQIdx;
      setCandidateText('');
    }
  }, [currentQIdx, transcript.length]);

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

  if (!active) return null;

  return (
    <div style={sectionWrap}>
      <SectionTitle />

      {/* Stepper (Read-only for candidate) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {questions.map((q, i) => {
          const done = i < currentQIdx;
          const current = i === currentQIdx;
          return (
            <div
              key={q.id}
              title={q.title}
              style={{
                width: 28, height: 28, borderRadius: '50%', fontSize: 11,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700,
                border: current
                  ? '2px solid var(--accent-primary)'
                  : `1px solid ${done ? 'var(--accent-success)' : 'var(--border-color)'}`,
                background: done
                  ? 'rgba(16,185,129,0.15)'
                  : current ? 'rgba(99,102,241,0.15)' : 'var(--bg-card)',
                color: done
                  ? 'var(--accent-success)'
                  : current ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}
            >
              {done ? '✓' : i + 1}
            </div>
          );
        })}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          Question {currentQIdx + 1} of {total}
        </span>
      </div>

      {/* Active question card */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        padding: '1.25rem 1.5rem',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, lineHeight: 1.4 }}>
            Q{currentQIdx + 1}. {active.title}
          </h3>
          {active.category && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
              padding: '3px 10px', borderRadius: 4, flexShrink: 0,
              background: 'rgba(99,102,241,0.15)', color: 'var(--accent-primary)',
            }}>
              {active.category}
            </span>
          )}
        </div>

        {/* Question prompt */}
        <p style={{ margin: '0 0 16px', fontSize: 15, lineHeight: 1.65, color: 'var(--text-highlight)' }}>
          {active.prompt}
        </p>

        {/* Live transcript preview */}
        <div style={{
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid var(--border-color)',
          borderRadius: 6, padding: '10px 14px',
          minHeight: 52,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.5, marginBottom: 4 }}>
            <Mic size={16} style={{ marginRight: 6, display: 'inline-block', verticalAlign: 'middle' }} /> YOUR ANSWER (live)
          </div>
          {candidateText ? (
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-highlight)' }}>
              {candidateText}
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Speak your answer — it will appear here automatically…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Interview questions</h2>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: 0.5,
        background: 'rgba(245,158,11,0.15)', color: '#fbbf24',
      }}>VERBAL</span>
    </div>
  );
}

const sectionWrap = { marginBottom: 28 };
