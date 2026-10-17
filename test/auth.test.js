import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { SignJWT, decodeJwt } from 'jose';
import defaultDb, { openDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';
defaultDb.close();
const secret = 'test-secret-that-is-at-least-32-bytes';

async function setup(t, secure = false) {
  const db = openDatabase(':memory:');
  const server = createApp({ db, secret, secure });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { db, url, post };
}
const credentials = { name: ' Test User ', email: ' TEST@example.com ', password: 'correct horse battery' };

test('registration, login and authenticated identity over HTTP', async t => {
  const { db, url, post } = await setup(t);
  const registered = await post('/api/auth/register', credentials);
  assert.equal(registered.status, 201);
  const { user } = await registered.json();
  assert.equal(user.name, 'Test User');
  assert.equal(user.email, 'test@example.com');
  assert.equal(user.password_hash, undefined);
  const hash = db.prepare('SELECT password_hash FROM users').get().password_hash;
  assert.match(hash, /^scrypt\$/);
  assert.ok(!hash.includes(credentials.password));
  const cookie = registered.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\//);
  assert.ok(!cookie.includes('Secure'));
  assert.equal(decodeJwt(cookie.split(';')[0].slice(8)).exp, undefined);
  const me = await fetch(url + '/api/auth/me', { headers: { cookie: cookie.split(';')[0] } });
  assert.deepEqual(await me.json(), { user });
  const login = await post('/api/auth/login', { email: 'TEST@example.com', password: credentials.password });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { user });
  assert.ok(login.headers.get('set-cookie'));
  const duplicate = await post('/api/auth/register', credentials);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'EMAIL_EXISTS');
  for (const email of ['test@example.com', 'missing@example.com']) {
    const response = await post('/api/auth/login', { email, password: 'wrong password' });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'INVALID_CREDENTIALS');
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('validation and origin checks reject bad requests without creating users', async t => {
  const { db, url, post } = await setup(t);
  for (const body of [null, [], {}, { ...credentials, name: ' ' }, { ...credentials, email: 'bad' },
    { ...credentials, password: 'short' }, { ...credentials, password: 123 }, { ...credentials, name: 'x'.repeat(101) }]) {
    assert.equal((await post('/api/auth/register', body)).status, 400);
  }
  assert.equal((await post('/api/auth/register', credentials, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/auth/register', credentials, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/auth/register', { padding: 'x'.repeat(17000) })).status, 413);
  const malformed = await fetch(url + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
});

test('protected route rejects absent, tampered, wrong-algorithm and deleted-user tokens', async t => {
  const { db, url, post } = await setup(t, true);
  const response = await post('/api/auth/register', credentials);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /; Secure/);
  const session = cookie.split(';')[0];
  const badAlgorithm = await new SignJWT({}).setProtectedHeader({ alg: 'HS384' })
    .setSubject('1').setIssuer('task-tracker-api').setAudience('task-tracker')
    .sign(new TextEncoder().encode(secret.repeat(2)));
  for (const value of ['', 'session=garbage', session.replace('session=', 'session=x'), `session=${badAlgorithm}`]) {
    assert.equal((await fetch(url + '/api/auth/me', { headers: { cookie: value } })).status, 401);
  }
  db.prepare('DELETE FROM users').run();
  assert.equal((await fetch(url + '/api/auth/me', { headers: { cookie: session } })).status, 401);
  assert.throws(() => createApp({ db, secret: 'short' }), /JWT_SECRET/);
});

