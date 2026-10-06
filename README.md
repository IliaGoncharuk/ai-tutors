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
- [День 16 — подключение MCP и каталог инструментов](challenges/day-16-mcp-connection/README.md)
- [День 17 — первый инструмент Яндекс Трекера](challenges/day-17-tracker-tool/README.md)
- [День 18 — расписание утренних сводок](challenges/day-18-tracker-scheduler/README.md)
- [День 19 — цепочка MCP-инструментов](challenges/day-19-mcp-pipeline/README.md)
- [День 20 — оркестрация двух MCP-серверов](challenges/day-20-mcp-orchestration/README.md)
- [День 21 — индексация документов и два способа разбиения](challenges/day-21-document-indexing/README.md)
- [День 22 — первый RAG-запрос и сравнение с обычной моделью](challenges/day-22-first-rag/README.md)
- [День 23 — фильтрация, ранжирование и переписывание вопроса](challenges/day-23-rag-filtering/README.md)
- [День 24 — проверяемые цитаты, источники и отказ от выдумок](challenges/day-24-grounded-answers/README.md)
- [День 25 — чат с RAG и памятью задачи](challenges/day-25-rag-memory-chat/README.md)

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

## Локальные сайты дней 16–20

Пять самостоятельных приложений вокруг Яндекс Трекера. Нужен Node.js 22.13+.
Каждый запускается вручную; зависимости устанавливаются командой `npm.cmd ci`
в папке соответствующего задания. Для быстрого запуска из корня репозитория:

| День | Адрес | Запуск |
| --- | --- | --- |
| 16 — подключение | [localhost:3016](http://localhost:3016) | `npm.cmd --prefix challenges/day-16-mcp-connection start` |
| 17 — инструмент Трекера | [localhost:3017](http://localhost:3017) | `npm.cmd --prefix challenges/day-17-tracker-tool start` |
| 18 — расписание | [localhost:3018](http://localhost:3018) | `npm.cmd --prefix challenges/day-18-tracker-scheduler start` |
| 19 — цепочка | [localhost:3019](http://localhost:3019) | `npm.cmd --prefix challenges/day-19-mcp-pipeline start` |
| 20 — два сервера | [localhost:3020](http://localhost:3020) | `npm.cmd --prefix challenges/day-20-mcp-orchestration start` |

Учебный режим работает без ключей. Реальный источник читает только назначенные
владельцу токена задачи; для него нужны `YANDEX360_TOKEN` и `YANDEX360_ORG`
либо специальные переменные Трекера, описанные в README каждого дня.
В днях 17 и 20 настоящий агент использует `OPENAI_API_KEY` и получает только
сводные показатели. Рабочие данные остаются вне репозитория.

День 18: выберите источник, сохраните расписание 09:00 Екатеринбурга и включите
выполнение по будням. Закрытие вкладки не мешает; остановка приложения и сон
компьютера приостанавливают работу. Все приложения останавливаются через Ctrl+C.

## Локальные сайты дней 21–25

Пять самостоятельных приложений, выполненных последовательно: от индекса до
чата с памятью. В каждом есть дословное задание, подробная теория, объяснение
решения и сохранённые реальные эксперименты. База знаний — снимок 20 README,
18 628 слов (37,3 условной страницы). Готовый индекс включён в каждую папку.

Нужен Node.js 22.13+. Установите зависимости командой `npm.cmd ci` в нужной
папке; затем из корня репозитория запустите выбранный сайт:

| День | Адрес | Запуск |
| --- | --- | --- |
| 21 — индекс | [localhost:3021](http://localhost:3021) | `npm.cmd --prefix challenges/day-21-document-indexing start` |
| 22 — RAG | [localhost:3022](http://localhost:3022) | `npm.cmd --prefix challenges/day-22-first-rag start` |
| 23 — фильтр | [localhost:3023](http://localhost:3023) | `npm.cmd --prefix challenges/day-23-rag-filtering start` |
| 24 — цитаты | [localhost:3024](http://localhost:3024) | `npm.cmd --prefix challenges/day-24-grounded-answers start` |
| 25 — чат | [localhost:3025](http://localhost:3025) | `npm.cmd --prefix challenges/day-25-rag-memory-chat start` |

Для наглядной демонстрации откройте «Результаты эксперимента». В Дне 25 можно
загрузить готовый диалог кнопкой «Открыть пример» — без новых расходов и ключа.
Новые вопросы используют серверный `OPENAI_API_KEY`: индекс и поиск локальные,
а тексты для эмбеддингов и генерации отправляются в OpenAI. Остановка — Ctrl+C.

SQLite, история и общий бюджет хранятся в `~/.ai-tutors/rag-campaign`;
`RAG_DATA_DIR` меняет каталог для всех пяти сайтов. В выполненной проверке
использовался исключённый из Git `.local-rag`. Чтобы продолжить именно её
журнал, перед запуском из корня задайте
`$env:RAG_DATA_DIR = Join-Path (Get-Location) '.local-rag'`.
В новом каталоге начинается новый локальный журнал. Общий лимит каждого
журнала — $1; автоматических повторов запросов нет.

Выполненная серия с диагностическими прогонами: 278 API-вызовов, расчётный
расход $0,10762273 при лимите $1. Фильтрация повысила покрытие ожидаемых фактов
с 15/26 до 24/26 на десяти вопросах; это малая учебная выборка. В двух длинных
диалогах цель сохранилась 24/24, получено 22 ответа с цитатами и два отказа.
Точные данные, недостатки поиска и смысловые ошибки разобраны в README и
JSON-протоколах соответствующих дней.

## Справочные материалы

- [Как управлять ответом LLM через API](docs/guides/response-control.md)

Правила работы с репозиторием приведены в [AGENTS.md](AGENTS.md), карта
проектной документации — в [docs/README.md](docs/README.md).
