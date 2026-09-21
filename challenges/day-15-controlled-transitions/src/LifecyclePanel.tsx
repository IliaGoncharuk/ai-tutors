import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Gates, Stage, Workflow } from './WorkflowPanel';
import './lifecycle.css';

type Props = {
  workflow: Workflow;
  gates: Gates;
  disabled: boolean;
  actionError: string;
  onAction: (action: { type: string; [key: string]: unknown }) => Promise<void>;
};
const stageNames: Record<Stage, string> = { planning: 'Планирование', execution: 'Выполнение', validation: 'Проверка', done: 'Готово' };

export default function LifecyclePanel({ workflow, gates, disabled, actionError, onAction }: Props) {
  const [target, setTarget] = useState<Stage>('done');
  const [attempted, setAttempted] = useState(false);
  const locked = disabled || workflow.paused;
  const hasPlan = workflow.planVersion > 0 && Boolean(workflow.plan);
  const planCurrent = hasPlan && workflow.planRequirementsVersion === workflow.requirementsVersion;
  const planApproved = planCurrent && workflow.approvedPlanVersion === workflow.planVersion && workflow.approvedRequirementsVersion === workflow.requirementsVersion;
  const artifactCurrent = planApproved && workflow.artifactVersion > 0 && Boolean(workflow.artifact) && workflow.artifactPlanVersion === workflow.planVersion && workflow.artifactRequirementsVersion === workflow.requirementsVersion;
  const validationCurrent = workflow.validation !== null && workflow.validation.planVersion === workflow.planVersion && workflow.validation.artifactVersion === workflow.artifactVersion && workflow.validation.requirementsVersion === workflow.requirementsVersion;
  const validated = artifactCurrent && validationCurrent && Boolean(workflow.validation?.passed);

  function attempt(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setAttempted(true);
    void onAction({ type: 'transition', target });
  }

  return <div className="lifecycle-panel">
    <div className="lifecycle-heading"><h3>Условия продвижения</h3><span>Требования · версия {workflow.requirementsVersion}</span></div>
    <div className="lifecycle-checkpoints">
      <article className={planApproved ? 'checkpoint-ready' : ''}><span className="checkpoint-icon">{planApproved ? '✓' : '01'}</span><div><h4>Утверждённый план</h4><p>{planApproved ? `Версия ${workflow.planVersion} утверждена для актуальных требований.` : !hasPlan ? 'Сначала создайте план в материалах задачи.' : !planCurrent ? 'Требования изменились. Создайте новую версию плана.' : `План версии ${workflow.planVersion} готов к вашему утверждению.`}</p><button className="button button-secondary" disabled={locked || workflow.stage !== 'planning' || !planCurrent || planApproved} onClick={() => void onAction({ type: 'approve-plan', planVersion: workflow.planVersion })}>{!hasPlan ? 'План ещё не создан' : planApproved ? `План v${workflow.planVersion} утверждён` : `Утвердить план v${workflow.planVersion}`}</button></div></article>
      <article className={artifactCurrent ? 'checkpoint-ready' : ''}><span className="checkpoint-icon">{artifactCurrent ? '✓' : '02'}</span><div><h4>Актуальный результат</h4><p>{artifactCurrent ? `Спецификация v${workflow.artifactVersion} создана по плану v${workflow.artifactPlanVersion} и требованиям v${workflow.artifactRequirementsVersion}.` : workflow.artifactVersion > 0 ? 'План или требования изменились. Создайте результат заново.' : 'Создайте спецификацию на этапе выполнения.'}</p><span className="checkpoint-detail">Версия результата: {workflow.artifactVersion || '—'}</span></div></article>
      <article className={validated ? 'checkpoint-ready' : ''}><span className="checkpoint-icon">{validated ? '✓' : '03'}</span><div><h4>Пройдена валидация</h4><p>{validated ? 'Локальная проверка пройдена для актуальных версий.' : workflow.validation && !validationCurrent ? 'Сохранённая проверка устарела. Проверьте актуальный результат.' : workflow.validation ? 'Есть непройденные проверки. Исправьте результат.' : 'На этапе проверки запустите проверку спецификации.'}</p><button className="button button-secondary" disabled={locked || workflow.stage !== 'validation' || !artifactCurrent} onClick={() => void onAction({ type: 'validate-task' })}>Проверить спецификацию</button><span className="checkpoint-detail">Локально, без API</span></div></article>
    </div>
    <p className="lifecycle-note">Утверждение относится к конкретной версии плана и требований. Изменения требуют нового утверждения и проверки. Обзор модели не заменяет локальную валидацию.</p>

    {workflow.validation && <div className={`validation-report ${validated ? 'validation-passed' : 'validation-failed'}`}><div><h4>{!validationCurrent ? 'Сохранённая проверка устарела' : workflow.validation.passed ? 'Структурная проверка пройдена' : 'Структурная проверка не пройдена'}</h4><span>План v{workflow.validation.planVersion} · результат v{workflow.validation.artifactVersion} · требования v{workflow.validation.requirementsVersion}</span></div><ul>{workflow.validation.checks.map((check, index) => <li key={`${check.name}-${index}`} className={check.pass ? 'check-passed' : 'check-failed'}><span className="validation-mark" aria-hidden="true">{check.pass ? '✓' : '×'}</span><div><strong>{check.name}</strong><p>{check.detail}</p></div></li>)}</ul><p className="validation-scope">Проверяется сохранённая спецификация. Работа готового приложения и его программные тесты здесь не проверяются.</p></div>}

    <div className="revise-plan-row"><p>Нужен другой подход? Вернитесь к планированию и подготовьте новую версию.</p><button type="button" className="button button-quiet" disabled={locked || workflow.stage === 'planning'} onClick={() => void onAction({ type: 'revise-plan' })}>↶ Пересмотреть план</button></div>

    <div className="transition-probe"><div><span className="eyebrow teal-text">ПОПЫТКА ПЕРЕХОДА</span><h4>Проверьте границы автомата</h4><p>Разрешённый переход будет выполнен. Недопустимый вернёт отказ и сохранит текущий этап.</p></div><form onSubmit={attempt}><label>Целевой этап<select value={target} disabled={disabled} onChange={event => { setTarget(event.target.value as Stage); setAttempted(false); }}>{(Object.keys(stageNames) as Stage[]).map(stage => <option value={stage} key={stage}>{stageNames[stage]} · {stage}</option>)}</select></label><button className="button button-secondary" disabled={disabled}>Проверить переход</button></form><p className={gates[target].allowed ? 'probe-allowed' : 'probe-blocked'}>{gates[target].allowed ? 'Доступно: ' : 'Недоступно: '}{gates[target].reason}</p>{attempted && actionError && <div className="transition-error" role="alert"><strong>Переход отклонён.</strong> {actionError}</div>}</div>
  </div>;
}
