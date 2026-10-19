# AI-ревью: Учебный diff: резерв бюджета и авторизация

Обнаружены две конкретные регрессии относительно правил резервирования бюджета и авторизации.

## P1 · Резервирование игнорирует уже зарезервированный бюджет

challenges/day-32-ai-code-review/fixtures/budget.mjs:2 · bug

Проверка учитывает только `spent + amount` и исключает `reserved`. При параллельных или незавершённых запросах уже зарезервированная сумма не уменьшает доступный лимит, поэтому суммарные резервы могут превысить лимит. Это прямо нарушает правило [S1]: резервирование должно проверять `spent + reserved + amount`.

Рекомендация: Вернуть `reserved` в условие: `if (spent + reserved + amount > limit) throw new Error('Budget exceeded');`.

## P1 · Отсутствующий ожидаемый токен разрешает авторизацию

challenges/day-32-ai-code-review/fixtures/budget.mjs:5 · bug

При falsy-значении `expected` выражение `!expected || actual === expected` возвращает `true`, независимо от `actual`. Поэтому при незаданном токене доступ разрешается, хотя правило [S1] требует запрещать авторизацию, если токен сервиса не задан.

Рекомендация: Сохранить отказ при отсутствии ожидаемого токена: `actual => Boolean(expected) && actual === expected` или эквивалентную явную проверку.

## Источники

- S1: challenges/day-31-developer-assistant/server/provider.mjs:1–29
- S2: challenges/day-32-ai-code-review/README.md:115–129
- S3: challenges/day-03-reasoning-comparison/README.md:58–72
- S4: challenges/day-08-token-accounting/README.md:216–242
- S5: challenges/day-05-model-comparison/README.md:146–184
- S6: challenges/day-17-tracker-tool/README.md:110–132
- S7: fixtures/review-rules.md:1–1
