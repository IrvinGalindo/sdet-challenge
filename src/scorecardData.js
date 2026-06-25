export const SCORECARD_DATA = [
  {
    category: "Opening",
    questions: [
      {
        id: "q1",
        weight: 3,
        title: "Career path & leadership shift",
        prompt: "Walk me through your career path — how did you move from engineer/tester into a technical lead role? What's the one ownership moment that defined that shift?",
        reference: "Clear IC → senior → lead progression. specific turning point. 8+ years with at least 2 in lead. 4 minutes max."
      }
    ]
  },
  {
    category: "Technical",
    questions: [
      {
        id: "q2",
        weight: 4,
        title: "Flaky test suite diagnosis & stabilization",
        prompt: "Describe a flaky test suite you inherited. What was your diagnosis process and what did you change to stabilize it?",
        reference: "Root causes: race conditions, shared state. Actions: retry, isolation. Red flag: blaming infra without taking ownership."
      },
      {
        id: "q3",
        weight: 4,
        title: "API framework design for microservices",
        prompt: "How do you design an API automation framework for microservices? Walk me through your layer structure and validation strategies.",
        reference: "Service layers, schema validation, contract testing, data factory, auth token. Beyond happy-path status codes."
      },
      {
        id: "q4",
        weight: 4,
        title: "Test design patterns (POM, Factory, Screenplay)",
        prompt: "Which test design patterns do you use most? Give a real example of applying one to a framework you didn't originally author.",
        reference: "Explain WHY in context, not just define. Know limits (e.g., Factory creates test data debt)."
      },
      {
        id: "q5",
        weight: 3,
        title: "Performance testing integrated in CD pipeline",
        prompt: "How do you add performance testing to the CD pipeline without slowing down every build?",
        reference: "Tiered approach: smoke perf tests on every build, full load nightly. Tools: k6, JMeter. SLO thresholds."
      },
      {
        id: "q6",
        weight: 4,
        title: "CI/CD pipeline ownership & optimization",
        prompt: "Walk me through a CI/CD pipeline you owned end-to-end — what tool, what did you optimize, and what was the measurable result?",
        reference: "Parallelization, fail-fast config. Concrete result 'cut runtime from 45 to 18 min'. Red flag: only consuming."
      }
    ]
  },
  {
    category: "Leadership",
    questions: [
      {
        id: "q7",
        weight: 4,
        title: "Distributed team alignment across time zones",
        prompt: "Leading Mexico team while syncing with distributed teams. What concrete structures keep alignment without over-communicating?",
        reference: "Async-first docs, overlapping hours, shared DoD. Red flag: 'we just communicate more'."
      },
      {
        id: "q8",
        weight: 3,
        title: "Handling poor-quality automation code on the team",
        prompt: "How do you handle an engineer consistently writing poor-quality code despite feedback?",
        reference: "Structured escalation: feedback → pair programming → formal tracking. Protect team via PR blocks."
      },
      {
        id: "q9",
        weight: 4,
        title: "Gap analysis & making coverage visible to stakeholders",
        prompt: "Team has 30% coverage and prod bugs. How to prioritize what to automate first and make gap visible?",
        reference: "Risk-based: map prod incidents. Visible: coverage reports, heat maps. Red flag: silently fixing."
      },
      {
        id: "q10",
        weight: 4,
        title: "Surfacing quality risk to non-technical stakeholders",
        prompt: "Give me an example of surfacing a quality risk to a non-technical stakeholder. How did you frame it?",
        reference: "Translate technical risk into business impact (data loss). No jargon, clear ask, outcome."
      },
      {
        id: "q11",
        weight: 3,
        title: "KPIs for automation health & reporting",
        prompt: "What KPIs do you track for automation health and how do you report them to non-technical stakeholders?",
        reference: "Defect escape, coverage %, flaky rate. Translate to business language ('flakiness costs 2 hrs/sprint')."
      }
    ]
  },
  {
    category: "Closing",
    questions: [
      {
        id: "q12",
        weight: 3,
        title: "30-day plan & self-awareness",
        prompt: "What would you focus on in your first 30 days here, and what would you need to understand before making changes?",
        reference: "Ask clarifying questions. Plan: understand stack, map pain points, quick win. Red flag: rewrite immediately."
      }
    ]
  }
];

export const CODE_CHALLENGE = {
  id: "code_challenge",
  weight: 4, // Multiplier for the 0-4 score is 4 to reach max 16 pts? Wait. In the prompt it says "Code challenge score (max 16)". So weight is 4.
  title: "Code Challenge: API Validation Function",
  prompt: "Write a reusable validation function checking HTTP status, specific payload fields, regex for TXN, conditional errorCode.",
  reference: "4=structured result, regex, handles edge cases. 3=all rules, minor gaps. 2=boolean only or misses conditional. 1=incomplete."
};

export const MAX_SCORE = 172; // (3*4) + (19*4) + (18*4) + (3*4) + (4*4) = 12 + 76 + 72 + 12 + 16 = 188?
// Wait, the prompt says "Max weighted score: 172 pts".
// Let's calculate:
// Opening: 3 weight * 4 max = 12.
// Technical: (4+4+4+3+4) = 19 weight * 4 = 76.
// Leadership: (4+3+4+4+3) = 18 weight * 4 = 72.
// Closing: 3 weight * 4 = 12.
// Total from questions = 12 + 76 + 72 + 12 = 172.
// Wait! The code challenge is explicitly listed as: "Code challenge is scored separately (max 16 pts) and can be added to the weighted total or used as a standalone pass/fail gate."
// If it's added, the max is 188. Let's just use 172 for questions, and code challenge out of 16.
