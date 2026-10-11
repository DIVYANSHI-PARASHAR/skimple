import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname, normalize} from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 3000);
const apiUrl = process.env.PUBLIC_API_URL || 'http://localhost:8000';
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};

createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^\/+/, '');
  if (!['index.html','app.js','live.js','profile.js','styles.css','profile.css'].includes(file) && !/^assets\/[a-z0-9-]+\.svg$/.test(file)) {
    response.writeHead(404); response.end('Not found'); return;
  }
  try {
    let content = await readFile(join(root, file));
    if (file === 'index.html') {
      const safeUrl = JSON.stringify(apiUrl).replace(/</g, '\\u003c');
      content = Buffer.from(content.toString().replace('<script src="app.js" defer></script>', `<script>window.SKIMPLE_API_URL=${safeUrl}</script>\n    <script src="app.js" defer></script>\n    <script src="live.js" defer></script>`));
    }
    response.writeHead(200, {'Content-Type':types[extname(file)],'Cache-Control':'no-store'});
    response.end(content);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
}).listen(port, '0.0.0.0', () => console.log(`Skimple UI ready on port ${port}`));
