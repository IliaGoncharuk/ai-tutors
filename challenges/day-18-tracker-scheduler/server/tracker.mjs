import { PublicError, analyze, demoIssues, selectPeriod, localDate } from './domain.mjs';

export function trackerConfig(env = process.env) {
  return { token: env.YANDEX_TRACKER_TOKEN || env.YANDEX360_TOKEN, org: env.YANDEX_TRACKER_ORG_ID || env.YANDEX360_ORG, cloudOrg: env.YANDEX_TRACKER_CLOUD_ORG_ID };
}
export async function searchIssues({ source = 'demo', period = 'all', date = localDate(), fetcher = fetch, config = trackerConfig() } = {}) {
  if (source === 'demo') return { source, ...selectPeriod(demoIssues(date), period, date) };
  if (source !== 'live') throw new PublicError('Неизвестный источник данных.');
  if (!config.token || (!config.org && !config.cloudOrg)) throw new PublicError('Нужны токен Трекера и идентификатор организации в окружении сервера.');
  const headers = { Authorization: `OAuth ${config.token}`, 'Content-Type': 'application/json', [config.cloudOrg ? 'X-Cloud-Org-ID' : 'X-Org-ID']: config.cloudOrg || config.org };
  const collected = new Map(); let total = null;
  for (let page = 1; page <= 100; page++) {
    let response;
    try { response = await fetcher(`https://api.tracker.yandex.net/v3/issues/_search?perPage=100&page=${page}&fields=key,summary,status,dueDate,resolution,priority`, {
      method: 'POST', headers, body: JSON.stringify({ query: 'Assignee: me() Resolution: empty() "Sort By": Key ASC' }), redirect: 'error', signal: AbortSignal.timeout(20000),
    }); } catch { throw new PublicError('Трекер недоступен или не ответил за 20 секунд.'); }
    if (!response.ok) {
      const messages = { 401: 'Трекер отклонил токен (401).', 403: 'Нет прав чтения Трекера (403).', 429: 'Достигнут лимит запросов Трекера (429). Повторите позже.' };
      throw new PublicError(messages[response.status] ?? `Трекер вернул HTTP ${response.status}.`);
    }
    let rows; try { rows = await response.json(); } catch { throw new PublicError('Трекер вернул некорректный JSON.'); }
    if (!Array.isArray(rows)) throw new PublicError('Некорректный список задач Трекера.');
    const count = response.headers.get('x-total-count'), pages = response.headers.get('x-total-pages');
    if (count !== null && /^\d+$/.test(count)) total = Number(count);
    for (const item of rows) {
      if (!item || typeof item.key !== 'string' || typeof item.summary !== 'string') throw new PublicError('В ответе Трекера отсутствуют обязательные поля.');
      collected.set(item.key, { key: item.key, summary: item.summary, dueDate: item.dueDate || null, resolved: Boolean(item.resolution), status: item.status?.display ?? 'Не указан', priority: item.priority?.display ?? 'Не указан', url: `https://tracker.yandex.ru/${encodeURIComponent(item.key)}` });
    }
    const complete = pages !== null && /^\d+$/.test(pages) ? page >= Number(pages) : rows.length < 100;
    if (complete) {
      if (total !== null && collected.size !== total) throw new PublicError('Список задач изменился во время чтения или получен не полностью. Обновите сводку.');
      return { source, ...selectPeriod([...collected.values()], period, date) };
    }
  }
  throw new PublicError('Слишком много страниц. Неполная выборка не используется для сводки.');
}
