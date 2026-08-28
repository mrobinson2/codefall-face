import { randomBytes as nodeRandomBytes } from 'node:crypto';

export class HttpInputError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'HttpInputError';
    this.code = code;
    this.status = status;
  }
}

export async function readJson(req, { maxBytes = 65536 } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new TypeError('maxBytes must be positive');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) {
      req.destroy?.();
      throw new HttpInputError('json-too-large', 'JSON body exceeds the configured limit', 413);
    }
    chunks.push(buffer);
  }
  if (bytes === 0) throw new HttpInputError('empty-json', 'JSON body is required');
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } catch {
    throw new HttpInputError('bad-json', 'Request body is not valid JSON');
  }
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function applySecurityHeaders(res, { requestId, csp } = {}) {
  if (requestId) res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (csp) res.setHeader('Content-Security-Policy', csp);
}

export function createRequestId(randomBytes = nodeRandomBytes) {
  return randomBytes(8).toString('hex');
}
