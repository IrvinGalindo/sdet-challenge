import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import ConfirmDialog, { useConfirmDialog } from './ConfirmDialog';
import { useTranslation } from 'react-i18next';

export default function ScorecardBuilder() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState(null);
  const { dialogProps, openConfirm } = useConfirmDialog();

  const [scorecardData, setScorecardData] = useState([]);
  const [codeChallenge, setCodeChallenge] = useState({});

  useEffect(() => {
    async function fetchSchema() {
      try {
        const snap = await getDoc(doc(db, 'settings', 'scorecard'));
        if (snap.exists()) {
          const data = snap.data();
          setScorecardData(data.SCORECARD_DATA || []);
          setCodeChallenge(data.CODE_CHALLENGE || {});
        }
      } catch (err) {
        console.error("Error loading scorecard:", err);
        showNotification(t('scorecard.errorLoading', "Failed to load scorecard schema."), "error");
      } finally {
        setLoading(false);
      }
    }
    fetchSchema();
  }, []);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Calculate new MAX_SCORE
      let newMax = 0;
      scorecardData.forEach(cat => {
        cat.questions.forEach(q => {
          newMax += (Number(q.weight) || 0) * 4;
        });
      });

      await setDoc(doc(db, 'settings', 'scorecard'), {
        SCORECARD_DATA: scorecardData,
        CODE_CHALLENGE: codeChallenge,
        MAX_SCORE: newMax
      });
      showNotification(t('scorecard.savedSuccess', 'Scorecard updated successfully!'));
    } catch (err) {
      showNotification(t('scorecard.errorSaving', 'Error saving scorecard: ') + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // --- Helpers for Category / Question Manipulation ---
  const addCategory = () => {
    setScorecardData([...scorecardData, { category: t('scorecard.newCategory', 'New Category'), questions: [] }]);
  };

  const removeCategory = async (catIdx) => {
    const ok = await openConfirm({
      title: t('scorecard.deleteCategoryTitle', 'Delete category?'),
      message: t('scorecard.deleteCategoryMessage', 'This will remove the entire category and all its questions from the scorecard.'),
      note: t('scorecard.deleteCategoryNote', 'This action cannot be undone.'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    const newData = [...scorecardData];
    newData.splice(catIdx, 1);
    setScorecardData(newData);
  };

  const updateCategoryName = (catIdx, newName) => {
    const newData = [...scorecardData];
    newData[catIdx].category = newName;
    setScorecardData(newData);
  };

  const addQuestion = (catIdx) => {
    const newData = [...scorecardData];
    newData[catIdx].questions.push({
      id: "q" + Date.now(),
      title: t('scorecard.newQuestion', 'New Question'),
      prompt: "",
      reference: "",
      weight: 1
    });
    setScorecardData(newData);
  };

  const removeQuestion = (catIdx, qIdx) => {
    const newData = [...scorecardData];
    newData[catIdx].questions.splice(qIdx, 1);
    setScorecardData(newData);
  };

  const updateQuestion = (catIdx, qIdx, field, val) => {
    const newData = [...scorecardData];
    newData[catIdx].questions[qIdx][field] = field === 'weight' ? Number(val) : val;
    setScorecardData(newData);
  };

  if (loading) return <div style={{ color: '#fff', padding: '2rem' }}>{t('common.loading')}</div>;

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '2rem', color: '#fff' }}>
      
      {notification && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          background: notification.type === 'error' ? 'var(--accent-danger)' : 'var(--accent-success)',
          color: '#fff', padding: '16px 24px', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 'bold'
        }}>
          <span>{notification.type === 'success' ? '✅' : '❌'}</span>
          {notification.message}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ margin: '0 0 8px 0' }}>{t('scorecard.builderTitle', 'Scorecard Builder')}</h2>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('scorecard.builderDesc', 'Add, edit, or remove questions from the manual evaluation scorecard. Changes apply immediately to all new evaluations.')}</p>
        </div>
        <button 
          onClick={handleSave} 
          disabled={saving}
          style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '6px', fontWeight: 'bold', cursor: saving ? 'not-allowed' : 'pointer' }}
        >
          {saving ? t('common.loading') : t('scorecard.saveConfiguration', 'Save Configuration')}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {scorecardData.map((cat, catIdx) => (
          <div key={catIdx} style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <input 
                value={cat.category}
                onChange={e => updateCategoryName(catIdx, e.target.value)}
                style={{ fontSize: '20px', fontWeight: 'bold', background: 'transparent', border: 'none', borderBottom: '2px solid var(--border-color)', color: 'var(--accent-primary)', paddingBottom: '4px', width: '300px' }}
              />
              <button onClick={() => removeCategory(catIdx)} style={{ background: 'transparent', color: 'var(--accent-danger)', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
                🗑 {t('scorecard.deleteCategory', 'Delete Category')}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {cat.questions.map((q, qIdx) => (
                <div key={q.id} style={{ background: 'var(--bg-main)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <input 
                        placeholder={t('scorecard.questionTitle', 'Question Title')}
                        value={q.title} 
                        onChange={e => updateQuestion(catIdx, qIdx, 'title', e.target.value)}
                        style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '4px', fontWeight: 'bold' }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('scorecard.weight', 'Weight')}:</span>
                        <input 
                          type="number" 
                          min="1" max="10"
                          value={q.weight} 
                          onChange={e => updateQuestion(catIdx, qIdx, 'weight', e.target.value)}
                          style={{ width: '60px', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '4px' }}
                        />
                      </div>
                    </div>
                    <textarea 
                      placeholder={t('scorecard.promptPlaceholder', 'Prompt / Question Text')}
                      value={q.prompt}
                      onChange={e => updateQuestion(catIdx, qIdx, 'prompt', e.target.value)}
                      style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '4px', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <textarea 
                      placeholder={t('scorecard.referencePlaceholder', 'Reference / Grading Rubric')}
                      value={q.reference}
                      onChange={e => updateQuestion(catIdx, qIdx, 'reference', e.target.value)}
                      style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: '4px', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit', fontStyle: 'italic' }}
                    />
                  </div>
                  <div>
                    <button onClick={() => removeQuestion(catIdx, qIdx)} style={{ background: 'var(--accent-danger)', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' }}>
                      ✖
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={() => addQuestion(catIdx)} style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: '6px', cursor: 'pointer', textAlign: 'center' }}>
                + {t('scorecard.addQuestion', 'Add Question')}
              </button>
            </div>
          </div>
        ))}
        
        <button onClick={addCategory} style={{ padding: '16px', background: 'transparent', color: 'var(--accent-primary)', border: '2px dashed var(--accent-primary)', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', fontSize: '16px', fontWeight: 'bold' }}>
          + {t('scorecard.addNewCategory', 'Add New Category')}
        </button>

        {/* Code Challenge config */}
        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--accent-warning)', marginTop: '2rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--accent-warning)' }}>{t('scorecard.codeChallengeConfig', 'Code Challenge Configuration')}</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '1rem' }}>{t('scorecard.codeChallengeDesc', 'This challenge is scored separately out of 16 points.')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input 
                value={codeChallenge.title || ''} 
                onChange={e => setCodeChallenge({...codeChallenge, title: e.target.value})}
                style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '4px', fontWeight: 'bold' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('scorecard.weight', 'Weight')}:</span>
                <input 
                  type="number" 
                  value={codeChallenge.weight || 4} 
                  onChange={e => setCodeChallenge({...codeChallenge, weight: Number(e.target.value)})}
                  style={{ width: '60px', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '4px' }}
                />
              </div>
            </div>
            <textarea 
              value={codeChallenge.prompt || ''}
              onChange={e => setCodeChallenge({...codeChallenge, prompt: e.target.value})}
              style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '4px', minHeight: '60px' }}
            />
            <textarea 
              value={codeChallenge.reference || ''}
              onChange={e => setCodeChallenge({...codeChallenge, reference: e.target.value})}
              style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: '4px', minHeight: '60px', fontStyle: 'italic' }}
            />
          </div>
        </div>
      </div>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
