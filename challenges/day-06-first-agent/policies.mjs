export class PolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PolicyError';
  }
}

export function createInputPolicy({ maxCharacters = 8_000 } = {}) {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new TypeError('maxCharacters должен быть положительным целым числом.');
  }

  return Object.freeze({
    apply(value) {
      if (typeof value !== 'string') {
        throw new PolicyError('Сообщение должно быть строкой.');
      }

      const message = value.trim();
      if (!message) {
        throw new PolicyError('Введите непустое сообщение.');
      }
      if (message.length > maxCharacters) {
        throw new PolicyError(
          `Сообщение не должно превышать ${maxCharacters} символов.`,
        );
      }

      return message;
    },
  });
}

export function createOutputPolicy() {
  return Object.freeze({
    apply(response) {
      if (!response || response.status !== 'completed') {
        throw new PolicyError('Модель не завершила ответ.');
      }

      const text =
        typeof response.output_text === 'string' ? response.output_text.trim() : '';
      if (!text) {
        throw new PolicyError('Модель вернула пустой ответ.');
      }

      return text;
    },
  });
}
