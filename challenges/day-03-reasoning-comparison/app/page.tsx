'use client';

import {
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  Download,
  FlaskConical,
  Play,
  Route,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import {
  ALLOWED_MODELS,
  METHOD_META,
  PROBLEM,
  buildMarkdownReport,
  type AllowedModel,
  type ExperimentResponse,
  type MethodId,
  type MethodResult,
} from '@/lib/experiment';

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: {
          name: string;
          title?: string;
          description: string;
          inputSchema: object;
          annotations?: {
            readOnlyHint?: boolean;
            untrustedContentHint?: boolean;
          };
          execute: (input: unknown) => Promise<unknown>;
        },
        options?: { signal?: AbortSignal },
      ) => void | Promise<void>;
    };
  }
}

const blocked = new Set(['2-2', '3-4', '4-2']);
const orderedMethods: MethodId[] = [
  'direct',
  'stepByStep',
  'metaPrompt',
  'experts',
];

async function requestExperiment(
  model: AllowedModel,
): Promise<ExperimentResponse> {
  const response = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  const body = (await response.json()) as ExperimentResponse & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? 'Не удалось запустить сравнение.');
  return body;
}

function EmptyCard({ id, index }: { id: MethodId; index: number }) {
  const meta = METHOD_META[id];
  return (
    <Card className="min-h-64 border-dashed bg-card/55 shadow-none">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <span className="font-mono text-xs font-semibold text-primary">
            0{index + 1}
          </span>
          <Badge variant="outline">—</Badge>
        </div>
        <CardTitle>{meta.title}</CardTitle>
        <CardDescription>{meta.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 opacity-45" aria-hidden="true">
          <span className="block h-2.5 w-full rounded-full bg-muted" />
          <span className="block h-2.5 w-5/6 rounded-full bg-muted" />
          <span className="block h-2.5 w-2/3 rounded-full bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}

function ResultCard({
  result,
  index,
}: {
  result: MethodResult;
  index: number;
}) {
  const ok = result.status === 'completed' && result.assessment.correct;
  return (
    <Card className="min-h-80 bg-card shadow-[0_12px_36px_-28px_var(--foreground)]">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <span className="font-mono text-xs font-semibold text-primary">
            0{index + 1}
          </span>
          {result.status === 'error' ? (
            <Badge variant="destructive">
              <XCircle /> Ошибка
            </Badge>
          ) : ok ? (
            <Badge className="bg-emerald-700 text-white">
              <CheckCircle2 /> Верно
            </Badge>
          ) : (
            <Badge variant="destructive">
              <XCircle /> Не совпало
            </Badge>
          )}
        </div>
        <CardTitle>{result.title}</CardTitle>
        <CardDescription>{result.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {result.status === 'completed' ? (
          <div className="whitespace-pre-wrap text-sm leading-6 text-card-foreground">
            {result.text}
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Ответ не получен</AlertTitle>
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        )}

        <div className="mt-auto rounded-lg bg-secondary/65 px-3 py-2 text-xs leading-5 text-secondary-foreground">
          {result.assessment.note}
        </div>

        <details className="group border-t pt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-semibold text-foreground">
            Показать промпт и метрики
          </summary>
          <div className="mt-3 space-y-3">
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-foreground p-3 font-mono text-[11px] leading-5 text-background">
              {result.prompt}
            </pre>
            {result.generatedPrompt && (
              <div>
                <p className="mb-1 font-semibold text-foreground">
                  Промпт, созданный моделью
                </p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-3 font-mono text-[11px] leading-5 text-foreground">
                  {result.generatedPrompt}
                </pre>
              </div>
            )}
            <p>
              {result.calls} API-вызов(а) · {result.usage.inputTokens} вход /{' '}
              {result.usage.outputTokens} выход · {result.durationMs} мс
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const [model, setModel] = useState<AllowedModel>('gpt-5.6-luna');
  const [data, setData] = useState<ExperimentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (chosenModel: AllowedModel = model) => {
      setModel(chosenModel);
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const result = await requestExperiment(chosenModel);
        setData(result);
        return {
          model: result.model,
          completed: result.summary.completedCount,
          correct: result.summary.correctMethodCount,
          conclusion: result.summary.conclusion,
        };
      } catch (runError) {
        const message =
          runError instanceof Error ? runError.message : 'Неизвестная ошибка.';
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [model],
  );

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'run_reasoning_comparison',
          title: 'Запустить сравнение рассуждений',
          description:
            'Выполняет пять платных вызовов OpenAI API, показывает четыре решения одной задачи и их проверку.',
          inputSchema: {
            type: 'object',
            properties: {
              model: { type: 'string', enum: [...ALLOWED_MODELS] },
            },
            required: ['model'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          execute: async (input) => {
            const candidate = (input as { model?: unknown })?.model;
            if (
              typeof candidate !== 'string' ||
              !ALLOWED_MODELS.includes(candidate as AllowedModel)
            ) {
              throw new Error(
                'Модель должна быть выбрана из разрешённого списка.',
              );
            }
            return run(candidate as AllowedModel);
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, [run]);

  const download = () => {
    if (!data) return;
    const blob = new Blob([buildMarkdownReport(data)], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `day-03-${data.model}-report.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen pb-20">
      <header className="border-b border-border/80 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground">
              <BrainCircuit className="size-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                AI Challenge · День 03
              </p>
              <p className="font-heading text-sm font-semibold">
                Лаборатория рассуждений
              </p>
            </div>
          </div>
          <Badge variant="outline" className="hidden sm:inline-flex">
            5 API-вызовов
          </Badge>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 sm:pt-12">
        <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
          <div>
            <Badge className="mb-5 bg-accent text-accent-foreground">
              Эксперимент 01
            </Badge>
            <h1 className="max-w-3xl font-heading text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-6xl">
              Одна задача.
              <span className="block text-primary">Четыре хода мысли.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Сравните прямой ответ, пошаговое решение, метапромпт и независимые
              выводы трёх экспертов — на одной модели и с одинаковыми
              ограничениями.
            </p>

            <div className="mt-8 flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-end">
              <label className="flex-1 text-sm font-medium" htmlFor="model">
                <span className="mb-2 block text-muted-foreground">
                  Модель для всех способов
                </span>
                <NativeSelect
                  className="w-full"
                  id="model"
                  aria-label="Модель"
                  value={model}
                  disabled={loading}
                  onChange={(event) =>
                    setModel(event.target.value as AllowedModel)
                  }
                >
                  <NativeSelectOption value="gpt-5.6-luna">
                    gpt-5.6-luna · экономичная
                  </NativeSelectOption>
                  <NativeSelectOption value="gpt-5.6-terra">
                    gpt-5.6-terra · сбалансированная
                  </NativeSelectOption>
                  <NativeSelectOption value="gpt-5.6-sol">
                    gpt-5.6-sol · максимальная
                  </NativeSelectOption>
                </NativeSelect>
              </label>
              <Button
                size="lg"
                className="h-10 px-5"
                disabled={loading}
                onClick={() => void run().catch(() => undefined)}
              >
                {loading ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Play data-icon="inline-start" />
                )}
                {loading ? 'Модели решают…' : 'Запустить сравнение'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Нажатие выполняет пять платных запросов. Ответы не сохраняются
              сервером.
            </p>
          </div>

          <Card className="border-0 bg-foreground text-background shadow-[0_24px_60px_-28px_color-mix(in_oklch,var(--foreground),transparent_45%)]">
            <CardHeader>
              <div className="mb-3 flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-full bg-background/10">
                  <Route className="size-4" />
                </span>
                <span className="font-mono text-xs text-background/60">
                  ЭТАЛОН: 10
                </span>
              </div>
              <CardTitle className="text-xl">Задача о маршрутах</CardTitle>
              <CardDescription className="leading-6 text-background/65">
                {PROBLEM}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="grid grid-cols-5 gap-1.5"
                aria-label="Сетка задачи 5 на 5"
              >
                {Array.from({ length: 25 }, (_, index) => {
                  const row = Math.floor(index / 5) + 1;
                  const column = (index % 5) + 1;
                  const isBlocked = blocked.has(`${row}-${column}`);
                  const isEndpoint = index === 0 || index === 24;
                  return (
                    <span
                      key={index}
                      title={
                        isBlocked
                          ? `Клетка (${row},${column}) заблокирована`
                          : `Клетка (${row},${column})`
                      }
                      className={`grid aspect-square place-items-center rounded-md border text-xs font-semibold ${isBlocked ? 'border-background/5 bg-background/15 text-background/35' : isEndpoint ? 'border-accent bg-accent text-accent-foreground' : 'border-background/15 bg-background/5 text-background/45'}`}
                    >
                      {isBlocked
                        ? '×'
                        : index === 0
                          ? 'S'
                          : index === 24
                            ? 'F'
                            : ''}
                    </span>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>

        {error && (
          <Alert variant="destructive" className="mt-8 bg-card">
            <AlertCircle />
            <AlertTitle>Эксперимент не запущен</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {data && (
          <section className="mt-10 grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <span className="grid size-11 place-items-center rounded-full bg-accent/25 text-accent-foreground">
              <Sparkles className="size-5" />
            </span>
            <div>
              <p className="font-heading text-lg font-semibold">
                Итог сравнения
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Тексты{' '}
                {data.summary.answersDiffer ? 'различаются' : 'совпадают'}.
                Верны {data.summary.correctMethodCount} из{' '}
                {data.summary.completedCount} завершённых способов.{' '}
                {data.summary.conclusion}
              </p>
            </div>
            <Button variant="outline" onClick={download}>
              <Download /> Скачать Markdown
            </Button>
          </section>
        )}

        <section className="mt-14 border-t pt-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <FlaskConical className="size-4" /> Результаты опыта
              </p>
              <h2 className="mt-2 font-heading text-2xl font-semibold tracking-tight">
                Четыре решения рядом
              </h2>
            </div>
            <span className="text-sm text-muted-foreground">
              {loading
                ? 'Выполняются параллельно'
                : data
                  ? `${data.summary.completedCount} из 4 завершено`
                  : 'Ожидают запуска'}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {data
              ? data.results.map((result, index) => (
                  <ResultCard key={result.id} result={result} index={index} />
                ))
              : orderedMethods.map((id, index) => (
                  <EmptyCard key={id} id={id} index={index} />
                ))}
          </div>
        </section>
      </div>
    </main>
  );
}
