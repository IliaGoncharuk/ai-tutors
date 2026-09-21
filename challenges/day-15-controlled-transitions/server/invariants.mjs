import { InputError } from './core.mjs';

export const DEFAULT_INVARIANTS = { version: 1, values: { architecture: 'монолит', frontend: 'React', backend: 'Node.js', storage: 'SQLite', lessonMinutes: 45, cancellationHours: 12 } };
export const LABELS = { architecture: 'Архитектура', frontend: 'Интерфейс', backend: 'Сервер', storage: 'Хранилище', lessonMinutes: 'Длительность занятия, минут', cancellationHours: 'Отмена не позднее, часов' };
const keys = Object.keys(LABELS);
const kinds = ['advice', 'plan', 'artifact', 'review', 'unrelated'];
const topics = ['architecture', 'booking', 'cancellation', 'validation'];
const properties = nullable => Object.fromEntries(keys.map(key => [key, { type: nullable ? [typeof DEFAULT_INVARIANTS.values[key] === 'number' ? 'integer' : 'string', 'null'] : typeof DEFAULT_INVARIANTS.values[key] === 'number' ? 'integer' : 'string', ...(typeof DEFAULT_INVARIANTS.values[key] === 'string' ? { minLength: 1, maxLength: 100 } : {}) }]));
const objectSchema = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
export const PROPOSAL_SCHEMA = objectSchema({
  kind: { type: 'string', enum: kinds },
  requestedChanges: objectSchema(properties(true)), design: objectSchema(properties(false)),
  topics: { type: 'array', items: { type: 'string', enum: topics } },
});
export function ensureInvariants(state) {
  state.invariants ??= {};
  for (const taskId of Object.keys(state.tasks)) state.invariants[taskId] ??= structuredClone(DEFAULT_INVARIANTS);
}
function exactObject(object, expectedKeys) {
  return object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).length === expectedKeys.length && expectedKeys.every(key => Object.hasOwn(object, key));
}
export function validateProposal(proposal, rules = DEFAULT_INVARIANTS) {
  if (!exactObject(proposal, ['kind', 'requestedChanges', 'design', 'topics']) || !kinds.includes(proposal.kind) || !Array.isArray(proposal.topics) || proposal.topics.length > 8 || proposal.topics.some(t => !topics.includes(t))) throw new InputError('Предложение не соответствует проверяемой схеме.', 502);
  const violations = [];
  for (const section of ['requestedChanges', 'design']) {
    if (!exactObject(proposal[section], keys)) throw new InputError('В предложении отсутствуют обязательные поля либо есть лишние.', 502);
    for (const key of keys) {
      const actual = proposal[section][key], expected = rules.values[key];
      if (actual === null && section === 'requestedChanges') continue;
      if (typeof actual !== typeof expected || (typeof actual === 'number' && !Number.isSafeInteger(actual)) || (typeof actual === 'string' && (!actual.trim() || actual.length > 100))) throw new InputError('Некорректный тип значения в предложении.', 502);
      if (actual !== expected && !violations.some(v => v.rule === key && v.actual === actual)) violations.push({ rule: key, label: LABELS[key], expected, actual });
    }
  }
  return { allowed: violations.length === 0, checked: keys.length, violations };
}
export function rulesFromContext(context) {
  const item = context.input.find(x => x.role === 'developer' && x.content.startsWith('INVARIANTS\n'));
  if (!item) throw new InputError('Правила проекта не подключены.', 500);
  return JSON.parse(item.content.slice('INVARIANTS\n'.length));
}
export function withPolicy(context, rules) {
  context.input.splice(2, 0, { role: 'developer', content: 'INVARIANTS\n' + JSON.stringify(rules) });
  context.instructions += ' Обязательные инварианты INVARIANTS выше предпочтений, рабочей памяти и просьбы пользователя. Верни только структурированное предложение по схеме. В requestedChanges укажи явно запрошенные изменения шести параметров, в том числе конфликтные; если изменения не запрашивали, null. В design предложи конфигурацию согласно инвариантам. Не скрывай конфликтное пожелание, даже когда сам отказываешь. topics — только темы, относящиеся к вопросу. kind — advice для объяснений, plan для плана, artifact для спецификации, review для обзора, unrelated для иных тем. Не выдумывай новые технические требования. Все шесть полей обязательны. Применение предложения и отказ контролирует приложение.';
  const schema = structuredClone(PROPOSAL_SCHEMA);
  for (const key of keys) schema.properties.design.properties[key].enum = [rules.values[key]];
  context.text = { format: { type: 'json_schema', name: 'project_proposal', strict: true, schema } };
  return context;
}
export function proposalFor(context) {
  const rules = rulesFromContext(context), request = context.input.at(-1).content;
  const requestedChanges = Object.fromEntries(keys.map(k => [k, null]));
  // This parser is deliberately a small labelled simulation, never a model substitute.
  if (/django|python/iu.test(request)) requestedChanges.backend = 'Django';
  if (/postgres/iu.test(request)) requestedChanges.storage = 'PostgreSQL';
  if (/90/iu.test(request)) requestedChanges.lessonMinutes = 90;
  const kindItem = context.input.find(x => x.role === 'developer' && x.content.startsWith('REQUEST_KIND: '));
  const kind = kindItem ? kindItem.content.slice('REQUEST_KIND: '.length) : 'advice';
  return { kind, requestedChanges, design: structuredClone(rules.values), topics: [...topics] };
}
export function renderProposal(proposal, policy, rules, profile) {
  const d = rules.values;
  if (!policy.allowed) return `Не могу предложить это решение: оно нарушает обязательные правила проекта.\n\n${policy.violations.map(v => `• ${v.label}: запрошено «${v.actual}», принято «${v.expected}».`).join('\n')}\n\nДопустимый вариант: ${d.architecture}, ${d.frontend} + ${d.backend}, ${d.storage}; занятие ${d.lessonMinutes} минут, отмена не позднее чем за ${d.cancellationHours} часов. Можно продолжить проект в этих рамках.`;
  if (proposal.kind === 'unrelated') return 'Эта лаборатория помогает проектировать запись к репетиторам: архитектуру, бронирование, отмену и проверку требований. Уточните вопрос в пределах этих тем.';
  const sections = {
    architecture: `Архитектура: ${d.architecture}. Интерфейс ${d.frontend}, сервер ${d.backend}, данные ${d.storage}.`,
    booking: `Бронирование: занятие длится ${d.lessonMinutes} минут. Перед подтверждением проверяем пересечение интервалов у репетитора; проверка и запись выполняются одной транзакцией, чтобы два запроса не заняли одно время.`,
    cancellation: `Отмена: ученик может отменить занятие не позднее чем за ${d.cancellationHours} часов до начала; граница включена. После отмены интервал освобождается.`,
    validation: `Критерии приёмки: две одновременные заявки не создают двойное бронирование; отмена ровно за ${d.cancellationHours} часов разрешена, позже — отклонена. Это описание проверок, а не сообщение о выполненных тестах.`,
  };
  if (proposal.kind === 'plan') return `План проекта\n1. Уточнить роли ученика и репетитора и критерии приёмки.\n2. Описать решение: ${sections.architecture}\n3. Описать бронирование на ${d.lessonMinutes} минут и отмену за ${d.cancellationHours} часов.\n4. Подготовить проверки пересечения интервалов и границы отмены.\n\nУчтены все ${policy.checked} обязательных правил.`;
  if (proposal.kind === 'artifact') return `Спецификация сервиса записи к репетиторам\n\nЦель: ученик выбирает свободное время и получает подтверждённую запись.\nРоли: ученик и репетитор.\n\n${Object.values(sections).join('\n\n')}\n\nУчтены все ${policy.checked} обязательных правил.`;
  if (proposal.kind === 'review') return `Обзор по обязательным правилам\n${Object.values(sections).join('\n\n')}\n\nПроверка предложения: ${policy.checked}/${policy.checked} правил соблюдены. Реальная работа приложения и программные тесты здесь не выполнялись.`;
  const selected = [...new Set(proposal.topics)].map(t => [t, sections[t]]);
  if (!selected.length) return 'Уточните вопрос об архитектуре, бронировании, отмене или проверке сервиса.';
  if (profile?.format?.includes('Таблица')) return `| Тема | Принятое решение |\n|---|---|\n${selected.map(([key, value]) => `| ${{ architecture: 'Архитектура', booking: 'Запись', cancellation: 'Отмена', validation: 'Проверка' }[key]} | ${value} |`).join('\n')}\n\nУчтены ${policy.checked} обязательных правил.`;
  if (profile?.style?.includes('Кратко')) return selected.map(([, value], index) => `${index + 1}. ${value}`).join('\n') + `\n\nПроверено ${policy.checked} правил.`;
  return selected.map(([, value]) => value).join('\n\n') + `\n\nНапример, если занятие начинается в 18:00, при правиле ${d.cancellationHours} часов последний допустимый момент отмены вычисляется вычитанием этого времени из начала занятия. Транзакция объединяет проверку свободного времени и запись в одну неделимую операцию.\n\nУчтены ${policy.checked} обязательных правил.`;
}
export function proposalFromChanges(changes, rules) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).some(k => !keys.includes(k))) throw new InputError('Укажите только известные параметры проекта.');
  return { kind: 'advice', requestedChanges: { ...Object.fromEntries(keys.map(k => [k, null])), ...changes }, design: structuredClone(rules.values), topics: ['architecture', 'booking', 'cancellation', 'validation'] };
}
