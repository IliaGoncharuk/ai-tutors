import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

export class McpConnection {
  client;
  transport;
  tools = [];
  events = [];
  info = null;
  constructor({ serverFile = fileURLToPath(new URL('./mcp-server.mjs', import.meta.url)), env = {} } = {}) {
    this.serverFile = serverFile;
    this.env = env;
  }
  record(method, detail) {
    this.events.push({ time: new Date().toISOString(), method, detail });
    this.events = this.events.slice(-80);
  }
  view() { return { connected: Boolean(this.client), info: this.info, tools: this.tools, events: this.events }; }
  async connect() {
    if (this.client) return this.view();
    const client = new Client({ name: 'tracker-web-client', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [this.serverFile], env: this.env, stderr: 'ignore' });
    try {
      this.record('initialize →', 'Запуск отдельного процесса и согласование возможностей');
      await client.connect(transport, { timeout: 15000 });
      this.info = client.getServerVersion();
      this.record('← initialized', 'MCP-соединение установлено');
      this.client = client; this.transport = transport;
      client.onclose = () => {
        this.client = undefined; this.info = null; this.tools = [];
        this.record('closed', 'Процесс MCP-сервера завершён');
      };
      await this.list();
      return this.view();
    } catch {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      this.client = undefined; this.info = null; this.tools = [];
      this.record('error', 'Соединение не установлено');
      throw new Error('Не удалось подключить MCP-сервер. Проверьте установку зависимостей.');
    }
  }
  async list() {
    if (!this.client) throw new Error('Сначала подключите MCP-сервер.');
    this.record('tools/list →', 'Запрос описаний и схем входных параметров');
    const all = []; let cursor;
    do {
      const page = await this.client.listTools(cursor ? { cursor } : {});
      all.push(...page.tools); cursor = page.nextCursor;
      if (all.length > 1000) throw new Error('Слишком большой список инструментов.');
    } while (cursor);
    this.tools = all;
    this.record('← tools/list', `Получено инструментов: ${all.length}`);
    return this.view();
  }
  async call(name, args = {}) {
    if (!this.client) throw new Error('Сначала подключите MCP-сервер.');
    if (!this.tools.some(tool => tool.name === name)) throw new Error('Неизвестный MCP-инструмент.');
    this.record('tools/call →', name);
    const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
    if (result.isError) {
      this.record('← error', name);
      const message = result.content?.find(item => item.type === 'text')?.text ?? `Инструмент ${name} вернул ошибку.`;
      throw Object.assign(new Error(message.slice(0, 300)), { publicMessage: message.slice(0, 300) });
    }
    const text = result.content?.find(item => item.type === 'text')?.text;
    if (!text) throw new Error('MCP-инструмент вернул пустой результат.');
    this.record('← tools/call', name);
    return JSON.parse(text);
  }
  async close() {
    const client = this.client, transport = this.transport;
    this.client = undefined; this.transport = undefined; this.info = null; this.tools = [];
    await client?.close();
    await transport?.close();
    this.record('disconnect', 'Соединение закрыто, дочерний процесс остановлен');
  }
}
