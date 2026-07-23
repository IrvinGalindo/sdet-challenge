import { Globe, CheckCircle2 } from 'lucide-react';
import React, { useState, useRef, Suspense } from 'react';

const Editor = React.lazy(() => import('@monaco-editor/react'));

// Code challenge — Monaco editor with language picker.
// The challenge specifies a default language; the candidate can switch to any
// supported language before or while writing their answer.

const SUPPORTED_LANGS = [
  { value: 'javascript', label: 'JavaScript',  icon: 'JS'  },
  { value: 'typescript', label: 'TypeScript',  icon: 'TS'  },
  { value: 'python',     label: 'Python',       icon: 'PY'  },
  { value: 'java',       label: 'Java',         icon: 'JAV' },
  { value: 'csharp',     label: 'C#',           icon: 'C#'  },
  { value: 'cpp',        label: 'C++',          icon: 'C++' },
  { value: 'go',         label: 'Go',           icon: 'GO'  },
  { value: 'rust',       label: 'Rust',         icon: 'RS'  },
  { value: 'kotlin',     label: 'Kotlin',       icon: 'KT'  },
  { value: 'ruby',       label: 'Ruby',         icon: 'RB'  },
  { value: 'sql',        label: 'SQL',          icon: 'SQL' },
];

const LANG_MAP = {
  javascript: 'javascript',
  typescript: 'typescript',
  python:     'python',
  java:       'java',
  go:         'go',
  csharp:     'csharp',
  'c#':       'csharp',
  cpp:        'cpp',
  'c++':      'cpp',
  c:          'c',
  ruby:       'ruby',
  rust:       'rust',
  kotlin:     'kotlin',
  sql:        'sql',
};

const DEFAULT_STARTER = {
  javascript: '// Write your solution here\n',
  typescript: '// Write your solution here\n',
  python:     '# Write your solution here\n',
  java:       'class Solution {\n  public static void main(String[] args) {\n    // Write your solution here\n  }\n}\n',
  go:         'package main\n\nfunc main() {\n  // Write your solution here\n}\n',
  csharp:     'public class Solution {\n  public static void Main(string[] args) {\n    // Write your solution here\n  }\n}\n',
  cpp:        '#include <iostream>\n\nint main() {\n  // Write your solution here\n  return 0;\n}\n',
  rust:       'fn main() {\n    // Write your solution here\n}\n',
  kotlin:     'fun main() {\n    // Write your solution here\n}\n',
  ruby:       '# Write your solution here\n',
  sql:        '-- Write your query here\n',
};

function normalizeLang(raw) {
  if (!raw) return null;
  const key = raw.toString().toLowerCase().trim();
  return LANG_MAP[key] || null;
}

export default function CodeChallenge({ challenge, onSubmit, locked, previousAnswer }) {
  const defaultLang = normalizeLang(challenge.language);

  // null means "candidate must choose" — happens when challenge has no configured language
  const [language, setLanguage] = useState(() =>
    previousAnswer?.language
      ? normalizeLang(previousAnswer.language)
      : normalizeLang(challenge.language)  // may be null
  );

  const getStarter = (lang) => {
    if (!lang) return '';
    // Only use challenge.starterCode if it was written for this exact language.
    if (challenge.starterCode && normalizeLang(challenge.language) === lang) {
      return challenge.starterCode;
    }
    return DEFAULT_STARTER[lang] ?? '// Write your solution here\n';
  };

  const [code, setCode] = useState(
    () => previousAnswer?.text ?? (language ? getStarter(language) : '')
  );
  const [hasEdited, setHasEdited] = useState(() => !!previousAnswer?.text);

  // ── Forensics ────────────────────────────────────────────────────────────
  // Captures think-time, typing duration, and paste activity so the evaluator
  // can flag AI-assisted submissions. Refs survive re-renders without
  // re-triggering effects.
  const mountedAtRef    = useRef(Date.now());
  const firstEditAtRef  = useRef(null);
  const pasteEventsRef  = useRef([]); // [{ at, chars }]
  const editorRef       = useRef(null);

  const handleEditorMount = (editor) => {
    editorRef.current = editor;
    // Monaco fires onDidPaste with the range of the pasted text.
    try {
      editor.onDidPaste((e) => {
        if (locked) return;
        const model = editor.getModel();
        if (!model || !e?.range) return;
        const pastedText = model.getValueInRange(e.range);
        const chars = (pastedText || '').length;
        if (chars > 0) pasteEventsRef.current.push({ at: Date.now(), chars });
      });
    } catch (err) {
      // Monaco API quirks across versions — non-fatal.
      console.warn('Monaco paste listener attach failed:', err.message || err);
    }
  };

  const handleLangChange = (newLang) => {
    if (newLang === language) return;
    if (language) {
      // Warn only if the user has written something beyond the default.
      const defaultForCurrent = getStarter(language);
      const isDefaultCode = !hasEdited || code.trim() === defaultForCurrent.trim();
      if (!isDefaultCode) {
        const ok = window.confirm(
          `Switch to ${SUPPORTED_LANGS.find(l => l.value === newLang)?.label}?\n\nYour current code will be replaced with the starter template.`
        );
        if (!ok) return;
      }
    }
    setLanguage(newLang);
    setCode(getStarter(newLang));
    setHasEdited(false);
  };

  const handleCodeChange = (v) => {
    if (locked) return;
    if (firstEditAtRef.current === null) firstEditAtRef.current = Date.now();
    setCode(v ?? '');
    setHasEdited(true);
  };

  const handleSubmit = () => {
    const trimmed = (code || '').trim();
    if (!trimmed || !language) return;

    const now = Date.now();
    const mountedAt   = mountedAtRef.current;
    const firstEditAt = firstEditAtRef.current;
    const pastes      = pasteEventsRef.current;
    const pastedChars = pastes.reduce((sum, p) => sum + p.chars, 0);
    const finalChars  = trimmed.length;
    const starter     = (getStarter(language) || '').length;
    // Approximate "candidate-written" chars (excludes starter scaffolding).
    const writtenChars = Math.max(0, finalChars - starter);

    onSubmit({
      kind: 'code',
      text: trimmed,
      language,
      forensics: {
        secondsViewing:     Math.round((now - mountedAt) / 1000),
        secondsToFirstEdit: firstEditAt ? Math.round((firstEditAt - mountedAt) / 1000) : null,
        secondsTyping:      firstEditAt ? Math.round((now - firstEditAt) / 1000)        : null,
        pasteCount:         pastes.length,
        pastedChars,
        finalChars,
        starterChars:       starter,
        writtenChars,
        pasteRatio:         writtenChars > 0 ? Math.round((pastedChars / writtenChars) * 1000) / 1000 : 0,
      },
    });
  };

  const lineCount = (code || '').split('\n').length;
  const currentMeta = SUPPORTED_LANGS.find(l => l.value === language) || SUPPORTED_LANGS[0];

  return (
    <div>
      {/* Prompt */}
      <div style={{ marginBottom: 16, lineHeight: 1.6, fontSize: 15 }}>{challenge.prompt}</div>

      {/* Language-choice callout — shown when no language is pre-configured */}
      {!challenge.language && !locked && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 14, padding: '10px 14px',
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 8, fontSize: 13,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 6 }}><Globe size={18} /></span>
          <span style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--accent-primary)' }}>Use any language you prefer.</strong>
            {!language && <span style={{ color: '#f87171', fontWeight: 600 }}> ← Select one below to start.</span>}
          </span>
        </div>
      )}

      {/* Language picker — only shown when not locked */}
      {!locked && (
        <div style={pickerRow}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: 0.4, marginRight: 4 }}>
            LANGUAGE
          </span>
          <div style={pickerGroup}>
            {SUPPORTED_LANGS.map(lang => (
              <button
                key={lang.value}
                onClick={() => handleLangChange(lang.value)}
                title={lang.label}
                style={{
                  ...langBtn,
                  ...(lang.value === language ? langBtnActive : {}),
                }}
              >
                <span style={langBtnIcon}>{lang.icon}</span>
                <span style={langBtnLabel}>{lang.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Editor titlebar + editor — only shown once a language is chosen */}
      {language && (
        <>
          <div style={titlebar}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: 'rgba(99,102,241,0.25)',
                color: 'var(--accent-primary)',
                fontWeight: 700,
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: 0.8,
              }}>
                {currentMeta.icon}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{currentMeta.label}</span>
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {lineCount} {lineCount === 1 ? 'line' : 'lines'}
            </span>
          </div>

          <div style={editorWrap}>
            <Suspense fallback={<div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Loading editor…</div>}>
              <Editor
                height="440px"
                language={language}
                value={code}
                onChange={handleCodeChange}
                onMount={handleEditorMount}
                theme="vs-dark"
                loading={<div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Loading editor…</div>}
                options={{
                  readOnly: locked,
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: 'on',
                  renderLineHighlight: 'line',
                  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
                  padding: { top: 10, bottom: 10 },
                }}
              />
            </Suspense>
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {language ? `${(code || '').length} characters` : 'Select a language to begin'}
        </span>
        {!locked ? (
          <button
            onClick={handleSubmit}
            disabled={!(code || '').trim() || !language}
            style={{
              padding: '10px 20px',
              background: language ? 'var(--accent-success)' : 'var(--bg-card)',
              color: language ? '#fff' : 'var(--text-muted)',
              border: language ? 'none' : '1px solid var(--border-color)',
              borderRadius: 6,
              fontWeight: 700,
              cursor: (code || '').trim() && language ? 'pointer' : 'not-allowed',
              opacity: (code || '').trim() && language ? 1 : 0.5,
              transition: 'background 0.2s, color 0.2s',
            }}
          >
            {language ? 'Submit Code →' : 'Choose a language first'}
          </button>
        ) : (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(16,185,129,0.1)',
            border: '1px solid var(--accent-success)',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--accent-success)',
          }}>
            <CheckCircle2 size={14} strokeWidth={2} />
            Submitted in {currentMeta.label}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const pickerRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 10,
  flexWrap: 'wrap',
};

const pickerGroup = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

const langBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-main)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  transition: 'border-color 0.15s, background 0.15s, color 0.15s',
};

const langBtnActive = {
  background: 'rgba(99,102,241,0.15)',
  border: '1px solid var(--accent-primary)',
  color: 'var(--accent-primary)',
};

const langBtnIcon = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.4,
};

const langBtnLabel = {
  fontSize: 12,
};

const titlebar = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: 'var(--bg-main)',
  borderTop: '1px solid var(--border-color)',
  borderLeft: '1px solid var(--border-color)',
  borderRight: '1px solid var(--border-color)',
  borderRadius: '6px 6px 0 0',
  padding: '7px 14px',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
};

const editorWrap = {
  border: '1px solid var(--border-color)',
  borderRadius: '0 0 6px 6px',
  overflow: 'hidden',
  background: '#1e1e1e',
};
