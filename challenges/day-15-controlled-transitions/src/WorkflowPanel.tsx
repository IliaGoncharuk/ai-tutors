import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import LifecyclePanel from './LifecyclePanel';

export type Stage = 'planning' | 'execution' | 'validation' | 'done';
export type Gate = { allowed: boolean; reason: string };
export type Gates = Record<Stage, Gate>;
export type Workflow = {
  stage: Stage;
  paused: boolean;
  step: string;
  expectedAction: string;
  plan: string;
  planVersion: number;
  artifact: string;
  artifactVersion: number;
  review: null | { text: string; artifactVersion: number; mode: 'live' | 'demo'; at: string };
  approvedPlanVersion: number | null;
  requirementsVersion: number;
  planRequirementsVersion: number | null;
  approvedRequirementsVersion: number | null;
  artifactPlanVersion: number | null;
  artifactRequirementsVersion: number | null;
  validation: null | { passed: boolean; checks: { name: string; pass: boolean; detail: string }[]; planVersion: number; artifactVersion: number; requirementsVersion: number; at: string };
};

type Props = {
  workflow: Workflow;
  gates: Gates;
  actionError: string;
  disabled: boolean;
  modelUnavailable: boolean;
  mode: 'live' | 'demo';
  onModeChange: (mode: 'live' | 'demo') => void;
  onAction: (action: { type: string; [key: string]: unknown }) => Promise<void>;
  onGenerate: (kind: 'plan' | 'artifact' | 'review') => void;
};

const stages: { id: Stage; title: string; note: string }[] = [
  { id: 'planning', title: 'Планирование', note: 'Выбираем подход' },
  { id: 'execution', title: 'Выполнение', note: 'Создаём результат' },
  { id: 'validation', title: 'Проверка', note: 'Находим недочёты' },
  { id: 'done', title: 'Готово', note: 'Фиксируем итог' },
];

export default function WorkflowPanel({ workflow, gates, actionError, disabled, modelUnavailable, mode, onModeChange, onAction, onGenerate }: Props) {
  const [step, setStep] = useState(workflow.step);
  const [expectedAction, setExpectedAction] = useState(workflow.expectedAction);
  const plan = workflow.plan;
  const artifact = workflow.artifact;
  useEffect(() => { setStep(workflow.step); setExpectedAction(workflow.expectedAction); }, [workflow.step, workflow.expectedAction]);

  const currentIndex = stages.findIndex(item => item.id === workflow.stage);
  const next = stages[currentIndex + 1];
  const locked = disabled || workflow.paused;
  const generateDisabled = locked || modelUnavailable;
  const stepChanged = step !== workflow.step || expectedAction !== workflow.expectedAction;

  function saveStep(event: FormEvent) {
    event.preventDefault();
    if (!locked && stepChanged && step.trim() && expectedAction.trim()) void onAction({ type: 'set-step', step: step.trim(), expectedAction: expectedAction.trim() });
  }

  return <section className={`panel workflow-panel ${workflow.paused ? 'workflow-paused' : ''}`} id="workflow" aria-labelledby="workflow-heading">
    <div className="workflow-heading">
      <div><span className="eyebrow teal-text">КОНТРОЛИРУЕМЫЙ ЖИЗНЕННЫЙ ЦИКЛ</span><h2 id="workflow-heading">Каждый переход — по правилам</h2></div>
      <span className={`workflow-status ${workflow.paused ? 'workflow-status-paused' : ''}`}><span />{workflow.paused ? 'На паузе' : workflow.stage === 'done' ? 'Завершено' : 'В работе'}</span>
    </div>

    <ol className="workflow-stages" aria-label="Этапы задачи">{stages.map((item, index) => <li key={item.id} className={`${index === currentIndex ? 'stage-current' : ''} ${index < currentIndex ? 'stage-past' : ''}`} aria-current={index === currentIndex ? 'step' : undefined}>
      <span className="stage-circle">{index < currentIndex ? '✓' : String(index + 1).padStart(2, '0')}</span>
      <div><strong>{item.title}</strong><code>{item.id}</code><small>{item.note}</small></div>
    </li>)}</ol>

    <div className="workflow-current">
      <div><span>Текущий шаг</span><strong>{workflow.step || 'Шаг ещё не указан'}</strong></div>
      <div><span>Ожидаемое действие</span><strong>{workflow.expectedAction || 'Действие ещё не указано'}</strong></div>
    </div>

    {workflow.paused && <div className="workflow-pause-note" role="status"><strong>Задача на паузе.</strong> Этап, текущий шаг и материалы сохранены. Нажмите «Продолжить задачу», чтобы вернуться к работе без повторных объяснений.</div>}

    <div className="workflow-controls">
      <button type="button" className={`button ${workflow.paused ? 'button-primary' : 'button-secondary'}`} disabled={disabled} onClick={() => void onAction({ type: workflow.paused ? 'resume-task' : 'pause-task' })}><span aria-hidden="true">{workflow.paused ? '▷' : 'Ⅱ'}</span>{workflow.paused ? 'Продолжить задачу' : 'Поставить на паузу'}</button>
      <div className="workflow-transitions">
        {workflow.stage === 'validation' && <button type="button" className="button button-quiet" disabled={locked || !gates.execution.allowed} onClick={() => void onAction({ type: 'transition', target: 'execution' })}>← На доработку</button>}
        {next && <button type="button" className="button button-primary" disabled={locked || !gates[next.id].allowed} onClick={() => void onAction({ type: 'transition', target: next.id })}>{next.id === 'done' ? 'Завершить задачу' : `К этапу «${next.title}»`}<span aria-hidden="true">→</span></button>}
        {workflow.stage === 'done' && <span className="workflow-finished">Все этапы пройдены</span>}
      </div>
    </div>

    {next && !gates[next.id].allowed && <p className="next-gate-reason"><span aria-hidden="true">◇</span>{gates[next.id].reason}</p>}

    <LifecyclePanel workflow={workflow} gates={gates} disabled={disabled} actionError={actionError} onAction={onAction} />

    <details className="workflow-step-editor">
      <summary>Уточнить шаг и ожидаемое действие</summary>
      <form onSubmit={saveStep}><div className="workflow-step-fields"><label>Текущий шаг<input value={step} disabled={locked} maxLength={300} required onChange={event => setStep(event.target.value)} placeholder="Например: описать экран выбора репетитора" /></label><label>Ожидаемое действие<input value={expectedAction} disabled={locked} maxLength={500} required onChange={event => setExpectedAction(event.target.value)} placeholder="Например: подготовить список элементов экрана" /></label></div><div className="workflow-form-footer"><span>{stepChanged ? 'Есть несохранённые изменения' : 'Шаг сохранён в состоянии задачи'}</span><button className="button button-secondary" disabled={locked || !stepChanged || !step.trim() || !expectedAction.trim()}>Сохранить шаг</button></div></form>
    </details>

    <div className="workflow-materials-heading"><h3>Материалы задачи</h3><div className="mode-switch" aria-label="Режим генерации материалов"><button type="button" disabled={disabled} aria-pressed={mode === 'live'} className={mode === 'live' ? 'selected' : ''} onClick={() => onModeChange('live')}>Реальная модель</button><button type="button" disabled={disabled} aria-pressed={mode === 'demo'} className={mode === 'demo' ? 'selected' : ''} onClick={() => onModeChange('demo')}>Симуляция</button></div></div>
    {mode === 'demo' && <p className="workflow-mode-note">Симуляция: фиксированный учебный результат без вызова языковой модели.</p>}
    {modelUnavailable && <p className="workflow-mode-note">Сервер не видит API-ключ. Для генерации выберите симуляцию или добавьте ключ в окружение и перезапустите сервер.</p>}
    <div className="workflow-materials">
      <details className="workflow-material" open={workflow.stage === 'planning'}>
        <summary><span className="material-number">01</span><strong>План решения</strong><span className="material-version">{workflow.planVersion ? `Версия ${workflow.planVersion}` : 'Ещё не создан'}</span></summary>
        <div className="workflow-material-body"><label htmlFor="workflow-plan">Что будем делать и в каком порядке</label><textarea id="workflow-plan" value={plan} readOnly rows={6} maxLength={12000} placeholder="Агент подготовит план из памяти задачи и проверит его по инвариантам." /><div className="workflow-material-actions"><button className="button button-primary" disabled={generateDisabled || workflow.stage !== 'planning'} onClick={() => onGenerate('plan')}>Создать план с агентом</button></div><p>Материал создаётся агентом и проверяется по правилам.</p><p>{workflow.stage !== 'planning' ? 'Создание плана доступно на этапе планирования.' : mode === 'live' ? 'Генерация — один платный запрос. План сохранится отдельно от диалога.' : 'Генерация — одна симуляция. План сохранится отдельно от диалога.'}</p></div>
      </details>
      <details className="workflow-material" open={workflow.stage === 'execution'}>
        <summary><span className="material-number">02</span><strong>Результат работы</strong><span className="material-version">{workflow.artifactVersion ? `Версия ${workflow.artifactVersion}` : 'Ещё не создан'}</span></summary>
        <div className="workflow-material-body"><label htmlFor="workflow-artifact">Содержание подготовленного решения</label><textarea id="workflow-artifact" value={artifact} readOnly rows={7} maxLength={16000} placeholder="Агент создаст результат по плану и проверит его по инвариантам." /><div className="workflow-material-actions"><button className="button button-primary" disabled={generateDisabled || workflow.stage !== 'execution'} onClick={() => onGenerate('artifact')}>Выполнить с агентом</button></div><p>Материал создаётся агентом и проверяется по правилам.</p><p>{workflow.stage !== 'execution' ? 'Создание результата доступно на этапе выполнения.' : mode === 'live' ? 'Генерация — один платный запрос. Результат сохранится в задаче.' : 'Генерация — одна симуляция. Результат сохранится в задаче.'}</p></div>
      </details>
      <details className="workflow-material" open={workflow.stage === 'validation' || workflow.stage === 'done'}>
        <summary><span className="material-number">03</span><strong>Обзор агента</strong><span className="material-version">{workflow.review ? `Для версии ${workflow.review.artifactVersion}` : 'Ещё не выполнена'}</span></summary>
        <div className="workflow-material-body">{workflow.review ? <><span className={`status-badge ${workflow.review.mode === 'demo' ? 'status-demo' : ''}`}>{workflow.review.mode === 'demo' ? 'Симуляция обзора' : 'Обзор модели'}</span><div className="workflow-review">{workflow.review.text}</div>{workflow.review.artifactVersion !== workflow.artifactVersion && <p className="workflow-stale-review">Результат изменён. Эта проверка относится к другой версии.</p>}</> : <div className="workflow-review-empty">Агент сопоставит результат с планом и данными задачи. Этот обзор дополняет локальную проверку спецификации, но не разрешает переход к завершению.</div>}<div className="workflow-material-actions"><button className="button button-primary" disabled={generateDisabled || workflow.stage !== 'validation'} onClick={() => onGenerate('review')}>{workflow.review ? 'Повторить обзор' : 'Получить обзор агента'}</button></div><p>{workflow.stage !== 'validation' ? 'Проверка запускается на этапе «Проверка».' : mode === 'live' ? 'Один платный запрос. Для завершения отдельно нажмите «Проверить спецификацию».' : 'Одна симуляция без API; она не оценивает качество реальной моделью.'}</p></div>
      </details>
    </div>
  </section>;
}
