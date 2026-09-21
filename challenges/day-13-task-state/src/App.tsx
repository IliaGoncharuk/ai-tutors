import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import ProfilePanel from './ProfilePanel';
import type { Profile } from './ProfilePanel';
import WorkflowPanel from './WorkflowPanel';
import type { Workflow } from './WorkflowPanel';

type Layer = 'short' | 'work' | 'long';
type Mode = 'live' | 'demo';
type Entry = { id: string; key: string; value: string; source?: string; updatedAt?: string };
type Message = { role: string; content: string };
type Context = { instructions?: unknown; input?: unknown; [key: string]: unknown };
type Usage = Record<string, unknown>;
type Result = { text: string; usage?: Usage | null; context?: Context; mode?: Mode; label?: string };
type AppState = {
  day: number;
  title: string;
  revision: number;
  session: { id: string; taskId: string; messages: Message[] };
  task: { id: string; title: string; entries: Entry[] };
  longTerm: { entries: Entry[] };
  sessions: { id: string; taskId: string; title?: string }[];
  tasks: { id: string; title: string }[];
  events: { at: string; action: string; detail: unknown }[];
  runtime: { model: string; hasApiKey: boolean; dataDirectory: string };
  lastRun: Result | null;
  profile: Profile;
  profiles: Profile[];
  activeProfile: string;
  workflow: Workflow;
};

const layerNames: Record<Layer, string> = { short: 'Диалог', work: 'Задача', long: 'Надолго' };
const questions = [
  'Что мы уже решили о сервисе записи к репетиторам?',
  'Предложи следующий шаг с учётом сохранённых данных.',
];

function Glyph({ kind, size = 20 }: { kind: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-3 2V11.5a9.5 9.5 0 0 1 19 0Z" />,
    layers: <><path d="m12 3 10 5-10 5L2 8l10-5Z" /><path d="m2 12 10 5 10-5M2 16l10 5 10-5" /></>,
    compare: <><rect x="3" y="4" width="7" height="16" rx="2" /><rect x="14" y="4" width="7" height="16" rx="2" /><path d="M6 8h1m10 0h1M6 12h1m10 0h1" /></>,
    history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7" /><path d="M12 7v5l3 2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    book: <><path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" />,
    box: <><rect x="4" y="6" width="16" height="15" rx="2" /><path d="M9 6V3h6v3M4 11h16m-10 0v3h4v-3" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind] ?? paths.layers}</svg>;
}

function display(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '—';
}

function sessionLabel(session: AppState['sessions'][number], index: number, tasks: AppState['tasks']): string {
  const taskTitle = tasks.find(task => task.id === session.taskId)?.title;
  const title = session.title || `Диалог ${index + 1}`;
  return taskTitle && !title.includes(taskTitle) ? `${title} · ${taskTitle}` : title;
}

function tokenValue(usage: Usage | null | undefined, kind: 'input' | 'output' | 'total'): number | null {
  if (!usage) return null;
  const value = usage[`${kind}Tokens`] ?? usage[`${kind}_tokens`] ?? usage[kind];
  if (typeof value === 'number') return value;
  if (kind === 'total') {
    const input = tokenValue(usage, 'input');
    const output = tokenValue(usage, 'output');
    return input === null || output === null ? null : input + output;
  }
  return null;
}

function UsageLine({ usage, mode }: { usage?: Usage | null; mode?: Mode }) {
  if (mode === 'demo') return <span className="usage-line">Симуляция · без вызова модели</span>;
  const total = tokenValue(usage, 'total');
  if (total === null) return <span className="usage-line">Расход токенов не получен</span>;
  return <span className="usage-line">{total.toLocaleString('ru-RU')} токенов · вход {tokenValue(usage, 'input') ?? '—'} · выход {tokenValue(usage, 'output') ?? '—'}</span>;
}

function ContextView({ context }: { context: Context }) {
  return <div className="context-content">
    <div><span className="field-caption">Инструкции</span><pre>{display(context.instructions ?? context)}</pre></div>
    {'input' in context && <div><span className="field-caption">Сообщения запроса</span><pre>{display(context.input)}</pre></div>}
  </div>;
}

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? data.message ?? `Ошибка сервера (${response.status}).`);
  return data as T;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('live');
  const [layers, setLayers] = useState<Layer[]>(['short', 'work', 'long']);
  const [message, setMessage] = useState('');
  const [entryLayer, setEntryLayer] = useState<'work' | 'long'>('work');
  const [entryKey, setEntryKey] = useState('');
  const [entryValue, setEntryValue] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [preview, setPreview] = useState<Context | null>(null);
  const [comparison, setComparison] = useState<Result[]>([]);
  const [comparisonMode, setComparisonMode] = useState<Mode>('live');
  const [comparisonQuestion, setComparisonQuestion] = useState('');
  const [profileComparison, setProfileComparison] = useState<Result[]>([]);
  const [profileComparisonQuestion, setProfileComparisonQuestion] = useState('');
  const [profileComparisonMode, setProfileComparisonMode] = useState<Mode>('live');
  const [profileComparisonSource, setProfileComparisonSource] = useState('');
  const transcript = useRef<HTMLDivElement>(null);
  const busy = Boolean(pending) || !state;
  const modelUnavailable = mode === 'live' && !state?.runtime.hasApiKey;
  const canAsk = !busy && !modelUnavailable && !state?.workflow.paused && Boolean(message.trim());

  useEffect(() => {
    const controller = new AbortController();
    request<AppState>('/api/state', undefined, controller.signal).then(setState).catch((reason: Error) => {
      if (reason.name !== 'AbortError') setError(reason.message);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [state?.session.messages, pending]);

  async function run(label: string, operation: () => Promise<void>) {
    if (pending) return;
    setPending(label);
    setError('');
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выполнить действие.'); }
    finally { setPending(''); }
  }

  async function action(type: string, payload: Record<string, unknown> = {}) {
    await run('Сохраняем изменения', async () => {
      const result = await request<AppState>('/api/action', { type, ...payload });
      setState(result);
      setPreview(null);
      if (type === 'remember') { setEntryKey(''); setEntryValue(''); }
      if (type === 'new-task') { setNewTaskTitle(''); setTaskFormOpen(false); }
      if (type === 'switch-profile') {
        setMessage(''); setEntryKey(''); setEntryValue('');
        setNewTaskTitle(''); setTaskFormOpen(false);
        setComparison([]); setProfileComparison([]);
      }
    });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canAsk) return;
    await run(mode === 'live' ? 'Агент готовит ответ' : 'Выполняем симуляцию', async () => {
      const response = await request<{ state: AppState; result: Result }>('/api/chat', { message: message.trim(), mode, layers });
      setState(response.state);
      setMessage('');
      setPreview(null);
    });
  }

  async function generateWorkflow(kind: 'plan' | 'artifact' | 'review') {
    if (busy || modelUnavailable || state?.workflow.paused) return;
    const labels = { plan: 'Готовим план задачи', artifact: 'Выполняем план задачи', review: 'Проверяем результат задачи' };
    await run(labels[kind], async () => {
      const response = await request<{ state: AppState; result: Result }>('/api/workflow', { kind, mode });
      setState(response.state);
      setPreview(null);
    });
  }

  async function compare() {
    if (!canAsk) return;
    await run(mode === 'live' ? 'Сравниваем четыре варианта памяти' : 'Сравниваем четыре симуляции', async () => {
      const response = await request<{ state: AppState; results: Result[] }>('/api/compare', { message: message.trim(), mode });
      setState(response.state);
      setComparison(response.results);
      setComparisonQuestion(message.trim());
      setComparisonMode(mode);
      window.setTimeout(() => document.getElementById('comparison-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    });
  }

  function toggleLayer(layer: Layer) {
    setLayers(current => current.includes(layer) ? current.filter(item => item !== layer) : [...current, layer]);
    setPreview(null);
  }

  async function compareProfiles() {
    if (!canAsk || !state) return;
    await run(mode === 'live' ? 'Сравниваем три профиля' : 'Сравниваем три симуляции профилей', async () => {
      const response = await request<{ state: AppState; results: Result[] }>('/api/profiles/compare', { message: message.trim(), mode });
      setState(response.state);
      setProfileComparison(response.results);
      setProfileComparisonQuestion(message.trim());
      setProfileComparisonMode(mode);
      setProfileComparisonSource(`${state.task.title} · ${state.profile.name}`);
      window.setTimeout(() => document.getElementById('profile-comparison-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    });
  }

  const messages = state?.session.messages ?? [];
  const workEntries = state?.task.entries ?? [];
  const longEntries = state?.longTerm.entries ?? [];

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#workspace"><span className="brand-symbol"><Glyph kind="layers" size={23} /></span><span>agent<span className="brand-light">lab</span><small>ПРАКТИКА ИИ</small></span></a>
      <div className="sidebar-course"><span className="eyebrow">УЧЕБНАЯ ЛАБОРАТОРИЯ</span><strong>От плана<br />до результата.</strong><p>Сохраняйте этап, шаг<br />и следующее действие.</p></div>
      <nav className="main-nav" aria-label="Разделы лаборатории">
        <a className="nav-active" href="#workspace"><Glyph kind="grid" />Рабочее пространство<span className="nav-dot" /></a>
        <a href="#workflow"><Glyph kind="history" />Состояние задачи</a>
        <a href="#profile"><Glyph kind="book" />Профиль пользователя</a>
        <a href="#memory"><Glyph kind="layers" />Слои памяти</a>
        <a href="#experiment"><Glyph kind="compare" />Эксперимент</a>
        <a href="#history"><Glyph kind="history" />Журнал изменений</a>
      </nav>
      <div className="sidebar-note"><span className="note-icon"><Glyph kind="book" size={18} /></span><strong>Продолжить с того же места</strong><p>Пауза сохраняет задачу. Агент знает, какой шаг идёт следующим.</p></div>
      <div className="sidebar-bottom"><span className="local-dot" /><span>Локальная лаборатория<small>День 13 · Состояние задачи</small></span></div>
    </aside>

    <main className="main-content" id="workspace">
      <header className="topbar"><span>Практика <span className="breadcrumb-slash">/</span> Архитектура агента</span><span className="day-pill">ДЕНЬ <b>13</b></span></header>
      <section className="page-heading">
        <div><div className="eyebrow teal-text">ПРОДОЛЖАТЬ БЕЗ ПОВТОРОВ</div><h1>Состояние задачи<span>.</span></h1><p>План, выполнение, проверка и результат. Поставьте на паузу и продолжите с того же шага.</p></div>
        <button className="button button-secondary sample-button" disabled={busy} onClick={() => void action('seed')}><Glyph kind="bolt" size={17} />Загрузить пример</button>
      </section>

      {error && <div role="alert" className="notice notice-error"><span><strong>Действие не выполнено.</strong> {error}</span><button className="icon-button" aria-label="Закрыть ошибку" onClick={() => setError('')}><Glyph kind="close" size={17} /></button></div>}
      {!state && !error && <div role="status" className="notice">Подключаем локальное хранилище…</div>}

      {state?.workflow && <WorkflowPanel key={`${state.activeProfile}-${state.task.id}`} workflow={state.workflow} disabled={busy} modelUnavailable={modelUnavailable} mode={mode} onModeChange={setMode} onAction={({ type, ...payload }) => action(type, payload)} onGenerate={kind => void generateWorkflow(kind)} />}

      <section className="overview" aria-label="Как устроена память">
        <OverviewCard number="01" icon="chat" name="Краткосрочная" caption="Текущий диалог" count={messages.length} unit="сообщений" tone="teal" />
        <OverviewCard number="02" icon="box" name="Рабочая" caption="Данные текущей задачи" count={workEntries.length} unit="записей" tone="blue" />
        <OverviewCard number="03" icon="book" name="Долговременная" caption="Решения и знания пользователя" count={longEntries.length} unit="записей" tone="amber" />
      </section>

      {state?.profile && <details className="profile-fold"><summary><span>Профиль пользователя</span><strong>{state.profile.name}</strong><small>Учитывается автоматически</small></summary><ProfilePanel profile={state.profile} profiles={state.profiles} disabled={busy} canCompare={canAsk} mode={mode} onAction={({ type, ...payload }) => action(type, payload)} onCompare={() => void compareProfiles()} /></details>}

      <section className="task-strip" aria-label="Текущая задача и диалог">
        <span className="task-symbol"><Glyph kind="box" /></span>
        <div className="task-title"><span className="field-caption">ТЕКУЩАЯ ЗАДАЧА</span><strong>{state?.task.title || 'Новая задача'}</strong></div>
        <div className="task-actions"><button className="button button-quiet" disabled={busy} onClick={() => void action('new-dialog')}><Glyph kind="plus" size={16} />Новый диалог</button><button className="button button-secondary" disabled={busy} aria-expanded={taskFormOpen} onClick={() => setTaskFormOpen(value => !value)}>Новая задача</button></div>
        {taskFormOpen && <form className="new-task-form" onSubmit={event => { event.preventDefault(); if (newTaskTitle.trim()) void action('new-task', { title: newTaskTitle.trim() }); }}><label htmlFor="task-title">Название новой задачи</label><div className="inline-fields"><input id="task-title" autoFocus value={newTaskTitle} onChange={event => setNewTaskTitle(event.target.value)} placeholder="Например: личный кабинет ученика" maxLength={150} disabled={busy} required /><button className="button button-primary" disabled={busy || !newTaskTitle.trim()}>Создать</button></div><p className="hint">Новая задача получит отдельную рабочую память. Долговременные записи останутся доступны.</p></form>}
      </section>

      <div className="workspace-grid">
        <div className="conversation-column">
          <section className="panel chat-panel" aria-labelledby="chat-heading">
            <div className="panel-header"><div><h2 id="chat-heading"><Glyph kind="chat" size={19} />Диалог с агентом</h2><p>Проектируем сервис записи к репетиторам</p></div><span className={`status-badge ${mode === 'demo' ? 'status-demo' : ''}`}><span />{mode === 'demo' ? 'Симуляция' : 'OpenAI API'}</span></div>
            <div className="chat-settings">
              <div className="mode-switch" aria-label="Режим ответа"><button type="button" disabled={busy} aria-pressed={mode === 'live'} className={mode === 'live' ? 'selected' : ''} onClick={() => setMode('live')}>Реальная модель</button><button type="button" disabled={busy} aria-pressed={mode === 'demo'} className={mode === 'demo' ? 'selected' : ''} onClick={() => setMode('demo')}>Симуляция</button></div>
              <span className="model-name">{state?.runtime.model || 'Подключение…'}</span>
            </div>
            {mode === 'demo' && <div className="mode-notice">Учебная симуляция без API. Её ответы не являются результатом работы языковой модели.</div>}
            {modelUnavailable && state && <div className="mode-notice key-notice">API-ключ не найден сервером. Добавьте OPENAI_API_KEY в окружение и перезапустите сервер либо выберите симуляцию.</div>}
            {state?.workflow.paused && <div className="mode-notice">Задача на паузе. Продолжите её в панели состояния, чтобы отправить сообщение агенту.</div>}
            <div className="transcript" ref={transcript} role="log" aria-label="Сообщения диалога" aria-live="polite">
              {messages.length === 0 ? <div className="chat-empty"><span className="empty-art"><Glyph kind="layers" size={35} /><i /><i /></span><h3>Начните с чистого листа</h3><p>Напишите агенту или загрузите учебный пример.<br />Сохранённые факты появятся в слоях справа.</p><span className="empty-label">Ничего не сохраняется надолго без вашего выбора</span></div> : messages.map((item, index) => <article className={`message message-${item.role === 'user' ? 'user' : 'assistant'}`} key={`${state?.session.id}-${index}`}><span className="message-avatar">{item.role === 'user' ? 'ВЫ' : <Glyph kind="layers" size={16} />}</span><div className="message-body"><span className="message-author">{item.role === 'user' ? 'Вы' : 'Агент'}</span><div className="message-text">{item.content}</div></div></article>)}
              {pending.includes('ответ') || pending.includes('симуляцию') ? <div className="thinking" role="status"><span /><span /><span />{pending}…</div> : null}
            </div>
            <form className="composer" onSubmit={event => void send(event)}>
              <div className="layer-selection"><span>Включить в запрос</span>{(['short', 'work', 'long'] as Layer[]).map(layer => <label key={layer} className={layers.includes(layer) ? 'layer-check checked' : 'layer-check'}><input type="checkbox" checked={layers.includes(layer)} disabled={busy} onChange={() => toggleLayer(layer)} /><span className="custom-check">{layers.includes(layer) && <Glyph kind="check" size={11} />}</span>{layerNames[layer]}</label>)}</div>
              <p className="attached-profile"><Glyph kind="check" size={12} />Профиль «{state?.profile?.name ?? '…'}» подключён всегда, в том числе без слоя «Надолго».</p>
              <div className="message-input-wrap"><textarea aria-label="Сообщение агенту" value={message} disabled={busy} onChange={event => { setMessage(event.target.value); setPreview(null); }} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Спросите о проекте или сообщите новую деталь…" rows={3} maxLength={12000} /><button type="submit" className="send-button" disabled={!canAsk} aria-label="Отправить сообщение"><Glyph kind="arrow" size={21} /></button></div>
              <div className="composer-footer"><span>{mode === 'live' ? 'Отправка вызывает платный API' : 'Без платных вызовов'} · Ctrl + Enter</span><button className="text-button" type="button" disabled={busy} onClick={() => void run('Собираем контекст', async () => setPreview(await request<Context>('/api/context', { message: message.trim(), layers })))}><Glyph kind="eye" size={15} />Посмотреть контекст</button></div>
              {messages.length === 0 && <div className="suggestions">{questions.map(question => <button type="button" key={question} disabled={busy} onClick={() => { setMessage(question); setPreview(null); }}>{question}<span>↗</span></button>)}</div>}
            </form>
          </section>
          {preview && <details className="panel context-panel" open><summary><Glyph kind="eye" size={17} />Предпросмотр следующего запроса<span>без вызова API</span></summary><ContextView context={preview} /></details>}
          {state?.lastRun?.context && <details className="panel context-panel"><summary><Glyph kind="eye" size={17} />Последний запрос к агенту<span>контекст и расход</span></summary><div className="last-run-usage"><UsageLine usage={state.lastRun.usage} mode={state.lastRun.mode} /></div><ContextView context={state.lastRun.context} /></details>}
          <section className="panel experiment-panel" id="experiment"><div className="experiment-icon"><Glyph kind="compare" size={23} /></div><div><span className="eyebrow teal-text">МИНИ-ЭКСПЕРИМЕНТ</span><h2>Что изменится без одного слоя?</h2><p>Один вопрос, четыре независимых варианта: вся память и поочерёдное исключение каждого слоя. Введите вопрос в поле диалога и сравните ответы.</p><button className="button button-secondary" disabled={!canAsk} onClick={() => void compare()}><Glyph kind="compare" size={16} />{pending.includes('Сравниваем') ? 'Сравниваем…' : 'Сравнить 4 варианта'}</button><span className="experiment-footnote">{mode === 'live' ? '4 платных запроса к модели' : '4 симуляции, без вызовов API'}</span></div></section>
        </div>

        <aside className="memory-column" id="memory" aria-label="Управление памятью">
          <section className="panel memory-editor"><div className="panel-header"><div><h2><Glyph kind="plus" size={18} />Сохранить в память</h2><p>Выберите факт и место для него</p></div><span className="manual-tag">ВРУЧНУЮ</span></div><form onSubmit={event => { event.preventDefault(); if (entryKey.trim() && entryValue.trim()) void action('remember', { layer: entryLayer, key: entryKey.trim(), value: entryValue.trim() }); }}><div className="save-destination"><label><input type="radio" name="entry-layer" value="work" checked={entryLayer === 'work'} disabled={busy} onChange={() => setEntryLayer('work')} /><span><Glyph kind="box" size={15} />В задачу</span></label><label><input type="radio" name="entry-layer" value="long" checked={entryLayer === 'long'} disabled={busy} onChange={() => setEntryLayer('long')} /><span><Glyph kind="book" size={15} />Надолго</span></label></div><label className="form-label" htmlFor="entry-key">Название факта</label><input id="entry-key" placeholder="Например: длительность занятия" value={entryKey} maxLength={100} onChange={event => setEntryKey(event.target.value)} disabled={busy} required /><label className="form-label" htmlFor="entry-value">Значение</label><textarea id="entry-value" placeholder="Например: 45 минут" value={entryValue} maxLength={4000} onChange={event => setEntryValue(event.target.value)} disabled={busy} required rows={2} /><button className="button button-primary full-width" disabled={busy || !entryKey.trim() || !entryValue.trim()}><Glyph kind="plus" size={16} />Сохранить запись</button><p className="hint">Повторное название обновляет существующую запись.</p></form></section>
          <section className="panel memory-layer short-memory"><div className="memory-heading"><span className="layer-icon teal"><Glyph kind="chat" size={18} /></span><div><h3>Краткосрочная</h3><span>Только текущий диалог</span></div><b>{messages.length}</b></div><p className="layer-description">Сообщения сохраняются автоматически после успешного ответа. Новый диалог начинает этот слой заново.</p><div className="session-select"><label htmlFor="session-picker">Возобновить диалог</label><select id="session-picker" disabled={busy || !state?.sessions.length} value={state?.session.id ?? ''} onChange={event => void action('resume', { sessionId: event.target.value })}>{!state && <option>Подключение…</option>}{state?.sessions.map((session, index) => <option key={session.id} value={session.id}>{sessionLabel(session, index, state.tasks)}</option>)}</select></div></section>
          <MemoryLayer title="Рабочая" subtitle="Для текущей задачи" tone="blue" icon="box" entries={workEntries} empty="Сохраните условия и решения этой задачи." busy={busy} onDelete={id => void action('forget', { layer: 'work', id })} />
          <MemoryLayer title="Долговременная" subtitle="Между задачами и диалогами" tone="amber" icon="book" entries={longEntries} empty="Здесь будут общие знания и устойчивые предпочтения." busy={busy} onDelete={id => void action('forget', { layer: 'long', id })} />
        </aside>
      </div>

      {comparison.length > 0 && <section id="comparison-results" className="comparison-section"><div className="section-heading"><div><div className="eyebrow teal-text">РЕЗУЛЬТАТ ЭКСПЕРИМЕНТА</div><h2>Один вопрос — разная память</h2></div><span className={`status-badge ${comparisonMode === 'demo' ? 'status-demo' : ''}`}>{comparisonMode === 'demo' ? 'Симуляция' : 'Реальные ответы'}</span></div><p className="comparison-question">{comparisonQuestion}</p><div className="comparison-grid">{comparison.map((result, index) => <article className="panel comparison-card" key={index}><div className="comparison-card-title"><span>{String(index + 1).padStart(2, '0')}</span><h3>{({ all: 'Вся память', 'безshort': 'Без диалога', 'безwork': 'Без рабочей памяти', 'безlong': 'Без долговременной памяти' } as Record<string, string>)[result.label ?? ''] ?? result.label ?? ['Вся память', 'Без диалога', 'Без рабочей памяти', 'Без долговременной памяти'][index]}</h3></div><div className="comparison-answer">{result.text}</div><UsageLine usage={result.usage} mode={result.mode ?? comparisonMode} />{result.context && <details className="comparison-context"><summary>Что было в запросе</summary><ContextView context={result.context} /></details>}</article>)}</div></section>}

      {profileComparison.length > 0 && <section id="profile-comparison-results" className="comparison-section">
        <div className="section-heading"><div><div className="eyebrow teal-text">СРАВНЕНИЕ ПЕРСОНАЛИЗАЦИИ</div><h2>Одна задача — три профиля</h2></div><span className={`status-badge ${profileComparisonMode === 'demo' ? 'status-demo' : ''}`}>{profileComparisonMode === 'demo' ? 'Симуляция' : 'Реальные ответы'}</span></div>
        <p className="comparison-question">{profileComparisonQuestion}</p>
        <p className="profile-comparison-baseline">Общая память задачи: {profileComparisonSource}. Диалог начат с чистого листа.</p>
        <div className="comparison-grid profile-comparison-grid">{profileComparison.map((result, index) => <article className="panel comparison-card" key={index}>
          <div className="comparison-card-title"><span>{String(index + 1).padStart(2, '0')}</span><h3>{({ novice: 'Новичок', expert: 'Эксперт', manager: 'Руководитель' } as Record<string, string>)[result.label ?? ''] ?? result.label ?? `Профиль ${index + 1}`}</h3></div>
          <div className="comparison-answer">{result.text}</div>
          <UsageLine usage={result.usage} mode={result.mode ?? profileComparisonMode} />
          {result.context && <details className="comparison-context"><summary>Профиль и контекст запроса</summary><ContextView context={result.context} /></details>}
        </article>)}</div>
      </section>}

      <section className="panel history-panel" id="history"><details><summary><span><Glyph kind="history" size={18} />Журнал изменений</span><span className="history-count">{state?.events.length ?? 0} событий</span></summary><div className="event-list">{!state?.events.length ? <p className="hint">Сохранения, удаления и переключения появятся здесь.</p> : state.events.slice().reverse().map((event, index) => <div className="event-item" key={`${event.at}-${index}`}><time dateTime={event.at}>{new Date(event.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time><div><strong>{event.action}</strong><p>{display(event.detail)}</p></div></div>)}</div></details></section>
      <footer className="page-footer"><span><span className="local-dot" />Данные хранятся локально · ключ доступен только серверу</span><span>День 13 / Состояние задачи</span></footer>
      {pending && <div className="busy-indicator" role="status"><span className="spinner" />{pending}…</div>}
    </main>
  </div>;
}

function OverviewCard({ number, icon, name, caption, count, unit, tone }: { number: string; icon: string; name: string; caption: string; count: number; unit: string; tone: string }) {
  return <article className="overview-card"><div className="overview-top"><span className={`layer-icon ${tone}`}><Glyph kind={icon} size={20} /></span><span className="overview-number">{number}</span></div><h2>{name}</h2><p>{caption}</p><div className="overview-bottom"><strong>{count}</strong><span>{unit}</span><span className={`tiny-line ${tone}`} /></div></article>;
}

function MemoryLayer({ title, subtitle, tone, icon, entries, empty, busy, onDelete }: { title: string; subtitle: string; tone: string; icon: string; entries: Entry[]; empty: string; busy: boolean; onDelete: (id: string) => void }) {
  return <section className="panel memory-layer"><div className="memory-heading"><span className={`layer-icon ${tone}`}><Glyph kind={icon} size={18} /></span><div><h3>{title}</h3><span>{subtitle}</span></div><b>{entries.length}</b></div>{entries.length === 0 ? <p className="memory-empty">{empty}</p> : <div className="memory-entries">{entries.map(entry => <article className="memory-entry" key={entry.id}><div className="entry-heading"><strong>{entry.key}</strong><button className="icon-button delete-button" disabled={busy} title={`Удалить «${entry.key}»`} aria-label={`Удалить «${entry.key}»`} onClick={() => onDelete(entry.id)}><Glyph kind="trash" size={15} /></button></div><p>{entry.value}</p>{entry.source && <span className="entry-source">Источник: {({ user: 'сохранено вручную', example: 'учебный пример', manual: 'сохранено вручную', seed: 'учебный пример' } as Record<string, string>)[entry.source] ?? entry.source}</span>}</article>)}</div>}</section>;
}
