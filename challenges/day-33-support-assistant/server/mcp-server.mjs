import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ticketContext } from './support.mjs';
const context = ticketContext(process.env.MCP_TICKET);
const server = new McpServer({ name: 'synthetic-support-json', version: '1.0.0' });
for (const [name, key, description] of [['get_ticket', 'ticket', 'Прочитать только выбранное обращение.'], ['get_user', 'user', 'Прочитать пользователя, связанного с выбранным обращением.']]) {
  server.registerTool(name, { description, inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false } }, async () => ({ content: [{ type: 'text', text: JSON.stringify(context[key]) }] }));
}
await server.connect(new StdioServerTransport());
