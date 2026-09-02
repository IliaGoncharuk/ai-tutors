'use client';

import { useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  ArrowUpRight,
  Bot,
  Braces,
  CircleDollarSign,
  KeyRound,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

const MODELS = [
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', note: 'Быстро и экономно' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', note: 'Баланс качества и цены' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', note: 'Максимум возможностей' },
] as const;

type ModelId = (typeof MODELS)[number]['id'];

type GenerationResult = {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCostUsd: number;
  settings: { temperature: number; maxOutputTokens: number };
};

const DEFAULT_PROMPT =
  'Объясни простыми словами, зачем разработчику обращаться к нейросети через API, если у него уже есть подписка на ChatGPT.';

export default function Home() {
  const [model, setModel] = useState<ModelId>('gpt-5.6-luna');
  const [instructions, setInstructions] = useState(
    'Ты дружелюбный преподаватель. Отвечай по-русски, ясно и с одним практическим примером.',
  );
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [temperature, setTemperature] = useState(0.7);
  const [maxOutputTokens, setMaxOutputTokens] = useState(600);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const selectedModel = MODELS.find((item) => item.id === model)!;

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          instructions,
          prompt,
          temperature,
          maxOutputTokens,
        }),
      });
      const payload = (await response.json()) as
        | GenerationResult
        | { error?: string };

      if (!response.ok || !('text' in payload)) {
        throw new Error(
          'error' in payload && payload.error
            ? payload.error
            : 'Не удалось получить ответ модели.',
        );
      }

      setResult(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Произошла неизвестная ошибка.',
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-4 pb-10 pt-5 sm:px-8 lg:px-12">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-[0_0_24px_color-mix(in_oklch,var(--primary)_18%,transparent)]">
              <Braces className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                AI challenges / Day 01
              </p>
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
                LLM API Playground
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
            >
              <span className="size-1.5 rounded-full bg-emerald-300" />
              ключ на сервере
            </Badge>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              локальный режим
            </Badge>
          </div>
        </header>

        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          <InfoStrip
            icon={<KeyRound />}
            label="Секрет"
            value="OPENAI_API_KEY не покидает сервер"
          />
          <InfoStrip
            icon={<CircleDollarSign />}
            label="Оплата"
            value="Только фактически использованные токены"
          />
          <InfoStrip
            icon={<Sparkles />}
            label="Цель"
            value="Увидеть, как настройки меняют ответ"
          />
        </section>

        <form
          onSubmit={handleSubmit}
          className="grid flex-1 gap-5 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.55fr)]"
        >
          <Card className="h-fit border border-border/70 bg-card/80 shadow-2xl shadow-black/20">
            <CardHeader className="border-b border-border/70">
              <div className="flex items-center gap-2 text-primary">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                <span className="font-mono text-[11px] uppercase tracking-[0.2em]">
                  Параметры запроса
                </span>
              </div>
              <CardTitle className="mt-2 text-xl">Настройте модель</CardTitle>
              <CardDescription>
                Каждая настройка станет частью одного API-запроса.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-1">
              <div className="space-y-2">
                <Label htmlFor="model">Модель</Label>
                <NativeSelect
                  id="model"
                  value={model}
                  onChange={(event) => setModel(event.target.value as ModelId)}
                  className="w-full"
                >
                  {MODELS.map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.label} — {item.note}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {selectedModel.note}. Стоимость зависит от входных и выходных
                  токенов.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="temperature">Температура</Label>
                  <output
                    htmlFor="temperature"
                    className="rounded-md bg-primary/10 px-2 py-1 font-mono text-xs text-primary"
                  >
                    {temperature.toFixed(1)}
                  </output>
                </div>
                <Slider
                  id="temperature"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onValueChange={(value) =>
                    setTemperature(Array.isArray(value) ? value[0] : value)
                  }
                  aria-label="Температура генерации"
                />
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>точнее</span>
                  <span>вариативнее</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="max-tokens">Лимит ответа</Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    tokens
                  </span>
                </div>
                <Input
                  id="max-tokens"
                  type="number"
                  min={64}
                  max={4096}
                  step={32}
                  value={maxOutputTokens}
                  onChange={(event) =>
                    setMaxOutputTokens(Number(event.target.value))
                  }
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Верхняя граница длины ответа и reasoning-токенов.
                </p>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
                  <WandSparkles className="size-4" aria-hidden="true" />
                  Что сейчас «крутим»
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Низкая температура подходит для точных задач. Высокая даёт
                  больше разнообразия, но не делает ответ умнее или правдивее.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid min-w-0 gap-5 xl:grid-rows-[auto_1fr]">
            <Card className="border border-border/70 bg-card/80 shadow-2xl shadow-black/20">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl">Сформируйте запрос</CardTitle>
                    <CardDescription className="mt-1">
                      Инструкция задаёт поведение, запрос — конкретную задачу.
                    </CardDescription>
                  </div>
                  <Bot className="size-7 text-primary/80" aria-hidden="true" />
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="instructions">Инструкция модели</Label>
                  <Textarea
                    id="instructions"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    maxLength={2000}
                    className="min-h-24 resize-y bg-background/60 leading-relaxed"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prompt">Ваш запрос</Label>
                  <Textarea
                    id="prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    required
                    maxLength={8000}
                    className="min-h-36 resize-y bg-background/60 text-[15px] leading-relaxed"
                    placeholder="Что вы хотите спросить у модели?"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                  <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
                    Запрос уйдёт в OpenAI Responses API с{' '}
                    <code className="text-foreground">store: false</code>.
                  </p>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={isLoading || !prompt.trim()}
                    className="min-w-40 bg-primary text-primary-foreground shadow-[0_0_24px_color-mix(in_oklch,var(--primary)_22%,transparent)]"
                  >
                    {isLoading ? (
                      <>
                        <Spinner /> Думаю…
                      </>
                    ) : (
                      <>
                        Отправить <ArrowUpRight aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-80 border border-border/70 bg-card/80 shadow-2xl shadow-black/20">
              <CardHeader className="border-b border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-primary shadow-[0_0_14px_var(--primary)]" />
                      <CardTitle>Ответ модели</CardTitle>
                    </div>
                    <CardDescription className="mt-1">
                      Здесь появится текст и фактическая статистика API.
                    </CardDescription>
                  </div>
                  {result && (
                    <Badge variant="outline" className="font-mono">
                      {result.model}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex min-h-64 flex-col pt-1">
                {error ? (
                  <Alert variant="destructive" className="mt-2">
                    <TriangleAlert aria-hidden="true" />
                    <AlertTitle>Запрос не выполнен</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : result ? (
                  <div className="flex flex-1 flex-col gap-6">
                    <div className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">
                      {result.text}
                    </div>
                    <div className="mt-auto grid gap-2 border-t border-border/60 pt-4 sm:grid-cols-4">
                      <Metric label="Вход" value={result.usage.inputTokens} />
                      <Metric label="Выход" value={result.usage.outputTokens} />
                      <Metric label="Всего" value={result.usage.totalTokens} />
                      <Metric
                        label="≈ стоимость"
                        value={`$${result.estimatedCostUsd.toFixed(6)}`}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid flex-1 place-items-center py-10 text-center">
                    <div className="max-w-sm">
                      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border border-dashed border-primary/40 bg-primary/[0.06] text-primary">
                        <Sparkles className="size-5" aria-hidden="true" />
                      </div>
                      <p className="font-medium">Готово к первому запросу</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        Измените температуру, отправьте запрос и сравните
                        полученный ответ с другими настройками.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </form>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>Responses API · Node.js · local only</span>
          <span>Оценка цены справочная · 02.09.2026</span>
        </footer>
      </div>
    </main>
  );
}

function InfoStrip({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-4 py-3">
      <span className="text-primary [&>svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-xs font-medium sm:text-sm">{value}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}
