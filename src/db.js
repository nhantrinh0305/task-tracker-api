import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPath = fileURLToPath(new URL('../data/task-tracker.db', import.meta.url));
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openDatabase(filename = defaultPath) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const connection = new Database(filename);
  try {
    connection.pragma('foreign_keys = ON');
    connection.transaction(() => connection.exec(schema))();
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

const db = openDatabase();
export default db;
