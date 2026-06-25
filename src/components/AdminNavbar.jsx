import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import './AdminDashboard.css';

export default function AdminNavbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) {
        navigate('/login');
        return;
      }
      try {
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        if (userDoc.exists()) {
          setRole(userDoc.data().role || 'interviewer');
        } else {
          setRole('interviewer');
        }
      } catch (err) {
        console.error("Error fetching user role for navbar:", err);
        setRole('interviewer');
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [navigate]);

  const path = location.pathname;
  let activeTab = '';
  if (path.startsWith('/admin/positions') || path.startsWith('/admin/sessions') || path.startsWith('/admin/candidate')) {
    activeTab = 'positions';
  } else if (path === '/admin' || path === '/admin/') {
    activeTab = searchParams.get('tab') || localStorage.getItem('adminActiveTab') || 'results';
  }

  const handleTabChange = (tab) => {
    localStorage.setItem('adminActiveTab', tab);
    navigate(`/admin?tab=${tab}`);
  };

  if (loading) {
    return (
      <div className="admin-navbar" style={{ marginBottom: '2rem' }}>
        <div className="admin-navbar-left">
          <h2 className="admin-navbar-title" onClick={() => navigate('/admin')} style={{ cursor: 'pointer' }}>
            {t('dashboard.title')}
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-navbar" style={{ marginBottom: '2rem' }}>
      <div className="admin-navbar-left">
        <h2 className="admin-navbar-title" onClick={() => navigate('/admin')} style={{ cursor: 'pointer' }}>
          {t('dashboard.title')}
        </h2>
        <nav className="admin-tabs">
          <button onClick={() => handleTabChange('results')} className={`admin-tab ${activeTab === 'results' ? 'active' : ''}`}>
            {t('dashboard.tabs.analytics')}
          </button>
          {(role === 'superadmin' || role === 'admin') && (
            <button onClick={() => handleTabChange('positions')} className={`admin-tab ${activeTab === 'positions' ? 'active' : ''}`}>
              {t('dashboard.tabs.positions')}
            </button>
          )}
          {(role === 'superadmin' || role === 'admin') && (
            <button onClick={() => handleTabChange('manage_users')} className={`admin-tab ${activeTab === 'manage_users' ? 'active' : ''}`}>
              {t('dashboard.tabs.manageUsers')}
            </button>
          )}
          <button onClick={() => handleTabChange('questions')} className={`admin-tab ${activeTab === 'questions' ? 'active' : ''}`}>
            {t('dashboard.tabs.questions')}
          </button>
          {(role === 'superadmin' || role === 'admin') && (
            <button onClick={() => handleTabChange('audit')} className={`admin-tab ${activeTab === 'audit' ? 'active' : ''}`}>
              {t('dashboard.tabs.audit')}
            </button>
          )}
          <button onClick={() => handleTabChange('settings')} className={`admin-tab ${activeTab === 'settings' ? 'active' : ''}`}>
            {t('dashboard.tabs.settings')}
          </button>
        </nav>
      </div>
      <div className="admin-navbar-right">
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {t('dashboard.role')}: <strong style={{ color: 'var(--text-highlight)' }}>{role}</strong>
        </span>
        <button onClick={() => auth.signOut()} className="btn-signout">{t('common.signOut')}</button>
      </div>
    </div>
  );
}
