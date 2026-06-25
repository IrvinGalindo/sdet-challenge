import React, { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

import { useTranslation } from 'react-i18next';

/**
 * ConfirmDialog — drop-in replacement for window.confirm / window.alert.
 *
 * Props:
 *   isOpen     {boolean}  – controls visibility
 *   title      {string}   – bold headline
 *   message    {string}   – body text
 *   note       {string?}  – optional red "cannot be undone" note
 *   variant    {string?}  – 'danger' | 'warning' | 'info' (default 'danger')
 *   confirmLabel {string?} – confirm button label (default 'Confirm')
 *   cancelLabel  {string?} – cancel button label (default 'Cancel'); falsy → no cancel (alert mode)
 *   onConfirm  {fn}       – called when user clicks confirm
 *   onCancel   {fn?}      – called when user clicks cancel or presses Escape
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  note,
  variant = 'danger',
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation();
  const activeConfirmLabel = confirmLabel ?? t('confirm.confirm');
  const activeCancelLabel = cancelLabel === undefined ? t('confirm.cancel') : cancelLabel;
  const confirmRef = useRef(null);

  // Trap Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape' && onCancel) onCancel();
    };
    window.addEventListener('keydown', handler);
    // Auto-focus confirm button
    if (confirmRef.current) confirmRef.current.focus();
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const iconMap = { danger: '⚠️', warning: '⚠️', info: 'ℹ️' };

  return (
    <div className="cd-backdrop" onClick={onCancel ? onCancel : undefined} role="dialog" aria-modal="true">
      <div className="cd-panel" onClick={(e) => e.stopPropagation()}>
        <div className={`cd-icon-ring cd-icon-ring--${variant}`}>
          <span>{iconMap[variant] || '⚠️'}</span>
        </div>

        <h2 className="cd-title">{title}</h2>

        {message && <p className="cd-message">{message}</p>}

        {note && (
          <div className="cd-note">
            <span className="cd-note-dot" />
            {note}
          </div>
        )}

        <div className="cd-actions">
          {activeCancelLabel && onCancel && (
            <button className="cd-btn cd-btn--ghost" onClick={onCancel}>
              {activeCancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`cd-btn cd-btn--${variant}`}
            onClick={onConfirm}
          >
            {activeConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * useConfirmDialog — hook that wires up ConfirmDialog imperatively,
 * similar to window.confirm but async.
 *
 * Usage:
 *   const { dialogProps, openConfirm } = useConfirmDialog();
 *   // in JSX: <ConfirmDialog {...dialogProps} />
 *   // in handler: const ok = await openConfirm({ title, message, note, ... });
 */
export function useConfirmDialog() {
  const [state, setState] = React.useState({ isOpen: false, resolve: null, options: {} });

  const openConfirm = (options = {}) =>
    new Promise((resolve) => {
      setState({ isOpen: true, resolve, options });
    });

  const handleConfirm = () => {
    setState((s) => { s.resolve?.(true); return { isOpen: false, resolve: null, options: {} }; });
  };

  const handleCancel = () => {
    setState((s) => { s.resolve?.(false); return { isOpen: false, resolve: null, options: {} }; });
  };

  const dialogProps = {
    isOpen: state.isOpen,
    ...state.options,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  };

  return { dialogProps, openConfirm };
}
