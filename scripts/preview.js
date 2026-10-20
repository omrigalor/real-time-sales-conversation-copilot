// Development-only static host for browser integration tests. No API routes.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Set(['index.html', 'styles.css', 'renderer.js', 'session.js', 'state.js', 'scenarios.js']);
http.createServer(async (req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!files.has(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(await readFile(new URL('../app/' + name, import.meta.url)));
}).listen(4197, '127.0.0.1');
