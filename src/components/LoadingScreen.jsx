import React from 'react';
import { RefreshCw } from 'lucide-react';

export default function LoadingScreen({ message = 'Loading\u2026' }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: 16, color: 'var(--text-muted)',
      background: 'var(--bg-main)', fontFamily: 'var(--font-ui)'
    }}>
      <RefreshCw size={28} style={{ animation: 'spin 1.5s linear infinite' }} />
      <span style={{ fontSize: 14 }}>{message}</span>
    </div>
  );
}
