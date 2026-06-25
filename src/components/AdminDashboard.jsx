import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { auth, db, firebaseConfig } from '../firebase';
import { collection, query, getDocs, doc, getDoc, setDoc, deleteDoc, where, addDoc, onSnapshot } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, updatePassword } from 'firebase/auth';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ScorecardBuilder from './ScorecardBuilder';
import QuestionsManager from './QuestionsManager';
import PositionsManager from './PositionsManager';
import AuditTrail from './AuditTrail';
import ConfirmDialog, { useConfirmDialog } from './ConfirmDialog';
import OverviewAnalytics from './OverviewAnalytics';
import AdminNavbar from './AdminNavbar';
import './AdminDashboard.css';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // 'superadmin' | 'admin' | 'interviewer'
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState(null);
  const [settingsPass, setSettingsPass] = useState('');
  const [creatorChain, setCreatorChain] = useState([]); // UIDs of admins above current user
  const { dialogProps, openConfirm } = useConfirmDialog();

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // For super admin creating an interviewer
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState('interviewer');

  const navigate = useNavigate();

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {

      if (!u) {
        navigate('/login');
        return;
      }
      setUser(u);

      try {
        // Fetch user role + doc
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        let currentRole = 'interviewer';
        let userData = {};
        if (userDoc.exists()) {
          userData = userDoc.data();
          currentRole = userData.role || 'interviewer';
        }
        setRole(currentRole);

        // Build creator chain for question visibility
        const chain = [];
        if (currentRole === 'interviewer' && userData.createdBy) {
          chain.push(userData.createdBy);
          const adminDoc = await getDoc(doc(db, 'users', userData.createdBy));
          if (adminDoc.exists() && adminDoc.data().createdBy) {
            chain.push(adminDoc.data().createdBy);
          }
        } else if (currentRole === 'admin' && userData.createdBy) {
          chain.push(userData.createdBy);
        }
        setCreatorChain(chain);

        let myStaffIds = [];

        if (currentRole === 'superadmin') {
          const usersSnap = await getDocs(query(collection(db, 'users')));
          const loadedStaff = [];
          usersSnap.forEach(d => loadedStaff.push({ id: d.id, ...d.data() }));
          setStaffList(loadedStaff);
        } else if (currentRole === 'admin') {
          const usersSnap = await getDocs(query(collection(db, 'users'), where('createdBy', '==', u.uid)));
          const loadedStaff = [];
          usersSnap.forEach(d => {
            loadedStaff.push({ id: d.id, ...d.data() });
            myStaffIds.push(d.id);
          });
          setStaffList(loadedStaff);
        }



      } catch (err) {
        console.error("Dashboard fetch error:", err);
        showNotification(t('dashboard.createStaff.error', { message: err.message }), 'error');
      } finally {
        setLoading(false);
      }
    });

    // Cleanup: unsubscribe the auth listener
    return () => {
      unsub();
    };
  }, [navigate]);


  const handleCreateInterviewer = async (e) => {
    e.preventDefault();
    try {
      const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp-" + Date.now());
      const secondaryAuth = getAuth(secondaryApp);
      const res = await createUserWithEmailAndPassword(secondaryAuth, newEmail, newPass);
      await secondaryAuth.signOut();
      await setDoc(doc(db, 'users', res.user.uid), {
        role: newRole,
        email: newEmail,
        createdBy: user.uid,
      });
      setStaffList(prev => [...prev, { id: res.user.uid, role: newRole, email: newEmail, createdBy: user.uid }]);
      showNotification(t('dashboard.createStaff.success', { email: newEmail, role: newRole }));
      setNewEmail('');
      setNewPass('');
    } catch (err) {
      showNotification(t('dashboard.createStaff.error', { message: err.message }), 'error');
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    try {
      await updatePassword(user, settingsPass);
      showNotification(t('dashboard.settings.successMessage'));
      setSettingsPass('');
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        showNotification(t('dashboard.settings.requiresRelogin'), 'error');
      } else {
        showNotification(t('dashboard.createStaff.error', { message: err.message }), 'error');
      }
    }
  };

  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || localStorage.getItem('adminActiveTab') || 'results';

  useEffect(() => {
    localStorage.setItem('adminActiveTab', activeTab);
  }, [activeTab]);

  if (loading) return <div style={{ color: '#fff', padding: '2rem' }}>{t('common.loading')}</div>;

  return (
    <div style={{ padding: '2rem', color: '#fff' }}>

      {notification && (
        <div className={`admin-toast ${notification.type}`}>
          <span>{notification.type === 'success' ? '✅' : '❌'}</span>
          {notification.message}
        </div>
      )}

      {/* Navbar */}
      <AdminNavbar />

      {activeTab === 'results' && (
        <>
          <OverviewAnalytics role={role} user={user} />


        </>
      )}

      {activeTab === 'manage_users' && (role === 'superadmin' || role === 'admin') && (
        <>
          <div className="admin-card" style={{ marginBottom: '2rem' }}>
            <h3 className="admin-card-title">{t('dashboard.createStaff.title')}</h3>
            <p className="admin-card-desc" style={{ maxWidth: 600 }}>
              {t('dashboard.createStaff.desc')}
              {role === 'superadmin' ? t('dashboard.createStaff.descSuperAdmin') : t('dashboard.createStaff.descAdmin')}
            </p>
            <form onSubmit={handleCreateInterviewer} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="email" placeholder={t('dashboard.createStaff.emailPlaceholder')} value={newEmail} onChange={e => setNewEmail(e.target.value)} required className="admin-form-input" style={{ width: 210 }} />
              <input type="password" placeholder={t('dashboard.createStaff.passwordPlaceholder')} value={newPass} onChange={e => setNewPass(e.target.value)} required className="admin-form-input" style={{ width: 210 }} />
              <div style={{ position: 'relative', width: 180 }}>
                <select value={newRole} onChange={e => setNewRole(e.target.value)} className="admin-form-input" style={{ width: '100%', appearance: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  <option value="interviewer">{t('dashboard.createStaff.roleInterviewer')}</option>
                  {role === 'superadmin' && <option value="admin">{t('dashboard.createStaff.roleAdmin')}</option>}
                  {role === 'superadmin' && <option value="superadmin">{t('dashboard.createStaff.roleSuperAdmin')}</option>}
                </select>
                <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--accent-primary)', fontSize: 11 }}>▼</div>
              </div>
              <button type="submit" className="admin-form-btn">{t('dashboard.createStaff.submit')}</button>
            </form>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('dashboard.staff.email')}</th>
                  <th>{t('dashboard.staff.role')}</th>
                  <th>{t('dashboard.staff.userId')}</th>
                </tr>
              </thead>
              <tbody>
                {staffList.length === 0 ? (
                  <tr className="admin-empty-row"><td colSpan={3}>{t('dashboard.staff.noStaff')}</td></tr>
                ) : (
                  staffList.map(s => (
                    <tr key={s.id} style={{ cursor: 'default' }}>
                      <td style={{ fontWeight: 600 }}>{s.email || t('common.unknown')}</td>
                      <td>
                        <span style={{ color: s.role === 'superadmin' ? 'var(--accent-success)' : s.role === 'admin' ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: 600, fontSize: 13 }}>{s.role}</span>
                      </td>
                      <td className="cell-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.id}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'positions' && (role === 'superadmin' || role === 'admin') && (
        <PositionsManager currentUser={user} role={role} />
      )}

      {activeTab === 'questions' && (
        <QuestionsManager
          currentUser={user}
          role={role}
          creatorChain={creatorChain}
        />
      )}

      {activeTab === 'audit' && (role === 'superadmin' || role === 'admin') && (
        <AuditTrail currentUser={user} role={role} />
      )}

      {activeTab === 'settings' && (
        <div className="admin-card" style={{ maxWidth: 560 }}>
          <h3 className="admin-card-title">{t('dashboard.settings.title')}</h3>
          <p className="admin-card-desc">
            {t('dashboard.settings.desc')}
          </p>
          <form onSubmit={handleUpdatePassword} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="password"
              placeholder={t('dashboard.settings.newPasswordPlaceholder')}
              value={settingsPass}
              onChange={e => setSettingsPass(e.target.value)}
              required
              className="admin-form-input"
              style={{ width: 250 }}
            />
            <button type="submit" className="admin-form-btn warning">{t('dashboard.settings.changePassword')}</button>
          </form>
        </div>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
