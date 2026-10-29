import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('./temu-mock.html', import.meta.url));
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (process.env.TEMU_MOCK_CSP) headers['content-security-policy'] = process.env.TEMU_MOCK_CSP;
  response.writeHead(200, headers);
  response.end(page);
});

const host = process.env.TEMU_MOCK_HOST || '127.0.0.1';
const port = Number(process.env.TEMU_MOCK_PORT || 4173);
server.listen(port, host, () => {
  process.stdout.write(`Temu structure mock: http://${host}:${port}/uk-zh-Hans/tablets-laptops-accessories-o3-2872.html?storesnapperTest=1\n`);
});
