const $ = id => document.getElementById(id);
const status = $('connection'), model = $('model'), prompt = $('prompt'), result = $('result'), send = $('send');
const history = [];
async function refresh() {
  status.className = 'connection'; status.textContent = 'Проверяем LM Studio…'; $('refresh').disabled = true;
  try {
    const r = await fetch('/api/status'); const data = await r.json();
    if (!data.ok) { status.classList.add('bad'); status.textContent = `Нет соединения: ${data.error}`; return; }
    status.classList.add('ok'); status.textContent = `Сервер отвечает · моделей доступно: ${data.models.length}`;
    const selected = model.value; model.replaceChildren(new Option('Автоопределение', ''));
    data.models.forEach(m => model.add(new Option(`${m.name || m.id}${m.quantization ? ` · ${m.quantization}` : ''}`, m.id))); if ([...model.options].some(o => o.value === selected)) model.value = selected; else if (data.models.length) model.value = data.models[0].id;
  } catch { status.classList.add('bad'); status.textContent = 'Не удалось проверить локальный сервер.'; }
  finally { $('refresh').disabled = false; }
}
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { prompt.value = button.dataset.prompt; $('level').textContent = button.dataset.level; }));
$('refresh').addEventListener('click', refresh);
send.addEventListener('click', async () => {
  if (!prompt.value.trim()) { result.textContent = 'Сначала введите вопрос.'; return; }
  send.disabled = true; result.textContent = 'Модель формирует ответ…';
  try { const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompt.value, model: model.value }) }); const data = await r.json(); if (!r.ok) throw Error(data.error); result.textContent = `${data.answer}\n\nМодель: ${data.model} · ${data.elapsedMs} мс${data.usage?.completion_tokens ? ` · выходных токенов: ${data.usage.completion_tokens}` : ''}`; history.push({ level: $('level').textContent, model: data.model, prompt: prompt.value, answer: data.answer, elapsedMs: data.elapsedMs, usage: data.usage, completedAt: new Date().toISOString() }); $('count').textContent = `Выполнено запросов: ${history.length}`; }
  catch (error) { result.textContent = `Ошибка: ${error.message}`; }
  finally { send.disabled = false; }
});
$('export').addEventListener('click', () => { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), requests: history }, null, 2)], { type: 'application/json' }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'day-26-local-llm-results.json' }); a.click(); URL.revokeObjectURL(a.href); });
refresh();
