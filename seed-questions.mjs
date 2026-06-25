// Seed script — run with: node seed-questions.mjs
// Seeds all interview questions as a SuperAdmin into Firebase.
//
// Required env vars (load via .env in repo root):
//   FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
//   FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID,
//   SEED_EMAIL, SEED_PASSWORD

import 'dotenv/config';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

const REQUIRED = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'SEED_EMAIL',
  'SEED_PASSWORD',
];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required env vars: ' + missing.join(', '));
  console.error('Copy .env.example to .env and fill in the seed values.');
  process.exit(1);
}

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const EMAIL = process.env.SEED_EMAIL;
const PASSWORD = process.env.SEED_PASSWORD;

const QUESTIONS = [
  // ─── Warm-up ────────────────────────────────────────────────────────
  { level: 'Warm-up', category: 'Testing Fundamentals', weight: 2, title: 'Verification vs Validation', prompt: 'What is the difference between verification and validation?', reference: 'Verification = are we building the product right? (reviews, inspections). Validation = are we building the right product? (actual testing vs user needs).' },
  { level: 'Warm-up', category: 'Testing Fundamentals', weight: 2, title: 'Test Case vs Test Scenario', prompt: 'What is a test case vs a test scenario? Give me an example of each.', reference: 'Scenario = broader user story (e.g. "login"). Test case = specific, detailed steps with expected result (e.g. "enter valid email + password → lands on dashboard"). Expect concrete examples.' },
  { level: 'Warm-up', category: 'Testing Fundamentals', weight: 2, title: 'Severity vs Priority', prompt: 'What does "severity" vs "priority" mean for a defect? Give me an example where severity is high but priority is low.', reference: 'Severity = technical impact. Priority = urgency to fix. Example: crash in an admin-only legacy screen (high severity, low priority because users rarely see it).' },
  { level: 'Warm-up', category: 'Testing Fundamentals', weight: 2, title: 'Regression Testing', prompt: 'What is regression testing and why does it exist?', reference: 'Ensuring that previously working functionality still works after new changes. It exists because code changes can unintentionally break existing behavior.' },
  { level: 'Warm-up', category: 'Testing Fundamentals', weight: 2, title: 'STLC Phases', prompt: 'What are the phases of the Software Testing Life Cycle (STLC)?', reference: 'Requirements analysis, test planning, test case design, test environment setup, test execution, test closure/reporting.' },

  { level: 'Warm-up', category: 'General', weight: 2, title: 'Test Management Tools', prompt: 'Have you used any test management tool like TestRail or Zephyr? How did you organize your test cases there?', reference: 'Listen for practical experience organizing suites, linking to requirements or stories, understanding traceability. Not just tool name.' },
  { level: 'Warm-up', category: 'General', weight: 2, title: 'SQL Duplicate Records', prompt: 'Can you write a SQL query to find duplicate records in a table?', reference: 'GROUP BY + HAVING COUNT(*) > 1. Bonus: use a CTE or window function. Red flag: can\'t write it at all.' },
  { level: 'Warm-up', category: 'General', weight: 2, title: 'What is an API?', prompt: 'What is an API? Have you ever tested one manually using Postman or a similar tool?', reference: 'Clear definition (contract for services to communicate). Practical Postman experience: setting headers, auth tokens, inspecting response body/status codes.' },

  // ─── QA Analyst ─────────────────────────────────────────────────────
  { level: 'QA Analyst', category: 'Testing Fundamentals', weight: 3, title: 'Boundary Value Analysis', prompt: 'What is boundary value analysis? Give me a real example of how you applied it.', reference: 'Testing at the edges of valid input ranges. E.g. for a 1–100 numeric field: test 0, 1, 2, 99, 100, 101. Must have a real example, not just the textbook definition.' },
  { level: 'QA Analyst', category: 'Testing Fundamentals', weight: 3, title: 'Equivalence Partitioning', prompt: 'What is equivalence partitioning and how does it reduce the number of test cases you need?', reference: 'Dividing inputs into groups where all values behave the same. One test per partition is sufficient instead of testing every value. Expect a concrete partition example.' },
  { level: 'QA Analyst', category: 'Testing Fundamentals', weight: 3, title: 'Exploratory Testing', prompt: 'What is exploratory testing and when do you choose it over scripted testing?', reference: 'Simultaneous test design and execution, driven by tester\'s intuition. Appropriate when: requirements are vague, a new feature lands, or you\'re looking for what scripted tests missed.' },
  { level: 'QA Analyst', category: 'Testing Fundamentals', weight: 3, title: 'Black / White / Gray Box', prompt: 'What is the difference between black box, white box, and gray box testing?', reference: 'Black box = no code knowledge, user perspective. White box = full code access, internal paths. Gray box = partial knowledge (e.g. DB schema known but code not). Real examples are key.' },
  { level: 'QA Analyst', category: 'Testing Fundamentals', weight: 2, title: 'Traceability Matrix', prompt: 'What is a traceability matrix and have you ever maintained one?', reference: 'Maps requirements → test cases → defects. Ensures coverage. Red flag: never maintained one or doesn\'t understand its purpose in audit trails and coverage gaps.' },

  { level: 'QA Analyst', category: 'Applied', weight: 3, title: 'Testing Undefined Requirements', prompt: 'How do you decide what to test when requirements are not fully defined?', reference: 'Risk-based prioritization, stakeholder interviews, acceptance criteria workshops, reference to similar existing flows. Red flag: waits for complete requirements before starting.' },
  { level: 'QA Analyst', category: 'Applied', weight: 4, title: 'Login Feature End-to-End', prompt: 'Walk me through how you would test a login feature end-to-end, including edge cases.', reference: 'Happy path, invalid credentials, lockout policy, SQL injection, forgot password, session handling, SSO, empty fields, case sensitivity. Depth and structure matter more than length.' },
  { level: 'QA Analyst', category: 'Applied', weight: 3, title: 'Using Logs to Investigate Bugs', prompt: 'How do you use logs to investigate a bug? Have you used Splunk, CloudWatch, or anything similar?', reference: 'Knows what to look for: error codes, timestamps, correlation IDs. Familiar with at least one log aggregation platform. Can explain filtering and tracing a request end-to-end.' },
  { level: 'QA Analyst', category: 'Applied', weight: 2, title: 'Bug vs Enhancement', prompt: 'What is the difference between a bug and an enhancement? How do you argue for bug priority in triage?', reference: 'Bug = product deviates from spec. Enhancement = new capability. Argumentation: customer impact, reproducibility rate, data loss risk, SLA implications. Not just emotional.' },
  { level: 'QA Analyst', category: 'Applied', weight: 3, title: 'Production Defect Missed in QA', prompt: 'You find a defect in production that nobody caught in QA. What do you do and what do you learn from it?', reference: 'Immediate: triage severity, communicate. Root cause: was it a test gap, environment difference, or data edge case? Follow-up: add a test, update strategy. Red flag: blame-first response.' },

  // ─── Middle SDET ────────────────────────────────────────────────────
  { level: 'Middle SDET', category: 'Testing Fundamentals', weight: 3, title: 'The Test Pyramid', prompt: 'What is the test pyramid? How does it influence the way you distribute your automated tests?', reference: 'Many unit tests, fewer integration, fewer E2E at the top. Influences investment: heavy at unit for speed/stability, selective E2E for critical flows. Red flag: only E2E.' },
  { level: 'Middle SDET', category: 'Testing Fundamentals', weight: 3, title: 'E2E vs Integration Testing', prompt: 'What is the difference between end-to-end testing and integration testing? Where does each live in your pipeline?', reference: 'Integration = component boundaries, usually no UI. E2E = full system stack including UI/API. Pipeline placement: integration on PR, E2E nightly or pre-release.' },
  { level: 'Middle SDET', category: 'Testing Fundamentals', weight: 2, title: 'Smoke vs Sanity Test', prompt: 'What is a smoke test vs a sanity test? When do you run each one?', reference: 'Smoke = broad shallow check after deploy (is the app alive?). Sanity = narrow deep check of a specific fix or change. Run smoke on every deploy; sanity after a targeted bug fix.' },
  { level: 'Middle SDET', category: 'Testing Fundamentals', weight: 3, title: 'Shift-Left Testing', prompt: 'What is shift-left testing and how have you practiced it in a real project?', reference: 'Moving testing earlier in SDLC: reviewing requirements, writing tests before code, participating in design. Red flag: only does shift-left in theory without real examples.' },
  { level: 'Middle SDET', category: 'Testing Fundamentals', weight: 3, title: 'Test Coverage Limits', prompt: 'What does "test coverage" mean to you — and what are its limits as a quality metric?', reference: '100% coverage ≠ no bugs. Coverage doesn\'t measure: correctness of assertions, edge case logic, data integrity, concurrent behavior. Expect nuanced critique, not a definition.' },

  { level: 'Middle SDET', category: 'Applied', weight: 3, title: 'Writing Tests From Scratch', prompt: 'Have you ever written automated tests from scratch, or only maintained existing ones?', reference: 'Must have from-scratch experience: setting up framework, dependency management, config strategy, base test class, CI integration. Maintaining only is a yellow flag.' },
  { level: 'Middle SDET', category: 'Applied', weight: 4, title: 'Page Object Model', prompt: 'Explain the Page Object Model. Why does it exist and when would you NOT use it?', reference: 'Separates page interaction from test logic. Exists for maintainability. Do NOT use when: purely API-driven tests, POM creates over-abstraction for simple flows, or migrating to Screenplay pattern.' },
  { level: 'Middle SDET', category: 'Applied', weight: 4, title: '40% Flaky Tests', prompt: 'You inherited an automation suite with 40% flaky tests. Where do you start?', reference: 'Categorize by root cause: async/timing, shared state, test order dependency, hard-coded data, external service calls. Prioritize by frequency of failure and business impact. Quarantine first.' },
  { level: 'Middle SDET', category: 'Applied', weight: 3, title: 'Unit vs Integration vs E2E Decision', prompt: 'How do you decide what belongs in a unit test vs an integration test vs an end-to-end test?', reference: 'Unit: isolated logic. Integration: contract between components. E2E: critical user journeys. Decision factors: speed, flakiness risk, value of the coverage. Not "test everything at E2E."' },
  { level: 'Middle SDET', category: 'Applied', weight: 3, title: 'CI Pipeline Trigger Config', prompt: 'How do you trigger your automated tests in a CI pipeline? Have you configured that yourself?', reference: 'Expect real experience: YAML config, stage gates, parallelization, environment vars, artifact publishing. Red flag: only runs tests locally, never configured a pipeline.' },
  { level: 'Middle SDET', category: 'Applied', weight: 3, title: 'Mocking in Tests', prompt: 'What is mocking and when do you use it in your tests?', reference: 'Replace real dependencies (DB, APIs, services) with controlled fakes. Use when: external service is slow/unreliable/unavailable, isolating logic, simulating error responses. Knows the difference from stubs and spies.' },

  // ─── Senior SDET ─────────────────────────────────────────────────────
  { level: 'Senior SDET', category: 'Testing Fundamentals', weight: 4, title: 'Risk-Based Testing', prompt: 'What is risk-based testing? How do you decide which areas of a system deserve the most test coverage?', reference: 'Prioritize based on: likelihood of failure × impact. Inputs: change frequency, complexity, defect history, business criticality, customer exposure. Not just "test everything equally."' },
  { level: 'Senior SDET', category: 'Testing Fundamentals', weight: 4, title: 'Contract Testing', prompt: 'What is contract testing and when would you use it over end-to-end integration tests?', reference: 'Pact or similar. Each service defines its contract (expected request/response). Use when: microservices evolve independently, E2E tests are too slow or fragile, need to decouple team delivery.' },
  { level: 'Senior SDET', category: 'Testing Fundamentals', weight: 3, title: 'Mutation Testing', prompt: 'What is mutation testing? Have you used it and what did it tell you that coverage reports didn\'t?', reference: 'Introduces small code changes (mutations) and checks if tests catch them. Coverage says "line executed"; mutation testing says "assertion meaningful." Red flag: never heard of it.' },
  { level: 'Senior SDET', category: 'Testing Fundamentals', weight: 4, title: 'Testing Async Architectures', prompt: 'How do you approach testing in an event-driven or asynchronous architecture where outcomes are not immediate?', reference: 'Polling strategies, event capture/replay, consumer-driven contracts, idempotency assertions, dead letter queue validation. Red flag: says "just add sleeps."' },
  { level: 'Senior SDET', category: 'Testing Fundamentals', weight: 4, title: 'Load vs Stress vs Soak vs Spike', prompt: 'What is the difference between load testing, stress testing, soak testing, and spike testing? When does each one apply?', reference: 'Load = expected concurrency. Stress = beyond capacity to find breaking point. Soak = sustained load over time (memory leaks). Spike = sudden surge. Each has a distinct goal and scenario.' },

  { level: 'Senior SDET', category: 'Applied', weight: 4, title: 'Testing Across 3 Microservices', prompt: 'You need to test a feature that spans 3 microservices. How do you architect your test strategy?', reference: 'Contract tests at boundaries, component tests per service, integration tests at orchestration layer, E2E for critical user journey only. Explicitly manage test data and environment isolation.' },
  { level: 'Senior SDET', category: 'Applied', weight: 4, title: 'Staging Pass / Production Fail', prompt: 'An automated test is passing in staging but failing in production consistently. How do you investigate?', reference: 'Environment diff (config, data, infra). Check: feature flags, external service versions, data state, timing differences, latency. Not just "it\'s an env issue" — must show systematic approach.' },
  { level: 'Senior SDET', category: 'Applied', weight: 3, title: 'Data Integrity Across Service Boundaries', prompt: 'How have you validated data integrity across service boundaries in a distributed system?', reference: 'Consumer-driven contracts, schema registry, event payload validation, cross-service reconciliation scripts, DB state assertions. Must have real examples, not just theory.' },
  { level: 'Senior SDET', category: 'Applied', weight: 4, title: 'Framework Refactor', prompt: 'Describe a time you refactored an automation framework. What was wrong with it and what decisions did you make?', reference: 'Specific technical problems (coupling, no data isolation, fragile selectors). Decisions should be justified (why POM → Screenplay, why RestTemplate → Feign). Not just "it was messy."' },
  { level: 'Senior SDET', category: 'Applied', weight: 4, title: 'Performance in CI/CD', prompt: 'Have you implemented performance tests inside a CI/CD pipeline? What did you measure and what thresholds did you set?', reference: 'Tools (k6, Gatling, JMeter). Metrics: p95/p99 latency, throughput, error rate. Thresholds as gates. Tiered approach: smoke perf on every build, full load nightly.' },
  { level: 'Senior SDET', category: 'Applied', weight: 3, title: 'Avoiding Automation Maintenance Nightmare', prompt: 'How do you keep your automation code from becoming a maintenance nightmare as the product evolves?', reference: 'Design principles: DRY, abstraction layers, page objects/screenplay, config externalization, data factories, no hardcoded waits or IDs. Code reviews for test code same as prod.' },
  { level: 'Senior SDET', category: 'Applied', weight: 3, title: '"That\'s Not Testable" Response', prompt: 'A developer tells you "that\'s not testable." How do you respond and what do you do next?', reference: 'Explore WHY: missing hooks, tight coupling, no dependency injection. Collaborate on making it testable: logging, feature flags, interfaces. Not confrontational but constructive.' },
  { level: 'Senior SDET', category: 'Applied', weight: 4, title: 'Finding Coverage Blind Spots', prompt: 'How do you identify blind spots in your test coverage — areas that have no tests but should?', reference: 'Production incident map, code churn analysis, defect clustering, manual exploratory sessions, consumer journey mapping. Coverage tools help but aren\'t sufficient alone.' },

  // ─── SDET Team Lead ──────────────────────────────────────────────────
  { level: 'SDET Team Lead', category: 'Testing Fundamentals', weight: 4, title: 'Quality Health Beyond Pass/Fail', prompt: 'How do you define and measure the overall quality health of a product — beyond pass/fail rates?', reference: 'Defect escape rate, MTTD/MTTR, flakiness trend, test coverage delta, customer-reported issues, deployment confidence. Must translate metrics into business language.' },
  { level: 'SDET Team Lead', category: 'Testing Fundamentals', weight: 4, title: 'Test Strategy for Unknown System', prompt: 'How do you build a test strategy for a system you have never seen before? Walk me through your process.', reference: 'Step 1: understand domain and risk. Step 2: map architecture (services, integrations). Step 3: identify team coverage gaps. Step 4: prioritize layers. Step 5: define what done looks like. Red flag: starts with tools.' },
  { level: 'SDET Team Lead', category: 'Testing Fundamentals', weight: 4, title: 'Testability at Architecture Level', prompt: 'What is testability and how do you influence it at the architecture level before a line of code is written?', reference: 'Testability = ease of injecting test conditions and observing outcomes. Influence via: design reviews, dependency injection advocacy, contract-first API design, logging standards, feature flags.' },
  { level: 'SDET Team Lead', category: 'Testing Fundamentals', weight: 4, title: 'Coverage Speed vs Depth Under Pressure', prompt: 'How do you balance automated coverage speed vs depth when the team is under constant delivery pressure?', reference: 'Risk-based prioritization. Negotiate scope with stakeholders. Define a minimum viable coverage bar. Don\'t sacrifice critical path. Communicate tradeoffs explicitly — not silently.' },
  { level: 'SDET Team Lead', category: 'Testing Fundamentals', weight: 4, title: 'Test Architecture Scalability', prompt: 'How do you evaluate whether your current test architecture will scale with the product over the next 12 months?', reference: 'Assess: execution time trend, flakiness rate, onboarding time for new SDETs, coverage-to-defect ratio. If any are degrading, the architecture is already failing to scale.' },

  { level: 'SDET Team Lead', category: 'Applied', weight: 4, title: 'Managing a Mixed-Skill SDET Team', prompt: 'You have a team of 4 SDETs with different skill levels. How do you assign work and grow the weakest member?', reference: 'Pair stronger with weaker on complex features. Assign structured stretch tasks with defined success criteria. Regular 1:1s. Code reviews as learning moments. Red flag: assigns weak member only maintenance.' },
  { level: 'SDET Team Lead', category: 'Applied', weight: 4, title: '20% Coverage, Release in 3 Days', prompt: 'The product team wants to release in 3 days but automation coverage for the new feature is at 20%. What do you do?', reference: 'Don\'t panic or silently comply. Assess risk of untested 80%. Propose: manual exploratory for high-risk paths, automated smoke for critical flows, document accepted risk with sign-off. Communicate tradeoffs to leadership.' },
  { level: 'SDET Team Lead', category: 'Applied', weight: 3, title: 'Coordinating Testing Across Time Zones', prompt: 'How have you coordinated testing strategy with teams in different time zones?', reference: 'Async documentation, shared definition of done, overlapping hours for live collaboration, automated pipeline as handoff mechanism. Knows Mexico–US overlap is an asset.' },
  { level: 'SDET Team Lead', category: 'Applied', weight: 4, title: 'Handling Framework Disagreement with Senior', prompt: 'A senior engineer on your team disagrees with your architectural decision on the framework. How do you handle it?', reference: 'Invite the disagreement explicitly. Facilitate structured discussion: present reasoning, invite counter-evidence. If valid, adapt. If not, own the decision and document the tradeoff. Not avoidance.' },
  { level: 'SDET Team Lead', category: 'Applied', weight: 4, title: 'Automation Suite ROI for Leadership', prompt: 'How do you measure the health and ROI of your automation suite to present it to engineering leadership?', reference: 'Metrics: bugs caught before prod / total shipped, manual test hours saved, deploy frequency enabled by automation, flakiness cost in engineer-hours. Frame in time and money, not test counts.' },
  { level: 'SDET Team Lead', category: 'Applied', weight: 4, title: 'Migrating CI/CD Infrastructure', prompt: 'You are asked to migrate the entire test infrastructure to a new CI/CD tool. How do you plan and execute that without breaking ongoing delivery?', reference: 'Parallel run strategy, phased migration by team/component, rollback plan, definition of parity, stakeholder communication, pilot team first. Never big-bang.' },
  { level: 'SDET Team Lead', category: 'Applied', weight: 4, title: 'Building a QA Culture', prompt: 'What does a good QA culture look like inside an engineering team, and how have you built or contributed to it?', reference: 'Quality is a shared responsibility, not QA\'s gate. Engineers write tests. Defects are learning moments, not blame. Visibility of quality metrics. Red flag: "QA catches what devs miss" mentality.' },
];

async function seed() {
  console.log('Signing in as', EMAIL, '...');
  const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
  const uid = cred.user.uid;
  console.log('Signed in. UID:', uid);

  console.log(`Seeding ${QUESTIONS.length} questions...`);
  let i = 0;
  for (const q of QUESTIONS) {
    await addDoc(collection(db, 'questions'), {
      ...q,
      scope: 'global',
      createdBy: uid,
      createdAt: new Date().toISOString(),
    });
    i++;
    console.log(`  [${i}/${QUESTIONS.length}] ${q.level} › ${q.category} › ${q.title}`);
  }
  console.log('Done! All questions seeded successfully.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err.message);
  process.exit(1);
});
