import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('./tiktok-manage-mock.html', import.meta.url));
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') return response.writeHead(204).end();
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(page);
});

const host = process.env.TIKTOK_MOCK_HOST || '127.0.0.1';
const port = Number(process.env.TIKTOK_MOCK_PORT || 49220);
server.listen(port, host, () => process.stdout.write(`TikTok structure mock: http://${host}:${port}/product/manage?storesnapper_test=1\n`));
