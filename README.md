<div align="center">

# 🧪 SDET Tech Lead Challenge Platform

**A premium, multi-stage technical assessment tool for evaluating Senior SDET and Tech Lead candidates.**

[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)](https://reactjs.org)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=flat-square&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![CSS](https://img.shields.io/badge/CSS-Vanilla-1572B6?style=flat-square&logo=css3)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

---

## 📌 Overview

The **SDET Tech Lead Challenge** is an interactive web-based tool designed to rigorously evaluate the depth of knowledge of Senior Software Development Engineers in Test and Tech Lead SDET candidates.

Unlike generic quiz platforms, this tool simulates **real-world scenarios**: reading production-grade test code, diagnosing subtle bugs, understanding API behavior under failure, and reasoning about database query semantics.

---

## 🎯 Challenge Modules

The platform consists of **three sequential challenge types**, each targeting a distinct competency area:

### 1. 🔗 REST Assured Challenge
Candidates analyze a real Java REST Assured test suite and answer four scenario-based questions:
- What is the purpose of the test suite?
- How to log responses only on failure?
- What happens to dependent tests when a POST fails?
- Will assertions succeed given a broken upstream dependency?

> **Target skills:** API testing patterns, error handling, test dependency awareness, RestAssured fluent API.

---

### 2. 🗄️ SQL Challenge
Candidates examine a two-table SQL schema with seed data and three queries, then answer:
- Is inserting a NULL foreign key valid? Why?
- How many rows does a LEFT JOIN return, and what shows for unassigned employees?
- What is excluded from an INNER JOIN GROUP BY, and how does it affect aggregations?

> **Target skills:** SQL JOIN semantics, NULL handling, aggregate functions, referential integrity.

---

### 3. 🐛 Bug Finder Challenge
Candidates browse a realistic project file tree (Java or JavaScript) and identify injected bugs hidden across multiple files, directories, and configuration files. Each bug is categorized by topic:

| Topic | Examples |
|---|---|
| `[Security]` | Hardcoded passwords, HTTP instead of HTTPS |
| `[Flakiness]` | Low timeouts, missing waits, brittle assertions |
| `[Architecture]` | Missing headers, wrong status code checks |
| `[CI/CD]` | Unpinned dependency versions (`LATEST`, `*`) |
| `[Performance]` | Resource leaks (driver, JDBC connections) |
| `[Environment]` | Missing WebDriverManager, ChromeOptions |
| `[Best Practice]` | Wrong assertion argument order, poor naming |

> **Target skills:** Code review, automation best practices, security awareness, architectural judgment.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ and npm

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/sdet-challenge.git
cd sdet-challenge

# Install dependencies
npm install

# Start the development server
npm start
```

The app will open at [http://localhost:3000](http://localhost:3000).

---

## 🧭 How It Works — Hiring Flow

1. **Interviewer opens the app** and shares the screen (or shares the local URL)
2. **Candidate enters their name** in the input field
3. **Candidate selects a challenge** from the landing screen
4. For **quiz challenges**: candidate reads the code snippet and selects one of four options per question — explanations reveal after each answer
5. For the **Bug Finder**: candidate clicks on suspicious code lines or file/folder names to flag and confirm bugs
6. **Submit & Score** records the result to local storage
7. **View Results** (leaderboard) allows interviewers to expand any candidate row and see exactly which bugs they caught and which they missed

---

## 📊 Scoring & Evaluation

| Score | Grade |
|---|---|
| 90–100% | Exceptional — strong Tech Lead candidate |
| 70–89% | Good — solid SDET skills |
| 50–69% | Average — some gaps to review |
| < 50% | Needs improvement |

Results are persisted in **localStorage** and survive page refreshes. The leaderboard shows:
- ✅ Bugs correctly identified (with topic and explanation)
- ❌ Bugs missed (with topic and explanation) — for post-interview debrief

---

## 🗂️ Project Structure

```
sdet-challenge/
├── public/
│   ├── index.html
│   └── created_with.png       # Branding signature
├── src/
│   ├── data.js                # Bug finder file contents + bug metadata
│   ├── quizData.js            # REST Assured + SQL quiz questions & answers
│   ├── App.jsx                # Root component + routing logic
│   ├── App.css                # Global layout styles
│   ├── index.css              # CSS variables, dark theme tokens
│   └── components/
│       ├── ModeSelector.jsx   # Landing screen with 3 challenge cards
│       ├── ModeSelector.css
│       ├── QuizChallenge.jsx  # Multi-choice quiz engine
│       ├── QuizChallenge.css
│       ├── FileTree.jsx       # Interactive project directory tree
│       ├── FileTree.css
│       ├── CodePanel.jsx      # Code viewer with inline bug marking
│       ├── CodePanel.css
│       ├── ScoreBar.jsx       # Live score indicator
│       ├── ScoreBar.css
│       ├── Leaderboard.jsx    # Results table with expandable rows
│       ├── Leaderboard.css
│       ├── ResultModal.jsx    # Completion modal with topic breakdown
│       └── ResultModal.css
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 (Create React App) |
| Styling | Vanilla CSS with CSS custom properties |
| State | React `useState`, `useCallback`, `useEffect` |
| Persistence | Browser `localStorage` |
| Typography | Inter (UI), JetBrains Mono (code) |
| Design | Dark mode, glassmorphism, micro-animations |

---

## ✨ Design Philosophy

> _"A tool that evaluates engineers should itself be engineered well."_

- **Dark-first IDE aesthetic** — candidates feel at home immediately
- **No frameworks or UI libraries** — vanilla CSS for full control and zero bloat
- **Instant feedback** — every action (correct/wrong bug, quiz answer) gives immediate visual and textual feedback
- **Forensic leaderboard** — not just a score, but a complete map of what was found and missed per candidate

---

## 📝 Adding More Bugs or Questions

### Adding a new bug to an existing file

In `src/data.js`, find the file entry and add a line number → description mapping:

```js
'LoginTest.java': {
  bugs: {
    6: '[Environment] Bug: new ChromeDriver() — no WebDriverManager...',
    42: '[Security] Bug: New bug description here.',  // Add this
  }
}
```

### Adding a new quiz question

In `src/quizData.js`, append to the `questions` array of a quiz:

```js
{
  id: 'ra-5',
  question: 'Your new question here?',
  options: [
    { label: 'A', text: '...', correct: false, explanation: '...' },
    { label: 'B', text: '...', correct: true,  explanation: '...' },
    { label: 'C', text: '...', correct: false, explanation: '...' },
    { label: 'D', text: '...', correct: false, explanation: '...' },
  ]
}
```

---

## 📄 License

MIT © Your Organization

---

<div align="center">
  <sub>Built with ❤️ for engineering excellence</sub>
</div>
