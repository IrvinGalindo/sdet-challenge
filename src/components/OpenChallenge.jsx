import React, { useState, useRef } from 'react';

// Open-ended challenge — text response, AI-evaluated in Phase 4.
// Also captures forensics (paste events, timing) so the evaluator can flag
// likely AI-assisted answers (large pastes, near-instant submits, etc.).

export default function OpenChallenge({ challenge, onSubmit, locked, previousAnswer }) {
  const [text, setText] = useState(previousAnswer?.text || '');

  // Forensics — refs survive re-renders without re-triggering effects.
  const mountedAtRef    = useRef(Date.now());
  const firstEditAtRef  = useRef(null);
  const pasteEventsRef  = useRef([]); // [{ at, chars }]

  const handleChange = (val) => {
    if (locked) return;
    if (firstEditAtRef.current === null && val !== text) {
      firstEditAtRef.current = Date.now();
    }
    setText(val);
  };

  const handlePaste = (e) => {
    if (locked) return;
    const pasted = e.clipboardData?.getData('text') || '';
    if (pasted) {
      pasteEventsRef.current.push({ at: Date.now(), chars: pasted.length });
    }
  };

  const handleSubmit = () => {
    const t = text.trim();
    if (!t) return;
    const now = Date.now();
    const mountedAt   = mountedAtRef.current;
    const firstEditAt = firstEditAtRef.current;
    const pastes      = pasteEventsRef.current;
    const pastedChars = pastes.reduce((sum, p) => sum + p.chars, 0);
    const finalChars  = t.length;

    onSubmit({
      kind: 'open',
      text: t,
      forensics: {
        secondsViewing:     Math.round((now - mountedAt) / 1000),
        secondsToFirstEdit: firstEditAt ? Math.round((firstEditAt - mountedAt) / 1000) : null,
        secondsTyping:      firstEditAt ? Math.round((now - firstEditAt) / 1000)        : null,
        pasteCount:         pastes.length,
        pastedChars,
        finalChars,
        pasteRatio:         finalChars > 0 ? Math.round((pastedChars / finalChars) * 1000) / 1000 : 0,
      },
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 16, lineHeight: 1.6, fontSize: 15 }}>{challenge.prompt}</div>

      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        onPaste={handlePaste}
        disabled={locked}
        placeholder="Type your answer here…"
        style={{
          width: '100%', boxSizing: 'border-box',
          minHeight: 220, padding: '12px',
          background: 'var(--bg-main)',
          border: '1px solid var(--border-color)',
          borderRadius: 6, color: '#fff',
          fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5,
          resize: 'vertical',
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{text.length} characters</span>
        {!locked && (
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            style={{
              padding: '10px 20px',
              background: 'var(--accent-success)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 700,
              cursor: text.trim() ? 'pointer' : 'not-allowed',
              opacity: text.trim() ? 1 : 0.5,
            }}
          >
            Submit Answer →
          </button>
        )}
        {locked && (
          <span style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid var(--accent-success)', padding: '6px 12px', borderRadius: 6, fontSize: 13, color: 'var(--accent-success)' }}>
            ✓ Submitted
          </span>
        )}
      </div>
    </div>
  );
}
