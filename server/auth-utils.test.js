'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getSessionToken } = require('./auth-utils');

test('reads a session token from a query parameter', () => {
  const req = {
    headers: {},
    query: { token: 'abc123' },
  };

  assert.equal(getSessionToken(req), 'abc123');
});

test('prefers a bearer token from the authorization header', () => {
  const req = {
    headers: { authorization: 'Bearer xyz789' },
    query: { token: 'abc123' },
  };

  assert.equal(getSessionToken(req), 'xyz789');
});
