import { HttpError } from './user-routes.js';

const pageSize = 10;
const statuses = new Set(['to-do', 'in-progress', 'done']);

function invalid(message) {
  throw new HttpError(400, 'INVALID_INPUT', message);
}

export function handleTaskRoute(method, url, body, db, userId) {
  if (method === 'GET') {
    const pages = url.searchParams.getAll('page');
    const value = pages[0] ?? '1';
    const page = Number(value);
    const offset = (page - 1) * pageSize;
    if (pages.length > 1 || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(page) ||
        !Number.isSafeInteger(offset)) invalid('Page must be a positive safe integer.');
    const total = db.prepare('SELECT count(*) AS total FROM tasks WHERE user_id = ?').get(userId).total;
    const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(userId, pageSize, offset);
    return { status: 200, body: { tasks, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } };
  }

  let id;
  if (method !== 'POST') {
    const value = url.pathname.slice('/api/tasks/'.length);
    id = Number(value);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) invalid('Task ID must be a positive safe integer.');
    if (!db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(id, userId)) {
      throw new HttpError(404, 'NOT_FOUND', 'Task not found.');
    }
  }
  if (method === 'DELETE') {
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, userId);
    return { status: 204 };
  }

  if (Object.keys(body).some(key => !['description', 'status'].includes(key))) {
    invalid('Only description and status can be provided.');
  }
  const hasDescription = Object.hasOwn(body, 'description');
  const hasStatus = Object.hasOwn(body, 'status');
  if (method === 'POST' && !hasDescription) invalid('Description is required.');
  if (method === 'PUT' && !hasDescription && !hasStatus) invalid('Provide description or status.');
  if (hasDescription && (typeof body.description !== 'string' || !body.description.trim() || body.description.includes('\0'))) {
    invalid('Description must be a nonblank string without null characters.');
  }
  if (hasStatus && !statuses.has(body.status)) invalid('Status must be to-do, in-progress, or done.');

  if (method === 'POST') {
    id = db.prepare('INSERT INTO tasks (user_id, description, status) VALUES (?, ?, ?)')
      .run(userId, body.description.trim(), body.status ?? 'to-do').lastInsertRowid;
  } else {
    const fields = [];
    const values = [];
    if (hasDescription) { fields.push('description = ?'); values.push(body.description.trim()); }
    if (hasStatus) { fields.push('status = ?'); values.push(body.status); }
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values, id, userId);
  }
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId);
  return { status: method === 'POST' ? 201 : 200, body: { task } };
}
