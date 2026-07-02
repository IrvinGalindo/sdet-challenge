import React from 'react';
import { useTranslation } from 'react-i18next';

// Renders the stream of AI co-pilot suggestion cards. Newest first.
// Cards from manual interviewer prompts (`isCustom: true`) are styled differently.

export default function AISuggestions({ suggestions, busy, customBusy }) {
  const { t } = useTranslation();

  if (!suggestions.length && !busy && !customBusy) {
    return (
      <div style={empty}>
        {t('aiSuggestions.noSuggestionsYet', 'Suggestions appear once there are a few exchanges to analyze.')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(busy || customBusy) && (
        <div style={busyRow}>
          <span style={spinner} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {customBusy ? t('aiSuggestions.loadingCustom', 'Claude is thinking…') : t('aiSuggestions.loading')}
          </span>
        </div>
      )}
      {suggestions.map(s => {
        if (s.isCustom) {
          // Custom prompt card — teal accent, distinct layout
          return (
            <div key={s.id} style={customCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                <span style={customBadge}>✦ {t('aiSuggestions.customBadge', 'You asked')}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, textAlign: 'right', fontStyle: 'italic' }}>
                  {s.topic || ''}
                </span>
              </div>
              {s.question && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontStyle: 'italic' }}>
                  "{s.question}"
                </div>
              )}
              <div style={{ fontSize: 13, color: 'var(--text-highlight)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {s.suggestion}
              </div>
            </div>
          );
        }

        // Standard automated suggestion card
        return (
          <div key={s.id} style={{
            ...card,
            borderLeft: `3px solid ${s.priority === 'high' ? 'var(--accent-danger)' : 'var(--accent-primary)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: '2px 6px', borderRadius: 4,
                background: s.priority === 'high' ? 'rgba(239,68,68,0.18)' : 'rgba(99,102,241,0.18)',
                color:      s.priority === 'high' ? 'var(--accent-danger)' : 'var(--accent-primary)',
              }}>
                {(s.priority || 'low').toUpperCase()}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, textAlign: 'right' }}>
                {s.topic || ''}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-highlight)', lineHeight: 1.45, fontWeight: 600 }}>
              {s.suggestion}
            </div>
            {s.reasoning && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4, fontStyle: 'italic' }}>
                {s.reasoning}
              </div>
            )}
          </div>
        );
      })}
      <style>{`@keyframes ai-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const empty = {
  background: 'var(--bg-main)',
  border: '1px dashed var(--border-color)',
  borderRadius: 6,
  padding: '20px 12px',
  fontSize: 12,
  color: 'var(--text-muted)',
  textAlign: 'center',
  lineHeight: 1.5,
};

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  padding: '10px 12px',
};

const customCard = {
  background: 'rgba(6,182,212,0.07)',
  border: '1px solid rgba(6,182,212,0.3)',
  borderLeft: '3px solid #06b6d4',
  borderRadius: 6,
  padding: '10px 12px',
};

const customBadge = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.5,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(6,182,212,0.18)',
  color: '#06b6d4',
};

const busyRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: 'var(--bg-main)',
  borderRadius: 4,
};

const spinner = {
  display: 'inline-block',
  width: 12,
  height: 12,
  border: '2px solid var(--border-color)',
  borderTopColor: 'var(--accent-primary)',
  borderRadius: '50%',
  animation: 'ai-spin 0.8s linear infinite',
};
