import { ZONE } from './config.mjs';
export class PublicError extends Error { constructor(message) { super(message); this.publicMessage = message; } }
export const periods = ['all', 'overdue', 'today'];
export function localDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function analyze(issues, date = localDate()) {
  if (!validDate(date)) throw new PublicError('Неверная дата сводки.');
  const metrics = { total: 0, overdue: 0, today: 0, upcoming: 0, noDeadline: 0, invalidDeadline: 0, maxOverdueDays: 0 };
  const rows = issues.filter(issue => !issue.resolved).map(issue => {
    let bucket = 'noDeadline', daysOverdue = 0;
    if (issue.dueDate) {
      if (!validDate(issue.dueDate)) bucket = 'invalidDeadline';
      else if (issue.dueDate < date) { bucket = 'overdue'; daysOverdue = Math.round((Date.parse(date) - Date.parse(issue.dueDate)) / 86400000); }
      else bucket = issue.dueDate === date ? 'today' : 'upcoming';
    }
    metrics.total++; metrics[bucket]++; metrics.maxOverdueDays = Math.max(metrics.maxOverdueDays, daysOverdue);
    return { ...issue, bucket, daysOverdue };
  }).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.key.localeCompare(b.key));
  return { date, metrics, issues: rows };
}
export function selectPeriod(issues, period, date) {
  if (!periods.includes(period)) throw new PublicError('Неизвестный период.');
  const result = analyze(issues, date);
  return period === 'all' ? result : analyze(result.issues.filter(issue => issue.bucket === period), date);
}
// An allowlist projection: no arbitrary strings or nested tool responses enter the model.
export function numericMetrics(value) {
  const keys = ['total', 'overdue', 'today', 'upcoming', 'noDeadline', 'invalidDeadline', 'maxOverdueDays'];
  return Object.fromEntries(keys.map(key => {
    const number = value?.[key];
    if (!Number.isSafeInteger(number) || number < 0) throw new PublicError('Некорректные показатели сводки.');
    return [key, number];
  }));
}
export function demoIssues(date = localDate()) {
  const shift = days => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0,10);
  return [
    ['DEMO-101', 'Подготовить макет страницы', shift(-3), false],
    ['DEMO-102', 'Проверить сценарий регистрации', shift(-1), false],
    ['DEMO-103', 'Обновить инструкцию запуска', date, false],
    ['DEMO-104', 'Согласовать план демонстрации', date, false],
    ['DEMO-105', 'Добавить подсказки к форме', shift(2), false],
    ['DEMO-106', 'Разобрать идеи улучшений', null, false],
    ['DEMO-107', 'Закрытая учебная задача', shift(-8), true],
  ].map(([key, summary, dueDate, resolved]) => ({ key, summary, dueDate, resolved, status: resolved ? 'Закрыта' : 'В работе', priority: 'Обычный', url: null }));
}
