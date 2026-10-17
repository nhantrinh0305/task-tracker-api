import { hashPassword, verifyPassword } from './auth.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function handleUserRoute(path, body, db) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      typeof password !== 'string' || password.length === 0 || Buffer.byteLength(password) > 1024) {
    throw new HttpError(400, 'INVALID_INPUT', 'Provide a valid email and a password of at most 1024 bytes.');
  }
  if (path === '/api/auth/register') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100 || password.length < 12) {
      throw new HttpError(400, 'INVALID_INPUT', 'Name must be 1–100 characters and password at least 12 characters.');
    }
    const hash = await hashPassword(password);
    let id;
    try {
      id = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
        .run(name, email, hash).lastInsertRowid;
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new HttpError(409, 'EMAIL_EXISTS', 'This email is already registered.');
      }
      throw error;
    }
    return db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(id);
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!await verifyPassword(password, user?.password_hash)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  const { password_hash, ...publicUser } = user;
  return publicUser;
}
