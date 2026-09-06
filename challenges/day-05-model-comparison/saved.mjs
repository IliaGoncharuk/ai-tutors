import experiment from './results/2026-09-05/results.json' with { type: 'json' };
import reviewed from './results/2026-09-05/review.json' with { type: 'json' };
export const savedExperiment = experiment;
export const reviews = reviewed;
export const savedConclusion = 'В этой серии Luna была самой быстрой и дешёвой, но не нашла оптимум ни разу. Terra нашла его в 1 из 3 ответов, Sol — в 3 из 3. Sol стоила в 15,7 раза дороже Luna, при этом использовала меньше выходных токенов и отвечала быстрее Terra. Все модели начинали с ошибочных вариантов. Даже правильные финальные ответы Sol не содержат полного доказательства оптимальности.';
