'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Play, Thermometer, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { SCENARIOS, TEMPERATURES, summarize, renderReport } from '../../core.mjs';
import { assessText, lexicalDifference } from '../../assessment.mjs';
import robots from '../../results/2026-09-05/results.json';
import dreams from '../../results/2026-09-05-dreams/results.json';
import type { Experiment, ScenarioId } from '@/lib/types';

const saved: Partial<Record<ScenarioId, Experiment>> = { robots: robots as Experiment, dreams: dreams as Experiment };
const tones = ['#367c87', '#8a7036', '#ad5540'];
const descriptions = ['Больше повторяемости', 'Свобода формулировок', 'Шире поиск вариантов'];

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Answer({ text }: { text: string }) {
  return <>{text.split('\n').map((line, index) => {
    const content = line.replace(/^#{1,6}\s+/, '').split(/(\*\*.+?\*\*)/g).map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
    return /^#{1,6}\s/u.test(line) ? <h3 key={index}>{content}</h3> : <div key={index}>{line ? content : <br />}</div>;
  })}</>;
}

type ReadTool = { name: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => unknown };
declare global { interface Document { modelContext?: { registerTool: (tool: ReadTool, options?: { signal?: AbortSignal }) => void | Promise<void> } } }

export default function Page() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('robots');
  const [experiments, setExperiments] = useState(saved);
  const [round, setRound] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const experiment = experiments[scenarioId];
  const scenario = SCENARIOS[scenarioId];
  const isSaved = experiment === saved[scenarioId];
  const latest = useRef({ scenarioId, round, experiment, busy });
  latest.current = { scenarioId, round, experiment, busy };
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({ name: 'read_temperature_experiment',
        description: 'Прочитать выбранный сценарий, повтор, статус и полученные ответы. Не запускает API-запросы.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Ожидается пустой объект.');
          return latest.current;
        },
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* Optional browser capability; UI works without WebMCP. */ }
    return () => lifecycle.abort();
  }, []);

  async function run() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setRound(1);
    try {
      const response = await fetch('/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioId }) });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? 'Не удалось начать эксперимент.'); }
      if (!response.body) throw new Error('Сервер не вернул поток результатов.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminalStatus = 'running';
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const snapshot = JSON.parse(line) as Experiment;
          terminalStatus = snapshot.status;
          setExperiments(previous => ({ ...previous, [scenarioId]: snapshot }));
          if (snapshot.status === 'failed') setError(snapshot.runs.at(-1)?.error ?? String(snapshot.error ?? 'Серия остановлена.'));
        }
        if (done) break;
      }
      if (terminalStatus === 'running') throw new Error('Соединение завершилось до окончания серии. Сохраните полученные ответы.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось получить ответы.'); setExperiments(previous => { const value = previous[scenarioId]; return value?.status === 'running' ? { ...previous, [scenarioId]: { ...value, status: 'interrupted' } } : previous; }); }
    finally { lock.current = false; setBusy(false); }
  }

  const summaries = summarize(experiment?.runs ?? []);
  return <main>
    <header className="masthead"><div><div className="eyebrow">AI Tutors / День 04</div><h1>Лаборатория температуры</h1></div><div className="model"><Thermometer size={19} style={{ display: 'inline', marginRight: 8 }} />gpt-5.6-luna<br />один запрос · три настройки</div></header>
    <section className="toolbar" aria-label="Настройки эксперимента">
      <div className="field"><label htmlFor="scenario">Сценарий</label><NativeSelect id="scenario" value={scenarioId} disabled={busy} onChange={event => { setScenarioId(event.target.value as ScenarioId); setRound(1); setError(''); }}>
        <NativeSelectOption value="robots">01 / Команда роботов</NativeSelectOption><NativeSelectOption value="dreams">02 / Мастерская снов</NativeSelectOption>
      </NativeSelect></div>
      <div><div className="actions"><Button onClick={run} disabled={busy}><Play size={15} />{busy ? 'Эксперимент идёт…' : 'Запустить 9 запросов'}</Button><Button variant="outline" disabled={busy || !saved[scenarioId]} onClick={() => { setExperiments(previous => ({ ...previous, [scenarioId]: saved[scenarioId] })); setError(''); }}><RotateCcw size={15} />Показать сохранённую</Button></div><div className="hint">Запуск расходует API-баланс. Просмотр сохранённых ответов бесплатный.</div></div>
    </section>
    <details className="prompt" open><summary>{scenario.title} — одинаковый запрос для всех температур</summary><p>{scenario.prompt}</p></details>
    {error && <div className="error" role="alert">{error}</div>}
    {busy && <progress className="progress" max={9} value={experiment?.status === 'running' ? experiment.runs.length : 0} aria-label="Полученные ответы" />}
    <section className="results-heading"><div><h2>Ответы рядом</h2><div className="source-label"><Badge variant="outline">{isSaved ? 'Сохранённый эксперимент' : 'Текущий запуск'}</Badge>{isSaved && <span className="hint">Готовые примеры из исследования. Новые запросы не отправлялись.</span>}</div><div className="hint" aria-live="polite">{experiment ? `${experiment.runs.filter(item => item.status === 'completed').length} из 9 завершено · ${new Date(experiment.startedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })} (UTC+5)` : 'Результаты появятся после запуска.'}</div></div><div className="rounds"><span className="hint">Повтор</span>{[1, 2, 3].map(value => <Button key={value} size="sm" variant={round === value ? 'default' : 'outline'} aria-pressed={round === value} onClick={() => setRound(value)}>{value}</Button>)}</div></section>
    <section className="columns" aria-label="Сравнение температур">
      {TEMPERATURES.map((temperature, index) => {
        const result = experiment?.runs.find(item => item.round === round && item.request.temperature === temperature);
        const assessment = result?.status === 'completed' ? assessText(result.text, scenarioId) : null;
        return <article className="result" key={temperature} style={{ '--tone': tones[index] } as React.CSSProperties}>
          <div className="result-head"><div className="temperature"><strong>{temperature.toFixed(1)}</strong><span>TEMPERATURE</span></div><p>{descriptions[index]}</p></div>
          <div className="answer"><Answer text={result?.text || (result?.error ? 'Ответ не получен.' : busy ? 'Ожидаем ответ…' : 'Для этого повтора пока нет ответа.')} /></div>
          <div className="result-foot"><Badge variant="outline">{result?.status === 'completed' ? 'Ответ получен' : result?.status === 'failed' ? 'Ошибка' : 'Ожидание'}</Badge>{assessment && <><div className="checks">{assessment.checks.map(check => <div key={check.label} className={check.ok ? 'check-ok' : 'check-no'}>{check.ok ? '✓' : '○'} {check.label}</div>)}</div><span className="hint">{assessment.wordCount} слов · {result?.usage?.output_tokens ?? '—'} выходных токенов · {((result?.durationMs ?? 0) / 1000).toFixed(1)} с</span></>}{result?.error && <p className="check-no">{result.error}</p>}</div>
        </article>;
      })}
    </section>
    <section className="stats" aria-label="Разнообразие трёх повторов"><table><thead><tr><th>Внутри одной температуры</th>{TEMPERATURES.map(t => <th key={t}>{t.toFixed(1)}</th>)}</tr></thead><tbody><tr><td>Различных полных ответов</td>{summaries.map(s => <td key={s.temperature}>{s.uniqueTexts} / {s.completed}</td>)}</tr><tr><td>Различие слов между повторами</td>{summaries.map(s => { const metric = lexicalDifference((experiment?.runs ?? []).filter(r => r.status === 'completed' && r.request.temperature === s.temperature).map(r => r.text)); return <td key={s.temperature}>{metric === null ? '—' : `${metric}%`}</td>; })}</tr><tr><td>Входные / выходные токены</td>{summaries.map(s => <td key={s.temperature}>{s.inputTokens} / {s.outputTokens}</td>)}</tr></tbody></table></section>
    <p className="note">Галочки проверяют текстовые признаки и длину, а не истинность всех утверждений. Уместность идей, противоречия и новые условия нужно оценивать по содержанию. Различие слов — среднее расстояние Жаккара между наборами слов; это не оценка креативности. Три повтора иллюстрируют один эксперимент.</p>
    <footer><div className="hint">Одинаковые инструкции · лимит 600 токенов · reasoning: none<br />Меняется только температура. Выводы исследования — в README задания.</div><div className="actions"><Button variant="outline" disabled={!experiment || busy} onClick={() => experiment && download(`${scenarioId}.md`, renderReport(experiment), 'text/markdown;charset=utf-8')}><Download size={15} />Markdown</Button><Button variant="outline" disabled={!experiment || busy} onClick={() => experiment && download(`${scenarioId}.json`, JSON.stringify(experiment, null, 2), 'application/json')}>JSON</Button></div></footer>
  </main>;
}
