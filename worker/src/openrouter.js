// Thin OpenRouter wrapper. Returns parsed JSON when jsonMode is set.

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 60_000;

export async function chat({ apiKey, model, messages, maxTokens = 2000, jsonMode = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!apiKey) throw new Error('OPENROUTER_KEY missing');
  if (!model)  throw new Error('model is required');

  const body = { model, max_tokens: maxTokens, messages };
  // response_format json_object is only honoured by OpenAI-compatible models.
  // Anthropic/Claude ignores it and still wraps output in markdown fences.
  // We rely on prompt instructions + our own fence-stripping parser instead.
  const isOpenAI = model.startsWith('openai/') || model.startsWith('gpt-');
  if (jsonMode && isOpenAI) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res, json;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sdet-challenge.firebaseapp.com',
        'X-Title': 'SDET AI Interview Platform',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`OpenRouter: ${msg}`);
    err.statusCode = res.status >= 500 ? 502 : 400;
    throw err;
  }

  const content = json?.choices?.[0]?.message?.content || '';
  const tokensUsed = json?.usage?.total_tokens || 0;

  let parsed;
  if (jsonMode && content) {
    parsed = tryParseJson(content);
  }

  return { content, parsed, tokensUsed };
}

// ─── JSON extractor ───────────────────────────────────────────────────────────
// Handles all the ways Claude / other models can mangle JSON output:
//   a) Raw JSON (ideal)
//   b) ```json ... ``` fences — complete
//   c) ```json ...   — opening fence only (response truncated, no closing fence)
//   d) Prose before/after the JSON object
//   e) JSON truncated mid-stream due to token limit (at any nesting depth)
function tryParseJson(text) {
  const candidates = [];

  // 1. Raw text as-is (works when model behaves).
  candidates.push(text);

  // 2. Complete fenced block:  ```json … ```.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidates.push(fenced[1]);

  // 3. Opening fence without closing (truncated response).
  //    Strip the ```json\n prefix, then also strip any trailing ``` fragment.
  const openFence = text.match(/^```(?:json)?\s*([\s\S]+)/i);
  if (openFence) {
    const inner = openFence[1].replace(/\s*`+\s*$/, '');
    candidates.push(inner);
    candidates.push(repairTruncatedJson(inner));
  }

  // 4. Substring from first { to last } (handles prose-wrapped JSON).
  const first = text.indexOf('{');
  const last  = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  // 5. Repair: strip any leading prose before { then close open structures.
  //    This is the main defence against token-limit truncation.
  if (first !== -1) {
    candidates.push(repairTruncatedJson(text.slice(first)));
  }

  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c.trim()); } catch { /* try next */ }
  }
  return undefined;
}

// Closes unclosed braces/brackets/strings in a (possibly truncated) JSON string.
function repairTruncatedJson(str) {
  let s = str.trimEnd();

  // Strip trailing backtick fragments (half-emitted closing fence).
  s = s.replace(/\s*`+\s*$/, '');

  // Drop trailing comma left before the cut point.
  s = s.replace(/,\s*$/, '');

  // Walk the string tracking structure and string state.
  const stack = [];
  let inStr = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape)               { escape = false; continue; }
    if (ch === '\\' && inStr) { escape = true;  continue; }
    if (ch === '"')           { inStr = !inStr; continue; }
    if (inStr)                continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }

  // Close any unclosed string value.
  if (inStr) s += '"';
  // Close any unclosed structures (innermost first).
  for (let i = stack.length - 1; i >= 0; i--) {
    s += stack[i] === '{' ? '}' : ']';
  }
  return s;
}
