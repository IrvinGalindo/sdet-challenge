import { Check, X, Globe, Pencil, Trash2 } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import {
  collection, query, getDocs, addDoc, updateDoc, deleteDoc,
  doc, where, orderBy
} from 'firebase/firestore';
import ConfirmDialog, { useConfirmDialog } from './ConfirmDialog';
import { useTranslation } from 'react-i18next';

const LEVELS = ['SDET Team Lead', 'Senior SDET', 'Mid SDET', 'Junior SDET', 'General'];
const CATEGORIES = [
  'Testing Fundamentals', 'API & Microservices', 'Test Automation',
  'CI/CD & DevOps', 'Leadership', 'Performance Testing', 'Code Challenge', 'Other'
];

const blankQuestion = () => ({
  title: '',
  prompt: '',
  reference: '',
  level: LEVELS[0],
  category: CATEGORIES[0],
  weight: 3,
});

export default function QuestionsManager({ currentUser, role, creatorChain }) {
  // creatorChain: for interviewer = [superadmin_uid?, admin_uid]
  // for admin     = [superadmin_uid?]
  // for superadmin= []
  const { t } = useTranslation();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [notification, setNotification] = useState(null);
  const { dialogProps, openConfirm } = useConfirmDialog();

  // Form state
  const [showForm, setShowForm]   = useState(false);
  const [editingId, setEditingId] = useState(null); // null = new
  const [form, setForm]           = useState(blankQuestion());
  const [saving, setSaving]       = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchQuestions = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'questions'));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      let visible = [];
      if (role === 'superadmin') {
        visible = all;
      } else if (role === 'admin') {
        // global + own + interviewers they created
        visible = all.filter(q =>
          q.scope === 'global' ||
          q.createdBy === currentUser.uid ||
          (creatorChain || []).includes(q.createdBy)
        );
      } else {
        // interviewer: global + admin's + own
        visible = all.filter(q =>
          q.scope === 'global' ||
          q.createdBy === currentUser.uid ||
          (creatorChain || []).includes(q.createdBy)
        );
      }

      setQuestions(visible.sort((a, b) => (a.category || '').localeCompare(b.category || '')));
    } catch (err) {
      console.error(err);
      showNotification(t('questions.errorLoading', 'Error loading questions: ') + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [currentUser, role, creatorChain, t]);

  useEffect(() => { fetchQuestions(); }, [fetchQuestions]);

  const canEdit = (q) => {
    if (role === 'superadmin') return true;
    return q.createdBy === currentUser?.uid;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.prompt.trim()) {
      showNotification(t('questions.titleAndPromptRequired', 'Title and Question are required.'), 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        weight: Number(form.weight) || 1,
        createdBy: currentUser.uid,
        scope: role === 'superadmin' ? 'global' : currentUser.uid,
        updatedAt: new Date().toISOString(),
      };
      if (editingId) {
        await updateDoc(doc(db, 'questions', editingId), payload);
        showNotification(t('questions.updated', 'Question updated!'));
      } else {
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'questions'), payload);
        showNotification(t('questions.created', 'Question created!'));
      }
      setShowForm(false);
      setEditingId(null);
      setForm(blankQuestion());
      fetchQuestions();
    } catch (err) {
      showNotification(t('questions.errorSaving', 'Error saving: ') + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (q) => {
    setForm({
      title: q.title || '',
      prompt: q.prompt || '',
      reference: q.reference || '',
      level: q.level || LEVELS[0],
      category: q.category || CATEGORIES[0],
      weight: q.weight || 1,
    });
    setEditingId(q.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (qId) => {
    const ok = await openConfirm({
      title: t('questions.deleteConfirmTitle', 'Delete question?'),
      message: t('questions.deleteConfirmMessage', 'This will permanently remove the question from the bank.'),
      note: t('questions.deleteConfirmNote', 'This action cannot be undone.'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'questions', qId));
      setQuestions(prev => prev.filter(q => q.id !== qId));
      showNotification(t('questions.deleted', 'Question deleted.'));
    } catch (err) {
      showNotification(t('questions.errorDeleting', 'Error deleting: ') + err.message, 'error');
    }
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(blankQuestion());
  };

  // Group by category for display
  const grouped = questions.reduce((acc, q) => {
    const cat = q.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(q);
    return acc;
  }, {});

  const inputStyle = {
    padding: '9px 12px',
    background: 'var(--bg-main)',
    border: '1px solid var(--border-color)',
    color: '#fff',
    borderRadius: '6px',
    fontFamily: 'inherit',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
  };

  const selectStyle = { ...inputStyle, cursor: 'pointer', appearance: 'none' };

  return (
    <div style={{ color: '#fff' }}>
      {notification && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: notification.type === 'error' ? 'var(--accent-danger)' : 'var(--accent-success)',
          color: '#fff', padding: '14px 22px', borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700
        }}>
          {notification.type === 'success' ? <Check size={16} /> : <X size={16} />} {notification.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>{t('questions.bankTitle', 'Questions Bank')}</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
            {role === 'superadmin' && t('questions.visibilitySuperAdmin', 'Global questions are visible to all staff.')}
            {role === 'admin' && t('questions.visibilityAdmin', 'Your questions are visible to you and interviewers you created.')}
            {role === 'interviewer' && t('questions.visibilityInterviewer', 'Your questions are visible to you and your admin.')}
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(blankQuestion()); }}
            style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
          >
            + {t('questions.newQuestion')}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1.5rem', marginBottom: '2rem', borderTop: '3px solid var(--accent-primary)' }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? t('questions.editQuestion', 'Edit Question') : t('questions.newQuestion')}</h3>
          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{t('questions.levelLabel', 'Level')} *</label>
                <div style={{ position: 'relative' }}>
                  <select style={selectStyle} value={form.level} onChange={e => setForm({ ...form, level: e.target.value })}>
                    {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-primary)', pointerEvents: 'none', fontSize: 11 }}>▼</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{t('questions.fields.category')} *</label>
                <div style={{ position: 'relative' }}>
                  <select style={selectStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-primary)', pointerEvents: 'none', fontSize: 11 }}>▼</span>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{t('questions.titleLabel', 'Title / Short Label')} *</label>
              <input style={inputStyle} placeholder="e.g. Flaky test suite stabilization" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{t('questions.fields.question')} / {t('questions.promptLabel', 'Prompt')} *</label>
              <textarea
                style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
                placeholder="How do you define and measure the overall quality health of a product — beyond pass/fail rates?"
                value={form.prompt}
                onChange={e => setForm({ ...form, prompt: e.target.value })}
                required
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{t('questions.rubricLabel', 'Grading Rubric / Reference Answer')}</label>
              <textarea
                style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontStyle: 'italic', color: 'var(--text-muted)' }}
                placeholder="What strong answers include: ..."
                value={form.reference}
                onChange={e => setForm({ ...form, reference: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('questions.weightLabel', 'Weight (1–10)')}:</label>
                <input
                  type="number" min={1} max={10}
                  style={{ ...inputStyle, width: 70 }}
                  value={form.weight}
                  onChange={e => setForm({ ...form, weight: e.target.value })}
                />
              </div>
              {role === 'superadmin' && (
                <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, background: 'rgba(99,102,241,0.2)', color: 'var(--accent-primary)', fontWeight: 700 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Globe size={14} /> {t('questions.savedAsGlobal', 'Will be saved as Global')}</span>
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
                <button type="button" onClick={cancelForm} style={{ padding: '10px 20px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' }}>
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={saving} style={{ padding: '10px 20px', background: 'var(--accent-success)', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? t('common.loading') : editingId ? t('questions.updateQuestion', 'Update Question') : t('questions.saveQuestion', 'Save Question')}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Question list grouped by category */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>{t('common.loading')}</div>
      ) : questions.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
          {t('questions.emptyState', 'No questions yet. Click "+ New Question" to create the first one.')}
        </div>
      ) : (
        Object.entries(grouped).map(([cat, qs]) => (
          <div key={cat} style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--accent-primary)' }}>{cat}</h3>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.07)', padding: '2px 8px', borderRadius: 10 }}>
                {qs.length} {qs.length !== 1 ? t('questions.questionsPlural', 'questions') : t('questions.questionSingular', 'question')}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {qs.map(q => (
                <div key={q.id} style={{
                  background: 'var(--bg-card)', borderRadius: '8px',
                  border: `1px solid ${q.scope === 'global' ? 'rgba(99,102,241,0.4)' : 'var(--border-color)'}`,
                  overflow: 'hidden'
                }}>
                  <div
                    onClick={() => setExpandedId(expandedId === q.id ? null : q.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}
                  >
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{q.title}</span>
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.07)', color: 'var(--text-muted)' }}>{q.level}</span>
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.07)', color: 'var(--text-muted)' }}>W: {q.weight}</span>
                    {q.scope === 'global' && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(99,102,241,0.2)', color: 'var(--accent-primary)', fontWeight: 700 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={11} /> {t('questions.globalBadge', 'Global')}</span></span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{expandedId === q.id ? '▲' : '▼'}</span>
                  </div>

                  {expandedId === q.id && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.15)' }}>
                      <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.6, fontStyle: 'italic' }}>"{q.prompt}"</p>
                      {q.reference && (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '10px 14px', borderLeft: '3px solid var(--accent-warning)', borderRadius: '0 4px 4px 0', marginBottom: 12 }}>
                          <strong>{t('questions.rubricPrefix', 'Rubric')}:</strong> {q.reference}
                        </div>
                      )}
                      {canEdit(q) && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => handleEdit(q)} style={{ padding: '6px 14px', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Pencil size={12} /> {t('questions.editBtn', 'Edit')}</span>
                          </button>
                          <button onClick={() => handleDelete(q.id)} style={{ padding: '6px 14px', background: 'var(--accent-danger)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Trash2 size={12} /> {t('common.delete')}</span>
                          </button>
                        </div>
                      )}
                      {!canEdit(q) && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('questions.readOnly', 'Read-only — created by another user')}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
