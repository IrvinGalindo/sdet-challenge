import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import { FILES, TREES } from '../data';
import { QUIZZES } from '../quizData';
import { useTranslation } from 'react-i18next';
import './Leaderboard.css';

function parseBugKey(key, rawLang) {
  // Normalize lang: stored as 'Full Challenge (java)' → extract 'java'
  const langMatch = (rawLang || '').match(/\((\w+)\)$/);
  const lang = langMatch ? langMatch[1] : rawLang;

  const parts = key.split('-');
  const lnOrType = parts.pop();
  const fname = parts.join('-');
  let bugDesc = 'Unknown bug configuration';
  
  try {
    if (!FILES[lang]) return { key, fname, lnOrType, topicHtml: null, bugDesc };
    if (lnOrType === 'folder') {
      const folder = TREES[lang].find(t => t.label === fname);
      if (folder && folder.bugs) bugDesc = folder.bugs.folder;
    } else if (lnOrType === 'file') {
      const fileObj = FILES[lang][fname];
      if (fileObj && fileObj.fileBugs) bugDesc = fileObj.fileBugs.file;
    } else {
      const fileObj = FILES[lang][fname];
      if (fileObj && fileObj.bugs) {
        // keys in data.js are numbers — coerce the parsed string to int
        const lineNum = parseInt(lnOrType, 10);
        bugDesc = fileObj.bugs[lineNum] || fileObj.bugs[lnOrType] || bugDesc;
      }
    }
  } catch (e) {}
  
  let topicHtml = null;
  // Regex matches [Topic] [Level] Bug: ...
  const match = bugDesc ? bugDesc.match(/^\[(.*?)\](?:\s*\[(.*?)\])?\s*(.*)/) : null;
  
  if (match) {
    topicHtml = (
      <>
        <span className="bug-topic">{match[1]}</span>
        {match[2] && (
          <span className={`bug-level level-${match[2].replace(' ', '').toLowerCase()}`}>
            {match[2]}
          </span>
        )}
      </>
    );
    bugDesc = match[3];
  }
  
  return { key, fname, lnOrType, topicHtml, bugDesc };
}

export default function Leaderboard({ onClose }) {
  const { t } = useTranslation();
  const [results, setResults] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [notification, setNotification] = useState(null);

  const showNotification = (message, type = 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const q = query(collection(db, 'leaderboard'));
        const sn = await getDocs(q);
        const data = [];
        sn.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
        // sort by percentage descending
        data.sort((a, b) => {
          if (b.pct !== a.pct) return b.pct - a.pct;
          return b.score - a.score;
        });
        setResults(data);
      } catch (e) {
        console.error("Failed to load leaderboard:", e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleClear = () => {
    // Firebase records shouldn't be blindly cleared globally in the frontend for everyone by a non-admin.
    // Display an alert or restrict it to admin.
    showNotification(t('leaderboard.clearRestricted', "Clearing records is restricted to Super Admin only via Firebase console."), 'error');
    setConfirmClear(false);
  };

  const sorted = [...results].sort((a, b) => b.score - a.score).slice(0, 15);

  return (
    <div className="leaderboard">
      
      {/* Custom Toast Notification */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: notification.type === 'error' ? 'var(--accent-danger)' : 'var(--accent-success)',
          color: '#fff',
          padding: '16px 24px',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontWeight: 'bold',
          transition: 'all 0.3s ease-in-out'
        }}>
          <span>{notification.type === 'success' ? '✅' : '❌'}</span>
          {notification.message}
        </div>
      )}

      <div className="lb-header">
        <span className="lb-title">{t('leaderboard.previousResults', 'Previous results')}</span>
        <button className="clear-btn" onClick={() => setConfirmClear(true)}>{t('leaderboard.clearAll', 'Clear all scores')}</button>
      </div>

      {confirmClear && (
        <div className="confirm-bar">
          <span className="confirm-msg">{t('leaderboard.deleteConfirm', 'Delete all scores? This cannot be undone.')}</span>
          <button className="confirm-yes" onClick={handleClear}>{t('leaderboard.yesDelete', 'Yes, delete')}</button>
          <button className="confirm-no" onClick={() => setConfirmClear(false)}>{t('common.cancel')}</button>
        </div>
      )}

      {loading ? (
        <div className="lb-empty">{t('leaderboard.loadingCloud', 'Loading records from secure cloud...')}</div>
      ) : sorted.length === 0 ? (
        <div className="lb-empty">{t('leaderboard.empty')}</div>
      ) : (
        <div className="lb-list">
          {sorted.map((r, i) => {
            const isExpanded = expandedRow === i;
            return (
              <div className="lb-item-container" key={i}>
                <div className={`lb-row ${isExpanded ? 'expanded' : ''} ${(r.foundKeys?.length || r.type === 'full') ? 'clickable' : ''}`} onClick={() => setExpandedRow(prev => prev === i ? null : i)}>
                  <span className="lb-rank">{i + 1}.</span>
                  <span className="lb-name">{r.name} <span className="lb-meta">({r.lang}, {r.date})</span></span>
                  <span className="lb-score">{r.score}/{r.total} — {r.pct}%</span>
                  <span className="lb-expand-icon">{isExpanded ? '▼' : '▶'}</span>
                </div>
                {isExpanded && (
                  <div className="lb-details">

                    {/* Quiz answers for sequential full challenge */}
                    {r.type === 'full' && r.breakdown && (
                      <div className="lb-details-section">
                        {['restassured', 'sql'].map(quizId => {
                          const sectionData = r.breakdown[quizId];
                          const answers = sectionData?.answers;
                          if (!answers) return null;
                          const quiz = QUIZZES[quizId];
                          
                          return (
                            <div key={quizId} style={{ marginBottom: '1.5rem' }}>
                              <h4 className="lb-details-title" style={{ color: 'var(--text-highlight)' }}>
                                {quiz.icon} {quiz.title} ({sectionData.score}/{sectionData.total})
                              </h4>
                              <ul className="lb-bugs-list">
                                {quiz.questions.map((q, qIndex) => {
                                  const selectedLabel = answers[q.id];
                                  const selected = q.options.find(o => o.label === selectedLabel);
                                  const isCorrect = selected && selected.correct;
                                  
                                  return (
                                    <li key={q.id} className="lb-bug-item" style={{ background: isCorrect ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)', borderLeft: `3px solid ${isCorrect ? 'var(--accent-success)' : 'var(--accent-danger)'}`, flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
                                      <div style={{ color: 'var(--text-main)', fontSize: '13px', fontWeight: 600 }}>Q{qIndex + 1}: {q.question}</div>
                                      <div style={{ fontSize: '13px', color: isCorrect ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                                        {isCorrect ? '✅' : '❌'} {selected ? selected.text : t('leaderboard.noAnswer', '(No answer)')}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Bug Finder details */}
                    <div className="lb-details-section">
                      <h4 className="lb-details-title found">✅ {t('leaderboard.identified', 'Identified')} ({r.foundKeys ? r.foundKeys.length : 0} / {r.type === 'full' && r.breakdown ? r.breakdown.bugfinder?.total : r.total})</h4>
                      {r.foundKeys && r.foundKeys.length > 0 ? (
                        <ul className="lb-bugs-list">
                          {r.foundKeys.map(k => {
                            const b = parseBugKey(k, r.lang);
                            return (
                              <li key={b.key} className="lb-bug-item found-item">
                                <span className="lb-bug-location">{b.fname}{b.lnOrType !== 'folder' && b.lnOrType !== 'file' ? `:${b.lnOrType}` : ''}</span>
                                {b.topicHtml} <span className="lb-bug-text">{b.bugDesc}</span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="lb-empty-sub">{t('leaderboard.noBugsIdentified', 'No bugs identified.')}</div>
                      )}
                    </div>
                    {(() => {
                      let allKeys = [];
                      try {
                        const langMatch = (r.lang || '').match(/\((\w+)\)$/);
                        const baseLang = langMatch ? langMatch[1] : r.lang;

                        Object.entries(FILES[baseLang]).forEach(([fname, fileObj]) => {
                          if (fileObj.bugs) Object.keys(fileObj.bugs).forEach(ln => allKeys.push(`${fname}-${ln}`));
                          if (fileObj.fileBugs) Object.keys(fileObj.fileBugs).forEach(type => allKeys.push(`${fname}-${type}`));
                        });
                        TREES[baseLang].forEach(folder => {
                          if (folder.bugs && folder.bugs.folder) allKeys.push(`${folder.label}-folder`);
                        });
                      } catch(e) {}
                      
                      const fks = r.foundKeys || [];
                      const missedKeys = allKeys.filter(k => !fks.includes(k));
                      
                      if (missedKeys.length === 0) return null;
                      
                      return (
                        <div className="lb-details-section missed-section">
                          <h4 className="lb-details-title missed">❌ {t('leaderboard.missed', 'Missed')} ({missedKeys.length})</h4>
                          <ul className="lb-bugs-list missed-list">
                            {missedKeys.map(k => {
                              const b = parseBugKey(k, r.lang);
                              return (
                                <li key={b.key} className="lb-bug-item missed-item">
                                  <span className="lb-bug-location missed-loc">{b.fname}{b.lnOrType !== 'folder' && b.lnOrType !== 'file' ? `:${b.lnOrType}` : ''}</span>
                                  {b.topicHtml} <span className="lb-bug-text">{b.bugDesc}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
