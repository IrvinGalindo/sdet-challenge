import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { useTranslation } from 'react-i18next';

const COLORS = ['#10b981', '#6366f1', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899'];

export default function OverviewAnalytics({ role, user }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);

  useEffect(() => {
    async function loadData() {
      try {
        const isAdminLike = role === 'admin' || role === 'superadmin';
        
        // Fetch positions
        const pQuery = isAdminLike 
          ? collection(db, 'positions')
          : query(collection(db, 'positions'), where('createdBy', '==', user.uid));
        const pSnap = await getDocs(pQuery);
        const positions = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Fetch sessions
        const sSnap = await getDocs(collection(db, 'sessions'));
        let sessions = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        if (!isAdminLike) {
          sessions = sessions.filter(s => s.interviewerId === user.uid);
        }

        let openPos = 0;
        let closedPos = 0;
        positions.forEach(p => p.status === 'closed' ? closedPos++ : openPos++);

        let totalSessions = sessions.length;
        let scheduled = 0;
        let completed = 0;
        
        let outcomeCounts = { 'Hire': 0, 'Strong Hire': 0, 'No Hire': 0, 'Undecided': 0 };
        
        sessions.forEach(s => {
          if (s.status === 'scheduled') scheduled++;
          else if (s.status === 'completed') completed++;
          
          if (s.outcome) {
            outcomeCounts[s.outcome] = (outcomeCounts[s.outcome] || 0) + 1;
          } else if (s.status === 'completed') {
             outcomeCounts['Undecided']++;
          }
        });

        // Format outcome data for Pie chart
        const outcomeData = Object.entries(outcomeCounts)
          .filter(([_, val]) => val > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([name, value]) => ({ name, value }));

        // Format timeline data for Bar chart
        const timeMap = {};
        sessions.forEach(s => {
          const ts = s.scheduledAt || s.createdAt;
          if (ts && ts.toDate) {
            const d = ts.toDate();
            const key = d.toLocaleString('default', { month: 'short' }) + ' ' + d.getDate();
            timeMap[key] = (timeMap[key] || 0) + 1;
          }
        });
        
        // Sort timeline chronologically (approximate by sorting keys if they were padded, but we just want an ordered array if possible.
        // Actually sorting by string might be weird, so we can sort the sessions first:
        sessions.sort((a, b) => {
           const ta = (a.scheduledAt || a.createdAt)?.toMillis?.() || 0;
           const tb = (b.scheduledAt || b.createdAt)?.toMillis?.() || 0;
           return ta - tb;
        });

        const sortedTimeMap = {};
        sessions.forEach(s => {
          const ts = s.scheduledAt || s.createdAt;
          if (ts && ts.toDate) {
             const d = ts.toDate();
             const key = d.toLocaleString('default', { month: 'short' }) + ' ' + d.getDate();
             sortedTimeMap[key] = (sortedTimeMap[key] || 0) + 1;
          }
        });

        const timelineData = Object.entries(sortedTimeMap).map(([name, Interviews]) => ({ name, Interviews }));

        setData({
          openPos, closedPos, totalSessions, scheduled, completed,
          outcomeData, timelineData
        });
      } catch (err) {
        console.error('Failed to load analytics:', err);
      }
    }
    
    if (user && role) {
      loadData();
    }
  }, [role, user]);

  if (!data) return <div style={{ padding: '24px 0', color: 'var(--text-muted)' }}>{t('analytics.loading')}</div>;

  const getLocalizedOutcome = (name) => {
    const keyMap = {
      'Hire': 'hire',
      'Strong Hire': 'strongHire',
      'No Hire': 'noHire',
      'Undecided': 'undecided'
    };
    const key = keyMap[name];
    return key ? t(`analytics.outcomes.${key}`) : name;
  };

  return (
    <div style={{ marginBottom: '3rem' }}>
      <h2 style={{ margin: '0 0 20px', color: 'var(--text-highlight)' }}>{t('analytics.title')}</h2>
      
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="admin-card" style={{ padding: '24px', textAlign: 'center', borderTop: '4px solid var(--accent-primary)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{t('positions.openPositions')}</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-highlight)', marginTop: 12 }}>{data.openPos}</div>
        </div>
        <div className="admin-card" style={{ padding: '24px', textAlign: 'center', borderTop: '4px solid var(--accent-success)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{t('analytics.totalSessions')}</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-highlight)', marginTop: 12 }}>{data.totalSessions}</div>
        </div>
        <div className="admin-card" style={{ padding: '24px', textAlign: 'center', borderTop: '4px solid var(--accent-warning)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{t('analytics.completed')}</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-highlight)', marginTop: 12 }}>{data.completed}</div>
        </div>
        <div className="admin-card" style={{ padding: '24px', textAlign: 'center', borderTop: '4px solid var(--text-muted)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{t('analytics.closedPositions')}</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-highlight)', marginTop: 12 }}>{data.closedPos}</div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24 }}>
        
        {/* Timeline */}
        <div className="admin-card" style={{ padding: '24px' }}>
          <h3 style={{ margin: '0 0 24px', color: 'var(--text-highlight)', fontSize: 16 }}>{t('analytics.volume')}</h3>
          <div style={{ height: 260 }}>
            {data.timelineData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 8, color: '#fff' }} 
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }} 
                  />
                  <Bar dataKey="Interviews" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} maxBarSize={50} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 100 }}>{t('analytics.timelineNoData')}</div>}
          </div>
        </div>

        {/* Outcomes */}
        <div className="admin-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 24px', color: 'var(--text-highlight)', fontSize: 16 }}>{t('analytics.outcomesTitle')}</h3>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ height: 220, width: '100%' }}>
              {data.outcomeData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={data.outcomeData.map(d => ({ ...d, name: getLocalizedOutcome(d.name) }))} 
                      cx="50%" cy="50%" 
                      innerRadius={65} outerRadius={90} 
                      paddingAngle={4} 
                      dataKey="value"
                      stroke="none"
                    >
                      {data.outcomeData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 8, color: '#fff' }} 
                      itemStyle={{ color: 'var(--text-highlight)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 100 }}>{t('analytics.outcomesNoData')}</div>}
            </div>
            
            {/* Legend */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
              {data.outcomeData.map((entry, i) => (
                <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length] }}></div>
                  <span style={{ color: 'var(--text-highlight)' }}>{getLocalizedOutcome(entry.name)}</span>
                  <strong style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{entry.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
