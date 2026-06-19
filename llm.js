'use strict';

// Thin client for a local Ollama instance. Used by the "Let Nightpick Guess"
// feature today; kept generic so future LLM-backed features can reuse it.

const OLLAMA_URL   = (process.env.OLLAMA_URL   || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:latest';
const LLM_TIMEOUT_MS = 60_000;

const clampMinutes = (n) => {
  const m = Math.round(Number(n));
  return Number.isFinite(m) && m >= 1 && m <= 1440 ? m : null;
};

// POST to Ollama's /api/generate with a timeout. Returns the parsed `response` string.
async function generate(prompt, { format } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, ...(format ? { format } : {}) }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
    const data = await res.json();
    return data.response ?? '';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('LLM request timed out');
    throw new Error(`LLM unreachable: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Estimate a typical duration (in minutes) for each activity.
 * @param {{id:string, text:string}[]} activities
 * @returns {Promise<Map<string, number>>} id → minutes (only ids the model returned valid numbers for)
 */
const ESTIMATE_BATCH_SIZE = parseInt(process.env.LLM_ESTIMATE_BATCH_SIZE, 10) || 15;

async function estimateBatch(batch) {
  const list = batch.map(a => `- id "${a.id}": ${a.text}`).join('\n');
  const prompt =
`You estimate how long everyday activities typically take.
For each activity below, give a single realistic typical duration in MINUTES (integer, 1-1440).
Respond ONLY with strict JSON of the form:
{"estimates":[{"id":"<id>","minutes":<int>}, ...]}
Include every id exactly once. Do not add commentary.

Activities:
${list}`;

  const raw = await generate(prompt, { format: 'json' });

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('LLM returned malformed output'); }

  const out = new Map();
  const rows = Array.isArray(parsed?.estimates) ? parsed.estimates : [];
  const valid = new Set(batch.map(a => a.id));
  for (const row of rows) {
    if (!row || !valid.has(row.id)) continue;
    const m = clampMinutes(row.minutes);
    if (m != null) out.set(row.id, m);
  }
  return out;
}

async function estimateActivityMinutes(activities) {
  if (!activities.length) return new Map();

  const out = new Map();
  for (let i = 0; i < activities.length; i += ESTIMATE_BATCH_SIZE) {
    const batch = activities.slice(i, i + ESTIMATE_BATCH_SIZE);
    const batchResult = await estimateBatch(batch);
    batchResult.forEach((v, k) => out.set(k, v));
  }
  return out;
}

/**
 * Generate a single new suggestion for a pool category.
 * @param {string} categoryLabel  e.g. "Activity", "Food", "Drink", "Modifier"
 * @param {string} poolName
 * @param {string} poolDescription
 * @param {string[]} existingItems  existing suggestion texts for that category
 * @returns {Promise<string>}  the suggested text (≤200 chars)
 */
async function suggestItem(categoryLabel, poolName, poolDescription, existingItems) {
  const existingBlock = existingItems.length > 0
    ? `Existing ${categoryLabel.toLowerCase()} suggestions:\n${existingItems.map(t => `- ${t}`).join('\n')}`
    : `No ${categoryLabel.toLowerCase()} suggestions have been added yet.`;

  const poolCtx = poolDescription?.trim()
    ? `Pool: "${poolName}" — ${poolDescription.trim()}`
    : `Pool: "${poolName}"`;

  const prompt =
`You help users brainstorm ideas for a social activity planning app called NightPick.
${poolCtx}

${existingBlock}

Generate ONE new ${categoryLabel.toLowerCase()} idea that fits the pool's theme and is distinct from the existing suggestions.
Respond ONLY with strict JSON of the form: {"suggestion":"<text>"}
Keep the suggestion concise (under 80 characters), fun, and specific. No explanations.`;

  const raw = await generate(prompt, { format: 'json' });

  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('LLM returned malformed output'); }

  const text = (parsed?.suggestion ?? '').trim().slice(0, 200);
  if (!text) throw new Error('LLM did not return a suggestion');
  return text;
}

module.exports = { estimateActivityMinutes, suggestItem, OLLAMA_URL, OLLAMA_MODEL };
