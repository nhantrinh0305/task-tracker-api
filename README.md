# Task tracker API

Local task tracker using Node.js ES modules and SQLite through `better-sqlite3`.

## Database setup

Run from this directory:

```sh
npm install
npm run db:init
npm test
```

The database is created at `data/task-tracker.db`. Its path is relative to the
project files, so it does not depend on the terminal's current directory.
Database files and `node_modules` are excluded from Git.

Import the shared connection in backend modules:

```js
import db from './db.js';
const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ?').all(userId);
```

Importing `db.js` opens the database, enables foreign keys, and creates missing
tables in a transaction. Repeating initialization preserves existing rows.
Call `db.close()` when the application shuts down. `openDatabase(filename)` is
also exported for isolated database connections.

## Stored data rules

- `users`: generated ID, unique email (case insensitive), required password hash,
  and UTC creation timestamp. Emails must be nonempty with no surrounding spaces.
- `tasks`: generated ID, required existing user, nonblank description, status,
  and UTC creation/update timestamps.
- Status is `to-do`, `in-progress`, or `done`; new tasks default to `to-do`.
- Updating a task's description, status, or owner refreshes `updated_at`.
- Deleting a user who still owns tasks is rejected by the foreign key.
- Registration will validate email format and password strength and hash passwords
  before storing them. The database requires a nonempty hash field but cannot
  determine whether its contents are actually a password hash.
- Task routes must scope queries to the authenticated user; foreign keys ensure
  an owner exists but do not enforce who is allowed to access a task.

The schema lives in `src/schema.sql`. `CREATE TABLE IF NOT EXISTS` initializes
fresh databases; future changes to existing table definitions require migrations.
The HTTP server and registration/login/task routes are not implemented yet.
