import './ScoreBar.css';
export default function ScoreBar({ found, wrong, remaining }) {
  return (
    <div className="score-bar">
      <div className="score-card"><div className="score-label">Bugs Found</div><div className="score-val green">{found}</div></div>
      <div className="score-card"><div className="score-label">Wrong</div><div className="score-val red">{wrong}</div></div>
      <div className="score-card"><div className="score-label">Remaining</div><div className="score-val">{remaining}</div></div>
    </div>
  );
}
