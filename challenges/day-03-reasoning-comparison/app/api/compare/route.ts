import { env } from 'cloudflare:workers';
import OpenAI from 'openai';

import {
  ALLOWED_MODELS,
  EXPERTS_PROMPT,
  META_PROMPT_REQUEST,
  METHOD_META,
  PROBLEM,
  REFERENCE_ANSWER,
  STEP_BY_STEP_PROMPT,
  assessAnswer,
  emptyAssessment,
  summarize,
  type AllowedModel,
  type MethodId,
  type MethodResult,
  type Usage,
} from '@/lib/experiment';

type RequestBody = { model?: unknown };
type Completion = { text: string; usage: Usage; durationMs: number };

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function publicError(error: unknown): string {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number(error.status)
      : 0;
  if (status === 401) return 'OpenAI отклонил API-ключ.';
  if (status === 429)
    return 'OpenAI ограничил частоту запросов или исчерпан баланс API.';
  if (status === 400) return 'Модель не приняла параметры запроса.';
  return 'Не удалось получить ответ от OpenAI.';
}

export async function POST(request: Request) {
  const apiKey =
    (env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY ??
    process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          'Переменная OPENAI_API_KEY недоступна серверу. Перезапустите терминал после её добавления.',
      },
      { status: 503 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json(
      { error: 'Тело запроса должно быть JSON.' },
      { status: 400 },
    );
  }
  if (
    typeof body.model !== 'string' ||
    !ALLOWED_MODELS.includes(body.model as AllowedModel)
  ) {
    return Response.json(
      { error: 'Выберите модель из списка.' },
      { status: 400 },
    );
  }

  const model = body.model as AllowedModel;
  const client = new OpenAI({ apiKey });
  const complete = async (
    input: string,
    maxOutputTokens = 900,
  ): Promise<Completion> => {
    const started = Date.now();
    const response = await client.responses.create({
      model,
      instructions:
        'Отвечай на русском языке. Не используй внешние инструменты.',
      input,
      temperature: 0.2,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: 'none' },
      store: false,
    });
    const text = response.output_text?.trim();
    if (!text) {
      const reason = response.incomplete_details?.reason;
      throw new Error(
        reason ? `Ответ не завершён: ${reason}` : 'Модель не вернула текст.',
      );
    }
    return {
      text,
      durationMs: Date.now() - started,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  };

  const failed = (
    id: MethodId,
    prompt: string,
    error: unknown,
    durationMs: number,
    partial: { calls?: number; usage?: Usage; generatedPrompt?: string } = {},
  ): MethodResult => ({
    id,
    ...METHOD_META[id],
    ...partial,
    prompt,
    status: 'error',
    error:
      error instanceof Error && error.message.startsWith('Ответ не завершён')
        ? error.message
        : publicError(error),
    durationMs,
    usage: partial.usage ?? ZERO_USAGE,
    assessment: emptyAssessment(id),
  });

  const single = async (
    id: MethodId,
    prompt: string,
  ): Promise<MethodResult> => {
    const started = Date.now();
    try {
      const completion = await complete(prompt);
      return {
        id,
        ...METHOD_META[id],
        prompt,
        status: 'completed',
        text: completion.text,
        durationMs: completion.durationMs,
        usage: completion.usage,
        assessment: assessAnswer(id, completion.text),
      };
    } catch (error) {
      return failed(id, prompt, error, Date.now() - started);
    }
  };

  const meta = async (): Promise<MethodResult> => {
    const started = Date.now();
    let calls = 0;
    let generatedPrompt: string | undefined;
    let usage = ZERO_USAGE;
    try {
      calls += 1;
      const generated = await complete(META_PROMPT_REQUEST, 600);
      generatedPrompt = generated.text;
      usage = addUsage(usage, generated.usage);
      calls += 1;
      const solved = await complete(generated.text);
      usage = addUsage(usage, solved.usage);
      return {
        id: 'metaPrompt',
        ...METHOD_META.metaPrompt,
        prompt: META_PROMPT_REQUEST,
        generatedPrompt,
        status: 'completed',
        text: solved.text,
        durationMs: Date.now() - started,
        usage,
        assessment: assessAnswer('metaPrompt', solved.text),
      };
    } catch (error) {
      return failed(
        'metaPrompt',
        META_PROMPT_REQUEST,
        error,
        Date.now() - started,
        {
          calls,
          usage,
          generatedPrompt,
        },
      );
    }
  };

  const results = await Promise.all([
    single('direct', PROBLEM),
    single('stepByStep', STEP_BY_STEP_PROMPT),
    meta(),
    single('experts', EXPERTS_PROMPT),
  ]);

  return Response.json({
    model,
    problem: PROBLEM,
    expectedAnswer: REFERENCE_ANSWER,
    results,
    summary: summarize(results),
  });
}
