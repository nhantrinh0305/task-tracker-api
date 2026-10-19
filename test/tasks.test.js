import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import defaultDb, { openDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';
import { createAuth } from '../src/auth.js';

defaultDb.close();
const secret = 'task-tests-secret-at-least-32-bytes';

async function setup(t) {
  const db = openDatabase(':memory:');
  for (const name of ['alice', 'bob']) {
    db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, `${name}@example.com`, 'test-hash');
  }
  const cookies = await Promise.all([1, 2].map(async id => (await createAuth(secret).cookie(id)).split(';')[0]));
  const server = createApp({ db, secret });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const request = (method, path = '/api/tasks', body, user = 1, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', cookie: cookies[user - 1] ?? '', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { db, request };
}

test('task lifecycle supports full and partial PUT and an empty DELETE response', async t => {
  const { db, request } = await setup(t);
  const created = await request('POST', '/api/tasks', { description: ' First task ', status: 'in-progress' });
  assert.equal(created.status, 201);
  let { task } = await created.json();
  assert.deepEqual(Object.keys(task).sort(), ['created_at', 'description', 'id', 'status', 'updated_at', 'user_id']);
  assert.equal(task.description, 'First task');
  assert.equal(task.user_id, 1);
  assert.equal(task.status, 'in-progress');
  assert.ok(Number.isFinite(Date.parse(task.created_at)));
  const path = `/api/tasks/${task.id}`;
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', task.id);
  for (const [body, description, status] of [
    [{ status: 'done' }, 'First task', 'done'],
    [{ description: ' Renamed ' }, 'Renamed', 'done'],
    [{ description: 'Final', status: 'to-do' }, 'Final', 'to-do'],
  ]) {
    const updated = await request('PUT', path, body);
    assert.equal(updated.status, 200);
    const result = (await updated.json()).task;
    assert.equal(result.description, description);
    assert.equal(result.status, status);
    assert.equal(result.created_at, task.created_at);
    assert.ok(result.updated_at > '2000-01-01T00:00:00.000Z');
    task = result;
  }
  const listed = await request('GET');
  assert.deepEqual((await listed.json()).tasks, [task]);
  const deleted = await request('DELETE', path);
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  assert.equal((await request('DELETE', path)).status, 404);
  assert.equal((await request('PUT', path, { status: 'done' })).status, 404);
  const defaulted = await request('POST', '/api/tasks', { description: 'Default' });
  assert.equal((await defaulted.json()).task.status, 'to-do');
});

test('pagination returns ten tasks in stable newest-first order and counts only owned tasks', async t => {
  const { db, request } = await setup(t);
  const insert = db.prepare('INSERT INTO tasks (user_id, description) VALUES (?, ?)');
  for (let i = 1; i <= 23; i++) insert.run(1, `Task ${i}`);
  insert.run(2, 'Private');
  for (const [page, ids] of [[1, [23,22,21,20,19,18,17,16,15,14]], [2, [13,12,11,10,9,8,7,6,5,4]], [3, [3,2,1]], [4, []]]) {
    const response = await request('GET', page === 1 ? '/api/tasks' : `/api/tasks?page=${page}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.tasks.map(task => task.id), ids);
    assert.deepEqual(body.pagination, { page, pageSize: 10, total: 23, totalPages: 3 });
  }
  db.prepare('DELETE FROM tasks WHERE user_id = 2').run();
  const empty = await request('GET', '/api/tasks', undefined, 2);
  assert.deepEqual(await empty.json(), { tasks: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
});

test('all task operations require authentication and prevent cross-user access or ownership changes', async t => {
  const { db, request } = await setup(t);
  db.prepare('INSERT INTO tasks (user_id, description) VALUES (1, ?)').run('Private');
  for (const [method, path, body] of [['GET', '/api/tasks'], ['POST', '/api/tasks', { description: 'x' }],
    ['PUT', '/api/tasks/1', { status: 'done' }], ['DELETE', '/api/tasks/1']]) {
    for (const cookie of ['', 'jwt=invalid']) {
      const result = await request(method, path, body, 0, { cookie });
      assert.equal(result.status, 401);
      assert.equal((await result.json()).error.code, 'UNAUTHENTICATED');
    }
  }
  assert.deepEqual((await (await request('GET', '/api/tasks', undefined, 2)).json()).tasks, []);
  for (const method of ['PUT', 'DELETE']) {
    const response = await request(method, '/api/tasks/1', method === 'PUT' ? { status: 'done' } : undefined, 2);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
  for (const [method, path] of [['POST', '/api/tasks'], ['PUT', '/api/tasks/1']]) {
    assert.equal((await request(method, path, { description: 'x', user_id: 2 })).status, 400);
  }
  assert.equal(db.prepare('SELECT description FROM tasks WHERE id = 1').get().description, 'Private');
});

test('task input, pagination and mutation protections reject invalid requests', async t => {
  const { db, request } = await setup(t);
  db.prepare('INSERT INTO tasks (user_id, description) VALUES (1, ?)').run('Original');
  for (const method of ['POST', 'PUT']) {
    const path = method === 'POST' ? '/api/tasks' : '/api/tasks/1';
    for (const body of [null, [], {}, { description: ' ' }, { description: 123 }, { description: '\0bad' },
      { description: 'x', status: 'invalid' }, { description: 'x', status: null }, { unknown: 'x' }]) {
      assert.equal((await request(method, path, body)).status, 400);
    }
    assert.equal((await request(method, path, { description: 'x' }, 1, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await request(method, path, { description: 'x'.repeat(17000) })).status, 413);
  }
  for (const page of ['', '0', '-1', '1.5', 'abc', '9007199254740991', '1&page=2']) {
    assert.equal((await request('GET', `/api/tasks?page=${page}`)).status, 400);
  }
  for (const id of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
    for (const method of ['PUT', 'DELETE']) {
      assert.equal((await request(method, `/api/tasks/${id}`, method === 'PUT' ? { status: 'done' } : undefined)).status, 400);
    }
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const response = await request(method, method === 'POST' ? '/api/tasks' : '/api/tasks/1',
        method === 'DELETE' ? undefined : { description: 'x' }, 1, headers);
      assert.equal(response.status, 403);
    }
  }
  assert.equal((await request('PATCH', '/api/tasks/1', { status: 'done' })).status, 404);
  assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n, 1);
  assert.equal(db.prepare('SELECT description FROM tasks').get().description, 'Original');
});
