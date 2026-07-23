import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic } from 'lucide-react';

// Neural Midnight styled mic permission gate.
// Shown before the candidate enters the challenge view.
// Clicking "Use microphone" calls getUserMedia which:
//   - shows the browser's native prompt (first time)
//   - shows Chrome's small re-prompt popover (after a prior denial)
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
      {/* Brand gradient border wrapper */}
      <div style={gradientWrap}>
        <div style={modal}>

          {/* Mic icon with brand gradient ring */}
          <div style={iconWrap}>
            <div style={micRingOuter}>
              <div style={micCircle}>
                <Mic size={30} color="#fff" strokeWidth={1.8} />
              </div>
            </div>
          </div>

          <h2 style={titleStyle}>{t('mic.title')}</h2>
          <p style={descStyle}>{t('mic.desc')}</p>

          {error && (
            <div style={errorBox}>{error}</div>
          )}

          <button
            onClick={handleAllow}
            disabled={busy}
            style={{
              ...primaryBtn,
              opacity: busy ? 0.7 : 1,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            <Mic size={15} strokeWidth={1.8} />
            {busy
              ? (i18n.language === 'es' ? 'Solicitando…' : 'Requesting…')
              : t('mic.allow')}
          </button>

          {onSkip && (
            <button onClick={onSkip} style={ghostBtn}>
              {t('mic.skip') || 'Continue without mic'}
            </button>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Styles — Neural Midnight ──────────────────────────────────────────────────

const overlay = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.85)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2000, padding: 20,
};

// 1px padding wrapper that shows the gradient border
const gradientWrap = {
  background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #7c3aed 100%)',
  borderRadius: 20,
  padding: 1,
  boxShadow: '0 0 60px rgba(6,182,212,0.2), 0 32px 80px rgba(0,0,0,0.7)',
  width: '100%',
  maxWidth: 440,
};

const modal = {
  background: '#080f1e',
  borderRadius: 19,
  padding: '2.5rem 2rem 2rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 0,
};

const iconWrap = {
  display: 'flex', justifyContent: 'center',
  marginBottom: '1.5rem',
};

// Outer glow ring
const micRingOuter = {
  width: 88, height: 88,
  borderRadius: '50%',
  background: 'rgba(6,182,212,0.08)',
  border: '1px solid rgba(6,182,212,0.25)',
  boxShadow: '0 0 30px rgba(6,182,212,0.2), inset 0 0 20px rgba(6,182,212,0.05)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const micCircle = {
  width: 60, height: 60,
  borderRadius: '50%',
  background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #7c3aed 100%)',
  boxShadow: '0 4px 20px rgba(6,182,212,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const titleStyle = {
  margin: '0 0 8px',
  fontSize: 19,
  fontWeight: 700,
  textAlign: 'center',
  color: '#f0f6ff',
  fontFamily: '"Outfit", "Inter", sans-serif',
  letterSpacing: '-0.03em',
};

const descStyle = {
  margin: '0 0 24px',
  textAlign: 'center',
  color: 'rgba(180,200,240,0.7)',
  fontSize: 14,
  lineHeight: 1.6,
};

const errorBox = {
  marginBottom: 16,
  padding: '10px 14px',
  background: 'rgba(244,63,94,0.1)',
  border: '1px solid rgba(244,63,94,0.3)',
  color: '#fb7185',
  borderRadius: 10,
  fontSize: 13,
  textAlign: 'center',
  fontWeight: 500,
  width: '100%',
  boxSizing: 'border-box',
};

const primaryBtn = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: '100%',
  padding: '12px 20px',
  background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #7c3aed 100%)',
  color: '#fff',
  border: 'none',
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  marginBottom: 10,
  boxShadow: '0 4px 20px rgba(6,182,212,0.35)',
  transition: 'box-shadow 0.2s ease, opacity 0.2s ease',
  fontFamily: '"Inter", sans-serif',
};

const ghostBtn = {
  display: 'block',
  width: '100%',
  padding: '10px 20px',
  background: 'transparent',
  color: 'rgba(180,200,240,0.5)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  textAlign: 'center',
  transition: 'color 0.2s, border-color 0.2s',
};
