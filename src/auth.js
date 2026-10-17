import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, options);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algorithm, salt, hash] = (stored || '').split('$');
  const valid = algorithm === 'scrypt' && /^[a-f0-9]{32}$/.test(salt) && /^[a-f0-9]{128}$/.test(hash);
  const actual = await derive(password, valid ? salt : '0'.repeat(32), 64, options);
  return valid && timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

export function createAuth(secret, secure = false) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes.');
  }
  const key = new TextEncoder().encode(secret);
  return {
    async cookie(userId) {
      const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(String(userId)).setIssuer('task-tracker-api').setAudience('task-tracker')
        .setIssuedAt().sign(key);
      return `jwt=${token}; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`;
    },
    async authenticate(request, db) {
      const token = (request.headers.cookie || '').split(';').map(part => part.trim())
        .find(part => part.startsWith('jwt='))?.slice(4);
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'], issuer: 'task-tracker-api', audience: 'task-tracker',
        });
        if (!/^[1-9]\d*$/.test(payload.sub)) return null;
        return db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(payload.sub) || null;
      } catch {
        return null;
      }
    },
  };
}
