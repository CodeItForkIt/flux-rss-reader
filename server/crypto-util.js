'use strict';
/**
 * server/crypto-util.js
 *
 * Small helper for the two things in db.js that shouldn't sit in the JSON
 * file as plain text:
 *   - 2FA (TOTP) secrets — anyone with read access to the data file
 *     shouldn't be able to generate valid codes for someone's account.
 *   - Session tokens — stored as a hash (like a password), not the raw
 *     value, so a leaked/backed-up copy of the data file can't be replayed
 *     as a live login the way a stolen cookie could be.
 *
 * The encryption key lives in its own file, separate from the data file
 * itself (so a copy of flux-data.json alone isn't enough to decrypt
 * anything in it), created with owner-only permissions on first run. Set
 * ENCRYPTION_KEY yourself (32+ random bytes, base64) if you'd rather manage
 * it explicitly — e.g. to keep it out of the filesystem entirely in a
 * hosted environment via a secrets manager.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

let _key = null;

function loadKey(dbPath) {
  if (_key) return _key;
  if (process.env.ENCRYPTION_KEY) {
    _key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
    if (_key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).');
    return _key;
  }
  if (!dbPath) {
    // No local filesystem to derive/persist a generated key against (e.g.
    // Supabase on Vercel — /tmp is ephemeral per invocation, so a key
    // generated there wouldn't survive to the next request and anything
    // encrypted with it would become permanently undecryptable). In this
    // mode ENCRYPTION_KEY must be set explicitly rather than auto-generated.
    throw new Error('ENCRYPTION_KEY environment variable is required when running without a local data file (e.g. Supabase/serverless mode). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  }
  const keyPath = path.join(path.dirname(dbPath), '.flux-encryption-key');
  try {
    _key = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
    return _key;
  } catch {
    _key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, _key.toString('base64'), { mode: 0o600 });
    return _key;
  }
}

function encrypt(dbPath, plaintext) {
  if (plaintext == null) return plaintext;
  const key = loadKey(dbPath);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decrypt(dbPath, stored) {
  if (stored == null) return stored;
  if (!String(stored).startsWith('enc:')) return stored; // tolerate pre-encryption-era plain values
  const [, ivB64, tagB64, dataB64] = stored.split(':');
  const key = loadKey(dbPath);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { encrypt, decrypt, hashToken };
