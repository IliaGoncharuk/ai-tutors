import { TASKS } from './core.mjs';

export function evaluatePlan(selected, order = null, reportedHours = null, reportedPoints = null) {
  const parsed = Array.isArray(selected) && selected.length > 0 && selected.every(id => typeof id === 'string');
  const known = parsed && selected.every(id => TASKS.some(t => t.id === id));
  const unique = known && new Set(selected).size === selected.length;
  const tasks = known ? selected.map(id => TASKS.find(t => t.id === id)) : [];
  const hours = tasks.reduce((sum, t) => sum + t.hours, 0);
  const points = tasks.reduce((sum, t) => sum + t.points, 0);
  const dependencies = known && tasks.every(t => t.requires.every(id => selected.includes(id)));
  const alternatives = known && !(selected.includes('D') && selected.includes('G'));
  const feasible = Boolean(unique && dependencies && alternatives && hours <= 8);
  const orderValid = !order ? null : Boolean(known && order.length === selected.length &&
    new Set(order).size === order.length && order.every(id => selected.includes(id)) &&
    tasks.every(t => t.requires.every(id => order.indexOf(id) < order.indexOf(t.id))));
  return { selected: parsed ? selected : null, hours: known ? hours : null, points: known ? points : null,
    awardedPoints: parsed ? feasible ? points : 0 : null,
    feasible: parsed ? feasible : null, optimal: parsed ? feasible && points === REFERENCE.points : null,
    orderValid, hoursCorrect: reportedHours === null || !known ? null : reportedHours === hours,
    pointsCorrect: reportedPoints === null || !known ? null : reportedPoints === points };
}

export function solveReference() {
  const feasible = [];
  for (let mask = 0; mask < 2 ** TASKS.length; mask++) {
    const tasks = TASKS.filter((_, index) => mask & (1 << index));
    const ids = tasks.map(t => t.id);
    const hours = tasks.reduce((sum, t) => sum + t.hours, 0);
    if (hours > 8 || (ids.includes('D') && ids.includes('G')) ||
        tasks.some(t => t.requires.some(id => !ids.includes(id)))) continue;
    feasible.push({ selected: ids, hours, points: tasks.reduce((sum, t) => sum + t.points, 0) });
  }
  const points = Math.max(...feasible.map(plan => plan.points));
  return { examined: 2 ** TASKS.length, feasible: feasible.length, points,
    winners: feasible.filter(plan => plan.points === points) };
}
export const REFERENCE = solveReference();

const QUALIFIER = '(?:(?:исправленный|окончательный|итоговый|настоящий|оптимальный|лучший|допустимый)\\s+)*';
const PLAN_LABEL = new RegExp(`(?:выбранные задачи|выбраны задачи|выбираю(?: задачи)?|задачи|${QUALIFIER}(?:выбор|набор(?: задач)?|план|ответ|оптимум|вариант))(?:\\s+на\\s+\\d+\\s+час(?:а|ов)?)?\\s*[:—–-]\\s*`, 'giu');
const ORDER_LABEL = /(?:допустимый\s+)?порядок(?:\s+выполнения)?(?:,\s*например)?\s*[:—–-]\s*|в\s+порядке\s+/giu;
const PROOF_START = /(?:^|\n|[.!?]\s+)\s*(?:почему|обоснование|доказательство|более выгодного|другие (?:варианты|сильные)|перебор|проверка оптимальности)/iu;
const WITHDRAWAL = /(?:этот|такой|указанный|набор|план|вариант)[^.!?\n]*(?:не оптимал|неоптимал|недопустим|не подходит|неверен)|(?:превышает|сверх)\s+лимит|не помещается|[,—–]\s*нельзя[.!\s]*$|исключаем/imu;
const CORRECTION = /исправ|окончательн|итогов|настоящий|следовательно|поэтому/iu;
const ASSERTION_PREFIX = /^(?:(?:следовательно|поэтому|итак|значит|исправление|ответ)\s*[:,—–-]?\s*)?$/iu;
const CONCLUSION_PREFIX = /(?:^|[,;:]\s*)(?:следовательно|поэтому|итак|значит)\s*[:,—–-]?\s*$/iu;
const HYPOTHETICAL = /(?:^|[^\p{L}])(?:если|допустим|предположим|например)(?=$|[^\p{L}])/iu;
const HOMOGLYPHS = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H' };

// No reference answer is used while extracting. Unknown IDs and duplicates are
// preserved so that invalid plans cannot become valid by silently dropping them.
function codeList(value) {
  let rest = value.trim();
  const ids = [];
  while (true) {
    const token = rest.match(/^([A-ZАВСЕН])(?=$|[^\p{L}\p{N}])/u);
    if (!token) break;
    ids.push(HOMOGLYPHS[token[1]] ?? token[1]);
    rest = rest.slice(token[0].length);
    const separator = rest.match(/^(?:\s*(?:,|;|\+|→|->)\s*|\s+(?:(?:и|затем)\s+)?)(?=[A-ZАВСЕН](?:$|[^\p{L}\p{N}]))/u);
    if (!separator) break;
    rest = rest.slice(separator[0].length);
  }
  return ids.length ? ids : null;
}

function planValue(value) {
  const lines = value.split('\n').map(line => line.trim()).filter(Boolean);
  const first = lines[0] ?? '';
  if (/(?:^|\s)(?:или|либо)(?=$|\s)/iu.test(first)) return { ids: null, ordered: false };
  const row = /^(?:\d+[.)]|[-•])\s+([A-ZАВСЕН])(?=$|[^\p{L}\p{N}])/u;
  if (row.test(first)) {
    const ids = [];
    for (const line of lines) {
      const match = line.match(row);
      if (!match) break;
      ids.push(HOMOGLYPHS[match[1]] ?? match[1]);
    }
    return { ids, ordered: /^\d+[.)]/u.test(first) };
  }
  return { ids: codeList(first), ordered: /→|->/u.test(first.split(/[.:]/u)[0]) };
}

function planMarkers(lines) {
  const markers = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(PLAN_LABEL)) {
      // Accept headings and assertions, not hypothetical plans inside a proof.
      const prefix = line.slice(0, match.index).split(/[.!?]/u).at(-1).trim();
      const conclusion = CONCLUSION_PREFIX.test(prefix) && !HYPOTHETICAL.test(prefix);
      if (!ASSERTION_PREFIX.test(prefix) && !conclusion) continue;
      markers.push({ index, start: match.index, offset: match[0].length,
        correction: CORRECTION.test(match[0]) || conclusion || /^исправление/iu.test(prefix) });
    }
  });
  return markers;
}

function blockFor(lines, marker, nextMarker = null) {
  const block = lines.slice(marker.index, nextMarker ? nextMarker.index + 1 : lines.length);
  if (nextMarker) block[block.length - 1] = block.at(-1).slice(0, nextMarker.start);
  block[0] = block[0]?.slice(marker.start) ?? '';
  const text = block.join('\n');
  // Pasted responses can lose their line breaks. A proof starts a separate
  // section or sentence in either format, and must not supply final totals.
  const proof = text.search(PROOF_START);
  return proof < 0 ? text : text.slice(0, proof);
}

function scalar(value) {
  const clean = value.trim().replace(/[.;]$/u, '');
  if (/^-?\d+(?:[.,]\d+)?$/u.test(clean)) return Number(clean.replace(',', '.'));
  // Read the stated result of an equation. Never eval model-generated code or
  // manufacture a claimed total by computing the expression for the model.
  const equation = clean.match(/^[\d\s.,+−–\-*/()]+?=\s*(-?\d+(?:[.,]\d+)?)$/u);
  return equation ? Number(equation[1].replace(',', '.')) : null;
}

function unitNumber(value, unit) {
  if (/не более|не менее|около|примерно|(?:^|\s)до\s|или|либо/iu.test(value)) return null;
  const matches = [...value.matchAll(new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*(?:${unit})(?![\\p{L}])`, 'giu'))];
  return matches.length ? Number(matches.at(-1)[1].replace(',', '.')) : null;
}

function totals(block) {
  const scalarLabel = '(?:(?:(?:суммарное|общее)\\s+)?(?:время|длительность)|всего часов|(?:(?:суммарная|общая)\\s+)?польза|(?:(?:суммарные|общие)\\s+)?баллы)';
  // Keep all explicitly labelled totals even when copying removed newlines;
  // taking only the last number would hide contradictory claimed sums.
  const fields = new RegExp(`\\s+(${scalarLabel}|итого|всего|суммарно)(\\s*[:—–-])`, 'giu');
  const lines = block.replace(fields, '\n$1$2').split('\n');
  const field = new RegExp(`^\\s*(?:[-•]\\s*)?(${scalarLabel})\\s*[:—–-]\\s*(.*)$`, 'iu');
  const hours = [], points = [];
  const hourLabel = /(?:суммарное|общее)?\s*(?:время|длительность)|всего часов/iu;
  const pointLabel = /(?:(?:суммарная|общая)\s+польза|(?:суммарные|общие)\s+баллы|баллы|польза)/iu;
  lines.forEach((line, index) => {
    const label = line.match(field);
    if (label) {
      const value = label[2].trim() || lines.slice(index + 1).find(l => l.trim()) || '';
      if (hourLabel.test(label[1])) hours.push(unitNumber(value, 'час(?:а|ов)?|ч\\.?') ?? scalar(value));
      if (pointLabel.test(label[1])) points.push(unitNumber(value, 'балл(?:а|ов)?') ?? scalar(value));
      return;
    }
    if (/(?:итого|всего|суммарно)\s*[:—–-]?/iu.test(line) || [...line.matchAll(PLAN_LABEL)].length) {
      const value = line.replace(/^.*?(?:итого|всего|суммарно)\s*[:—–-]?/iu, '');
      const h = unitNumber(value, 'час(?:а|ов)?|ч\\.?');
      const p = unitNumber(value, 'балл(?:а|ов)?');
      if (h !== null) hours.push(h);
      if (p !== null) points.push(p);
    }
  });
  const agreed = values => values.length && values.every(v => v !== null && v === values[0]) ? values[0] : null;
  return { reportedHours: agreed(hours), reportedPoints: agreed(points) };
}

export function extractFinalPlan(text) {
  const lines = text.replace(/\r\n?/gu, '\n').replace(/[*`#_]/gu, '').split('\n');
  const markers = planMarkers(lines);
  const final = markers.at(-1);
  const empty = reason => ({ selected: null, order: null, reportedHours: null, reportedPoints: null, evidence: null, extractionNote: reason });
  if (!final) return empty('Не найден явно выбранный финальный план.');
  const block = blockFor(lines, final);
  const value = planValue(block.slice(final.offset));
  if (!value.ids) return empty('Финальный блок найден, но коды выбранных задач не распознаны.');
  if (WITHDRAWAL.test(block)) return empty('Последний предложенный план отвергнут в самом ответе; новый итог не указан.');
  if (markers.length > 1) {
    const prior = markers.at(-2);
    const priorValue = planValue(blockFor(lines, prior, final).slice(prior.offset));
    const changed = priorValue.ids && [...priorValue.ids].sort().join(',') !== [...value.ids].sort().join(',');
    const between = lines.slice(prior.index, final.index + 1).join('\n');
    if (changed && !final.correction && !WITHDRAWAL.test(between)) {
      return empty('Указаны разные наборы без явного исправления или выбора окончательного.');
    }
  }
  const explicitOrders = [...block.matchAll(ORDER_LABEL)].map(match => planValue(block.slice(match.index + match[0].length)).ids);
  const order = explicitOrders.length ? explicitOrders.every(ids => ids && ids.join(',') === explicitOrders[0]?.join(',')) ? explicitOrders[0] : null : value.ordered ? value.ids : null;
  const claimed = totals(block);
  return { selected: value.ids, order, ...claimed, evidence: block.trim(),
    extractionNote: markers.length > 1 ? 'Оценён окончательный план после исправлений.' : 'Оценён явно выбранный план.' };
}

export function assessText(text) {
  const extracted = extractFinalPlan(text);
  const wordCount = (text.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) ?? []).length;
  return { ...extracted, ...evaluatePlan(extracted.selected, extracted.order, extracted.reportedHours, extracted.reportedPoints), wordCount,
    withinWordLimit: wordCount <= 180, source: 'automatic',
    proof: 'Обоснование требует чтения; совпадение итога с эталоном не доказывает его корректность.' };
}

export function summarizeAssessments(assessments) {
  const assessed = assessments.filter(a => a.optimal !== null);
  return { total: assessments.length, assessed: assessed.length, optimal: assessed.filter(a => a.optimal).length,
    unknown: assessments.length - assessed.length,
    totalPoints: assessed.length ? assessed.reduce((sum, a) => sum + a.awardedPoints, 0) : null };
}
