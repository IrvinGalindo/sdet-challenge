// SDET AI Worker — proxies OpenRouter calls for the React app.
// Endpoints:
//   POST /parseJD              { jdText }
//   POST /generateQuestionBank { position }
//
// Auth: Bearer <Firebase ID token> in Authorization header. The worker verifies
// the token before calling OpenRouter so the API key cannot be drained by
// random callers.
//
// Secrets (set via wrangler):  OPENROUTER_KEY
// Vars (in wrangler.toml):     FIREBASE_PROJECT_ID, ALLOWED_ORIGINS,
//                              OPENROUTER_MODEL_PARSE, OPENROUTER_MODEL_GENERATE

import { verifyFirebaseToken } from './firebase-auth.js';
import { chat } from './openrouter.js';

const PARSE_JD_SYSTEM = `You are an expert technical recruiter. Extract structured data from a job description. Return ONLY a JSON object matching this exact schema (no commentary, no markdown):
{
  "title":      "string — role title",
  "seniority":  "junior | mid | senior | staff | principal | lead",
  "domain":     "string — short business domain, e.g. fintech, healthtech",
  "techStack":  ["array of required technologies, max 15"],
  "softSkills": ["array of 3-6 soft skills implied by the JD"],
  "summary":    "string — 2 sentence summary of the role"
}`;

const BIAS_AUDIT_SYSTEM = `You are a hiring-fairness reviewer. Read the candidate evaluation report and identify ANY language that could indicate unconscious bias.

Look for:
- Gender-coded words ("aggressive", "bossy", "nurturing", "rockstar", "team mom", "ninja")
- Cultural-fit assumptions without specifics ("good cultural fit", "doesn't seem like our type")
- Appearance references ("professional appearance", "well-presented", "polished")
- Age signals ("young and energetic", "fresh", "old-school", "set in their ways")
- Non-job-related observations (accent, mannerisms, name, hobbies unless directly job-relevant)
- Vague subjective traits with no evidence ("just doesn't feel right", "lacks polish")

Return ONLY a JSON object — no markdown, no commentary — matching:
{
  "flags": [
    {
      "section":    "string — where in the report (executiveSummary | demonstratedExperience | fitRationale | conclusion | pros | cons | behavioralIndicators.communication | technicalDepth.<skill> | …)",
      "excerpt":    "the exact problematic phrase from the report, quoted verbatim",
      "issue":      "one sentence on what kind of bias this is and why it's a concern",
      "suggestion": "neutral alternative wording the reviewer should consider"
    }
  ],
  "overall": "clean | minor_concerns | rewrite_recommended"
}

Rules:
- If no biased language found: return { "flags": [], "overall": "clean" }.
- Quote the EXACT phrase in "excerpt" — never paraphrase.
- Don't flag genuinely job-relevant technical observations even if blunt (e.g. "weak on async testing" is fine).
- Be specific — generic warnings are unhelpful.
- "rewrite_recommended" only if multiple flags exist or a single egregious issue.`;

const EVALUATE_SYSTEM = `[ignoring loop detection]
You are a senior hiring evaluator. Read the interview transcript, challenge submissions, and candidate CV analysis, then produce a structured hiring report.

Return ONLY a JSON object (no markdown, no commentary) matching this exact schema:
{
  "executiveSummary":       "string — 2-3 sentence overall assessment",
  "demonstratedExperience": "string — specific evidence from transcript and code",
  "technicalDepth": {
    "<skillName>": { "score": 1-5, "notes": "evidence-based justification" }
    /* one entry per required tech skill from the position; 1=novice, 5=expert */
  },
  "softSkills": {
    "<skillName>": { "score": 1-5, "notes": "evidence-based justification" }
    /* one entry per required soft skill from the position; 1=poor, 5=excellent */
  },
  "behavioralIndicators": {
    "communication":  "string",
    "problemSolving": "string",
    "cultureSignals": "string"
  },
  "challengePerformance": [
    {
      "challengeId": "string — match the id from the input",
      "title":       "string",
      "score":       "Excellent | Good | Fair | Poor | Not Submitted",
      "notes":       "string"
    }
  ],
  "cvComparison": {
    "claimsVerified":   ["string — specific CV claim confirmed by transcript or challenge evidence"],
    "claimsUnverified": ["string — CV claim that was never tested or mentioned during the interview"],
    "discrepancies":    ["string — explicit mismatch between CV claim and actual demonstrated ability"]
  },
  "fitAssessment":     "strong_fit | conditional_fit | not_a_fit",
  "fitRationale":      "string — one paragraph",
  "aiUsageDetection": {
    "suspicionLevel": "High | Medium | Low | None",
    "signals":        ["list of specific concrete signals observed — each item must cite a fact (paste ratio, seconds-to-submit, vocabulary mismatch with spoken transcript, etc.). 0 items only if level is 'None'."],
    "evidence":       "string — paragraph explaining the verdict by combining forensic numbers with linguistic observations. Quote specific phrases or numbers.",
    "calibrationNote":"string — one short sentence for the hiring manager on what level of AI-assistance is normal vs concerning for this role/seniority."
  },
  "pros":              ["2-5 bullet points"],
  "cons":              ["2-5 bullet points"],
  "followUpQuestions": ["2-4 specific probes a hiring manager should still ask"],
  "conclusion":        "string — final summary paragraph",
  "hiringRecommendation": "proceed | hold | decline"
}

Hard rules:
- Base every claim on actual transcript or challenge evidence — never invent.
- If the transcript is missing or short (<10 lines), call this out in executiveSummary and reflect lower confidence in fitAssessment/recommendation.
- Score the candidate against THIS position's required skills, not as a general engineer.
- challengePerformance must have exactly one entry per challenge in the input.
- Keep notes specific and concise (max ~30 words each).

AI usage detection — read carefully, this is post-ChatGPT 2026:
- Modern LLMs produce fluent, structured, voice-consistent text by default. Stylometry alone is NOT enough to clear someone — assume any candidate could be using AI unless evidence contradicts it.
- DEFAULT STANCE: "Medium" suspicion. Move to "Low" only if forensics show strong human-pattern evidence; move to "High" if multiple signals point to copy-paste use.
- WEIGHT FORENSICS HEAVILY (you receive them in the challenge submissions under "FORENSICS:" headers):
    * pasteRatio > 0.4 of a substantive answer → strong High signal
    * pasteRatio 0.1–0.4 → Medium signal (could be reasonable code-borrowing)
    * secondsToFirstEdit > 60s before a near-instant burst of text → High signal (likely consulting AI in another tab)
    * secondsTyping vs finalChars: <2 chars/sec sustained is human; >10 chars/sec for >200 chars is unrealistic typing → High signal
    * MCQ answered in <5 seconds for a complex question → mild signal
- LINGUISTIC SIGNALS to combine with forensics, not as standalone proof:
    * Voice mismatch: spoken transcript chunks (tagged with the candidate role) sound conversational and hesitant, but written answers are formally structured, perfectly punctuated, use elevated vocabulary the speaker doesn't use orally
    * Suspiciously comprehensive coverage of edge cases without prompting
    * Repeated AI-tell phrases ("It's important to note", "In essence", "It's worth mentioning", "ultimately", "navigate", "leverage", "robust framework")
    * Inconsistent vocabulary level across answers (some written by speaker, others much more elevated)
    * Zero typos, zero corrections, zero hedge language across long answers
- HUMAN-PATTERN positive signals (push toward Low):
    * Forensics show steady typing (3–6 chars/sec), some pauses, no large pastes
    * Written voice matches spoken voice in vocabulary, cadence, formality
    * Genuine errors, hesitations, course-corrections, or partial answers
    * Slang, contractions, or domain-specific shorthand consistent across modes
- NEVER mark "None" unless forensics are clearly human AND linguistic markers are clearly authentic. "None" is rare in 2026.
- For "signals", cite specific numbers (e.g. "Q3 open answer: 47s to first edit, 8s typing, 89% paste ratio, 612 chars submitted"). Vague signals are unhelpful.`;

const LIVE_SUGGESTION_SYSTEM = `You are an AI co-interviewer assisting a hiring manager during a live technical interview.

Your job: read the recent conversation and suggest ONE specific, actionable follow-up the interviewer should consider next. Prefer probes that surface depth, real experience, or red flags.

Return ONLY a JSON object — no markdown, no commentary — matching this schema:
{
  "suggestion": "string — one sentence the interviewer can use directly. Specific and concrete.",
  "topic":      "string — short tag for what skill/area this probes (max 4 words)",
  "priority":   "high | low",
  "reasoning":  "string — one short sentence on why this matters now (max 20 words)"
}

Rules:
- If the candidate already covered something well, don't suggest re-asking it.
- Bias toward unsurfaced topics from the required skills list.
- If CV claims are provided (cvClaims), prioritize probing claims that have NOT yet been addressed in the conversation — mark those as "high" priority.
- "high" priority = a likely red flag, a critical skill not yet probed, a CV claim unverified, or a vague answer that needs follow-up. Otherwise "low".
- Never invent facts about the candidate.`;

const CV_ANALYSIS_SYSTEM = `You are a senior technical recruiter pre-screening a candidate's CV/resume before a live interview.

Analyze the CV text and return a structured JSON object. Return ONLY a JSON object — no markdown, no commentary — matching this exact schema:
{
  "summary":           "string — 2-sentence overview of the candidate profile",
  "claimedTechStack":  ["array of specific technologies/tools the candidate claims experience with"],
  "claimedExperience": {
    "yearsTotal":      "number or null — estimated total years of professional experience",
    "senioritySignals": "string — what the CV suggests about their actual seniority level"
  },
  "keyStrengths":      ["2-5 concrete strengths evidenced by the CV"],
  "redFlags":          ["array of concerns, inconsistencies, or gaps in the CV — empty array if none"],
  "questionsToVerify": ["3-6 targeted questions the interviewer should ask to verify specific CV claims"],
  "fitScore":          "integer 1-5 — how well the CV matches the position (1=poor, 5=excellent)",
  "fitRationale":      "string — one paragraph explaining the fit score against the position requirements"
}

Hard rules:
- Only cite what is actually written in the CV. Never invent or assume experience not mentioned.
- Red flags should be specific (e.g. 'Claims 5 years React but most projects list jQuery/Angular', not generic 'limited experience').
- questionsToVerify must be tied to specific CV claims, not generic interview questions.
- fitScore must reflect the position requirements — a generalist CV for a highly specialized role should score low even if the candidate looks strong overall.`;

const GENERATE_SYSTEM = `You are a senior technical interviewer. Generate a question bank for one role.
Return ONLY a JSON object — no markdown, no commentary — matching this schema:
{
  "questions": [
    {
      "title":     "short label",
      "prompt":    "the actual question",
      "rubric":    "what a strong answer includes",
      "category":  "Testing Fundamentals | API & Microservices | Test Automation | CI/CD & DevOps | Leadership | Performance Testing | Behavioral | Other",
      "weight":    1-5
    }
    // 8-12 entries, mix of behavioral and technical, ordered easy→hard
  ],
  "challenges": [
    {
      "kind":         "mcq" | "open" | "code",
      "title":        "short label",
      "prompt":       "instructions to candidate — language-agnostic for code challenges",
      "language":     null,
      "starterCode":  null,
      "options":      [{ "label": "A", "text": "...", "correct": false }, …]  /* mcq only, exactly 4, exactly 1 correct */,
      "rubric":       "what a strong submission demonstrates — language-agnostic"
    }
    // 3-5 entries — at least 1 mcq and 1 open. ONLY include "code" challenges if the position is a software engineering or programming role. Non-technical or leadership roles (like CEO, HR, Sales) MUST NOT have code challenges.
  ]
}

Hard rules for code challenges:
- ALWAYS set language to null — the candidate chooses their preferred language at interview time.
- ALWAYS set starterCode to null — starter templates are generated per-language automatically.
- Write the prompt and rubric in a language-agnostic way (e.g. "implement a function", not "write a JavaScript function").
- Do NOT mention any specific programming language in code challenge prompts or rubrics.`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS || '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true }, 200, cors);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'POST only' }, 405, cors);
    }

    try {
      // 1. Verify Firebase ID token.
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const { uid } = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);

      // 2. Route.
      const body = await request.json().catch(() => ({}));
      let result;
      if (url.pathname === '/parseJD') {
        result = await handleParseJD(body, env);
      } else if (url.pathname === '/generateQuestionBank') {
        result = await handleGenerateQuestionBank(body, env);
      } else if (url.pathname === '/liveSuggestion') {
        result = await handleLiveSuggestion(body, env);
      } else if (url.pathname === '/customPrompt') {
        result = await handleCustomPrompt(body, env);
      } else if (url.pathname === '/evaluateSession') {
        result = await handleEvaluateSession(body, env);
      } else if (url.pathname === '/biasAudit') {
        result = await handleBiasAudit(body, env);
      } else if (url.pathname === '/createStaff') {
        result = await handleCreateStaff(body, env);
      } else if (url.pathname === '/analyzeCV') {
        result = await handleAnalyzeCV(body, env);
      } else {
        return jsonResponse({ error: 'not found' }, 404, cors);
      }
      return jsonResponse({ ...result, _meta: { uid } }, 200, cors);
    } catch (err) {
      const status = err.statusCode || 500;
      console.error(`[${status}] ${err.message}`, err.detail ? { detail: err.detail } : '');
      return jsonResponse({ error: err.message || 'internal error', detail: err.detail || null }, status, cors);
    }
  },
};

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleParseJD(body, env) {
  const jdText = (body?.jdText || '').toString().trim();
  if (!jdText) throw httpError(400, 'jdText is required');
  if (jdText.length > 50_000) throw httpError(400, 'jdText too long (>50k chars)');

  const { content, parsed, tokensUsed } = await chat({
    apiKey: env.OPENROUTER_KEY,
    model: env.OPENROUTER_MODEL_PARSE,
    jsonMode: true,
    maxTokens: 1500,
    messages: [
      { role: 'system', content: PARSE_JD_SYSTEM },
      { role: 'user', content: `Parse this JD:\n\n${jdText}` },
    ],
  });

  if (!parsed || !parsed.title) {
    console.error('parseJD: bad model output', { model: env.OPENROUTER_MODEL_PARSE, contentPreview: content.slice(0, 500) });
    const err = httpError(502, 'Model did not return valid JSON');
    err.detail = content.slice(0, 800);
    throw err;
  }
  return { ...parsed, _tokensUsed: tokensUsed };
}

async function handleGenerateQuestionBank(body, env) {
  const pos = body?.position;
  if (!pos || !pos.title) throw httpError(400, 'position is required');

  const userPrompt = `Position: ${pos.title}
Seniority: ${pos.seniority}
Domain: ${pos.domain || ''}
Required tech stack: ${(pos.techStack || []).join(', ')}
Soft skills to probe: ${(pos.softSkills || []).join(', ')}
Summary: ${pos.summary || ''}

Generate the question bank.`;

  const { parsed, content, tokensUsed } = await chat({
    apiKey: env.OPENROUTER_KEY,
    model: env.OPENROUTER_MODEL_GENERATE,
    jsonMode: true,
    maxTokens: 8000,
    timeoutMs: 180_000, // 3 min — generating ~12 questions + ~5 challenges with rubrics is slow
    messages: [
      { role: 'system', content: GENERATE_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
  });

  if (!parsed || !Array.isArray(parsed.questions)) {
    console.error('generateQuestionBank: bad model output', { model: env.OPENROUTER_MODEL_GENERATE, contentPreview: content.slice(0, 500) });
    const err = httpError(502, 'Model did not return valid JSON');
    err.detail = content.slice(0, 800);
    throw err;
  }
  return { ...parsed, _tokensUsed: tokensUsed };
}

async function handleBiasAudit(body, env) {
  const { report } = body || {};
  if (!report || typeof report !== 'object') {
    throw httpError(400, 'report is required');
  }

  // Serialize the report compactly for the model. We strip internal _-fields
  // so they don't confuse the model into flagging them.
  const cleanReport = Object.fromEntries(
    Object.entries(report).filter(([k]) => !k.startsWith('_'))
  );
  const reportText = JSON.stringify(cleanReport, null, 2);

  const { parsed, content, tokensUsed } = await chat({
    apiKey: env.OPENROUTER_KEY,
    model: env.OPENROUTER_MODEL_BIAS || 'anthropic/claude-sonnet-4.5',
    jsonMode: true,
    maxTokens: 2000,
    timeoutMs: 90_000,
    messages: [
      { role: 'system', content: BIAS_AUDIT_SYSTEM },
      { role: 'user', content: `Audit this candidate evaluation report:\n\n${reportText}` },
    ],
  });

  if (!parsed || !Array.isArray(parsed.flags)) {
    const err = httpError(502, 'Bias audit did not return valid JSON');
    err.detail = content.slice(0, 500);
    throw err;
  }
  return {
    flags: parsed.flags,
    overall: parsed.overall || 'clean',
    _tokensUsed: tokensUsed,
    _model: env.OPENROUTER_MODEL_BIAS || 'anthropic/claude-sonnet-4.5',
  };
}

async function handleEvaluateSession(body, env) {
  const { position, candidateName, transcript, answers, challenges, cvAnalysis, cvText } = body || {};
  if (!position?.title) throw httpError(400, 'position is required');
  if (!Array.isArray(challenges)) throw httpError(400, 'challenges array required');

  // ── Transcript: keep the most recent 120 chunks, max 400 chars each ──────
  // A full-interview transcript can easily exceed 50k tokens. We sample the
  // tail because it usually contains the most substantive technical discussion.
  const MAX_CHUNKS = 120;
  const MAX_CHUNK_CHARS = 400;
  const rawChunks = (Array.isArray(transcript) ? transcript : []).filter(t => t && t.text);
  const trimmedChunks = rawChunks.slice(-MAX_CHUNKS);
  const omittedCount = rawChunks.length - trimmedChunks.length;

  const transcriptLines = trimmedChunks.map(t => {
    const text = t.text.length > MAX_CHUNK_CHARS
      ? t.text.slice(0, MAX_CHUNK_CHARS) + '…'
      : t.text;
    return `[${t.speaker || 'unknown'}]: ${text}`;
  });

  // Deduplicate consecutive identical lines — speech-to-text often emits the
  // same phrase multiple times, which trips OpenRouter's loop-detection filter.
  const deduped = transcriptLines.filter((line, i) => line !== transcriptLines[i - 1]);

  const transcriptText = [
    omittedCount > 0 ? `[… ${omittedCount} earlier exchanges omitted for brevity …]` : null,
    ...deduped,
  ].filter(Boolean).join('\n');

  // ── Challenges + answers ─────────────────────────────────────────────────
  const MAX_PROMPT_CHARS = 600;
  const MAX_RUBRIC_CHARS = 300;
  const MAX_ANSWER_CHARS = 1200;

  const ansById = Object.fromEntries((answers || []).map(a => [a.challengeId, a]));
  const challengeBlock = challenges.map(c => {
    const a = ansById[c.id];
    let answerText;
    if (!a) answerText = '(NOT ANSWERED)';
    else if (c.kind === 'mcq') answerText = `Selected ${a.selectedOption} — ${a.isCorrect ? 'CORRECT' : 'INCORRECT'}`;
    else {
      const raw = a.text || '(no text)';
      answerText = raw.length > MAX_ANSWER_CHARS ? raw.slice(0, MAX_ANSWER_CHARS) + '\n…(truncated)' : raw;
    }

    const prompt = (c.prompt || '').length > MAX_PROMPT_CHARS
      ? c.prompt.slice(0, MAX_PROMPT_CHARS) + '…'
      : (c.prompt || '');
    const rubric = (c.rubric || '').length > MAX_RUBRIC_CHARS
      ? c.rubric.slice(0, MAX_RUBRIC_CHARS) + '…'
      : (c.rubric || 'n/a');

    // Forensic line — give the model the timing and paste data so it can
    // ground the aiUsageDetection verdict in numbers, not just stylometry.
    const f = a?.forensics;
    let forensicsLine = '';
    if (f && typeof f === 'object') {
      if (c.kind === 'mcq') {
        const t = f.secondsViewing != null ? `${f.secondsViewing}s viewing` : 'n/a';
        const c1 = f.secondsToFirstClick != null ? `${f.secondsToFirstClick}s to first click` : 'no click recorded';
        const cn = f.clickCount != null ? `${f.clickCount} clicks total` : '';
        forensicsLine = `\nFORENSICS: ${t}, ${c1}${cn ? ', ' + cn : ''}`;
      } else {
        const parts = [];
        if (f.secondsViewing != null) parts.push(`${f.secondsViewing}s viewing`);
        if (f.secondsToFirstEdit != null) parts.push(`${f.secondsToFirstEdit}s to first edit`);
        if (f.secondsTyping != null) parts.push(`${f.secondsTyping}s typing`);
        if (f.finalChars != null) parts.push(`${f.finalChars} chars final`);
        if (f.pasteCount != null) parts.push(`${f.pasteCount} paste event(s)`);
        if (f.pastedChars != null) parts.push(`${f.pastedChars} chars pasted`);
        if (f.pasteRatio != null) parts.push(`pasteRatio=${(f.pasteRatio * 100).toFixed(0)}%`);
        if (f.secondsTyping && f.finalChars) {
          const cps = f.finalChars / Math.max(1, f.secondsTyping);
          parts.push(`~${cps.toFixed(1)} chars/sec`);
        }
        forensicsLine = `\nFORENSICS: ${parts.join(', ')}`;
      }
    } else {
      forensicsLine = '\nFORENSICS: (not captured)';
    }

    return `## ${c.title} [id=${c.id}, kind=${c.kind}]\nQuestion: ${prompt}\nRubric: ${rubric}${forensicsLine}\nAnswer:\n${answerText}`;
  }).join('\n\n');

  // ── Assemble prompt and hard-cap total size ───────────────────────────────
  // Rough rule of thumb: 1 token ≈ 4 characters. Keeping input under ~40k
  // characters leaves plenty of room for the ~8k-token output within the
  // model's 64k context window.
  const MAX_PROMPT_TOTAL = 40_000;

  // ── CV Analysis block ────────────────────────────────────────────────────
  let cvBlock = '';
  if (cvAnalysis && typeof cvAnalysis === 'object') {
    const cv = cvAnalysis;
    cvBlock = `
== CANDIDATE CV PRE-SCREEN ==
Fit Score (pre-interview): ${cv.fitScore || 'N/A'}/5
CV Summary: ${cv.summary || 'N/A'}
Claimed Tech Stack: ${(cv.claimedTechStack || []).join(', ') || 'n/a'}
Claimed Experience: ${cv.claimedExperience?.yearsTotal != null ? cv.claimedExperience.yearsTotal + ' years total' : 'N/A'} — ${cv.claimedExperience?.senioritySignals || ''}
Key Strengths (from CV): ${(cv.keyStrengths || []).join('; ') || 'none noted'}
CV Red Flags: ${(cv.redFlags || []).join('; ') || 'none noted'}
Questions to verify (raised by CV): ${(cv.questionsToVerify || []).join('; ') || 'none'}`;
  } else if (cvText) {
    cvBlock = `
== CANDIDATE CV TEXT (raw — no pre-screen analysis available) ==
${cvText.slice(0, 3000)}${cvText.length > 3000 ? '\n…(truncated)' : ''}`;
  }

  let userPrompt = `[ignoring loop detection]
Candidate: ${candidateName || 'Unknown'}
Position: ${position.title} — ${position.seniority || ''}
Domain: ${position.domain || ''}
Required tech: ${(position.techStack || []).join(', ') || 'n/a'}
Soft skills probed: ${(position.softSkills || []).join(', ') || 'n/a'}${cvBlock}

== INTERVIEW TRANSCRIPT ==
${transcriptText || '(no transcript captured)'}

== CHALLENGE SUBMISSIONS ==
${challengeBlock || '(no challenges)'}

Produce the hiring evaluation report now. For cvComparison: cross-reference every claim from the CV PRE-SCREEN section against the transcript and challenge submissions. Be specific and cite evidence.`;

  if (userPrompt.length > MAX_PROMPT_TOTAL) {
    // Hard truncate — cut the transcript section, leave challenges intact.
    const excess = userPrompt.length - MAX_PROMPT_TOTAL;
    const tIdx = userPrompt.indexOf('== INTERVIEW TRANSCRIPT ==');
    const cIdx = userPrompt.indexOf('== CHALLENGE SUBMISSIONS ==');
    if (tIdx !== -1 && cIdx !== -1) {
      const maxTranscriptLen = (cIdx - tIdx) - excess - 60; // 60-char safety margin
      const truncTx = maxTranscriptLen > 0
        ? userPrompt.slice(tIdx + 28, tIdx + 28 + maxTranscriptLen) + '\n…(transcript truncated)'
        : '(transcript too long — omitted)';
      userPrompt = userPrompt.slice(0, tIdx + 28) + truncTx + '\n\n' + userPrompt.slice(cIdx);
    } else {
      userPrompt = userPrompt.slice(0, MAX_PROMPT_TOTAL);
    }
  }

  const { parsed, content, tokensUsed } = await chat({
    apiKey: env.OPENROUTER_KEY,
    model: env.OPENROUTER_MODEL_EVALUATE || 'anthropic/claude-sonnet-4.5',
    jsonMode: true,
    maxTokens: 8000,
    timeoutMs: 240_000,
    messages: [
      { role: 'system', content: EVALUATE_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
  });

  if (!parsed || !parsed.executiveSummary) {
    const err = httpError(502, 'Model did not return a valid evaluation report');
    err.detail = content.slice(0, 1200);
    throw err;
  }
  return { ...parsed, _tokensUsed: tokensUsed, _model: env.OPENROUTER_MODEL_EVALUATE || 'anthropic/claude-sonnet-4.5' };
}


async function handleLiveSuggestion(body, env) {
  const { position, transcript, askedTopics, cvClaims } = body || {};
  if (!position?.title) throw httpError(400, 'position is required');
  if (!Array.isArray(transcript) || transcript.length === 0) {
    throw httpError(400, 'transcript array is required and must be non-empty');
  }

  // Format transcript: [speaker]: text
  const lines = transcript
    .filter(t => t && t.text)
    .slice(-60) // hard cap to keep prompt small
    .map(t => `[${t.speaker || 'unknown'}]: ${t.text}`)
    .join('\n');

  // CV claims block — unverified claims for the model to prioritize
  let cvClaimsBlock = '';
  if (cvClaims && typeof cvClaims === 'object') {
    const unverified = (cvClaims.unverifiedClaims || []).slice(0, 8);
    const questionsToVerify = (cvClaims.questionsToVerify || []).slice(0, 6);
    if (unverified.length > 0 || questionsToVerify.length > 0) {
      cvClaimsBlock = `\nCV claims not yet verified in this conversation:\n${unverified.map(c => `- ${c}`).join('\n')}\nCV-derived questions still to ask:\n${questionsToVerify.map(q => `- ${q}`).join('\n')}`;
    }
  }

  const userPrompt = `Position: ${position.title} — ${position.seniority || ''}
Required skills: ${(position.techStack || []).join(', ') || 'n/a'}
Soft skills to probe: ${(position.softSkills || []).join(', ') || 'n/a'}
Topics already covered: ${(askedTopics || []).join(', ') || 'none yet'}${cvClaimsBlock}

Recent conversation:
${lines}

Suggest the next probe.`;

  const { parsed, content, tokensUsed } = await chat({
    apiKey: env.OPENROUTER_KEY,
    model: env.OPENROUTER_MODEL_LIVE || 'openai/gpt-4o-mini',
    jsonMode: true,
    maxTokens: 600,
    messages: [
      { role: 'system', content: LIVE_SUGGESTION_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
  });

  if (!parsed || !parsed.suggestion) {
    const err = httpError(502, 'Model did not return a suggestion');
    err.detail = content.slice(0, 500);
    throw err;
  }
  return { ...parsed, _tokensUsed: tokensUsed, _model: env.OPENROUTER_MODEL_LIVE || 'anthropic/claude-haiku-3.5' };
}


async function handleAnalyzeCV(body, env) {
  const { cvText, position } = body || {};
  if (!cvText || typeof cvText !== 'string' || !cvText.trim()) {
    throw httpError(400, 'cvText is required');
  }
  if (cvText.length > 15_000) throw httpError(400, 'cvText too long (>15k chars). Please trim before submitting.');

  const positionCtx = position
    ? `Position: ${position.title || ''} — ${position.seniority || ''}\nRequired tech stack: ${(position.techStack || []).join(', ') || 'n/a'}\nSoft skills: ${(position.softSkills || []).join(', ') || 'n/a'}`
    : 'No specific position provided — analyze CV standalone.';

  const { parsed, content, tokensUsed } = await chat({
    apiKey: env.OPENROUTER_KEY,
    model: env.OPENROUTER_MODEL_CV || 'anthropic/claude-sonnet-4-5',
    jsonMode: true,
    maxTokens: 2500,
    timeoutMs: 90_000,
    messages: [
      { role: 'system', content: CV_ANALYSIS_SYSTEM },
      { role: 'user', content: `${positionCtx}\n\n== CANDIDATE CV ==\n${cvText}\n\nAnalyze this CV.` },
    ],
  });

  if (!parsed || !parsed.summary) {
    const err = httpError(502, 'CV analysis did not return valid JSON');
    err.detail = content.slice(0, 800);
    throw err;
  }
  return {
    summary:            parsed.summary,
    claimedTechStack:   parsed.claimedTechStack   || [],
    claimedExperience:  parsed.claimedExperience  || {},
    keyStrengths:       parsed.keyStrengths        || [],
    redFlags:           parsed.redFlags            || [],
    questionsToVerify:  parsed.questionsToVerify   || [],
    fitScore:           parsed.fitScore            || null,
    fitRationale:       parsed.fitRationale        || '',
    _tokensUsed:        tokensUsed,
    _model:             env.OPENROUTER_MODEL_CV || 'anthropic/claude-sonnet-4-5',
  };
}


const CUSTOM_PROMPT_SYSTEM = `You are an AI co-pilot assisting a live technical interviewer.
The interviewer may ask you anything — suggest a follow-up, evaluate the candidate's last answer, generate a hard question, flag a concern, or any other request.

You always have access to the recent transcript and position context.
Be concise, specific, and actionable. Plain text response — no markdown, no headers, no bullet lists unless they genuinely help readability.`;

async function handleCustomPrompt(body, env) {
  const { question, transcript, position } = body || {};
  if (!question || typeof question !== 'string' || !question.trim()) {
    throw httpError(400, 'question is required');
  }

  const recentLines = Array.isArray(transcript)
    ? transcript
      .filter(t => t && t.text)
      .slice(-40)
      .map(t => `[${t.speaker || 'unknown'}]: ${t.text}`)
      .join('\n')
    : '';

  const positionCtx = position
    ? `Position: ${position.title || ''} — ${position.seniority || ''}\nRequired skills: ${(position.techStack || []).join(', ') || 'n/a'}`
    : '';

  const userPrompt = [
    positionCtx,
    recentLines ? `Recent conversation:\n${recentLines}` : '',
    `Interviewer asks: ${question.trim()}`,
  ].filter(Boolean).join('\n\n');

  const { content, tokensUsed } = await chat({
    apiKey: env.OPENROUTER_KEY,
    model: env.OPENROUTER_MODEL_CUSTOM || 'anthropic/claude-haiku-3.5',
    jsonMode: false,
    maxTokens: 500,
    messages: [
      { role: 'system', content: CUSTOM_PROMPT_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
  });

  if (!content || !content.trim()) {
    throw httpError(502, 'Model returned an empty response');
  }

  return {
    answer: content.trim(),
    _tokensUsed: tokensUsed,
    _model: env.OPENROUTER_MODEL_CUSTOM || 'anthropic/claude-haiku-3.5',
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function corsHeaders(origin, allowedOriginsCsv) {
  const allowed = (allowedOriginsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

async function handleCreateStaff(body, env) {
  const { email, password, apiKey } = body || {};
  if (!email) throw httpError(400, 'email is required');
  if (!password) throw httpError(400, 'password is required');

  const resolvedApiKey = apiKey || env.FIREBASE_API_KEY;
  if (!resolvedApiKey) {
    throw httpError(400, 'Firebase API key is required (in body or environment)');
  }

  // Call Firebase Auth REST API signUp
  const signupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${resolvedApiKey}`;
  const res = await fetch(signupUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw httpError(res.status, data?.error?.message || 'Failed to create user in Firebase Auth');
  }

  return {
    uid: data.localId,
    email: data.email,
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

