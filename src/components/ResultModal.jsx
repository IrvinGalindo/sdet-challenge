import { Bug } from 'lucide-react';
import { FILES, TREES } from '../data';
import { useTranslation } from 'react-i18next';
import './ResultModal.css';

export default function ResultModal({ result, onClose, onReset, customAction }) {
  const { t } = useTranslation();
  const { name, score, wrongN, pct, total, foundKeys, lang } = result;
  const grade =
    pct >= 90 ? t('result.gradeExceptional', 'Exceptional.') :
      pct >= 75 ? t('result.gradeGood', 'Good.') :
        pct >= 55 ? t('result.gradeAverage', 'Average.') :
          t('result.gradeNeedsImprovement', 'Needs improvement. Review automation best practices.');

  const topics = {};
  if (foundKeys && lang && FILES[lang]) {
    foundKeys.forEach(key => {
      const parts = key.split('-');
      const lnOrType = parts.pop();
      const fname = parts.join('-');
      let bugDesc = '';
      try {
        if (lnOrType === 'folder') {
          const folder = TREES[lang].find(t => t.label === fname);
          if (folder && folder.bugs) bugDesc = folder.bugs.folder;
        } else if (lnOrType === 'file') {
          const fileObj = FILES[lang][fname];
          if (fileObj && fileObj.fileBugs) bugDesc = fileObj.fileBugs.file;
        } else {
          const fileObj = FILES[lang][fname];
          if (fileObj && fileObj.bugs) {
            const lineNum = parseInt(lnOrType, 10);
            bugDesc = fileObj.bugs[lineNum] || fileObj.bugs[lnOrType] || '';
          }
        }
      } catch (e) { }
      if (bugDesc) {
        const match = bugDesc.match(/^\[(.*?)\]/);
        if (match) { const top = match[1]; topics[top] = (topics[top] || 0) + 1; }
      }
    });
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bug size={24} style={{ color: 'var(--accent-primary)' }} /> {t('result.bugFinderStage', 'Bug Finder — Stage 3')}</h2>
        <div className="modal-score">{score}/{total}</div>
        <p className="modal-detail">
          <strong>{name}</strong> {t('result.foundBugs', 'found')} <strong>{score}</strong> {t('result.of', 'of')} {total} {t('result.bugs', 'bugs')} ({pct}%)
          {t('result.withWrong', ' with')} {wrongN} {t('result.wrongGuess', 'wrong guess')}{wrongN !== 1 ? t('result.wrongGuessPlural', 'es') : ''}.
        </p>

        {Object.keys(topics).length > 0 && (
          <div className="modal-topics">
            <h4 style={{ margin: '8px 0 6px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>{t('result.topicsIdentified', 'Topics identified:')}</h4>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {Object.entries(topics).map(([topic, count]) => (
                <span key={topic} style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent-primary)', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>
                  {topic}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="modal-grade">{grade}</p>

        <div className="modal-actions" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <button className="modal-btn" onClick={onClose}>{t('result.reviewMore', 'Review more')}</button>
          <button className="modal-btn" onClick={onReset}>{t('result.resetBugs', 'Reset bugs')}</button>
          {customAction && (
            <button className="modal-btn modal-btn-primary" onClick={customAction.onClick}>
              {customAction.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
