import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// stdout belongs to MCP. Diagnostics must go to stderr.
const server = new McpServer({ name: 'tracker-connection', version: '1.0.0' });
server.registerTool('connection_info', {
  title: 'Информация о соединении',
  description: 'Возвращает возможности учебного MCP-сервера. Не обращается к API Трекера.',
  inputSchema: { detail: z.enum(['short', 'full']).describe('Краткое или полное описание') },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async ({ detail }) => ({
  content: [{ type: 'text', text: JSON.stringify({ transport: 'stdio', trackerApi: false, detail }) }],
}));
await server.connect(new StdioServerTransport());
