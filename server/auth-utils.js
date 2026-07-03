'use strict';

const SESSION_COOKIE_NAME = 'flux_device_token';

function getCookieValue(cookieHeader, name) {
  for (const chunk of (cookieHeader || '').split(';')) {
    const [rawName, ...rawValue] = chunk.trim().split('=');
    if (!rawName) continue;
    const trimmedName = rawName.trim();
    if (trimmedName === name) return decodeURIComponent(rawValue.join('='));
  }
  return null;
}

function getHostCandidates(req) {
  const rawHost = req.headers.host || '';
  const hostname = rawHost.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  const candidates = new Set();
  if (hostname) candidates.add(hostname);
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    candidates.add('localhost');
    candidates.add('127.0.0.1');
    candidates.add('::1');
  }
  if (hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    candidates.add('localhost');
  }
  return [...candidates];
}

function buildCookieValue(token, host, req) {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
  const isSecure = !!(req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL || process.env.NODE_ENV === 'production');
  const attrs = [`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', isSecure ? 'SameSite=None' : 'SameSite=Lax', 'Max-Age=2592000', `Expires=${expires}`];
  if (isSecure) attrs.push('Secure');
  if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') attrs.push(`Domain=${host}`);
  return attrs.join('; ');
}

function getSessionToken(req) {
  const headerToken = req.headers.authorization || '';
  if (headerToken.startsWith('Bearer ')) return headerToken.slice(7);
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken) return queryToken;
  return getCookieValue(req.headers.cookie || '', SESSION_COOKIE_NAME);
}

function setSessionCookie(res, token, req) {
  const hosts = getHostCandidates(req);
  for (const host of hosts) {
    res.append('Set-Cookie', buildCookieValue(token, host, req));
  }
}

function clearSessionCookie(res, req) {
  const hosts = getHostCandidates(req);
  for (const host of hosts) {
    const cookieValue = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' ? `; Domain=${host}` : ''}`;
    res.append('Set-Cookie', cookieValue);
  }
}

module.exports = {
  SESSION_COOKIE_NAME,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
};
