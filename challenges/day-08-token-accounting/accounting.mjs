// Verified 2026-09-13. Standard text Responses API, USD per million tokens.
// https://developers.openai.com/api/docs/models/gpt-5.6-luna
// https://developers.openai.com/api/docs/guides/prompt-caching
export const MODEL = Object.freeze({
  id: 'gpt-5.6-luna', contextWindow: 1_050_000, maxOutputTokens: 128_000,
  input: 0.20, cachedInput: 0.02, cacheWrite: 0.25, output: 1.20,
  longInputThreshold: 272_000, longInputMultiplier: 2, longOutputMultiplier: 1.5,
});

const tokenCount = (value) => Number.isSafeInteger(value) && value >= 0;

// A missing metric is unknown, never a fabricated zero.
export function normalizeUsage(usage) {
  if (!usage || !tokenCount(usage.input_tokens) || !tokenCount(usage.output_tokens) ||
      !tokenCount(usage.total_tokens) ||
      usage.total_tokens !== usage.input_tokens + usage.output_tokens) return null;
  const cached = usage.input_tokens_details?.cached_tokens;
  const written = usage.input_tokens_details?.cache_write_tokens;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  const hasCache = tokenCount(cached) && tokenCount(written) && cached + written <= usage.input_tokens;
  return Object.freeze({
    input: usage.input_tokens, output: usage.output_tokens, total: usage.total_tokens,
    cached: hasCache ? cached : null, written: hasCache ? written : null,
    reasoning: tokenCount(reasoning) && reasoning <= usage.output_tokens ? reasoning : null,
  });
}

export function estimateCost(usage, model = MODEL.id) {
  if (!usage || model !== MODEL.id || usage.cached === null || usage.written === null) return null;
  const long = usage.input > MODEL.longInputThreshold;
  const input = (usage.input - usage.cached - usage.written) * MODEL.input +
    usage.cached * MODEL.cachedInput + usage.written * MODEL.cacheWrite;
  return (input * (long ? MODEL.longInputMultiplier : 1) +
    usage.output * MODEL.output * (long ? MODEL.longOutputMultiplier : 1)) / 1_000_000;
}

// Conservative generation estimate: all input written to cache, full output allowance.
// Counting-endpoint billing, taxes and account-specific terms are not included.
export function estimateMaximumCost(input, output) {
  if (!tokenCount(input) || !tokenCount(output)) throw new TypeError('Некорректное число токенов.');
  return estimateCost({ input, output, cached: 0, written: input });
}

export function summarize(records) {
  const totals = { attempts: records.length, apiCalls: 0, input: 0, output: 0, total: 0,
    knownCostUsd: 0, unknownUsageCalls: 0, unknownCostCalls: 0 };
  for (const record of records) {
    if (!record.sent) continue;
    totals.apiCalls++;
    if (record.usage) {
      totals.input += record.usage.input;
      totals.output += record.usage.output;
      totals.total += record.usage.total;
    } else totals.unknownUsageCalls++;
    if (record.costUsd === null) totals.unknownCostCalls++;
    else totals.knownCostUsd += record.costUsd;
  }
  return totals;
}

export async function countInput(client, payload) {
  const result = await client.responses.inputTokens.count(payload);
  if (!tokenCount(result?.input_tokens)) throw new Error('Недопустимый результат подсчёта.');
  return result.input_tokens;
}

export async function measureInput(client, { model, instructions, input, reasoning }) {
  const common = { model, reasoning };
  const history = input.slice(0, -1);
  // Independent payloads include their own message framing; these counts are not additive.
  const current = await countInput(client, { ...common, input: input.slice(-1) });
  const historyTokens = history.length ? await countInput(client, { ...common, input: history }) : 0;
  const full = await countInput(client, { ...common, instructions, input });
  return { current, history: historyTokens, full };
}
