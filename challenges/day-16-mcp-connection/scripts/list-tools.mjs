import { McpConnection } from '../server/mcp-client.mjs';
const connection = new McpConnection();
try {
  const { info, tools } = await connection.connect();
  console.log(JSON.stringify({ server: info, tools }, null, 2));
} finally { await connection.close(); }
