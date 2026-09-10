import process from 'node:process';
import { createInterface } from 'node:readline/promises';

import OpenAI from 'openai';

import { Agent } from './agent.mjs';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey?.trim()) {
  console.error(
    'OPENAI_API_KEY недоступен. Добавьте ключ в окружение и перезапустите терминал.',
  );
  process.exitCode = 1;
} else {
  await runChat(apiKey);
}

async function runChat(key) {
  const agent = new Agent({ client: new OpenAI({ apiKey: key }) });
  const terminal = createInterface({ input: process.stdin, output: process.stdout });

  console.log('Первый агент готов. Команды: /reset — очистить память, /exit — выйти.');

  try {
    while (true) {
      const raw = await terminal.question('\nВы: ');
      const command = raw.trim().toLowerCase();

      if (command === '/exit') break;
      if (command === '/reset') {
        agent.reset();
        console.log('Агент: история очищена.');
        continue;
      }

      try {
        const result = await agent.ask(raw);
        console.log(`\nАгент: ${result.text}`);
      } catch (error) {
        console.error(
          `\nОшибка: ${error instanceof Error ? error.message : 'неизвестный сбой.'}`,
        );
      }
    }
  } catch (error) {
    if (error?.code !== 'ERR_USE_AFTER_CLOSE') {
      console.error('CLI завершён из-за ошибки ввода.');
      process.exitCode = 1;
    }
  } finally {
    terminal.close();
  }

  console.log('До встречи!');
}
