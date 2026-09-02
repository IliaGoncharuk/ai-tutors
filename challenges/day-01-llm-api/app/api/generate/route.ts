import { env } from 'cloudflare:workers';
import OpenAI from 'openai';

const ALLOWED_MODELS = [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];

const TOKEN_RATES_USD: Record<AllowedModel, { input: number; output: number }> = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gpt-5.6-sol': { input: 4, output: 20 },
};

type GenerateRequest = {
  model?: unknown;
  instructions?: unknown;
  prompt?: unknown;
  temperature?: unknown;
  maxOutputTokens?: unknown;
};

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

  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return Response.json({ error: 'Тело запроса должно быть JSON.' }, { status: 400 });
  }

  const validation = validateRequest(body);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const { model, instructions, prompt, temperature, maxOutputTokens } =
    validation.value;

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      model,
      instructions: instructions || undefined,
      input: prompt,
      temperature,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: 'none' },
      store: false,
    });

    const usage = response.usage ?? {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
    const rates = TOKEN_RATES_USD[model];
    const estimatedCostUsd =
      (usage.input_tokens / 1_000_000) * rates.input +
      (usage.output_tokens / 1_000_000) * rates.output;

    return Response.json({
      text: response.output_text || 'Модель не вернула текстовый ответ.',
      model,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens,
      },
      estimatedCostUsd,
      settings: { temperature, maxOutputTokens },
    });
  } catch (error) {
    const status = getStatus(error);
    if (status === 401) {
      return Response.json(
        { error: 'OpenAI отклонил API-ключ. Проверьте OPENAI_API_KEY.' },
        { status: 502 },
      );
    }
    if (status === 429) {
      return Response.json(
        {
          error:
            'OpenAI временно ограничил запросы или исчерпан доступный баланс. Попробуйте позже и проверьте лимиты API.',
        },
        { status: 502 },
      );
    }
    if (status === 400) {
      return Response.json(
        {
          error:
            'Выбранная модель не приняла один из параметров. Попробуйте другую модель или значение температуры.',
        },
        { status: 502 },
      );
    }
    return Response.json(
      { error: 'OpenAI API не ответил. Повторите запрос через несколько секунд.' },
      { status: 502 },
    );
  }
}

function validateRequest(body: GenerateRequest):
  | {
      ok: true;
      value: {
        model: AllowedModel;
        instructions: string;
        prompt: string;
        temperature: number;
        maxOutputTokens: number;
      };
    }
  | { ok: false; error: string } {
  if (
    typeof body.model !== 'string' ||
    !ALLOWED_MODELS.includes(body.model as AllowedModel)
  ) {
    return { ok: false, error: 'Выберите модель из списка.' };
  }
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return { ok: false, error: 'Введите запрос для модели.' };
  }
  if (body.prompt.length > 8000) {
    return { ok: false, error: 'Запрос не должен превышать 8000 символов.' };
  }
  if (
    typeof body.instructions !== 'string' ||
    body.instructions.length > 2000
  ) {
    return {
      ok: false,
      error: 'Инструкция не должна превышать 2000 символов.',
    };
  }
  if (
    typeof body.temperature !== 'number' ||
    !Number.isFinite(body.temperature) ||
    body.temperature < 0 ||
    body.temperature > 2
  ) {
    return { ok: false, error: 'Температура должна быть от 0 до 2.' };
  }
  if (
    typeof body.maxOutputTokens !== 'number' ||
    !Number.isInteger(body.maxOutputTokens) ||
    body.maxOutputTokens < 64 ||
    body.maxOutputTokens > 4096
  ) {
    return { ok: false, error: 'Лимит ответа должен быть от 64 до 4096.' };
  }

  return {
    ok: true,
    value: {
      model: body.model as AllowedModel,
      instructions: body.instructions.trim(),
      prompt: body.prompt.trim(),
      temperature: body.temperature,
      maxOutputTokens: body.maxOutputTokens,
    },
  };
}

function getStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status;
  }
  return undefined;
}
