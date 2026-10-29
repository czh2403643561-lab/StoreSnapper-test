import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('./temu-mock.html', import.meta.url));
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(page);
});

server.listen(4173, '127.0.0.1', () => {
  process.stdout.write('Temu structure mock: http://127.0.0.1:4173/uk-zh-Hans/tablets-laptops-accessories-o3-2872.html?storesnapperTest=1\n');
});
