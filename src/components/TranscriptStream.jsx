import React, { useEffect, useRef } from 'react';

// Renders a scrollable list of transcript chunks. Newest chunk is at the
// bottom and the panel auto-scrolls when chunks arrive (unless the user
// has scrolled up to read older context).

export default function TranscriptStream({ chunks }) {
  const ref = useRef(null);
  const wasAtBottomRef = useRef(true);

  // Track whether user is at bottom *before* a new chunk lands.
  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = dist < 30;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chunks.length]);

  if (!chunks.length) {
    return (
      <div style={empty}>
        Waiting for the first words…
      </div>
    );
  }

  return (
    <div ref={ref} onScroll={handleScroll} style={panel}>
      {chunks.map(c => (
        <div key={c.id} style={row}>
          <span style={{
            ...badge,
            background: c.speaker === 'interviewer' ? 'rgba(99,102,241,0.18)' : 'rgba(16,185,129,0.18)',
            color:      c.speaker === 'interviewer' ? 'var(--accent-primary)' : 'var(--accent-success)',
          }}>
            {c.speaker === 'interviewer' ? 'INT' : 'CAN'}
          </span>
          <span style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: 'var(--text-highlight)' }}>
            {c.text}
          </span>
        </div>
      ))}
    </div>
  );
}

const panel = {
  background: 'var(--bg-main)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  padding: '10px 12px',
  maxHeight: 280,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const empty = {
  background: 'var(--bg-main)',
  border: '1px dashed var(--border-color)',
  borderRadius: 6,
  padding: '24px 12px',
  fontSize: 13,
  color: 'var(--text-muted)',
  textAlign: 'center',
};

const row = { display: 'flex', alignItems: 'flex-start', gap: 8 };

const badge = {
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 6px',
  borderRadius: 4,
  letterSpacing: 0.5,
  marginTop: 2,
  flexShrink: 0,
};
