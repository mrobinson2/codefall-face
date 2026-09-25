/**
 * Decide which agent-hub URL (if any) the page should attach to on boot.
 *
 * Priority: explicit ?agent= URL param, then config.agent.url. The special
 * value 'auto' probes same-origin /api/face/status — present only when the
 * face server is hosting the page — so a static deploy (GitHub Pages,
 * Cloudflare) never spins a doomed reconnect loop, while `npm start`
 * users get a connected face with zero configuration.
 */

function withToken(url, token) {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export async function resolveAgentUrl({
  param = null,
  config = {},
  location,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (param) return param;
  const { url = null, token = null } = config;
  if (!url) return null;
  if (url !== 'auto') return withToken(url, token);
  if (!location || !/^https?:$/.test(location.protocol)) return null;
  try {
    const { status } = await fetchImpl('/api/face/status', { method: 'GET' });
    // 200 = open hub; 401 = hub present but token-guarded — attach with
    // whatever token config supplies and let the hub decide.
    if (status === 200 || status === 401) return withToken('/agent-hub', token);
  } catch { /* no server — stay detached */ }
  return null;
}
