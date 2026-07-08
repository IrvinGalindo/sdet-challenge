import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { FileText, Brain, Lightbulb, ClipboardCheck, Scale } from 'lucide-react';

// Admin-only view of the ai_audit/ log. Every LLM call we've made (parseJD,
// generateQuestionBank, liveSuggestion, evaluateSession, biasAudit) appends
// a row here from the client right after the call returns.
//
// Rules already restrict reads to isAdmin().

export default function AuditTrail({ currentUser, role }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');

  const PROMPT_TYPE_LABEL = {
    parse_jd:           { label: t('audit.types.parseJD', 'Parse JD'),          icon: <FileText size={12} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />, color: 'var(--accent-primary)' },
    generate_questions: { label: t('audit.types.generateBank', 'Generate Bank'), icon: <Brain size={12} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />, color: 'var(--accent-warning)' },
    live_suggestion:    { label: t('audit.types.liveSuggestion', 'Live Suggestion'), icon: <Lightbulb size={12} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />, color: '#60a5fa' },
    evaluate_session:   { label: t('audit.types.evaluateSession', 'Evaluate Session'), icon: <ClipboardCheck size={12} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />, color: 'var(--accent-success)' },
    bias_audit:         { label: t('audit.types.biasAudit', 'Bias Audit'),       icon: <Scale size={12} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />, color: '#a78bfa' },
  };

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'ai_audit'), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(
      q,
      snap => {
        setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      err => {
        console.warn('Audit listener:', err.code, err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [currentUser]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filterType !== 'all' && r.promptType !== filterType) return false;
      if (!q) return true;
      const haystack = [
        r.sessionId, r.positionId, r.model, r.promptType, r.createdBy,
        r.overall, JSON.stringify(r),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, filterType, search]);

  const totalTokens  = filtered.reduce((sum, r) => sum + (Number(r.tokensUsed) || 0), 0);
  const totalLatency = filtered.reduce((sum, r) => sum + (Number(r.latencyMs)  || 0), 0);
  const avgLatency   = filtered.length ? Math.round(totalLatency / filtered.length) : 0;

  if (role !== 'admin' && role !== 'superadmin') {
    return (
      <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: 8 }}>
        {t('audit.adminOnly', 'AI audit trail is admin-only.')}
      </div>
    );
  }

  return (
    <div style={{ color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>{t('audit.title')}</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
            {t('audit.subtitle', 'Every LLM call made by this platform. Showing the 200 most recent.')}
          </p>
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <SummaryChip label={t('audit.totalCalls', 'Total calls')}   value={filtered.length} />
        <SummaryChip label={t('audit.tokensUsed', 'Tokens used')}   value={totalTokens.toLocaleString()} />
        <SummaryChip label={t('audit.avgLatency', 'Avg latency')}   value={avgLatency ? `${avgLatency} ms` : '—'} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          style={{ padding: '8px 12px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 6, color: '#fff', fontSize: 13, cursor: 'pointer' }}
        >
          <option value="all">{t('audit.allCallTypes', 'All call types')}</option>
          {Object.entries(PROMPT_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('audit.searchPlaceholder', 'Search sessionId / positionId / model…')}
          style={{ flex: 1, minWidth: 220, padding: '8px 12px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 6, color: '#fff', fontSize: 13 }}
        />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: 8 }}>
          {rows.length === 0 ? t('audit.noCallsYet', 'No AI calls have been logged yet.') : t('audit.noMatchFilter', 'No entries match the current filter.')}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('audit.when', 'When')}</th>
                <th>{t('audit.type', 'Type')}</th>
                <th>{t('audit.model', 'Model')}</th>
                <th>{t('audit.tokens', 'Tokens')}</th>
                <th>{t('audit.session', 'Session')}</th>
                <th>{t('positions.fields.title', 'Position')}</th>
                <th>{t('audit.latency', 'Latency')}</th>
                <th>{t('audit.extra', 'Extra')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const meta = PROMPT_TYPE_LABEL[r.promptType] || { label: r.promptType || '—', icon: '•', color: 'var(--text-muted)' };
                return (
                  <tr key={r.id}>
                    <td className="cell-muted" style={{ fontSize: 12 }}>
                      {r.createdAt?.toDate?.().toLocaleString() || '—'}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4, background: `${meta.color}22`, color: meta.color, whiteSpace: 'nowrap' }}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td className="cell-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {(r.model || '—').replace('anthropic/', 'a/').replace('openai/', 'o/')}
                    </td>
                    <td className="cell-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right' }}>
                      {Number(r.tokensUsed) ? Number(r.tokensUsed).toLocaleString() : '—'}
                    </td>
                    <td>
                      {r.sessionId ? (
                        <button onClick={() => navigate(`/admin/sessions/${r.sessionId}`)} style={linkBtn} title={r.sessionId}>
                          {r.sessionId.slice(0, 8)}…
                        </button>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>
                      {r.positionId ? (
                        <button onClick={() => navigate(`/admin/positions/${r.positionId}`)} style={linkBtn} title={r.positionId}>
                          {r.positionId.slice(0, 8)}…
                        </button>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="cell-muted" style={{ fontSize: 12 }}>
                      {r.latencyMs ? `${r.latencyMs} ms` : '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {r.promptType === 'bias_audit' && r.overall && <span>{r.overall.replace('_', ' ')}, {r.flagCount ?? 0} {t('audit.flags', 'flag(s)')}</span>}
                      {r.promptType === 'generate_questions' && (r.questionsAdded != null) && <span>{r.questionsAdded} Q, {r.challengesAdded ?? 0} C</span>}
                      {r.error && <span style={{ color: 'var(--accent-danger)' }}>err: {r.error}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryChip({ label, value }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-highlight)', marginTop: 2 }}>{value}</div>
    </div>
  );
}

const linkBtn = {
  background: 'transparent', border: 'none', color: 'var(--accent-primary)',
  cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 0,
};
