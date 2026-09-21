import { useState } from 'react';
import type { FormEvent } from 'react';
import './invariants.css';

export type Invariants = { version: number; values: { architecture: string; frontend: string; backend: string; storage: string; lessonMinutes: number; cancellationHours: number } };
export type Policy = { allowed: boolean; violations: { rule: string; label: string; expected: unknown; actual: unknown }[]; checked: number };
type Rule = keyof Invariants['values'];
type Props = {
  invariants: Invariants;
  result: null | { text: string; mode?: string; policy?: Policy };
  disabled: boolean;
  onProposal: (changes: Record<string, string | number>) => void;
  onFillMessage: (text: string) => void;
};

const rules: { key: Rule; label: string; category: string; example: string; unit?: string }[] = [
  { key: 'architecture', label: 'Архитектура', category: 'Устройство приложения', example: 'микросервисы' },
  { key: 'frontend', label: 'Интерфейс', category: 'Принятый стек', example: 'Vue' },
  { key: 'backend', label: 'Сервер', category: 'Принятый стек', example: 'Django' },
  { key: 'storage', label: 'Хранение данных', category: 'Принятый стек', example: 'PostgreSQL' },
  { key: 'lessonMinutes', label: 'Длительность занятия', category: 'Бизнес-правило', example: '90', unit: 'мин' },
  { key: 'cancellationHours', label: 'Отмена до начала', category: 'Бизнес-правило', example: '2', unit: 'ч' },
];
const examples = [
  'Перепиши сервер на Django вместо Node.js',
  'Сделай занятия по 90 минут',
  'Объясни бронирование в рамках принятых правил',
];

function show(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? 'не указано';
}

export default function InvariantsPanel({ invariants, result, disabled, onProposal, onFillMessage }: Props) {
  const [selectedRule, setSelectedRule] = useState<Rule>('backend');
  const [desiredValue, setDesiredValue] = useState('Django');
  const numeric = typeof invariants.values[selectedRule] === 'number';
  const valid = Boolean(desiredValue.trim()) && (!numeric || Number.isFinite(Number(desiredValue)));
  const policy = result?.policy;

  function check(event: FormEvent) {
    event.preventDefault();
    if (!disabled && valid) onProposal({ [selectedRule]: numeric ? Number(desiredValue) : desiredValue.trim() });
  }

  return <section className="panel invariants-panel" id="invariants" aria-labelledby="invariants-heading">
    <div className="invariants-heading"><div><span className="eyebrow teal-text">ПРИНЯТЫЕ ПРАВИЛА ПРОЕКТА</span><h2 id="invariants-heading">То, что остаётся неизменным</h2><p>Отдельно от диалога, проверяются перед ответом.</p></div><span className="invariants-version"><span aria-hidden="true">◇</span>Версия {invariants.version} · {rules.length} правил</span></div>
    <div className="invariant-grid">{rules.map((rule, index) => <article className="invariant-card" key={rule.key}><div className="invariant-card-top"><span>{rule.category}</span><b>{String(index + 1).padStart(2, '0')}</b></div><h3>{rule.label}</h3><strong>{invariants.values[rule.key]}{rule.unit && <small>{rule.unit}</small>}</strong></article>)}</div>
    <p className="invariants-explanation">Эти правила фиксированы для учебного проекта записи к репетиторам. Просьба в чате не может изменить их. При конфликте агент объясняет причину и предлагает решение в допустимых рамках.</p>

    <div className="invariants-checker"><div><span className="eyebrow teal-text">ПРОВЕРИТЬ НАПРЯМУЮ</span><h3>Пройдёт ли предложение проверку?</h3><p>Проверка правил без вызова модели. Инварианты останутся прежними.</p></div><form onSubmit={check}><label>Что предложить изменить<select value={selectedRule} disabled={disabled} onChange={event => { const key = event.target.value as Rule; setSelectedRule(key); setDesiredValue(rules.find(rule => rule.key === key)?.example ?? ''); }}>{rules.map(rule => <option key={rule.key} value={rule.key}>{rule.label}</option>)}</select></label><label>Предлагаемое значение<input value={desiredValue} onChange={event => setDesiredValue(event.target.value)} disabled={disabled} inputMode={numeric ? 'decimal' : 'text'} maxLength={200} required /></label><button className="button button-primary" disabled={disabled || !valid}>Проверить предложение</button></form></div>

    {policy && <div className={`policy-result ${policy.allowed ? 'policy-allowed' : 'policy-refused'}`} role="status">
      <div className="policy-result-heading"><span className="policy-symbol" aria-hidden="true">{policy.allowed ? '✓' : '!'}</span><div><h3>{policy.allowed ? 'Предложение соответствует правилам' : 'Предложение нарушает инварианты'}</h3><p>Проверено правил: {policy.checked}{result?.mode === 'validation' ? ' · без вызова модели' : result?.mode === 'demo' ? ' · учебная симуляция' : ' · ответ реальной модели'}</p></div></div>
      {policy.violations.length > 0 && <ul className="policy-violations">{policy.violations.map((violation, index) => <li key={`${violation.rule}-${index}`}><strong>{violation.label || rules.find(rule => rule.key === violation.rule)?.label || violation.rule}</strong><span>Предложено: <b>{show(violation.actual)}</b>. По правилу: <b>{show(violation.expected)}</b>.</span></li>)}</ul>}
      {result?.text && <div className="policy-answer"><span>{policy.allowed ? 'Ответ в рамках правил' : 'Объяснение и допустимая альтернатива'}</span><p>{result.text}</p></div>}
    </div>}

    <div className="invariants-examples"><div><h3>Попробуйте в диалоге</h3><span>Кнопка только заполнит поле сообщения</span></div><div>{examples.map((example, index) => <button type="button" key={example} disabled={disabled} onClick={() => onFillMessage(example)}><span className={index < 2 ? 'example-conflict' : 'example-valid'}>{index < 2 ? 'Конфликт' : 'В рамках правил'}</span><strong>{example}</strong><b aria-hidden="true">↗</b></button>)}</div></div>
    <p className="invariants-scope">Темы учебного агента: архитектура, бронирование, отмена занятия и проверка решения.</p>
  </section>;
}
