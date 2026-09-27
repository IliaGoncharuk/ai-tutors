import { useEffect, useState } from 'react';
type Tool = { name: string; description: string; inputSchema: unknown };
type State = { connected: boolean; info: { name: string; version: string } | null; tools: Tool[]; events: { time: string; method: string; detail: string }[] };
export function App() {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function refresh() { const response = await fetch('/api/state'); if (!response.ok) throw new Error('Сайт недоступен.'); setState(await response.json()); }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  async function act(action: string) {
    setBusy(true); setError('');
    try { const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setState(data); }
    catch (e) { setError((e as Error).message); await refresh().catch(() => {}); } finally { setBusy(false); }
  }
  return <div className="shell">
    <aside><a className="brand" href="/">Т<span>·</span>ЛАБ</a><div className="series">MCP / ЯНДЕКС ТРЕКЕР</div><nav>{[16,17,18,19,20].map((day,i) => <div className={day === 16 ? 'nav-item active' : 'nav-item'} key={day}><span>{day}</span>{['Подключение','Первый инструмент','Расписание','Цепочка','Оркестрация'][i]}</div>)}</nav><div className="aside-note">Учебная лаборатория<br/>Каждый день — отдельное приложение</div></aside>
    <main><header><span className="eyebrow">ДЕНЬ 16 / ОСНОВЫ ПРОТОКОЛА</span><span className="local"><i/> Локальное приложение</span></header>
      <section className="hero"><div><h1>Знакомство<br/>с инструментами</h1><p>Установите MCP-соединение и посмотрите, какие действия сервер предлагает приложению.</p></div><div className="hero-number">16<span>/20</span></div></section>
      <section className="panel connection"><div><span className={'badge ' + (state?.connected ? 'good' : '')}>{state?.connected ? 'Соединение установлено' : 'Ожидает подключения'}</span><h2>{state?.info?.name ?? 'Сервер Трекера'}</h2><p>Отдельный процесс · транспорт stdio · {state?.tools.length ?? 0} инструментов</p></div><div className="actions"><button disabled={busy || state?.connected} onClick={() => act('connect')}>{busy ? 'Подождите…' : 'Подключить сервер'}</button><button className="secondary" disabled={busy || !state?.connected} onClick={() => act('disconnect')}>Отключить</button></div></section>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="flow"><span>Приложение</span><b>→ initialize →</b><span>MCP-сервер</span><b>→ tools/list →</b><span>Каталог инструментов</span></div>
      <div className="columns"><section className="panel"><div className="section-title"><h2>Доступные инструменты</h2><button className="text-button" disabled={busy || !state?.connected} onClick={() => act('tools')}>Обновить список ↻</button></div>{!state?.tools.length && <div className="empty"><strong>Сначала установите соединение</strong><p>Названия, описания и параметры придут от MCP-сервера.</p></div>}{state?.tools.map(tool => <article className="tool" key={tool.name}><span className="badge good">Только чтение</span><h3>{tool.name}</h3><p>{tool.description}</p><details><summary>Входные параметры · JSON Schema</summary><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details></article>)}</section>
      <section className="panel"><h2>Журнал соединения</h2><p className="muted">Настоящие сообщения клиента, без API-ключей.</p><ol className="timeline">{state?.events.map((event,i) => <li key={i}><small>{new Date(event.time).toLocaleTimeString('ru-RU')}</small><strong>{event.method}</strong><p>{event.detail}</p></li>)}</ol>{!state?.events.length && <p className="muted">Здесь появятся этапы подключения.</p>}</section></div>
      <footer>Что проверяем: соединение установлено → сервер представился → список инструментов получен.<br/>На этом этапе API Трекера и языковая модель не вызываются.</footer>
    </main></div>;
}
