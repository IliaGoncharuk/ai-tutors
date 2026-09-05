import { SCENARIOS, createExperiment, executeExperiment } from './core.mjs';

export function createWebHandler({ getApiKey, execute = executeExperiment }) {
  let active = false;
  return async function handle(request) {
    const url = new URL(request.url);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || request.headers.get('origin') !== url.origin) {
      return Response.json({ error: 'Запуск доступен только со страницы локальной лаборатории.' }, { status: 403 });
    }
    if (active) return Response.json({ error: 'Одна серия уже выполняется. Дождитесь её завершения.' }, { status: 409 });
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
    if (!body || typeof body.scenarioId !== 'string' || !Object.hasOwn(SCENARIOS, body.scenarioId)) {
      return Response.json({ error: 'Выберите сценарий из списка.' }, { status: 400 });
    }
    const apiKey = getApiKey();
    if (!apiKey?.trim()) return Response.json({ error: 'OPENAI_API_KEY недоступен серверу. Перезапустите сервер после добавления ключа.' }, { status: 503 });
    active = true;
    const abort = new AbortController();
    const encoder = new TextEncoder();
    const experiment = createExperiment(body.scenarioId);
    const stream = new ReadableStream({
      async start(controller) {
        const send = value => {
          if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
        };
        try {
          send(experiment);
          const result = await execute({ apiKey, scenarioId: body.scenarioId, experiment,
            signal: abort.signal, onProgress: snapshot => send(snapshot),
          });
          send(result);
        } catch {
          experiment.status = 'failed';
          experiment.error = 'Серия прервана. Полученные ответы доступны для экспорта.';
          send(experiment);
        } finally {
          active = false;
          if (!abort.signal.aborted) controller.close();
        }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  };
}
