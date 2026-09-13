// Synthetic public data. Expectations are used only by the local grader, never by the model.
export const FIELDS = ['project', 'audience', 'city', 'budget', 'deadline', 'onlinePaymentAllowed', 'phoneRequired', 'lessonMinutes', 'tutors', 'notifications', 'reminderHours', 'reserve', 'remaining', 'cancellationHours', 'platform'];
const question = (final = false) => `${final ? 'Составь итоговое ТЗ' : 'Контрольная проверка текущих требований'}: верни только JSON с полями ${FIELDS.join(', ')}. Числа — числа, onlinePaymentAllowed и phoneRequired — boolean, неизвестное — null. remaining — бюджет минус резерв. Бери только актуальные решения из доступного контекста.${final ? ' Добавь acceptance: массив из трёх коротких проверяемых критериев приёмки. Не подменяй неизвестное догадкой.' : ''}`;
const base = { project: 'Репетитор рядом', audience: 'взрослые', city: 'Пермь', budget: 120000, deadline: '2026-11-01',
  onlinePaymentAllowed: false, phoneRequired: false, lessonMinutes: 45, tutors: 8, notifications: 'email', reminderHours: 24 };
const revised = { ...base, budget: 90000, notifications: 'Telegram', reserve: 15000, remaining: 75000 };
export const COMMON = [
  { prompt: 'Собираем ТЗ сервиса записи к репетиторам. Проект: Репетитор рядом. Аудитория: взрослые. Город: Пермь. Бюджет: 120000 рублей. Срок: 2026-11-01. Пока только кратко подтверди получение.' },
  { prompt: 'Фиксируем ограничения первой версии. Онлайн-оплата: запрещена. Телефон пользователя: не собираем. Запись должна работать без этих возможностей. Подтверди кратко.' },
  { prompt: 'Для пилота: длительность занятия: 45 минут. Репетиторов: 8. Показываем свободное время каждого преподавателя. Подтверди кратко.' },
  { prompt: 'Решение по уведомлениям: канал уведомлений: email. Напоминание: за 24 часа. Пока достаточно подтвердить эти параметры.' },
  { prompt: 'На экране выбора занятия сначала показываем предмет, потом преподавателя и свободное время. Как назвать кнопку перехода к свободным слотам? Предложи один короткий вариант, это пока не принятое решение.' },
  { prompt: question(), expected: base },
  { prompt: 'Заказчик сократил финансирование. Прежний бюджет больше не действует. Бюджет: 90000 рублей. Резерв: 15000 рублей. Остальные требования сохраняются. Подтверди изменение.' },
  { prompt: 'Платные интеграции: запрещены. В первой версии используем только бесплатные интеграции. Не предлагай платные SMS. Подтверди кратко.' },
  { prompt: 'Обсудим пустое расписание: нужна понятная фраза, когда у преподавателя нет свободных мест. Предложи один вариант, пока без утверждения новых требований.' },
  { prompt: 'Меняем принятое решение: email-уведомления отменяем. Канал уведомлений: Telegram. Остальные условия прежние. Подтверди только это изменение.' },
  { prompt: question(), expected: revised },
  { prompt: 'Последнее общее требование перед выбором платформы. Отмена записи: не позднее чем за 12 часов. Уведомлять об отмене тем же согласованным каналом. Подтверди кратко.' },
];
export const ENDINGS = {
  web: [
    { prompt: 'Выбираем вариант реализации. Платформа: адаптивный сайт. Он должен работать в браузере телефона. Подтверди кратко.' },
    { prompt: 'Для этого варианта подтверждаю прежние финансовые рамки. Бюджет: 90000 рублей. Резерв: 15000 рублей. Остальные согласованные требования продолжают действовать. Подтверди кратко.' },
    { prompt: question(true), expected: { ...revised, cancellationHours: 12, platform: 'адаптивный сайт' }, final: true },
  ],
  bot: [
    { prompt: 'Выбираем альтернативный вариант реализации. Платформа: Telegram-бот. Отдельного сайта в этом варианте не будет. Подтверди кратко.' },
    { prompt: 'В этой альтернативе меняем только стоимость. Бюджет: 60000 рублей. Резерв: 10000 рублей. Остальные согласованные требования продолжают действовать. Подтверди кратко.' },
    { prompt: question(true), expected: { ...revised, budget: 60000, reserve: 10000, remaining: 50000, cancellationHours: 12, platform: 'Telegram-бот' }, final: true },
  ],
};

export function evaluate(text, expected, final = false) {
  let value;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { /* Invalid JSON earns no fact points. */ }
  const validJson = value !== null && typeof value === 'object' && !Array.isArray(value);
  const failed = Object.entries(expected).filter(([key, wanted]) => !validJson || value[key] !== wanted)
    .map(([key, wanted]) => ({ key, expected: wanted, actual: validJson ? value[key] ?? null : null }));
  return { score: Object.keys(expected).length - failed.length, max: Object.keys(expected).length, validJson, failed,
    acceptanceShape: final ? validJson && Array.isArray(value.acceptance) && value.acceptance.length === 3 && value.acceptance.every((v) => typeof v === 'string' && v.trim()) : null };
}
