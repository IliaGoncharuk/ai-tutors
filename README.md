# AI Tutors

Учебный репозиторий с результатами AI-челленджей курса.

## Челленджи

- [День 1 — запрос к LLM через API](challenges/day-01-llm-api/README.md)
- [День 2 — управление ответом, Kotlin Desktop](challenges/day-02-response-control/README.md)
- [День 3 — лаборатория рассуждений](challenges/day-03-reasoning-comparison/README.md)
- [День 4 — температура: эксперимент и выводы](challenges/day-04-temperature/README.md)
- [День 5 — сравнение моделей: веб-лаборатория и результаты](challenges/day-05-model-comparison/README.md)
- [День 6 — первый агент в CLI](challenges/day-06-first-agent/README.md)
- [День 7 — сохранение контекста между запусками](challenges/day-07-context-persistence/README.md)
- [День 8 — токены, стоимость диалога и переполнение контекста](challenges/day-08-token-accounting/README.md)
- [День 9 — сжатие истории и сравнение расхода токенов](challenges/day-09-context-compression/README.md)
- [День 10 — Sliding Window, Facts и ветки диалога](challenges/day-10-context-strategies/README.md)
- [День 11 — локальная лаборатория трёх слоёв памяти](challenges/day-11-memory-layers/README.md)
- [День 12 — персональный профиль и адаптация ответов](challenges/day-12-personalization/README.md)
- [День 13 — состояние задачи, пауза и продолжение](challenges/day-13-task-state/README.md)
- [День 14 — инварианты и объяснимый отказ при конфликте](challenges/day-14-invariants/README.md)
- [День 15 — переходы по принятому плану и актуальной валидации](challenges/day-15-controlled-transitions/README.md)

## Локальные сайты дней 11–15

Каждый сайт запускается самостоятельно. Нужен Node.js 22.13 или новее;
установку зависимостей и режимы работы описывает README соответствующего дня.
Команды ниже выполняются из корня репозитория.

| День | Адрес | Запуск |
| --- | --- | --- |
| 11 — память | [localhost:3011](http://localhost:3011) | `npm.cmd --prefix challenges/day-11-memory-layers start` |
| 12 — профиль | [localhost:3012](http://localhost:3012) | `npm.cmd --prefix challenges/day-12-personalization start` |
| 13 — состояние | [localhost:3013](http://localhost:3013) | `npm.cmd --prefix challenges/day-13-task-state start` |
| 14 — инварианты | [localhost:3014](http://localhost:3014) | `npm.cmd --prefix challenges/day-14-invariants start` |
| 15 — переходы | [localhost:3015](http://localhost:3015) | `npm.cmd --prefix challenges/day-15-controlled-transitions start` |

## Справочные материалы

- [Как управлять ответом LLM через API](docs/guides/response-control.md)

Правила работы с репозиторием приведены в [AGENTS.md](AGENTS.md), карта
проектной документации — в [docs/README.md](docs/README.md).
