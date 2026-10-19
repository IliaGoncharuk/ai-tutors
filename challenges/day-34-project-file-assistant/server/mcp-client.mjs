import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { assert } from './provider.mjs';
export async function withMcp(fn, { env = {}, server = new URL('./mcp-server.mjs', import.meta.url) } = {}) {
  const client = new Client({ name: 'ai-tutors-local-site', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(server)], env: { PATH: process.env.PATH || process.env.Path || '', SystemRoot: process.env.SystemRoot || '', ...env }, stderr: 'pipe' });
  const events = [];
  try {
    await client.connect(transport); const { tools } = await client.listTools();
    const call = async (name, args = {}) => {
      assert(tools.some(t => t.name === name), 'Неизвестный MCP-инструмент.');
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
      assert(!result.isError, result.content?.find(c => c.type === 'text')?.text || 'MCP вернул ошибку.');
      const value = JSON.parse(result.content.find(c => c.type === 'text').text); events.push({ name, arguments: args, result: value }); return value;
    };
    return await fn({ call, tools, events });
  } finally { await client.close().catch(() => {}); }
}
