import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createContentLoader } from './content.js';
import { createServer } from './server.js';

const load = createContentLoader();
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id',
  'Access-Control-Expose-Headers': 'MCP-Protocol-Version, MCP-Session-Id',
};

export function createWorker(contentLoader = load) { return {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ status: 'ok', server: 'justin-martin' });
    if (url.pathname !== '/mcp') return Response.redirect('https://justinmartin.wiki/mcp/', 302);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) return Response.redirect('https://justinmartin.wiki/mcp/', 302);
    if (request.method !== 'POST') return new Response('Use an MCP client to connect.', { status: 405, headers: { ...cors, Allow: 'POST, OPTIONS' } });
    // This server is public and read-only; browser origins may connect without cookies or credentials.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createServer(contentLoader);
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(await response.arrayBuffer(), { status: response.status, headers });
    } finally {
      await server.close();
    }
  },
}; }

export default createWorker();
