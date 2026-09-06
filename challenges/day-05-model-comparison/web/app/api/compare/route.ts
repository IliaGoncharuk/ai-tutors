import { env } from 'cloudflare:workers';
import { createWebHandler } from '../../../../web-handler.mjs';

export const POST = createWebHandler({
  getApiKey: () => (env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
});
