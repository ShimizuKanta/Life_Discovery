import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    // Also serve a project subpath to verify GitHub Pages-style deployment.
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/LifeDiscovery') { res.writeHead(302, { Location: '/LifeDiscovery/' }); res.end(); return; }
    pathname = pathname.replace(/^\/LifeDiscovery\//, '/');
    const path = resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${process.env.PORT || 4173}`));
