import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: 16, color: 'var(--text-muted)',
          background: 'var(--bg-main)', fontFamily: 'var(--font-ui)', padding: 20, textAlign: 'center'
        }}>
          <h2 style={{ color: 'var(--text-highlight)', margin: 0 }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 400, fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            {this.state.error?.message || 'An unexpected client-side error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px', background: 'var(--accent-primary)', color: '#fff',
              border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
              marginTop: 8
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
