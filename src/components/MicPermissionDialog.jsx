import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

// Google-Meet-style permission gate. Shown before the candidate enters the
// challenge view. Clicking "Use microphone" calls getUserMedia which:
//   - shows the browser's native prompt (first time)
//   - shows Chrome's small "Previously you didn't allow…" re-prompt popover
//     (modern Chrome, after a prior denial)
//   - or rejects silently (older browsers / strict block)
// On grant, the modal auto-closes from the parent's effect.

export default function MicPermissionDialog({ onAllow, onSkip, error }) {
  const [busy, setBusy] = useState(false);
  const { t, i18n } = useTranslation();

  const handleAllow = async () => {
    setBusy(true);
    try {
      await onAllow();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal}>

        <div style={iconWrap}>
          <div style={micCircle}>🎤</div>
        </div>

        <h2 style={{ margin: '0 0 8px', fontSize: 18, textAlign: 'center', color: '#222' }}>
          {t('mic.title')}
        </h2>
        <p style={{ margin: '0 0 22px', textAlign: 'center', color: '#5f6368', fontSize: 14, lineHeight: 1.5 }}>
          {t('mic.desc')}
        </p>

        {error && (
          <div style={{ marginBottom: 20, padding: 12, background: '#fce8e6', color: '#d93025', borderRadius: 8, fontSize: 13, textAlign: 'center', fontWeight: 500 }}>
            {error}
          </div>
        )}

        <button
          onClick={handleAllow}
          disabled={busy}
          style={{ ...primaryBtn, opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}
        >
          🎤 {busy ? (i18n.language === 'es' ? 'Solicitando…' : 'Requesting…') : t('mic.allow')}
        </button>

      </div>
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2000, padding: 20,
};

const modal = {
  background: '#fff', borderRadius: 14, padding: '2rem 2rem 1.5rem',
  width: '100%', maxWidth: 460, color: '#222', position: 'relative',
  boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
};

const closeBtn = {
  position: 'absolute', top: 12, right: 12,
  width: 32, height: 32, borderRadius: '50%',
  background: 'transparent', border: 'none', color: '#5f6368',
  fontSize: 16, cursor: 'pointer',
};

const iconWrap = { display: 'flex', justifyContent: 'center', marginBottom: 18 };

const micCircle = {
  width: 64, height: 64, borderRadius: '50%',
  background: 'linear-gradient(135deg, #4285f4 0%, #1a73e8 100%)',
  color: '#fff', fontSize: 28,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 4px 12px rgba(26,115,232,0.35)',
};

const primaryBtn = {
  display: 'block', width: '100%', padding: '12px 20px',
  background: '#1a73e8', color: '#fff', border: 'none',
  borderRadius: 24, fontSize: 14, fontWeight: 600,
  cursor: 'pointer', marginBottom: 10,
};

const ghostBtn = {
  display: 'block', width: '100%', padding: '10px 20px',
  background: 'transparent', color: '#1a73e8', border: '1px solid #dadce0',
  borderRadius: 24, fontSize: 14, fontWeight: 500, cursor: 'pointer',
};
