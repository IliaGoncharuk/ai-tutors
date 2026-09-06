'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TASKS, MODELS, PROMPT, summarize } from '../../core.mjs';
import { assessText, summarizeAssessments, REFERENCE } from '../../assessment.mjs';
import type { Experiment } from '@/lib/types';

const colors = ['#21765c', '#2558d4', '#793bb4'];
const seconds = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(2)} с`;
const dollars = (amount: number | null) => amount === null ? '—' : `$${amount.toFixed(5)}`;
function Check({ value, children }: { value: boolean | null; children: React.ReactNode }) {
  return <div className={value === null ? 'check unknown' : value ? 'check good' : 'check bad'}>
    <span aria-hidden="true">{value === null ? '○' : value ? '✓' : '×'}</span><span>{children}: <strong>{value === null ? 'не оценено' : value ? 'да' : 'нет'}</strong></span>
  </div>;
}
function Answer({ text }: { text: string }) {
  return <>{text.split('\n').map((line, index) => <div key={index}>{line ? line.replace(/^#{1,6}\s+/u, '').split(/(\*\*.+?\*\*)/gu)
    .map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part) : <br />}</div>)}</>;
}

type ReadTool = { name: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => unknown };
declare global { interface Document { modelContext?: { registerTool: (tool: ReadTool, options?: { signal?: AbortSignal }) => void | Promise<void> } } }

export default function Page() {
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [round, setRound] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const summaries = summarize(experiment?.runs ?? []);
  const assessments = MODELS.map(model => summarizeAssessments((experiment?.runs ?? [])
    .filter(run => run.request.model === model.id && run.status === 'completed').map(run => assessText(run.text))));
  const totalCost = summaries.reduce((sum, s) => sum + s.costUsd, 0);
  const complete = experiment?.runs.filter(run => run.status === 'completed').length ?? 0;
  const current = useRef({ experiment, round, busy });
  current.current = { experiment, round, busy };
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({ name: 'read_model_comparison',
        description: 'Прочитать выбранный повтор, статус и результаты сравнения моделей. Не запускает платные запросы.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Ожидается пустой объект.');
          return current.current;
        },
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* Optional capability; the visible lab works without WebMCP. */ }
    return () => lifecycle.abort();
  }, []);

  async function run() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setRound(1); setExperiment(null);
    abort.current = new AbortController();
    try {
      const response = await fetch('/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmPaidRun: true }), signal: abort.current.signal });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? 'Не удалось начать серию.'); }
      if (!response.body) throw new Error('Сервер не вернул поток.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = ''; let status = 'running';
      const consume = (line: string) => {
        if (!line.trim()) return;
        const value = JSON.parse(line) as Experiment; status = value.status; setExperiment(value);
        if (value.status === 'failed') setError(value.error ?? value.runs.at(-1)?.error ?? 'Серия остановлена.');
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; lines.forEach(consume);
        if (done) { consume(buffer); break; }
      }
      if (status === 'running') throw new Error('Соединение завершилось до окончания серии.');
    } catch (cause) {
      const cancelled = abort.current?.signal.aborted;
      setError(cancelled ? 'Остановлено. За уже отправленный запрос возможна плата. Полученные ответы остаются на странице до её обновления или закрытия.' :
        cause instanceof Error ? cause.message : 'Не удалось получить результаты.');
      setExperiment(prior => prior?.status === 'running' ? { ...prior, status: cancelled ? 'cancelled' : 'interrupted' } : prior);
    } finally { lock.current = false; setBusy(false); abort.current = null; }
  }

  return <main>
    <header className="masthead"><div><div className="eyebrow">AI TUTORS <span>/</span> ДЕНЬ 05</div><h1>Один запрос. Три модели.</h1></div><div className="experiment-tag"><span className="dot" />Лаборатория сравнения</div></header>
    <section className="toolbar" aria-label="Запуск эксперимента"><div><h2>План научного фестиваля</h2><p>8 часов · 8 задач · найти максимум пользы</p></div>
      <div className="controls"><div className="actions"><Button onClick={run} disabled={busy} size="lg"><Play size={16} />Запустить 9 запросов</Button>
        {busy && <Button variant="outline" onClick={() => abort.current?.abort()}><Square size={14} />Остановить</Button>}</div>
        <p className="hint">Новый запуск платный · бюджет $0,20 · просмотр результатов бесплатный</p></div>
    </section>
    <p className="hint">Ответы хранятся только в памяти вкладки до обновления, закрытия страницы или нового запуска. На диск результаты не записываются.</p>
    <details className="brief"><summary><span>Условие и одинаковый запрос</span><span className="hint">Авторская задача</span></summary>
      <p>Один организатор, 8 часов. Задачи выполняются последовательно, целиком и один раз. Нужно получить максимум баллов.</p>
      <div className="table-wrap"><table><thead><tr><th>Код</th><th>Задача</th><th>Часы</th><th>Баллы</th><th>Условие</th></tr></thead><tbody>{TASKS.map(t => <tr key={t.id}><td><strong>{t.id}</strong></td><td>{t.title}</td><td>{t.hours}</td><td>{t.points}</td><td>{t.requires.length ? `После ${t.requires[0]}` : t.id === 'G' ? 'Нельзя вместе с D' : '—'}</td></tr>)}</tbody></table></div>
      <details className="raw-prompt"><summary>Полный текст запроса</summary><pre>{PROMPT}</pre></details>
      <p className="hint">Во всех запросах: температура 0, reasoning none, до 1200 выходных токенов. Без истории и инструментов. Порядок: Luna → Terra → Sol; Terra → Sol → Luna; Sol → Luna → Terra.</p>
    </details>
    {error && <div className="error" role="alert">{error}</div>}
    {busy && <progress max={9} value={complete} aria-label="Полученные ответы" />}
    <section className="result-heading"><div><h2>Ответы рядом</h2><div className="source"><Badge variant="outline">{experiment || busy ? 'Текущий запуск' : 'До первого запуска'}</Badge><span className="hint" aria-live="polite">{complete} из 9 ответов{experiment ? ` · ${new Date(experiment.startedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })} (UTC+5)` : ''}</span></div></div>
      <div className="rounds"><span>Повтор</span>{[1, 2, 3].map(value => <Button key={value} variant={round === value ? 'default' : 'outline'} aria-pressed={round === value} onClick={() => setRound(value)}>{value}</Button>)}</div>
    </section>
    <section className="columns" aria-label="Ответы трёх моделей">{MODELS.map((model, index) => {
      const result = experiment?.runs.find(item => item.round === round && item.request.model === model.id);
      const assessment = result?.status === 'completed' ? assessText(result.text) : null;
      return <article className="model-card" key={model.id} style={{ '--tone': colors[index] } as CSSProperties}>
        <div className="model-heading"><div><div className="model-level">0{index + 1} / {model.tier}</div><h3>{model.name}<ArrowUpRight size={22} /></h3><span className="hint mono">{model.id}</span></div><Badge variant="outline">{result?.status === 'completed' ? 'Готово' : result?.status === 'failed' ? 'Ошибка' : 'Ожидание'}</Badge></div>
        <div className="run-metrics"><div><span>Время</span><strong>{result ? seconds(result.durationMs) : '—'}</strong></div><div><span>Токены ↑ / ↓</span><strong>{result?.usage ? `${result.usage.input_tokens} / ${result.usage.output_tokens}` : '—'}</strong></div><div><span>Стоимость</span><strong>{dollars(result?.costUsd ?? null)}</strong></div></div>
        <div className={result?.text ? 'answer' : 'answer empty'}><Answer text={result?.text || (busy ? 'Ожидаем ответ модели…' : 'Здесь появится ответ на задачу про фестиваль.')} /></div>
        {result?.error && <p className="card-error">{result.error}</p>}
        {assessment && <div className="assessment"><div className="assessment-title">{assessment.awardedPoints !== null ? <><strong>{assessment.awardedPoints} / {REFERENCE.points}</strong><span>баллов засчитано · {assessment.selected?.join(' + ')}</span></> : <span>План пока не оценён</span>}</div>
          {assessment.feasible === false && <p className="score-rejected">Набор нарушает ограничения задачи — баллы не засчитаны.</p>}
          <p className="hint">{assessment.extractionNote}</p>
          <Check value={assessment.feasible}>Допустимый набор</Check><Check value={assessment.optimal}>Оптимальный набор</Check>
          <Check value={assessment.orderValid}>Верный порядок</Check>
          <Check value={assessment.hoursCorrect}>Верная сумма часов</Check>
          <Check value={assessment.pointsCorrect}>Верная сумма баллов</Check>
          <Check value={assessment.withinWordLimit}>Лимит 180 слов соблюдён · {assessment.wordCount} слов</Check>
          {assessment.evidence && <details className="extraction"><summary>Что распознала проверка</summary>
            <p>Порядок: {assessment.order?.join(' → ') ?? 'не указан явно'}.<br />Заявлено: {assessment.reportedHours ?? '—'} ч, {assessment.reportedPoints ?? '—'} баллов.<br />Посчитано по задачам: {assessment.hours ?? '—'} ч, {assessment.points ?? '—'} баллов.</p>
            <pre>{assessment.evidence}</pre></details>}
          <p className="proof">{assessment.proof}</p><p className="hint">Не оценённые поля не считаются ошибками модели. Обоснование проверяется отдельно.</p>
        </div>}
      </article>;
    })}</section>
    <section className="summary-section"><div className="section-label"><h2>Сравнение трёх повторов</h2><span className="hint">Известная стоимость серии: {dollars(totalCost)}{summaries.some(s => s.unknownCosts) ? ' + неизвестные расходы' : ''}</span></div>
      <div className="table-wrap"><table className="comparison"><thead><tr><th>Метрика</th>{MODELS.map(m => <th key={m.id}>{m.name}</th>)}</tr></thead><tbody>
        <tr className="total-points"><th>Баллы за три повтора · сумма</th>{assessments.map((counts, index) => <td key={MODELS[index].id}>{counts.totalPoints === null ? counts.total ? 'Нет оценки' : '—' : <strong>{counts.totalPoints} / {REFERENCE.points * 3}</strong>}{counts.total > 0 && counts.assessed < 3 && <span className="unassessed">Оценено: {counts.assessed} из 3 · сумма неполная</span>}</td>)}</tr>
        <tr><th>Медианное время ответа</th>{summaries.map(s => <td key={s.model}>{seconds(s.medianMs)}</td>)}</tr>
        <tr><th>Оптимальных среди оценённых</th>{assessments.map((counts, index) => <td key={MODELS[index].id}>{counts.assessed ? `${counts.optimal} / ${counts.assessed}` : counts.total ? 'Нет оценки' : '—'}{counts.unknown > 0 && <span className="unassessed">Не оценено: {counts.unknown}</span>}</td>)}</tr>
        <tr><th>Токены, вход / выход · сумма</th>{summaries.map(s => <td key={s.model}>{s.attempts ? `${s.inputTokens} / ${s.outputTokens}` : '—'}</td>)}</tr>
        <tr><th>Стоимость · сумма</th>{summaries.map(s => <td key={s.model}>{s.attempts ? dollars(s.costUsd) : '—'}{s.unknownCosts > 0 && ' + неизвестно'}</td>)}</tr>
      </tbody></table></div>
      <p className="hint">Засчитывается польза допустимого набора; за нарушение ограничений — 0 баллов. Максимум за три повтора — {REFERENCE.points * 3}. Порядок и заявленные суммы проверяются отдельно.</p>
    </section>
    <details className="reference"><summary>Эталон и границы сравнения</summary><p>Проверены все {REFERENCE.examined} наборов, допустимы {REFERENCE.feasible}. Единственный оптимальный набор: <strong>C, E, F, G — 8 часов, 29 баллов</strong>. Например, E → F → C → G. Эталон не передаётся моделям.</p>
      <p>Уровни моделей обозначают их положение в семействе. Девять ответов на одну авторскую задачу не дают общего рейтинга. Верный набор не гарантирует верного обоснования.</p>
      <p>Время включает сеть и ожидание полного ответа. Токены и стоимость отражают расход API; GPU, память и энергия провайдера не измеряются. Стоимость рассчитана по usage с учётом кэша и тарифам на 05.09.2026.</p>
    </details>
    <footer><span className="hint">День 5 / Версии моделей</span></footer>
  </main>;
}
