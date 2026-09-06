export type Usage = {
  input_tokens: number; output_tokens: number; total_tokens: number;
  cached_tokens: number; cache_write_tokens: number; reasoning_tokens: number;
};
export type Run = {
  id: string; round: number; request: { model: string; input: string; [key: string]: unknown };
  status: string; text: string; durationMs: number; startedAt: string;
  usage: Usage | null; costUsd: number | null; error?: string;
};
export type Experiment = {
  schemaVersion: number; status: string; startedAt: string; runs: Run[]; plannedCalls: number;
  budgetUsd: number; reservedCostUsd: number; pricingDate: string; error?: string;
};
export type Assessment = {
  selected: string[] | null; hours: number | null; points: number | null; awardedPoints: number | null;
  order: string[] | null; reportedHours: number | null; reportedPoints: number | null;
  evidence: string | null; extractionNote: string;
  feasible: boolean | null; optimal: boolean | null; orderValid: boolean | null;
  hoursCorrect: boolean | null; pointsCorrect: boolean | null;
  wordCount: number; withinWordLimit: boolean; source: string; proof: string;
};
export type Review = { selected: string[]; order: string[]; reportedHours: number; reportedPoints: number; proof: string };
