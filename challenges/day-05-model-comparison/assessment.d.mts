import type { Assessment } from './web/lib/types';
export const REFERENCE: { examined: number; feasible: number; points: number; winners: { selected: string[]; hours: number; points: number }[] };
export function evaluatePlan(selected: string[] | null, order?: string[] | null, reportedHours?: number | null, reportedPoints?: number | null): Pick<Assessment, 'selected' | 'hours' | 'points' | 'awardedPoints' | 'feasible' | 'optimal' | 'orderValid' | 'hoursCorrect' | 'pointsCorrect'>;
export function extractFinalPlan(text: string): Pick<Assessment, 'selected' | 'order' | 'reportedHours' | 'reportedPoints' | 'evidence' | 'extractionNote'>;
export function assessText(text: string): Assessment;
export function summarizeAssessments(assessments: Pick<Assessment, 'optimal' | 'awardedPoints'>[]): { total: number; assessed: number; optimal: number; unknown: number; totalPoints: number | null };
