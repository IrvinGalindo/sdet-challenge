import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area, Legend
} from 'recharts';
import { useTranslation } from 'react-i18next';
import {
  Briefcase, Mic2, CheckCircle2, UserCheck, Star, Lock, BarChart2
} from 'lucide-react';

// ── Neural Midnight brand palette for charts ──────────────────
const BRAND = {
  teal:   '#06b6d4',
  mid:    '#3b82f6',
  violet: '#7c3aed',
  green:  '#10b981',
  amber:  '#f59e0b',
  rose:   '#f43f5e',
  purple: '#8b5cf6',
  sky:    '#0ea5e9',
};

const OUTCOME_COLORS = {
  'Strong Hire': BRAND.teal,
  'Hire':        BRAND.green,
  'No Hire':     BRAND.rose,
  'Undecided':   BRAND.amber,
};

const CHART_COLORS = [BRAND.teal, BRAND.mid, BRAND.violet, BRAND.green, BRAND.amber, BRAND.rose, BRAND.purple, BRAND.sky];

// Shared tooltip style
const tooltipStyle = {
  background: 'rgba(8,16,32,0.95)',
  border: '1px solid rgba(6,182,212,0.25)',
  borderRadius: 10,
  color: '#fff',
  boxShadow: '0 8px 24px rgba(0,0,0,0.6), 0 0 20px rgba(6,182,212,0.1)',
  fontSize: 13,
};
const tooltipItemStyle = { color: '#f0f6ff' };
const tooltipCursor = { fill: 'rgba(6,182,212,0.06)' };

// ── Shared chart card wrapper ─────────────────────────────────
function ChartCard({ title, subtitle, children, style = {} }) {
  return (
    <div className="admin-card" style={{ padding: '24px', ...style }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: 0, color: 'var(--text-highlight)', fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
          {title}
        </h3>
        {subtitle && (
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div
      className="admin-card"
      style={{
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        borderLeft: `3px solid ${color}`,
        boxShadow: `var(--shadow-surface), 0 0 16px ${color}18`,
        transition: 'box-shadow 0.25s ease, transform 0.25s ease',
      }}
    >
      <div style={{
        width: 44, height: 44,
        borderRadius: 12,
        background: `${color}18`,
        border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        color,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.9px', fontWeight: 700 }}>
          {label}
        </div>
        <div style={{
          fontSize: 30, fontWeight: 800,
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          background: `linear-gradient(135deg, ${color}, ${color}cc)`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          lineHeight: 1.15,
          marginTop: 2,
        }}>
          {value}
        </div>
        {sub && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
        )}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────
function EmptyChart({ label }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 8,
      color: 'var(--text-muted)', fontSize: 13, opacity: 0.7,
    }}>
      <BarChart2 size={32} strokeWidth={1.5} style={{ opacity: 0.4 }} />
      {label}
    </div>
  );
}

// ── Custom gradient bar ───────────────────────────────────────
function GradientDefs() {
  return (
    <defs>
      <linearGradient id="gradBrand" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stopColor={BRAND.teal} />
        <stop offset="50%"  stopColor={BRAND.mid} />
        <stop offset="100%" stopColor={BRAND.violet} />
      </linearGradient>
      <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor={BRAND.green} stopOpacity={0.9} />
        <stop offset="100%" stopColor={BRAND.teal}  stopOpacity={0.6} />
      </linearGradient>
      <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor={BRAND.teal} stopOpacity={0.25} />
        <stop offset="100%" stopColor={BRAND.teal} stopOpacity={0.01} />
      </linearGradient>
      <linearGradient id="gradAreaHire" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor={BRAND.green} stopOpacity={0.25} />
        <stop offset="100%" stopColor={BRAND.green} stopOpacity={0.01} />
      </linearGradient>
    </defs>
  );
}

// ─────────────────────────────────────────────────────────────
export default function OverviewAnalytics({ role, user }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);

  useEffect(() => {
    /* eslint-disable react-hooks/exhaustive-deps */
    async function loadData() {
      try {
        const isAdminLike = role === 'admin' || role === 'superadmin';

        // ── Fetch positions ──────────────────────────────────
        const pQuery = isAdminLike
          ? collection(db, 'positions')
          : query(collection(db, 'positions'), where('createdBy', '==', user.uid));
        const pSnap = await getDocs(pQuery);
        const positions = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // ── Fetch sessions ───────────────────────────────────
        const sSnap = await getDocs(collection(db, 'sessions'));
        let sessions = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!isAdminLike) sessions = sessions.filter(s => s.interviewerId === user.uid);

        // Sort chronologically
        sessions.sort((a, b) => {
          const ta = (a.scheduledAt || a.createdAt)?.toMillis?.() || 0;
          const tb = (b.scheduledAt || b.createdAt)?.toMillis?.() || 0;
          return ta - tb;
        });

        // ── KPI calculations ─────────────────────────────────
        let openPos = 0, closedPos = 0;
        positions.forEach(p => p.status === 'closed' ? closedPos++ : openPos++);

        let scheduled = 0, completed = 0;
        let outcomeCounts = { 'Strong Hire': 0, 'Hire': 0, 'No Hire': 0, 'Undecided': 0 };
        let totalFitScore = 0, fitScoreCount = 0;
        let totalHireRate = 0;

        sessions.forEach(s => {
          if (s.status === 'scheduled') scheduled++;
          else if (s.status === 'completed') completed++;

          if (s.outcome) {
            outcomeCounts[s.outcome] = (outcomeCounts[s.outcome] || 0) + 1;
          } else if (s.status === 'completed') {
            outcomeCounts['Undecided']++;
          }

          if (s.cvAnalysis?.fitScore) {
            totalFitScore += s.cvAnalysis.fitScore;
            fitScoreCount++;
          }
        });

        const hireableCount = (outcomeCounts['Hire'] || 0) + (outcomeCounts['Strong Hire'] || 0);
        const hireRate = completed > 0 ? Math.round((hireableCount / completed) * 100) : 0;
        const avgFitScore = fitScoreCount > 0 ? (totalFitScore / fitScoreCount).toFixed(1) : '—';
        const completionRate = sessions.length > 0 ? Math.round((completed / sessions.length) * 100) : 0;

        // ── Outcome donut data ───────────────────────────────
        const outcomeData = Object.entries(outcomeCounts)
          .filter(([, val]) => val > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([name, value]) => ({ name, value }));

        // ── Interview volume by month (area chart) ───────────
        const monthMap = {};
        sessions.forEach(s => {
          const ts = s.scheduledAt || s.createdAt;
          if (ts?.toDate) {
            const d = ts.toDate();
            const key = d.toLocaleString('default', { month: 'short', year: '2-digit' });
            if (!monthMap[key]) monthMap[key] = { name: key, total: 0, completed: 0, hires: 0 };
            monthMap[key].total++;
            if (s.status === 'completed') monthMap[key].completed++;
            if (s.outcome === 'Hire' || s.outcome === 'Strong Hire') monthMap[key].hires++;
          }
        });
        const timelineData = Object.values(monthMap);

        // ── Hire rate trend (monthly) ────────────────────────
        const hireRateTrend = timelineData.map(m => ({
          name: m.name,
          'Hire Rate %': m.completed > 0 ? Math.round((m.hires / m.completed) * 100) : 0,
          Interviews: m.total,
        }));

        // ── CV Fit Score distribution ────────────────────────
        const fitScoreCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        sessions.forEach(s => {
          if (s.cvAnalysis?.fitScore) {
            const score = Math.round(s.cvAnalysis.fitScore);
            if (fitScoreCounts[score] !== undefined) fitScoreCounts[score]++;
          }
        });
        const fitScoreData = Object.entries(fitScoreCounts).map(([score, Count]) => ({
          name: `${score} ★`, Count,
        }));

        // ── Top claimed technologies ─────────────────────────
        const techStackCounts = {};
        sessions.forEach(s => {
          s.cvAnalysis?.claimedTechStack?.forEach(tech => {
            if (tech) {
              const k = tech.trim();
              techStackCounts[k] = (techStackCounts[k] || 0) + 1;
            }
          });
        });
        const techStackData = Object.entries(techStackCounts)
          .map(([name, Count]) => ({ name, Count }))
          .sort((a, b) => b.Count - a.Count)
          .slice(0, 10);

        // ── Sessions per position ────────────────────────────
        const positionMap = {};
        sessions.forEach(s => {
          const title = s.positionTitle || 'Unknown';
          if (!positionMap[title]) positionMap[title] = { name: title, total: 0, hires: 0 };
          positionMap[title].total++;
          if (s.outcome === 'Hire' || s.outcome === 'Strong Hire') positionMap[title].hires++;
        });
        const positionData = Object.values(positionMap)
          .sort((a, b) => b.total - a.total)
          .slice(0, 8);

        // ── Fit score vs outcome radar ───────────────────────
        const avgFitByOutcome = {};
        const countByOutcome = {};
        sessions.forEach(s => {
          const outcome = s.outcome || (s.status === 'completed' ? 'Undecided' : null);
          if (!outcome || !s.cvAnalysis?.fitScore) return;
          if (!avgFitByOutcome[outcome]) { avgFitByOutcome[outcome] = 0; countByOutcome[outcome] = 0; }
          avgFitByOutcome[outcome] += s.cvAnalysis.fitScore;
          countByOutcome[outcome]++;
        });
        const radarData = [
          { subject: 'Fit Score',     ...Object.fromEntries(Object.entries(avgFitByOutcome).map(([k, v]) => [k, +(v / (countByOutcome[k] || 1)).toFixed(1)])) },
          { subject: 'Sessions',      ...Object.fromEntries(Object.entries(countByOutcome).map(([k, v]) => [k, v])) },
        ];

        // ── Avg fit score per position ───────────────────────
        const fitPerPos = {};
        const fitCountPerPos = {};
        sessions.forEach(s => {
          const title = s.positionTitle || 'Unknown';
          if (s.cvAnalysis?.fitScore) {
            fitPerPos[title] = (fitPerPos[title] || 0) + s.cvAnalysis.fitScore;
            fitCountPerPos[title] = (fitCountPerPos[title] || 0) + 1;
          }
        });
        const fitPerPositionData = Object.entries(fitPerPos)
          .map(([name, total]) => ({ name, avg: +(total / fitCountPerPos[name]).toFixed(1) }))
          .sort((a, b) => b.avg - a.avg)
          .slice(0, 8);

        setData({
          openPos, closedPos, scheduled, completed,
          totalSessions: sessions.length,
          hireRate, avgFitScore, completionRate,
          outcomeData, timelineData, hireRateTrend,
          fitScoreData, techStackData, positionData,
          radarData, fitPerPositionData,
          outcomes: outcomeCounts,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Analytics load error:', err);
      }
    }

    if (user && role) loadData();
  }, [role, user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⚡</div>
        {t('analytics.loading')}
      </div>
    );
  }

  const getLocalizedOutcome = name => {
    const keyMap = { 'Hire': 'hire', 'Strong Hire': 'strongHire', 'No Hire': 'noHire', 'Undecided': 'undecided' };
    const key = keyMap[name];
    return key ? t(`analytics.outcomes.${key}`) : name;
  };

  return (
    <div style={{ marginBottom: '3rem' }}>
      {/* ── Page header ── */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ margin: 0, color: 'var(--text-highlight)', fontFamily: 'var(--font-display)', letterSpacing: '-0.03em' }}>
          {t('analytics.title')}
        </h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
          {data.totalSessions} {t('analytics.totalSessions').toLowerCase()}
        </span>
      </div>

      {/* ── KPI row — 6 cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 14, marginBottom: 24 }}>
        <KpiCard label={t('positions.openPositions')}   value={data.openPos}          color={BRAND.teal}   icon={<Briefcase   size={18} strokeWidth={1.8} />} />
        <KpiCard label={t('analytics.totalSessions')}   value={data.totalSessions}    color={BRAND.mid}    icon={<Mic2        size={18} strokeWidth={1.8} />} />
        <KpiCard label={t('analytics.completed')}       value={data.completed}        color={BRAND.green}  icon={<CheckCircle2 size={18} strokeWidth={1.8} />}
          sub={`${data.completionRate}% ${t('analytics.completionRate')}`} />
        <KpiCard label={t('analytics.hireRate')}        value={`${data.hireRate}%`}   color={BRAND.violet} icon={<UserCheck   size={18} strokeWidth={1.8} />} />
        <KpiCard label={t('analytics.avgFitScore')}     value={data.avgFitScore}      color={BRAND.amber}  icon={<Star        size={18} strokeWidth={1.8} />}
          sub={`/ 5 ${t('analytics.fitScoreLabel')}`} />
        <KpiCard label={t('analytics.closedPositions')} value={data.closedPos}        color={BRAND.rose}   icon={<Lock        size={18} strokeWidth={1.8} />} />
      </div>

      {/* ── Row 1: Area volume + Outcomes donut ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>

        {/* Interview volume area chart */}
        <ChartCard title={t('analytics.volume')} subtitle={t('analytics.volumeSubtitle')}>
          <div style={{ height: 250 }}>
            {data.timelineData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timelineData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                  <GradientDefs />
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} cursor={{ stroke: BRAND.teal, strokeWidth: 1 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} />
                  <Area type="monotone" dataKey="total"     name={t('analytics.legendTotal')}    stroke={BRAND.teal}  fill="url(#gradArea)"    strokeWidth={2} dot={false} activeDot={{ r: 4, fill: BRAND.teal }} />
                  <Area type="monotone" dataKey="completed" name={t('analytics.legendCompleted')} stroke={BRAND.green} fill="url(#gradAreaHire)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: BRAND.green }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyChart label={t('analytics.timelineNoData')} />}
          </div>
        </ChartCard>

        {/* Outcomes donut */}
        <ChartCard title={t('analytics.outcomesTitle')} subtitle={t('analytics.outcomesSubtitle')}>
          <div style={{ height: 200 }}>
            {data.outcomeData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.outcomeData.map(d => ({ ...d, name: getLocalizedOutcome(d.name) }))}
                    cx="50%" cy="50%"
                    innerRadius={60} outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                  >
                    {data.outcomeData.map((entry, i) => (
                      <Cell
                        key={`cell-${i}`}
                        fill={OUTCOME_COLORS[entry.name] || CHART_COLORS[i]}
                      />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyChart label={t('analytics.outcomesNoData')} />}
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {data.outcomeData.map(entry => (
              <div key={entry.name} style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                background: `${OUTCOME_COLORS[entry.name] || BRAND.mid}14`,
                border: `1px solid ${OUTCOME_COLORS[entry.name] || BRAND.mid}30`,
                padding: '4px 10px', borderRadius: 99,
              }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: OUTCOME_COLORS[entry.name] || BRAND.mid }} />
                <span style={{ color: 'var(--text-highlight)' }}>{getLocalizedOutcome(entry.name)}</span>
                <strong style={{ color: 'var(--text-muted)' }}>{entry.value}</strong>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* ── Row 2: Hire rate trend + Fit score bars ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

        {/* Hire rate % over time */}
        <ChartCard title={t('analytics.hireRateTrend')} subtitle={t('analytics.hireRateTrendSubtitle')}>
          <div style={{ height: 240 }}>
            {data.hireRateTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.hireRateTrend} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
                  <Line
                    type="monotone"
                    dataKey="Hire Rate %"
                    stroke={BRAND.violet}
                    strokeWidth={2.5}
                    dot={{ fill: BRAND.violet, r: 4 }}
                    activeDot={{ r: 6, fill: BRAND.violet, stroke: 'rgba(124,58,237,0.3)', strokeWidth: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart label={t('analytics.outcomesNoData')} />}
          </div>
        </ChartCard>

        {/* CV Fit Score distribution */}
        <ChartCard title={t('analytics.fitScoreTitle')} subtitle={t('analytics.fitScoreSubtitle')}>
          <div style={{ height: 240 }}>
            {data.fitScoreData.some(d => d.Count > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.fitScoreData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                  <GradientDefs />
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
                  <Bar dataKey="Count" fill="url(#gradBrand)" radius={[5, 5, 0, 0]} maxBarSize={52} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart label={t('analytics.fitScoreNoData')} />}
          </div>
        </ChartCard>
      </div>

      {/* ── Row 3: Interviews per position + Avg fit by position ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

        {/* Sessions per position (horizontal bar) */}
        <ChartCard title={t('analytics.positionTitle')} subtitle={t('analytics.positionSubtitle')}>
          <div style={{ height: 260 }}>
            {data.positionData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.positionData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <GradientDefs />
                  <XAxis type="number" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} width={100} />
                  <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
                  <Bar dataKey="total" name={t('analytics.legendTotal')} fill={BRAND.teal}  radius={[0, 5, 5, 0]} maxBarSize={18} />
                  <Bar dataKey="hires" name={t('analytics.legendHires')} fill={BRAND.green} radius={[0, 5, 5, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart label={t('analytics.timelineNoData')} />}
          </div>
        </ChartCard>

        {/* Average Fit Score per position */}
        <ChartCard title={t('analytics.fitPerPositionTitle')} subtitle={t('analytics.fitPerPositionSubtitle')}>
          <div style={{ height: 260 }}>
            {data.fitPerPositionData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.fitPerPositionData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <GradientDefs />
                  <XAxis type="number" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} domain={[0, 5]} ticks={[1,2,3,4,5]} />
                  <YAxis dataKey="name" type="category" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} width={100} />
                  <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
                  <Bar dataKey="avg" name={t('analytics.avgFitScore')} radius={[0, 5, 5, 0]} maxBarSize={18}>
                    {data.fitPerPositionData.map((entry, i) => (
                      <Cell
                        key={`fit-cell-${i}`}
                        fill={entry.avg >= 4 ? BRAND.green : entry.avg >= 3 ? BRAND.amber : BRAND.rose}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart label={t('analytics.fitScoreNoData')} />}
          </div>
        </ChartCard>
      </div>

      {/* ── Row 4: Top tech stack ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
        <ChartCard title={t('analytics.techStackTitle')} subtitle={t('analytics.techStackSubtitle')}>
          <div style={{ height: 260 }}>
            {data.techStackData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.techStackData} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 0 }}>
                  <GradientDefs />
                  <XAxis type="number" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} width={90} />
                  <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
                  <Bar dataKey="Count" name={t('analytics.candidatesLabel')} fill="url(#gradBrand)" radius={[0, 5, 5, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart label={t('analytics.techStackNoData')} />}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
