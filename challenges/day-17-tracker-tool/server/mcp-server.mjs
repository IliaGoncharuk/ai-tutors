import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchIssues } from './tracker.mjs';
import { PublicError } from './domain.mjs';

const server = new McpServer({ name: 'tracker-tools', version: '1.0.0' });
server.registerTool('search_issues', {
  title: 'Найти мои задачи',
  description: 'Читает незавершённые задачи, назначенные текущему пользователю Трекера. Период all — все, overdue — просроченные, today — срок сегодня.',
  inputSchema: { period: z.enum(['all', 'overdue', 'today']) },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
}, async ({ period }) => {
  try { const result = await searchIssues({ source: process.env.TRACKER_SOURCE ?? 'demo', period }); return { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof PublicError ? error.message : 'Ошибка чтения задач.' }] }; }
});
await server.connect(new StdioServerTransport());
