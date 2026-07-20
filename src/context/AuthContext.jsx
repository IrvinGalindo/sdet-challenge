import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [role, setRole]       = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          setRole(snap.exists() ? (snap.data().role || 'interviewer') : 'interviewer');
        } catch (e) {
          console.warn('[AuthContext] Error loading user role:', e);
          setRole('interviewer');
        }
      } else {
        setUser(null);
        setRole(null);
      }
      setAuthReady(true);
    });
    return unsub;
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, authReady }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
};
