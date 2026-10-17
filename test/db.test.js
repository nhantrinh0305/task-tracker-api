import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import db, { openDatabase } from '../src/db.js';

db.close();

test('task CRUD persists across database initialization', () => {
  const directory = mkdtempSync(join(tmpdir(), 'task-tracker-db-'));
  const filename = join(directory, 'nested', 'test.db');
  let connection;
  try {
    connection = openDatabase(filename);
    const userId = connection.prepare(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)'
    ).run('test@example.com', 'test-only-hash').lastInsertRowid;
    const taskId = connection.prepare(
      'INSERT INTO tasks (user_id, description, updated_at) VALUES (?, ?, ?)'
    ).run(userId, 'First task', '2000-01-01T00:00:00.000Z').lastInsertRowid;
    const original = connection.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    assert.equal(original.status, 'to-do');
    assert.match(original.created_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    connection.prepare('UPDATE tasks SET description = ?, status = ? WHERE id = ?')
      .run('Updated task', 'in-progress', taskId);
    connection.close();

    connection = openDatabase(filename);
    const saved = connection.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    assert.equal(saved.description, 'Updated task');
    assert.equal(saved.status, 'in-progress');
    assert.equal(saved.created_at, original.created_at);
    assert.notEqual(saved.updated_at, original.updated_at);
    connection.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('done', taskId);
    connection.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    connection.close();
    connection = openDatabase(filename);
    assert.equal(connection.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId), undefined);
    assert.equal(connection.prepare('SELECT count(*) AS count FROM users').get().count, 1);
  } finally {
    if (connection?.open) connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database rejects invalid user and task data', () => {
  const connection = openDatabase(':memory:');
  try {
    assert.equal(connection.pragma('foreign_keys', { simple: true }), 1);
    const addUser = connection.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
    const userId = addUser.run('test@example.com', 'test-only-hash').lastInsertRowid;
    assert.throws(() => addUser.run('TEST@example.com', 'hash'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    assert.throws(() => addUser.run(null, 'hash'), { code: 'SQLITE_CONSTRAINT_NOTNULL' });
    assert.throws(() => addUser.run('other@example.com', null), { code: 'SQLITE_CONSTRAINT_NOTNULL' });
    assert.throws(() => addUser.run('other@example.com', ' '), { code: 'SQLITE_CONSTRAINT_CHECK' });
    assert.throws(() => addUser.run(' ', 'hash'), { code: 'SQLITE_CONSTRAINT_CHECK' });
    const addTask = connection.prepare('INSERT INTO tasks (user_id, description, status) VALUES (?, ?, ?)');
    assert.throws(() => addTask.run(userId, 'Task', 'invalid'), { code: 'SQLITE_CONSTRAINT_CHECK' });
    assert.throws(() => addTask.run(userId, ' ', 'to-do'), { code: 'SQLITE_CONSTRAINT_CHECK' });
    assert.throws(() => addTask.run(userId, null, 'to-do'), { code: 'SQLITE_CONSTRAINT_NOTNULL' });
    assert.throws(() => addTask.run(9999, 'Task', 'to-do'), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
    assert.throws(() => addTask.run(null, 'Task', 'to-do'), { code: 'SQLITE_CONSTRAINT_NOTNULL' });
    const taskId = addTask.run(userId, 'Task', 'to-do').lastInsertRowid;
    assert.throws(() => connection.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('invalid', taskId),
      { code: 'SQLITE_CONSTRAINT_CHECK' });
    assert.throws(() => connection.prepare('DELETE FROM users WHERE id = ?').run(userId),
      { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
  } finally {
    connection.close();
  }
});
