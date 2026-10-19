const $ = id => document.getElementById(id);
const names = ['Ассистент разработчика', 'Ревью кода', 'Поддержка пользователей', 'Работа с файлами', 'Подготовка релиза'];
let state, latest, savedRuns = [], savedIndex = 0;
async function api(path, body) { const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Ошибка сервера'); return data; }
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
function budget(value) { if (!value) return; $('budget').textContent = `$${value.spent.toFixed(4)} / $1`; $('reserve').textContent = `Вызовов: ${value.calls} · резерв $${value.reserved.toFixed(4)}`; }
function detail(title, content, parent) { const item = element('details'); item.append(element('summary', title)); item.append(element('pre', typeof content === 'string' ? content : JSON.stringify(content, null, 2))); parent.append(item); }
function markdown(text, parent) {
  parent.replaceChildren(); let code = null, list = null;
  function inline(node, value) { for (const part of value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) node.append(part.startsWith('**') ? element('strong', part.slice(2, -2)) : part.startsWith('`') ? element('code', part.slice(1, -1)) : document.createTextNode(part)); }
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { if (code) { parent.append(code); code = null; } else code = element('pre'); list = null; continue; }
    if (code) { code.textContent += `${line}\n`; continue; }
    if (!line.trim()) { list = null; continue; }
    const heading = line.match(/^#{1,6} (.+)$/), bullet = line.match(/^(?:[-*]|\d+\.) (.+)$/);
    if (bullet) { if (!list) { list = element('ul'); parent.append(list); } const item = element('li'); inline(item, bullet[1]); list.append(item); }
    else { list = null; const node = element(heading ? 'h3' : 'p'); inline(node, heading ? heading[1] : line); parent.append(node); }
  }
  if (code) parent.append(code);
}
function render(result, saved = false) {
  if (saved && result.question) $('question').value = result.question;
  if (saved && result.ticketId && $('ticket')) $('ticket').value = result.ticketId;
  latest = result; $('empty').hidden = true; $('result').hidden = false; markdown(result.answer || result.summary || result.text || '', $('answer'));
  $('result-badge').textContent = saved ? 'Сохранённый результат' : 'Выполнено';
  const sources = result.context || []; $('source-count').textContent = sources.length; $('sources').replaceChildren();
  for (const [i, c] of sources.entries()) detail(`S${i + 1} · ${c.source}:${c.start || 1}${c.end ? `–${c.end}` : ''}`, c.text, $('sources'));
  if (!sources.length) $('sources').append(element('p', 'Поиск по документам не использовался', 'empty small'));
  $('tools').replaceChildren();
  const events = result.events || result.project?.events || [];
  for (const event of events) { const div = element('div', event.name || event.command || event.title || 'Операция', 'tool-event'); if (event.status) div.append(element('small', event.status)); $('tools').append(div); detail('Вход и результат', event, $('tools')); }
  if (!events.length) $('tools').append(element('p', 'MCP-инструменты не вызывались', 'empty small'));
  $('special').replaceChildren();
  if (result.findings) for (const finding of result.findings) { const div = element('div', undefined, 'finding'); div.append(element('strong', `${finding.severity || ''} ${finding.title}`)); div.append(element('small', `${finding.file}:${finding.line}`)); div.append(element('p', finding.explanation)); if (finding.recommendation) div.append(element('p', finding.recommendation)); $('special').append(div); }
  for (const key of ['diff', 'checks', 'files', 'releaseNotes', 'warnings', 'verification']) if (result[key] !== undefined) detail({ diff: 'Подготовленный diff', checks: 'Проверки', files: 'Файлы', releaseNotes: 'Черновик release notes', warnings: 'Ограничения', verification: 'Проверка результата' }[key], result[key], $('special'));
  $('metrics').textContent = [result.model, result.usage ? `${result.usage.input_tokens} вх. / ${result.usage.output_tokens} вых. токенов` : '', result.elapsedMs ? `${(result.elapsedMs / 1000).toFixed(1)} с` : '', result.citations?.note].filter(Boolean).join(' · ');
}
function field(label, id, choices) { const wrap = element('div'); const caption = element('label', label); caption.htmlFor = id; const select = element('select'); select.id = id; for (const option of choices) { const node = element('option', option.label || option); node.value = option.value || option; select.append(node); } wrap.append(caption, select); $('extra-controls').append(wrap); return select; }
function controls() {
  if (state.day === 32) { const label = element('label', 'Открыть JSON-отчёт из GitHub Actions'); const input = element('input'); input.type = 'file'; input.accept = '.json,application/json'; input.onchange = () => action(async () => { const report = JSON.parse(await input.files[0].text()); if (!Array.isArray(report.findings) || !Array.isArray(report.context)) throw new Error('Нужен review.json из артефакта'); render(report, true); }, 'Читаю локальный отчёт…'); label.append(input); $('extra-controls').append(label); }
  if (state.tickets) field('Контекст тикета', 'ticket', state.tickets.map(t => ({ value: t.id, label: `${t.id} · ${t.subject}` })));
  if (state.scenarios) field('Сценарий', 'scenario', state.scenarios);
  if (state.reviewFixtures) field('Источник diff', 'fixture', state.reviewFixtures);
}
async function refresh(initial = false) {
  state = await api('/api/state'); budget(state.budget); $('connection').textContent = state.cloudConfigured ? '● API-ключ доступен серверу' : '○ Просмотр без ключа';
  $('day-label').textContent = `ДЕНЬ ${state.day} / ПРИКЛАДНОЙ AI`; $('title').textContent = state.title; $('subtitle').textContent = state.subtitle; document.title = `День ${state.day} — ${state.title}`;
  $('index-info').textContent = state.index ? `${state.index.documents} документов · ${state.index.chunks} фрагментов` : 'Индекс ещё не создан';
  if (state.noIndex) { $('index').hidden = true; $('index-info').textContent = 'Свежий контекст выбранного проекта'; }
  if (initial) {
    $('navigation').replaceChildren(); for (let i = 0; i < 5; i++) { const a = element('a'); a.href = `http://127.0.0.1:${3031 + i}`; if (state.day === 31 + i) a.className = 'active'; a.append(element('span', 31 + i), element('div', names[i])); $('navigation').append(a); }
    $('examples').replaceChildren(); for (const example of state.examples) { const button = element('button', example); button.type = 'button'; button.onclick = () => { $('question').value = example; $('question').focus(); }; $('examples').append(button); }
    $('question').value = state.examples[0] || ''; controls(); if (state.latest) render(state.latest, true);
  }
}
async function action(fn, message) { const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true); status(message); try { await fn(); await refresh(); status('Готово'); } catch (error) { status(error.message, true); } finally { buttons.forEach(b => b.disabled = false); } }
$('index').onclick = () => action(async () => { const data = await api('/api/index', {}); budget(data.budget); }, 'Обновляю индекс. Новые эмбеддинги используют общий бюджет…');
$('task-form').onsubmit = event => { event.preventDefault(); action(async () => { const body = { question: $('question').value }; for (const key of ['ticket', 'scenario', 'fixture']) if ($(key)) body[key] = $(key).value; const data = await api('/api/run', body); render(data.result); budget(data.budget); }, 'Ассистент работает. Обычно это занимает несколько секунд…'); };
$('example').onclick = () => action(async () => { if (!savedRuns.length) { const data = await api('/api/example'); savedRuns = data.runs || [data.result || data]; } render(savedRuns[savedIndex % savedRuns.length], true); savedIndex++; if (savedRuns.length > 1) $('example').textContent = 'Следующий сохранённый пример (' + (savedIndex % savedRuns.length + 1) + '/' + savedRuns.length + ')'; }, 'Загружаю сохранённый результат без нового API-вызова…');
$('download').onclick = () => { if (!latest) return; const url = URL.createObjectURL(new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' })); const a = element('a'); a.href = url; a.download = `day-${state.day}-result.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
refresh(true).catch(error => status(error.message, true));
