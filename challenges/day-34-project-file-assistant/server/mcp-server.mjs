import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { FILES, readWorkspace, writeWorkspace, verify } from './workspace.mjs';
const root = process.env.MCP_WORKSPACE;
if (!root) throw new Error('MCP_WORKSPACE required');
const server = new McpServer({ name: 'bounded-project-files', version: '1.0.0' });
const wrap = fn => async args => { try { return { content: [{ type: 'text', text: JSON.stringify(await fn(args)) }] }; } catch { return { isError: true, content: [{ type: 'text', text: 'Действие отклонено: разрешены только файлы учебной копии и запись docs/api.md.' }] }; } };
function register(name, description, inputSchema, fn, write = false) { server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: !write, openWorldHint: false, destructiveHint: false } }, wrap(fn)); }
register('list_files', 'Узнать файлы учебного проекта.', {}, async () => ({ files: FILES }));
register('search_text', 'Найти подстроку во всех файлах проекта с номерами строк.', { query: z.string().min(1).max(100) }, async ({ query }) => { const matches = []; for (const path of FILES) (await readWorkspace(root, path)).split('\n').forEach((line, i) => { if (line.toLowerCase().includes(query.toLowerCase())) matches.push({ path, line: i + 1, text: line }); }); return { matches }; });
register('read_file', 'Прочитать файл для анализа. Нужно изучить минимум три разных файла.', { path: z.string() }, async ({ path }) => ({ path, text: await readWorkspace(root, path) }));
register('verify_workspace', 'Проверить соответствие маршрутов документации текущему клиенту.', {}, async () => verify(root));
if (process.env.MCP_CAN_WRITE === '1') register('write_file', 'Сохранить полное обновлённое содержимое docs/api.md в учебной копии. Сначала прочитай исходники.', { path: z.string(), content: z.string().min(30).max(15000) }, async ({ path, content }) => writeWorkspace(root, path, content), true);
await server.connect(new StdioServerTransport());
