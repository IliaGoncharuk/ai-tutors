// Deterministic demo provider. Only run by the offline restart demonstration.
import { runChat } from '../cli.mjs';

process.exitCode = await runChat({
  client: {
    responses: {
      async create({ input }) {
        const remembered = input.find((message) =>
          message.role === 'user' && /Проверочное слово: ([a-z0-9-]+)/.test(message.content),
        );
        const word = remembered?.content.match(/Проверочное слово: ([a-z0-9-]+)/)?.[1];
        return {
          status: 'completed',
          output_text: word ? `Проверочное слово: ${word}.` : 'В переданном контексте слова нет.',
        };
      },
    },
  },
});
