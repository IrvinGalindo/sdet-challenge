import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useNavigate } from 'react-router-dom';
import './AdminLogin.css';

function friendlyError(code, t) {
  if (!code) return t('login.error.generic');
  if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential') || code.includes('invalid-email'))
    return t('login.error.invalidCredential');
  if (code.includes('too-many-requests'))
    return t('login.error.tooManyRequests');
  if (code.includes('network-request-failed'))
    return t('login.error.networkError');
  return t('login.error.generic');
}

export default function AdminLogin() {
  const { t } = useTranslation();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `Login | Presto AI`;
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/admin');
    } catch (err) {
      setError(friendlyError(err.code, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card-wrapper">
        <div className="login-card">

          <div className="login-brand">
            <img src="/favicon/android-chrome-192x192.png" alt="Presto AI Logo" className="login-logo" />
            <h1 className="login-title">{t('login.title')}</h1>
            <p className="login-subtitle">{t('login.subtitle')}</p>
          </div>

        <form onSubmit={handleLogin} className="login-form">
          {error && (
            <div className="login-error">
              <span className="login-error-icon">⚠</span>
              {error}
            </div>
          )}

          <div className="login-field">
            <label className="login-label" htmlFor="login-email">{t('login.emailLabel')}</label>
            <input
              id="login-email"
              type="email"
              className="login-input"
              placeholder={t('login.emailPlaceholder')}
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="login-password">{t('login.passwordLabel')}</label>
            <input
              id="login-password"
              type="password"
              className="login-input"
              placeholder={t('login.passwordPlaceholder')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? t('login.submitting') : t('login.submit')}
          </button>
        </form>

        </div>{/* login-card */}
      </div>{/* login-card-wrapper */}
    </div>
  );
}
