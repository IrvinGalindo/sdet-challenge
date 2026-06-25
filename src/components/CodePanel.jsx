import { useState } from 'react';
import './CodePanel.css';

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function CodePanel({ lang, activeFile, files, found, wrong, recentBugs, onGuess }) {
  const [selectedLine, setSelectedLine] = useState(null);

  if (!activeFile) {
    return (
      <div className="code-panel">
        <div className="code-header"><span>Select a file</span></div>
        <div className="code-empty">Select a file from the tree to inspect its code.</div>
      </div>
    );
  }

  const fdata = files[lang][activeFile];
  const bugLines = fdata.bugs;
  const bugCount = Object.keys(bugLines).length;

  const handleLineClick = (ln) => {
    setSelectedLine(prev => prev === ln ? null : ln);
  };

  const handleMark = (ln) => {
    const key = activeFile + '-' + ln;
    const bugDesc = bugLines[ln];
    if (found.has(key)) { setSelectedLine(null); return; }
    onGuess(activeFile, ln, bugDesc);
    setSelectedLine(null);
  };

  return (
    <div className="code-panel">
      <div className="code-header">
        <span>{activeFile}</span>
        <span className="code-hint">{bugCount} bug{bugCount > 1 ? 's' : ''} in this file</span>
      </div>
      <div className="code-body">
        {fdata.lines.map((code, i) => {
          const ln = i + 1;
          const key = activeFile + '-' + ln;
          const isFound = found.has(key);
          const isWrong = wrong.has(key);
          const isSel = selectedLine === ln;
          return (
            <div key={ln}>
              <div
                className={`code-line ${isFound ? 'found' : ''} ${isWrong ? 'wrong' : ''} ${isSel ? 'selected' : ''}`}
                onClick={() => handleLineClick(ln)}
              >
                <div className="line-num">{ln}</div>
                <div className="line-code" dangerouslySetInnerHTML={{ __html: esc(code) }} />
              </div>
              {isSel && (
                <div className="inline-popup">
                  <span className="popup-label">Line {ln} — is this a bug?</span>
                  <button className="popup-mark-btn" onClick={() => handleMark(ln)}>Mark as bug</button>
                  <button className="popup-close-btn" onClick={() => setSelectedLine(null)}>Cancel</button>
                </div>
              )}
              {recentBugs.has(key) && bugLines[ln] && (
                <div className="inline-bug-alert">
                  <strong>💡 Issue:</strong> {bugLines[ln]}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
