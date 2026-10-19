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
- [День 26 — запуск локальной LLM](challenges/day-26-local-llm/README.md)
- [День 27 — чат-приложение с локальной LLM](challenges/day-27-local-llm-app/README.md)
- [День 28 — локальный RAG и сравнение генерации](challenges/day-28-local-rag/README.md)
- [День 29 — настройка локальной модели](challenges/day-29-local-llm-optimization/README.md)
- [День 30 — приватный сервис в домашней сети](challenges/day-30-private-local-service/README.md)
- [День 31 — ассистент разработчика с RAG и MCP](challenges/day-31-developer-assistant/README.md)
- [День 32 — автоматическое AI-ревью кода](challenges/day-32-ai-code-review/README.md)
- [День 33 — поддержка с контекстом тикета](challenges/day-33-support-assistant/README.md)
- [День 34 — агент для операций с файлами](challenges/day-34-project-file-assistant/README.md)
- [День 35 — переносимый CLI подготовки релиза](challenges/day-35-release-assistant/README.md)

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

## Локальные сайты дней 26–30

Пять независимых сайтов в отдельных папках, порты 3026–3030. Нужны Node.js
22.13+ и запущенный API-сервер LM Studio на `127.0.0.1:1234`. В папках нет
устанавливаемых npm-зависимостей; сайт запускается из корня репозитория:

| День | Адрес | Запуск |
| --- | --- | --- |
| 26 — три запроса | [localhost:3026](http://localhost:3026) | `npm.cmd --prefix challenges/day-26-local-llm start` |
| 27 — локальный чат | [localhost:3027](http://localhost:3027) | `npm.cmd --prefix challenges/day-27-local-llm-app start` |
| 28 — локальный RAG | [localhost:3028](http://localhost:3028) | `npm.cmd --prefix challenges/day-28-local-rag start` |
| 29 — настройка модели | [localhost:3029](http://localhost:3029) | `npm.cmd --prefix challenges/day-29-local-llm-optimization start` |
| 30 — домашний сервис | [localhost:3030](http://localhost:3030) | отдельные инструкции в README Дня 30 |

Дни 26–29 доступны только на компьютере пользователя. День 30 слушает домашнюю
сеть и требует `DAY30_SERVICE_TOKEN`; настройте его по README задания. LM Studio
остаётся локальной службой, облачные вызовы Дня 28 выполняются только вручную
и требуют `OPENAI_API_KEY`. Все запущенные сайты останавливаются через Ctrl+C.

## Локальные сайты дней 31–35

Пять самостоятельных приложений в отдельных папках. Нужен Node.js 22.13+.
Для дней 31–34 сначала выполните `npm.cmd ci` в папке задания; день 35
не имеет внешних npm-зависимостей. Команды ниже запускаются из корня:

| День | Адрес | Запуск |
| --- | --- | --- |
| 31 — проект | [127.0.0.1:3031](http://127.0.0.1:3031) | `npm.cmd --prefix challenges/day-31-developer-assistant start` |
| 32 — ревью | [127.0.0.1:3032](http://127.0.0.1:3032) | `npm.cmd --prefix challenges/day-32-ai-code-review start` |
| 33 — поддержка | [127.0.0.1:3033](http://127.0.0.1:3033) | `npm.cmd --prefix challenges/day-33-support-assistant start` |
| 34 — файлы | [127.0.0.1:3034](http://127.0.0.1:3034) | `npm.cmd --prefix challenges/day-34-project-file-assistant start` |
| 35 — релиз | [127.0.0.1:3035](http://127.0.0.1:3035) | `npm.cmd --prefix challenges/day-35-release-assistant start` |

«Открыть сохранённый пример» показывает реальные записанные результаты без
ключа и новых расходов; повторный клик переключает примеры. Новые запросы
используют серверный `OPENAI_API_KEY` и передают выбранные материалы в OpenAI.
В днях 31–33 сначала обновите индекс. Общий бюджет одного локального журнала
— $1. Для продолжения журнала выполненной серии задайте из корня
`$env:AI_TUTORS_DATA_DIR = Join-Path (Get-Location) '.local-days-31-35'`.
Без этой переменной используется `~/.ai-tutors/days-31-35`, новый журнал.

День 34 изменяет только учебную копию, а день 35 также работает как переносимый
CLI `ai-release` в других Git-проектах. Конфигурация проверок AI Tutors —
[`ai-release.config.json`](ai-release.config.json). Порядок подключения и
подготовки релиза — в [README Дня 35](challenges/day-35-release-assistant/README.md).
Все сайты останавливаются через Ctrl+C. GitHub workflow Дня 32 подготовлен
локально; реальный удалённый запуск требует включения в base-ветку и настройки
Actions Secret. Публикация PR и релиза автоматически не выполняется.

## Справочные материалы

- [Как управлять ответом LLM через API](docs/guides/response-control.md)

Правила работы с репозиторием приведены в [AGENTS.md](AGENTS.md), карта
проектной документации — в [docs/README.md](docs/README.md).
