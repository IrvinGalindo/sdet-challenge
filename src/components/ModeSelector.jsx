import './ModeSelector.css';

const MODES = [
  {
    id: 'restassured',
    icon: '🔗',
    label: 'REST Assured',
    tag: 'API Testing',
    description: 'Analyze a REST Assured test suite and answer scenario-based questions about API behavior, failure modes, and best practices.',
    color: '#F59E0B',
    questions: 4,
  },
  {
    id: 'sql',
    icon: '🗄️',
    label: 'SQL Queries',
    tag: 'Database',
    description: 'Examine a SQL schema with JOINs and aggregations. Answer questions about NULL handling, LEFT vs INNER JOIN, and GROUP BY behavior.',
    color: '#8B5CF6',
    questions: 3,
  },
  {
    id: 'bugfinder',
    icon: '🐛',
    label: 'Bug Finder',
    tag: 'Code Review',
    description: 'Review realistic test automation code across files and directories. Identify security, flakiness, architecture, and CI/CD bugs.',
    color: '#3B82F6',
    questions: null,
  },
];

export default function ModeSelector({ candidateName, setCandidateName, onSelectMode, showLB, setShowLB }) {
  return (
    <div className="mode-selector">
      <div className="ms-header">
        <h1 className="ms-title">SDET Tech Lead Challenge</h1>
        <p className="ms-subtitle">
          A multi-stage technical assessment covering API testing, database queries, and code review.
          Select a challenge to begin.
        </p>
      </div>

      <div className="ms-candidate-row">
        <input
          className="candidate-input ms-input"
          value={candidateName}
          onChange={e => setCandidateName(e.target.value)}
          placeholder="Enter candidate name before starting..."
        />
        <button className="link-btn" onClick={() => setShowLB(v => !v)}>
          {showLB ? 'Hide results' : '📊 View results'}
        </button>
      </div>

      <div className="ms-cards">
        {MODES.map((mode, i) => (
          <button
            key={mode.id}
            className="ms-card"
            style={{ '--card-color': mode.color }}
            onClick={() => onSelectMode(mode.id)}
          >
            <div className="ms-card-number">{String(i + 1).padStart(2, '0')}</div>
            <div className="ms-card-icon">{mode.icon}</div>
            <div className="ms-card-tag" style={{ color: mode.color }}>{mode.tag}</div>
            <h2 className="ms-card-label">{mode.label}</h2>
            <p className="ms-card-desc">{mode.description}</p>
            <div className="ms-card-footer">
              {mode.questions
                ? <span className="ms-card-count">{mode.questions} questions</span>
                : <span className="ms-card-count">Java &amp; JavaScript</span>
              }
              <span className="ms-card-arrow" style={{ color: mode.color }}>→</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
