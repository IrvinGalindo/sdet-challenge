import { Check, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, callParseJD, callGenerateQuestionBank } from '../firebase';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, doc, updateDoc, deleteDoc, writeBatch, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import ConfirmDialog, { useConfirmDialog } from './ConfirmDialog';

// Position intake — paste a JD, AI parses it, HR confirms, AI generates the
// question bank. All AI calls go through Firebase Functions (never from here).

export default function PositionsManager({ currentUser, role }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const { dialogProps, openConfirm } = useConfirmDialog();
  const [deleting, setDeleting] = useState(null); // positionId currently being deleted

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const isAdminLike = role === 'admin' || role === 'superadmin';

  useEffect(() => {
    if (!currentUser) return;
    const q = isAdminLike
      ? query(collection(db, 'positions'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'positions'), where('createdBy', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Client-side sort fallback for the interviewer query (no orderBy).
      rows.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      });
      setPositions(rows);
      setLoading(false);
    }, (err) => {
      console.error('Positions listener error:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [currentUser, role]);

  const handleClose = async (id) => {
    const ok = await openConfirm({
      title: t('positions.closeConfirmTitle'),
      message: t('positions.closeConfirmMessage'),
      confirmLabel: t('positions.closeConfirmBtn'),
      cancelLabel: t('common.cancel'),
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'positions', id), { status: 'closed', closedAt: serverTimestamp() });
      showNotification(t('positions.notification.closed'));
    } catch (e) {
      showNotification(t('positions.notification.error', { message: e.message }), 'error');
    }
  };

  const handleReopen = async (id) => {
    const ok = await openConfirm({
      title: t('positions.reopenConfirmTitle'),
      message: t('positions.reopenConfirmMessage'),
      confirmLabel: t('positions.reopenConfirmBtn'),
      cancelLabel: t('common.cancel'),
      variant: 'primary',
    });
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'positions', id), { status: 'open' });
      showNotification(t('positions.notification.reopened'));
    } catch (e) {
      showNotification(t('positions.notification.error', { message: e.message }), 'error');
    }
  };

  const handleDelete = async (posId) => {
    const ok = await openConfirm({
      title: t('positions.deleteConfirmTitle'),
      message: t('positions.deleteConfirmMessage'),
      confirmLabel: t('positions.deleteConfirmBtn'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    setDeleting(posId);
    try {
      // ── 1. Delete position subcollections ──────────────────────────────
      await deleteSubcollection(db, collection(db, 'positions', posId, 'challenges'));
      await deleteSubcollection(db, collection(db, 'positions', posId, 'questions'));

      // ── 2. Find all sessions for this position ──────────────────────────
      const sessionsSnap = await getDocs(
        query(collection(db, 'sessions'), where('positionId', '==', posId))
      );

      // ── 3. Delete each session's subcollections ─────────────────────────
      for (const sessionDoc of sessionsSnap.docs) {
        const sid = sessionDoc.id;
        await deleteSubcollection(db, collection(db, 'sessions', sid, 'transcript_chunks'));
        await deleteSubcollection(db, collection(db, 'sessions', sid, 'answers'));
        await deleteSubcollection(db, collection(db, 'sessions', sid, 'suggestions'));
      }

      // ── 4. Delete session documents themselves ──────────────────────────
      if (!sessionsSnap.empty) {
        const batch = writeBatch(db);
        sessionsSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // ── 5. Delete the position document ────────────────────────────────
      await deleteDoc(doc(db, 'positions', posId));

      const sessionCount = sessionsSnap.size;
      showNotification(
        t(sessionCount === 1 ? 'positions.notification.deleted' : 'positions.notification.deleted_plural', { count: sessionCount })
      );
    } catch (e) {
      console.error('Cascade delete failed:', e);
      showNotification(t('positions.notification.error', { message: e.message }), 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div style={{ color: '#fff' }}>
      {notification && (
        <div className={`admin-toast ${notification.type}`}>
          <span>{notification.type === 'success' ? <Check size={16} /> : <X size={16} />}</span>
          {notification.msg}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>{t('positions.openPositions')}</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
            {t('positions.subtitle')}
          </p>
        </div>
        {!showWizard && (
          <button
            onClick={() => setShowWizard(true)}
            style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
          >
            {t('positions.newPositionBtn')}
          </button>
        )}
      </div>

      {showWizard && (
        <PositionWizard
          currentUser={currentUser}
          onCancel={() => setShowWizard(false)}
          onCreated={(id) => {
            setShowWizard(false);
            showNotification(t('positions.notification.created', { defaultValue: 'Position created and question bank generated.' }));
            navigate(`/admin/positions/${id}`);
          }}
          onError={(msg) => showNotification(msg, 'error')}
        />
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>{t('positions.loading')}</div>
      ) : positions.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
          {t('positions.empty')}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('positions.fields.title')}</th>
                <th>{t('positions.seniority')}</th>
                <th>{t('positions.domain')}</th>
                <th>{t('positions.tech')}</th>
                <th>{t('positions.statusLabel')}</th>
                <th style={{ textAlign: 'right' }}>{t('positions.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/positions/${p.id}`)}>
                  <td style={{ fontWeight: 600 }}>{p.title || '—'}</td>
                  <td className="cell-muted" style={{ textTransform: 'capitalize' }}>{p.seniority || '—'}</td>
                  <td className="cell-muted">{p.domain || '—'}</td>
                  <td className="cell-muted" style={{ fontSize: 12 }}>
                    {(p.techStack || []).slice(0, 4).join(', ')}
                    {(p.techStack || []).length > 4 ? '…' : ''}
                  </td>
                  <td>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 12,
                      background: p.status === 'closed' ? 'rgba(148,163,184,0.18)' : 'rgba(16,185,129,0.15)',
                      color:      p.status === 'closed' ? 'var(--text-muted)'      : 'var(--accent-success)',
                    }}>
                      {p.status === 'closed' ? t('positions.status.closed') : t('positions.status.open')}
                    </span>
                    {p.status === 'closed' && p.selectedCandidateName && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--accent-success)', fontWeight: 700 }} title="Hired candidate">
                        ★ {p.selectedCandidateName}
                      </span>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="admin-row-actions">
                      {isAdminLike && p.status === 'closed' && (
                        <button className="btn-evaluate" style={{ background: 'var(--accent-info)' }} onClick={() => handleReopen(p.id)}>{t('positions.reopen')}</button>
                      )}

                      {isAdminLike && p.status !== 'closed' && (
                        <button className="btn-delete" style={{ background: 'var(--accent-warning)', borderColor: 'var(--accent-warning)', color: '#fff' }} onClick={() => handleClose(p.id)}>{t('positions.close')}</button>
                      )}
                      {isAdminLike && (
                        <button
                          className="btn-delete"
                          disabled={deleting === p.id}
                          onClick={() => handleDelete(p.id)}
                          style={{ opacity: deleting === p.id ? 0.6 : 1, cursor: deleting === p.id ? 'wait' : 'pointer' }}
                        >
                          {deleting === p.id ? t('positions.deleting') : t('common.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Deletes all documents in a Firestore collection reference in batches of 400.
// Firestore does not auto-delete subcollections, so this must be called
// explicitly for every subcollection before deleting the parent document.
async function deleteSubcollection(db, collRef) {
  const snap = await getDocs(collRef);
  if (snap.empty) return;
  const BATCH_SIZE = 400;
  let batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++;
    if (count >= BATCH_SIZE) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

// ─── Wizard ──────────────────────────────────────────────────────────────────

function PositionWizard({ currentUser, onCancel, onCreated, onError }) {
  const { t } = useTranslation();
  const [step, setStep] = useState('paste'); // 'paste' | 'review' | 'generating'
  const [jdText, setJdText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [lastError, setLastError] = useState(null);

  const handleParse = async () => {
    const text = jdText.trim();
    if (!text) return;
    setParsing(true);
    try {
      const data = await callParseJD(text);
      setParsed({
        title:      data.title || '',
        seniority:  data.seniority || 'mid',
        domain:     data.domain || '',
        techStack:  Array.isArray(data.techStack)  ? data.techStack  : [],
        softSkills: Array.isArray(data.softSkills) ? data.softSkills : [],
        summary:    data.summary || '',
      });
      setStep('review');
    } catch (e) {
      onError(t('positions.notification.error', { message: 'JD parse failed: ' + (e.message || 'unknown error') }));
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmAndGenerate = async () => {
    setLastError(null);
    setStep('generating');
    let createdRef = null;
    let stage = 'creating position';
    try {
      // 1. Create position doc.
      stage = 'creating position';
      const ref = await addDoc(collection(db, 'positions'), {
        ...parsed,
        jdText,
        status: 'open',
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
      });
      createdRef = ref;

      // 2. Ask the Worker to generate questions + challenges (returns JSON).
      stage = 'calling AI worker for question bank';
      const bank = await callGenerateQuestionBank(parsed);

      // 3. Write the generated bank to Firestore as a single batch.
      stage = 'writing question bank to Firestore';
      const batch = writeBatch(db);
      const qCol = collection(db, 'positions', ref.id, 'questions');
      const cCol = collection(db, 'positions', ref.id, 'challenges');
      const now = serverTimestamp();

      let qCount = 0;
      for (const q of (bank.questions || [])) {
        if (!q?.prompt) continue;
        batch.set(doc(qCol), {
          title:     (q.title || '').slice(0, 200),
          prompt:    (q.prompt || '').slice(0, 4000),
          reference: (q.rubric || '').slice(0, 4000),
          category:  q.category || 'Other',
          weight:    Number(q.weight) || 3,
          positionId: ref.id,
          version:   1,
          kind:      'open',
          createdBy: currentUser.uid,
          createdAt: now,
          source:    'ai_generated',
        });
        qCount++;
      }

      let cCount = 0;
      for (const c of (bank.challenges || [])) {
        if (!c?.kind || !c?.prompt) continue;
        const data = {
          kind:      c.kind,
          title:     (c.title || '').slice(0, 200),
          prompt:    (c.prompt || '').slice(0, 8000),
          rubric:    (c.rubric || '').slice(0, 4000),
          positionId: ref.id,
          version:   1,
          createdBy: currentUser.uid,
          createdAt: now,
          source:    'ai_generated',
        };
        if (c.kind === 'mcq')  data.options     = Array.isArray(c.options) ? c.options.slice(0, 4) : [];
        if (c.kind === 'code') {
          data.language    = c.language || 'javascript';
          data.starterCode = (c.starterCode || '').slice(0, 8000);
        }
        batch.set(doc(cCol), data);
        cCount++;
      }

      // 4. Best-effort audit log (client-side; Phase 6 will move it server-side).
      batch.set(doc(collection(db, 'ai_audit')), {
        promptType: 'generate_questions',
        positionId: ref.id,
        createdBy:  currentUser.uid,
        tokensUsed: bank._tokensUsed || 0,
        questionsAdded:  qCount,
        challengesAdded: cCount,
        createdAt: now,
      });

      // 5. Mark the position as having its bank generated.
      batch.update(ref, { questionBankGeneratedAt: now });

      await batch.commit();
      onCreated(ref.id);
    } catch (e) {
      console.error('[PositionWizard] Generation failed during stage:', stage, e);
      const msg = e.message || 'unknown error';
      const code = e.code ? ` [${e.code}]` : '';
      
      const localizedStage = {
        'creating position': t('positions.wizard.stages.creating'),
        'calling AI worker for question bank': t('positions.wizard.stages.callingWorker'),
        'writing question bank to Firestore': t('positions.wizard.stages.writingFirestore')
      }[stage] || stage;

      const detail = t('positions.notification.error', { message: `${localizedStage}${code}: ${msg}` });

      // Best-effort cleanup of the orphaned position doc so retry doesn't
      // leave empty rows in the list.
      let cleanupNote = null;
      if (createdRef && stage !== 'creating position') {
        try {
          await deleteDoc(createdRef);
          cleanupNote = t('positions.wizard.cleanupSuccess', { defaultValue: 'Empty position doc was cleaned up.' });
        } catch (cleanupErr) {
          console.warn('[PositionWizard] Could not auto-delete orphan position:', cleanupErr);
          cleanupNote = t('positions.wizard.cleanupFailed', { defaultValue: `Could not auto-delete orphan position (id ${createdRef.id}); delete it manually from the list.` });
        }
      }

      setLastError({
        stage: localizedStage,
        message: msg,
        code: e.code || null,
        positionId: createdRef?.id || null,
        cleanupNote,
      });
      onError(detail);
      setStep('review');
    }
  };

  const updateParsed = (patch) => setParsed(p => ({ ...p, ...patch }));

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1.5rem', marginBottom: '2rem', borderTop: '3px solid var(--accent-primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>
          {step === 'paste'      && t('positions.wizard.step1')}
          {step === 'review'     && t('positions.wizard.step2')}
          {step === 'generating' && t('positions.wizard.step3')}
        </h3>
        <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer' }}>
          {t('common.cancel')}
        </button>
      </div>

      {step === 'paste' && (
        <>
          <textarea
            placeholder={t('positions.wizard.placeholder')}
            value={jdText}
            onChange={e => setJdText(e.target.value)}
            style={{
              width: '100%', minHeight: 240, boxSizing: 'border-box',
              padding: '12px', background: 'var(--bg-main)',
              border: '1px solid var(--border-color)', borderRadius: '6px',
              color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', gap: '10px' }}>
            <button
              onClick={handleParse}
              disabled={!jdText.trim() || parsing}
              style={{ padding: '10px 20px', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', opacity: !jdText.trim() || parsing ? 0.5 : 1 }}
            >
              {parsing ? t('positions.wizard.parsing') : t('positions.wizard.parseBtn')}
            </button>
          </div>
        </>
      )}

      {step === 'review' && parsed && (
        <>
          {lastError && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid var(--accent-danger)',
              borderRadius: 6, padding: '12px 14px', marginBottom: 14,
            }}>
              <div style={{ color: 'var(--accent-danger)', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                {t('positions.wizard.failed')}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 4 }}>
                {t('positions.wizard.stage', { stage: lastError.stage })}
                {lastError.code && <> · Code: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 6px', borderRadius: 3 }}>{lastError.code}</code></>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                {lastError.message}
              </div>
              {lastError.cleanupNote && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  {lastError.cleanupNote}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                {t('positions.wizard.consoleDetail')}
              </div>
            </div>
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
            {t('positions.wizard.instruction')}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label={t('positions.wizard.title')}>
              <Input value={parsed.title} onChange={v => updateParsed({ title: v })} />
            </Field>
            <Field label={t('positions.wizard.seniority')}>
              <Select value={parsed.seniority} onChange={v => updateParsed({ seniority: v })}
                options={['junior', 'mid', 'senior', 'staff', 'principal', 'lead']} />
            </Field>
            <Field label={t('positions.wizard.domain')}>
              <Input value={parsed.domain} onChange={v => updateParsed({ domain: v })} />
            </Field>
            <Field label={t('positions.wizard.techStack')}>
              <Input
                value={parsed.techStack.join(', ')}
                onChange={v => updateParsed({ techStack: v.split(',').map(s => s.trim()).filter(Boolean) })}
              />
            </Field>
          </div>

          <Field label={t('positions.wizard.softSkills')}>
            <Input
              value={parsed.softSkills.join(', ')}
              onChange={v => updateParsed({ softSkills: v.split(',').map(s => s.trim()).filter(Boolean) })}
            />
          </Field>

          <Field label={t('positions.wizard.summary')}>
            <textarea
              value={parsed.summary}
              onChange={e => updateParsed({ summary: e.target.value })}
              style={{ width: '100%', minHeight: 70, boxSizing: 'border-box', padding: '9px 12px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }}
            />
          </Field>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', gap: '10px' }}>
            <button onClick={() => setStep('paste')} style={{ padding: '10px 18px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' }}>
              {t('positions.wizard.backToJd')}
            </button>
            <button
              onClick={handleConfirmAndGenerate}
              style={{ padding: '10px 20px', background: 'var(--accent-success)', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
            >
              {t('positions.wizard.confirmBtn')}
            </button>
          </div>
        </>
      )}

      {step === 'generating' && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-card)', padding: '3rem', borderRadius: '12px',
            border: '1px solid var(--accent-primary)', textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)', maxWidth: '400px'
          }}>
            <h2 style={{ margin: '0 0 1rem', color: '#fff' }}>{t('positions.wizard.generatingTitle')}</h2>
            <div
              style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: '2rem', lineHeight: 1.5 }}
              dangerouslySetInnerHTML={{ __html: t('positions.wizard.generatingDesc') }}
            />
            <div style={{ width: 48, height: 48, border: '4px solid var(--border-color)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontFamily: 'inherit', fontSize: 14 }}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', appearance: 'none' }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-primary)', pointerEvents: 'none', fontSize: 11 }}>▼</span>
    </div>
  );
}
