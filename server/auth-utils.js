'use strict';

const SESSION_COOKIE_NAME = 'flux_device_token';

function getCookieValue(cookieHeader, name) {
  for (const chunk of (cookieHeader || '').split(';')) {
    const [rawName, ...rawValue] = chunk.trim().split('=');
    if (!rawName) continue;
    if (rawName === name) return decodeURIComponent(rawValue.join('='));
  }
  return null;
}

function getSessionToken(req) {
  const headerToken = req.headers.authorization || '';
  if (headerToken.startsWith('Bearer ')) return headerToken.slice(7);
  return getCookieValue(req.headers.cookie || '', SESSION_COOKIE_NAME);
}

function setSessionCookie(res, token) {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Expires=${expires}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

module.exports = {
  SESSION_COOKIE_NAME,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
};
