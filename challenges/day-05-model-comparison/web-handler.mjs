import { createExperiment, executeExperiment } from './core.mjs';

export function createWebHandler({ getApiKey, execute = executeExperiment }) {
  let active = false;
  return async function handle(request) {
    const url = new URL(request.url);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || request.headers.get('origin') !== url.origin) {
      return Response.json({ error: 'Запуск доступен только со страницы локальной лаборатории.' }, { status: 403 });
    }
    if (active) return Response.json({ error: 'Одна серия уже выполняется.' }, { status: 409 });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
    if (!body || body.confirmPaidRun !== true || Object.keys(body).length !== 1) {
      return Response.json({ error: 'Запуск требует подтверждения расходов; параметры эксперимента фиксированы.' }, { status: 400 });
    }
    const apiKey = getApiKey();
    if (!apiKey?.trim()) return Response.json({ error: 'OPENAI_API_KEY недоступен серверу. Перезапустите сервер после добавления ключа.' }, { status: 503 });
    // Another request may have acquired the lock while this body was read.
    if (active) return Response.json({ error: 'Одна серия уже выполняется.' }, { status: 409 });
    active = true;
    const abort = new AbortController();
    const encoder = new TextEncoder();
    const experiment = createExperiment();
    const onAbort = () => abort.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) abort.abort();
    const stream = new ReadableStream({
      async start(controller) {
        const send = value => { if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
        try {
          send(experiment);
          await execute({ apiKey, experiment, signal: abort.signal, onProgress: send });
        } catch {
          experiment.status = 'failed'; experiment.error = 'Серия прервана. Полученные ответы остаются на странице до её обновления или закрытия.';
          send(experiment);
        } finally {
          active = false; request.signal.removeEventListener('abort', onAbort);
          if (!abort.signal.aborted) controller.close();
        }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  };
}
