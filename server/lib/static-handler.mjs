import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { applySecurityHeaders, createRequestId } from './http-utils.mjs';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
});

const DENIED_SEGMENTS = new Set([
  'server', 'voices', 'piper-venv', 'node_modules', '.git', '.github', '.planning',
]);

function denied(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.') || DENIED_SEGMENTS.has(segment))) return true;
  if (pathname.startsWith('/docs/superpowers/')) return true;
  return /\.(?:map|onnx|bin|toml|env)$/i.test(pathname);
}

function cacheControl(pathname) {
  if (pathname.endsWith('.html')) return 'no-cache';
  if (/[.-][a-f0-9]{8,}\.(?:js|css|png|svg|webp)$/i.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'no-cache';
}

export function createStaticHandler({ root }) {
  const canonicalRoot = resolve(root);
  return {
    async handle(req, res) {
      applySecurityHeaders(res, {
        requestId: createRequestId(),
        csp: "default-src 'self'; script-src 'self'; style-src 'self'; " +
          "img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self'; object-src 'none'; base-uri 'none'",
      });
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return true;
      }
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch {
        pathname = '/__invalid__';
      }
      if (pathname === '/') pathname = '/index.html';
      if (denied(pathname)) return notFound(res);
      const file = resolve(canonicalRoot, `.${pathname}`);
      if (file !== canonicalRoot && !file.startsWith(`${canonicalRoot}${sep}`)) return notFound(res);
      try {
        const metadata = await stat(file);
        if (!metadata.isFile()) return notFound(res);
        const etag = `W/\"${metadata.size.toString(16)}-${Math.floor(metadata.mtimeMs).toString(16)}\"`;
        if (req.headers?.['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl(pathname) });
          res.end();
          return true;
        }
        const headers = {
          'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Length': metadata.size,
          'Cache-Control': cacheControl(pathname),
          ETag: etag,
        };
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? '' : await readFile(file));
        return true;
      } catch {
        return notFound(res);
      }
    },
    getHealth() { return { ok: true, root: canonicalRoot }; },
    async close() { return true; },
  };
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('404');
  return true;
}
