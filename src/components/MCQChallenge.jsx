import React, { useState, useRef } from 'react';

// Multi-choice challenge — exactly one correct option, scored automatically.
// Also captures lightweight forensics (think-time, click changes) for the
// post-interview AI-usage analysis.

export default function MCQChallenge({ challenge, onSubmit, locked, previousAnswer }) {
  const [selected, setSelected] = useState(previousAnswer?.selectedOption || null);

  // Forensics — refs so re-renders don't reset them.
  const mountedAtRef    = useRef(Date.now());
  const firstClickAtRef = useRef(null);
  const clickCountRef   = useRef(0);

  const handleSelect = (label) => {
    if (locked) return;
    if (firstClickAtRef.current === null) firstClickAtRef.current = Date.now();
    clickCountRef.current += 1;
    setSelected(label);
  };

  const handleSubmit = () => {
    if (!selected) return;
    const opt = (challenge.options || []).find(o => o.label === selected);
    const now = Date.now();
    const mountedAt    = mountedAtRef.current;
    const firstClickAt = firstClickAtRef.current;
    onSubmit({
      kind: 'mcq',
      selectedOption: selected,
      isCorrect: !!opt?.correct,
      forensics: {
        secondsViewing:       Math.round((now - mountedAt) / 1000),
        secondsToFirstClick:  firstClickAt ? Math.round((firstClickAt - mountedAt) / 1000) : null,
        clickCount:           clickCountRef.current,
      },
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 16, lineHeight: 1.6, fontSize: 15 }}>{challenge.prompt}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {(challenge.options || []).map(opt => {
          const isSel = selected === opt.label;
          return (
            <button
              key={opt.label}
              type="button"
              disabled={locked}
              onClick={() => handleSelect(opt.label)}
              style={{
                textAlign: 'left',
                padding: '12px 16px',
                background: isSel ? 'rgba(99,102,241,0.15)' : 'var(--bg-main)',
                border: isSel ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                borderRadius: 6,
                color: '#fff',
                fontFamily: 'inherit',
                fontSize: 14,
                cursor: locked ? 'default' : 'pointer',
                lineHeight: 1.5,
              }}
            >
              <strong style={{ marginRight: 10, color: isSel ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                {opt.label}.
              </strong>
              {opt.text}
            </button>
          );
        })}
      </div>

      {!locked && (
        <button
          onClick={handleSubmit}
          disabled={!selected}
          style={{
            padding: '10px 20px',
            background: 'var(--accent-success)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 700,
            cursor: selected ? 'pointer' : 'not-allowed',
            opacity: selected ? 1 : 0.5,
          }}
        >
          Submit Answer →
        </button>
      )}

      {locked && previousAnswer && (
        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid var(--accent-success)', padding: '8px 12px', borderRadius: 6, fontSize: 13 }}>
          ✓ Submitted: <strong>{previousAnswer.selectedOption}</strong>
        </div>
      )}
    </div>
  );
}
