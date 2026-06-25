import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import AdminNavbar from './AdminNavbar';
import './CandidateProfile.css';

export default function CandidateProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState({});
  const [interviewDate, setInterviewDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState(null);

  const [questions, setQuestions] = useState([]); // flat list from DB
  const [openCats, setOpenCats]   = useState({}); // tracks which categories are expanded
  const [naQuestions, setNaQuestions] = useState({}); // { [qId]: boolean }
  const [categoryOrder, setCategoryOrder] = useState([]); // array of category names

  const toggleCategory = (cat) => {
    setOpenCats(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const toggleNA = async (qId) => {
    const isNowNA = !naQuestions[qId];
    setNaQuestions(prev => ({ ...prev, [qId]: isNowNA }));
    try {
      // Immediately store the NA status in the question in the DB
      await updateDoc(doc(db, 'questions', qId), { isNA: isNowNA });
    } catch (err) {
      console.error("Failed to update question NA status in DB", err);
    }
  };

  const [draggedCat, setDraggedCat] = useState(null);

  const handleDragStart = (e, cat) => {
    setDraggedCat(cat);
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // Necessary to allow dropping
  };

  const handleDrop = (e, targetCat) => {
    e.preventDefault();
    if (!draggedCat || draggedCat === targetCat) return;

    const newOrder = [...categoryOrder];
    const draggedIdx = newOrder.indexOf(draggedCat);
    const targetIdx = newOrder.indexOf(targetCat);

    newOrder.splice(draggedIdx, 1);
    newOrder.splice(targetIdx, 0, draggedCat);

    setCategoryOrder(newOrder);
    setDraggedCat(null);
  };

  useEffect(() => {
    async function loadData() {
      try {
        // Load candidate
        const docSnap = await getDoc(doc(db, 'leaderboard', id));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setCandidate(data);
          if (data.manualEvaluation?.scores) setScores(data.manualEvaluation.scores);
          if (data.manualEvaluation?.interviewDate) setInterviewDate(data.manualEvaluation.interviewDate);
          if (data.manualEvaluation?.naQuestions) setNaQuestions(data.manualEvaluation.naQuestions);
        }

        // Load the current user to determine their role & creator chain
        const currentUser = auth.currentUser;
        let creatorChain = [];
        if (currentUser) {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.createdBy) {
              creatorChain.push(userData.createdBy);
              const parentDoc = await getDoc(doc(db, 'users', userData.createdBy));
              if (parentDoc.exists() && parentDoc.data().createdBy) {
                creatorChain.push(parentDoc.data().createdBy);
              }
            }
          }
        }

        // Load questions scoped to this user
        const qSnap = await getDocs(collection(db, 'questions'));
        const allQ = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        let visible = allQ;
        if (currentUser) {
          visible = allQ.filter(q =>
            q.scope === 'global' ||
            q.createdBy === currentUser.uid ||
            creatorChain.includes(q.createdBy)
          );
        }
        // Sort by category then title
        visible.sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.title || '').localeCompare(b.title || ''));
        
        const uniqueCats = Array.from(new Set(visible.map(q => q.category || 'Uncategorized'))).sort();
        if (docSnap.exists() && docSnap.data().manualEvaluation?.categoryOrder?.length === uniqueCats.length) {
          setCategoryOrder(docSnap.data().manualEvaluation.categoryOrder);
        } else {
          setCategoryOrder(uniqueCats);
        }
        
        // Initialize NA state from candidate data OR from the question's global isNA flag
        const savedNa = docSnap.exists() ? (docSnap.data().manualEvaluation?.naQuestions || {}) : {};
        const mergedNa = { ...savedNa };
        visible.forEach(q => {
          if (q.isNA && mergedNa[q.id] === undefined) {
            mergedNa[q.id] = true;
          }
        });
        setNaQuestions(mergedNa);

        setQuestions(visible);

      } catch (err) {
        console.error('Error loading data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [id]);

  const handleScoreChange = (qId, val) => {
    setScores(prev => ({ ...prev, [qId]: Number(val) }));
  };

  const calculateScores = () => {
    let total = 0;
    let max = 0;
    questions.forEach(q => {
      if (!naQuestions[q.id]) {
        max += (Number(q.weight) || 0) * 4;
        if (scores[q.id] !== undefined && scores[q.id] !== 'N/A') {
          total += Number(scores[q.id]) * q.weight;
        }
      }
    });
    return { total, max };
  };

  const { total: weightedTotal, max: maxScore } = calculateScores();
  const grandTotal    = weightedTotal;
  const pct           = Math.round((weightedTotal / (maxScore || 1)) * 100) || 0;

  const getRecommendation = (percentage) => {
    if (percentage >= 75) return { text: '✅ STRONG HIRE', color: 'var(--accent-success)' };
    if (percentage >= 55) return { text: '🟡 CONSIDER',   color: 'var(--accent-warning)' };
    return                       { text: '❌ NOT READY',  color: 'var(--accent-danger)' };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Ensure 'N/A' is explicitly written into the scores object for the DB
      const finalScores = { ...scores };
      Object.keys(naQuestions).forEach(qId => {
        if (naQuestions[qId]) {
          finalScores[qId] = 'N/A';
        }
      });

      const evaluation = {
        scores: finalScores,
        naQuestions,
        categoryOrder,
        weightedTotal,
        grandTotal,
        percentage: pct,
        recommendation: getRecommendation(pct).text,
        evaluatedAt: new Date().toISOString(),
        interviewDate,
      };
      await updateDoc(doc(db, 'leaderboard', id), { manualEvaluation: evaluation });
      setNotification({ message: 'Evaluation saved successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 4000);
      setCandidate(prev => ({ ...prev, manualEvaluation: evaluation }));
    } catch (err) {
      setNotification({ message: 'Error saving: ' + err.message, type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <div className="cp-loading" style={{ padding: '4rem 0' }}>
        <div className="cp-spinner" />
        Loading candidate profile…
      </div>
    </div>
  );
  if (!candidate) return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      <div className="cp-loading" style={{ padding: '4rem 0' }}>
        Candidate not found.
      </div>
    </div>
  );

  const chartData = [
    { subject: 'REST Assured', score: candidate.breakdown?.restassured?.score || 0, fullMark: candidate.breakdown?.restassured?.total || 5 },
    { subject: 'SQL Queries',  score: candidate.breakdown?.sql?.score        || 0, fullMark: candidate.breakdown?.sql?.total        || 5 },
    { subject: 'Bug Finder',   score: candidate.breakdown?.bugfinder?.score  || 0, fullMark: candidate.breakdown?.bugfinder?.total  || 5 },
  ];

  return (
    <div style={{ padding: '2rem', color: '#fff' }}>
      <AdminNavbar />
      {notification && (
        <div className={`cp-toast ${notification.type}`}>
          <span>{notification.type === 'success' ? '✅' : '❌'}</span>
          {notification.message}
        </div>
      )}

      <button onClick={() => navigate('/admin')} className="cp-back-btn">
        ← Back to Dashboard
      </button>

      <div className="cp-header">
        <div>
          <h1 style={{ margin: '0 0 8px 0', fontSize: '32px' }}>{candidate.name}</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Automated tests completed: {candidate.date} | Interviewer ID: {candidate.interviewerId || 'N/A'}</p>
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Interview Date:</label>
            <input
              type="date"
              value={interviewDate}
              onChange={e => setInterviewDate(e.target.value)}
              style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: '#fff', padding: '6px 12px', borderRadius: '4px' }}
            />
          </div>
        </div>
        <div style={{ textAlign: 'right', background: 'var(--bg-card)', padding: '16px 24px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Automated Score</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--accent-primary)' }}>{candidate.score} / {candidate.total} <span style={{ fontSize: '18px', color: 'var(--text-muted)' }}>({candidate.pct}%)</span></div>
        </div>
      </div>

      <div className="cp-layout">

        {/* LEFT COLUMN */}
        <div style={{ flex: '1', position: 'sticky', top: '2rem' }}>
          <div className="cp-card" style={{ marginBottom: '1.5rem' }}>
            <h3 className="cp-card-title">Automated Skills Radar</h3>
            <div style={{ width: '100%', height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
                  <PolarGrid stroke="var(--border-color)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 'dataMax']} tick={false} />
                  <Radar name="Candidate" dataKey="score" stroke="var(--accent-primary)" fill="var(--accent-primary)" fillOpacity={0.5} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="cp-card">
            <h3 className="cp-card-title">Manual Interview Summary</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: 14 }}>
              <span style={{ color: 'var(--text-muted)' }}>Questions Scored:</span>
              <strong>{weightedTotal} / {maxScore}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', paddingTop: '8px', borderTop: '1px solid var(--border-color)', fontSize: 15 }}>
              <span style={{ color: 'var(--text-muted)' }}>Grand Total:</span>
              <strong>{grandTotal} / {maxScore}</strong>
            </div>
            <div className="cp-recommendation">
              <div className="cp-recommendation-label">Recommendation</div>
              <div className="cp-recommendation-value" style={{ color: getRecommendation(pct).color }}>{getRecommendation(pct).text}</div>
              <div className="cp-recommendation-sub">Based on {pct}% question score</div>
            </div>
            <button onClick={handleSave} disabled={saving} className="cp-save-btn">
              {saving ? 'Saving…' : 'Save Evaluation'}
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Interactive Scorecard */}
        <div style={{ flex: '2', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Loading questions…</div>
          ) : questions.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
              No interview questions available. Ask your admin to add questions in the Questions tab.
            </div>
          ) : (() => {
            const grouped = questions.reduce((acc, q) => {
              const cat = q.category || 'Uncategorized';
              if (!acc[cat]) acc[cat] = [];
              acc[cat].push(q);
              return acc;
            }, {});

            const sortedCats = categoryOrder.length ? categoryOrder.filter(c => grouped[c]) : Object.keys(grouped);

            return sortedCats.map((cat) => {
              const qs = grouped[cat];
              const isOpen = openCats[cat];
              return (
              <div 
                key={cat} 
                className="cp-card"
                draggable
                onDragStart={(e) => handleDragStart(e, cat)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, cat)}
                style={{ opacity: draggedCat === cat ? 0.5 : 1 }}
              >
                <h2 
                  onClick={() => toggleCategory(cat)}
                  style={{ 
                    marginTop: 0, 
                    color: 'var(--accent-primary)', 
                    borderBottom: isOpen ? '1px solid var(--border-color)' : 'none', 
                    paddingBottom: isOpen ? '12px' : '0', 
                    marginBottom: isOpen ? '1.5rem' : '0', 
                    fontSize: '18px',
                    cursor: 'grab',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>☰</span>
                    {cat}
                  </span>
                  <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{isOpen ? '▼' : '▶'}</span>
                </h2>
                {isOpen && qs.map((q, idx) => (
                  <div key={q.id} style={{ marginBottom: idx === qs.length - 1 ? 0 : '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px', gap: '12px' }}>
                      <div>
                        <h4 style={{ margin: '0 0 2px', fontSize: '15px', color: 'var(--text-highlight)' }}>{q.title}</h4>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{q.level}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <label 
                          style={{ 
                            fontSize: '12px', 
                            color: q.scope === 'global' ? 'var(--text-muted)' : 'var(--text-highlight)', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '4px', 
                            cursor: q.scope === 'global' ? 'not-allowed' : 'pointer',
                            opacity: q.scope === 'global' ? 0.5 : 1
                          }}
                          title={q.scope === 'global' ? "Global questions are obligatory and cannot be marked N/A" : "Mark question as Not Applicable"}
                        >
                          <input 
                            type="checkbox" 
                            checked={!!naQuestions[q.id]} 
                            onChange={() => toggleNA(q.id)} 
                            disabled={q.scope === 'global'}
                          />
                          N/A
                        </label>
                        <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.08)', padding: '3px 8px', borderRadius: '4px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>×{q.weight}</span>
                      </div>
                    </div>
                    <div style={{ opacity: naQuestions[q.id] ? 0.4 : 1, pointerEvents: naQuestions[q.id] ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
                      <p style={{ color: 'var(--text-main)', fontSize: '14px', lineHeight: '1.6', fontStyle: 'italic', marginBottom: '10px' }}>"{q.prompt}"</p>
                      {q.reference && (
                        <div className="cp-reference"><strong>Rubric:</strong> {q.reference}</div>
                      )}
                      <div className="score-row">
                        <span className="score-row-label">Score:</span>
                        {[0, 1, 2, 3, 4].map(val => (
                          <label key={val} className={`score-radio-btn ${scores[q.id] === val ? 'active-primary' : ''}`}>
                            <input type="radio" className="score-radio" name={q.id} value={val} checked={scores[q.id] === val} onChange={e => handleScoreChange(q.id, e.target.value)} />
                            {val}
                          </label>
                        ))}
                        {scores[q.id] !== undefined && !naQuestions[q.id] && (
                          <span className="score-pts-badge primary">+{scores[q.id] * q.weight} pts</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )});
          })()}
        </div>
      </div>
    </div>
  );
}
