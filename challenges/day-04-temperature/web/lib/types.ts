export type ScenarioId = 'robots' | 'dreams';
export type Run = {
  round: number;
  request: { model: string; input: string; temperature: number; [key: string]: unknown };
  status: string;
  text: string;
  durationMs?: number;
  error?: string;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
};
export type Experiment = {
  scenarioId?: ScenarioId;
  startedAt: string;
  status: string;
  plannedCalls: number;
  runs: Run[];
  [key: string]: unknown;
};
