import { CheckCircle2, XCircle } from 'lucide-react';
import { useState, useMemo } from 'react';
import './QuizChallenge.css';

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function QuizChallenge({ quiz, candidateName, onComplete, onBack }) {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState({});

  if (!quiz || !quiz.questions || quiz.questions.length === 0) return null;

  const question = quiz.questions[currentQ];
  const totalQ = quiz.questions.length;
  const isLast = currentQ === totalQ - 1;
  const isAnswered = question ? answers[question.id] !== undefined : false;
  const isRevealed = question ? revealed[question.id] : false;
  const progress = (currentQ / totalQ) * 100;

  const shuffledOptions = useMemo(
    () => shuffleArray(question.options),
    [question.id]
  );

  const handleSelect = (optionLabel) => {
    if (answers[question.id] !== undefined) return;
    setAnswers(prev => ({ ...prev, [question.id]: optionLabel }));
    setRevealed(prev => ({ ...prev, [question.id]: true }));
  };

  const handleNext = () => {
    if (currentQ < totalQ - 1) setCurrentQ(q => q + 1);
  };

  const handleFinish = () => {
    let score = 0;
    const richAnswers = {};
    
    quiz.questions.forEach(q => {
      const selectedLabel = answers[q.id];
      const selected = q.options.find(o => o.label === selectedLabel);
      const correctOpt = q.options.find(o => o.correct);
      
      const isCorrect = selected && selected.correct;
      if (isCorrect) score++;
      
      richAnswers[q.id] = {
        questionText: q.question,
        selected: selectedLabel || 'None',
        correctOption: correctOpt ? correctOpt.label : 'None',
        isCorrect: !!isCorrect
      };
    });

    onComplete({ score, total: totalQ, answers: richAnswers, quiz });
  };

  const selectedLabel = answers[question.id];
  const selectedOption = question.options.find(o => o.label === selectedLabel);

  return (
    <div className="quiz-challenge">
      {/* Header */}
      <div className="qc-header">
        {onBack
          ? <button className="qc-back-btn" onClick={onBack}>← Back</button>
          : <span />
        }
        <div className="qc-meta">
          <span className="qc-icon">{quiz.icon}</span>
          <span className="qc-title">{quiz.title}</span>
        </div>
        <span className="qc-step">{currentQ + 1} / {totalQ}</span>
      </div>

      {/* Progress */}
      <div className="qc-progress-track">
        <div className="qc-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="qc-body">
        {/* Code snippet */}
        <div className="qc-snippet-panel">
          <div className="qc-snippet-header">
            <span className="qc-lang-badge">{quiz.language}</span>
            <span className="qc-snippet-label">Reference Code</span>
          </div>
          <pre className="qc-snippet"><code>{quiz.snippet}</code></pre>
        </div>

        {/* Question Panel */}
        <div className="qc-question-panel">
          <div className="qc-q-number">Question {currentQ + 1}</div>
          <h3 className="qc-q-text">{question.question}</h3>

          <div className="qc-options">
            {shuffledOptions.map(opt => {
              let cls = 'qc-option';
              if (isRevealed) {
                if (opt.correct) cls += ' correct';
                else if (opt.label === selectedLabel && !opt.correct) cls += ' wrong';
                else cls += ' dimmed';
              }
              return (
                <button
                  key={opt.label}
                  className={cls}
                  onClick={() => handleSelect(opt.label)}
                  disabled={isAnswered}
                >
                  <span className="qc-opt-label">{opt.label}</span>
                  <span className="qc-opt-text">{opt.text}</span>
                </button>
              );
            })}
          </div>

          {/* Explanation */}
          {isRevealed && selectedOption && (
            <div className={`qc-explanation ${selectedOption.correct ? 'correct' : 'wrong'}`}>
              <span className="qc-exp-icon">{selectedOption.correct ? <CheckCircle2 size={16} style={{ color: 'var(--accent-success)' }} /> : <XCircle size={16} style={{ color: 'var(--accent-danger)' }} />}</span>
              <p>{selectedOption.explanation}</p>
            </div>
          )}

          {/* Navigation */}
          {isRevealed && (
            <div className="qc-nav">
              {!isLast ? (
                <button className="qc-next-btn" onClick={handleNext}>
                  Next Question →
                </button>
              ) : (
                <button className="qc-finish-btn" onClick={handleFinish}>
                  Finish &amp; See Results
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
