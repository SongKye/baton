// Trust only direct local requests or identity headers from the local Tailscale proxy.
export function isLoopback(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
}

export function isLocal(req) {
  const proxied = Boolean(req.headers['x-forwarded-for'] || req.headers['tailscale-user-login'] || req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto']);
  return isLoopback(req) && !proxied;
}

export function authorized(req, allowed = []) {
  if (!isLoopback(req)) return false;
  const login = String(req.headers['tailscale-user-login'] || '').toLowerCase();
  if (login) return !allowed.length || allowed.includes(login);
  return isLocal(req);
}
