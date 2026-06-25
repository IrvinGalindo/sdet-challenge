import { useState } from 'react';
import './FileTree.css';

export default function FileTree({ lang, trees, activeFile, found, wrong, recentBugs, files, onSelect, onGuess }) {
  const [selectedStruct, setSelectedStruct] = useState(null);

  const handleBugIconClick = (e, key) => {
    e.stopPropagation();
    setSelectedStruct(prev => prev === key ? null : key);
  };

  const handleMark = (e, isFolder, name, bugDesc) => {
    e.stopPropagation();
    const typeLabel = isFolder ? 'folder' : 'file';
    const key = name + '-' + typeLabel;
    if (!found.has(key)) {
      onGuess(name, typeLabel, bugDesc);
    }
    setSelectedStruct(null);
  };

  return (
    <div className="tree">
      <div className="tree-title">Project structure</div>
      {trees[lang].map(folder => {
        const folderKey = folder.label + '-folder';
        const isFolderFound = found.has(folderKey);
        const isFolderWrong = wrong.has(folderKey);
        const isFolderSel = selectedStruct === folderKey;
        const folderBugDesc = folder.bugs && folder.bugs.folder;

        return (
          <div key={folder.label}>
            <div style={{ marginBottom: '4px' }}>
              <div className={`tree-folder struct-item ${isFolderFound ? 'found' : ''} ${isFolderWrong ? 'wrong' : ''}`}>
                <span className="tree-arrow">&#9654;</span>
                <span style={{ flex: 1 }}>{folder.label}</span>
                <button className="bug-icon-btn" onClick={(e) => handleBugIconClick(e, folderKey)} title="Mark folder as bug">⚠️</button>
              </div>
              {isFolderSel && (
                <div className="inline-popup tree-popup">
                  <span className="popup-label">Structure bug?</span>
                  <button className="popup-mark-btn" onClick={(e) => handleMark(e, true, folder.label, folderBugDesc)}>Mark bug</button>
                  <button className="popup-close-btn" onClick={(e) => { e.stopPropagation(); setSelectedStruct(null); }}>Cancel</button>
                </div>
              )}
              {recentBugs.has(folderKey) && folderBugDesc && (
                <div className="inline-bug-alert tree-bug-alert">
                  <strong>💡 Issue:</strong> {folderBugDesc}
                </div>
              )}
            </div>
            
            {folder.children.map(fname => {
              const fileKey = fname + '-file';
              const fileObj = files[lang][fname];
              const isFileFound = found.has(fileKey);
              const isFileWrong = wrong.has(fileKey);
              const isFileSel = selectedStruct === fileKey;
              const fileBugDesc = fileObj && fileObj.fileBugs && fileObj.fileBugs.file;

              const bugKeys = Object.keys(fileObj?.bugs || {});
              const foundN = bugKeys.filter(l => found.has(fname + '-' + l)).length;
              
              return (
                <div key={fname} style={{ marginBottom: '2px' }}>
                  <div
                    className={`tree-file struct-item ${activeFile === fname ? 'active' : ''} ${isFileFound ? 'found' : ''} ${isFileWrong ? 'wrong' : ''}`}
                    onClick={() => onSelect(fname)}
                  >
                    <span className="tree-icon">&#128196;</span>
                    <span style={{ flex: 1 }}>{fname}</span>
                    {foundN > 0 && <span className="tree-badge">{foundN}</span>}
                    <button className="bug-icon-btn" onClick={(e) => handleBugIconClick(e, fileKey)} title="Mark file as bug">⚠️</button>
                  </div>
                  {isFileSel && (
                    <div className="inline-popup tree-popup" style={{ marginLeft: '24px' }}>
                      <span className="popup-label">File bug?</span>
                      <button className="popup-mark-btn" onClick={(e) => handleMark(e, false, fname, fileBugDesc)}>Mark bug</button>
                      <button className="popup-close-btn" onClick={(e) => { e.stopPropagation(); setSelectedStruct(null); }}>Cancel</button>
                    </div>
                  )}
                  {recentBugs.has(fileKey) && fileBugDesc && (
                    <div className="inline-bug-alert tree-bug-alert" style={{ marginLeft: '24px' }}>
                      <strong>💡 Issue:</strong> {fileBugDesc}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
