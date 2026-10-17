# Task tracker API

Local task tracker using Node.js ES modules and SQLite through `better-sqlite3`.

## Project progress

- **Complete:** Persistent SQLite storage, HTTP server, registration/login,
  password hashing, JWT cookies, and authenticated user lookup.
- **Next:** Implement authenticated task CRUD routes, then design and connect
  the frontend.
- **Current boundary:** Authentication is implemented and tested locally.
  Task routes and frontend integration are still unimplemented.

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

- `users`: generated ID, required nonblank name, unique email (case insensitive), required password hash,
  and UTC creation timestamp. Emails must be nonempty with no surrounding spaces.
- `tasks`: generated ID, required existing user, nonblank description, status,
  and UTC creation/update timestamps.
- Status is `to-do`, `in-progress`, or `done`; new tasks default to `to-do`.
- Updating a task's description, status, or owner refreshes `updated_at`.
- Deleting a user who still owns tasks is rejected by the foreign key.
- Registration validates email format and password length and hashes passwords
  before storing them. The database requires a nonempty hash field but cannot
  determine whether its contents are actually a password hash.
- Task routes must scope queries to the authenticated user; foreign keys ensure
  an owner exists but do not enforce who is allowed to access a task.

The complete schema, including `users.name`, lives in `src/schema.sql`.
Initialization creates missing tables in a transaction; it does not migrate
existing tables. The local database was recreated for the name-column change.
Future schema changes require an explicit migration or database recreation.

## Run the API

Requires Node.js 22.16 or newer. From this directory in PowerShell:

```powershell
npm install
$env:JWT_SECRET = node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
npm start
```

The server listens on `127.0.0.1:3000`. `PORT` overrides the port. Keep the same
secret across restarts to keep existing tokens valid; keep it out of Git.
Startup rejects a missing secret or one shorter than 32 bytes.
`APP_ORIGIN` defaults to `http://localhost:<PORT>` and defines the allowed browser
origin. Use a same-origin frontend or development proxy; cross-origin CORS is
not enabled. Set `NODE_ENV=production` behind HTTPS to enable Secure cookies.

## Authentication API contract

| Method | Path | JSON input | Success |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `name`, `email`, `password` | 201, user and session cookie |
| POST | `/api/auth/login` | `email`, `password` | 200, user and session cookie |
| GET | `/api/auth/me` | None; session cookie required | 200, authenticated user |

Registration automatically signs the user in. Login verifies the email and
password; subsequent protected requests verify the JWT from the cookie.
Both POST routes require `Content-Type: application/json`, with a 16 KiB body limit.
Name is trimmed and must contain 1–100 characters. Email is trimmed, lowercased,
checked for a basic email format, and limited to 254 characters. Registration
passwords require at least 12 characters and at most 1024 UTF-8 bytes. Passwords
are never trimmed. Login accepts existing passwords up to the same byte limit.

Example registration input:

```json
{"name":"Nhan","email":"nhan@example.com","password":"a long unique passphrase"}
```

Success response (password hashes and JWTs are never included in JSON):

```json
{"user":{"id":1,"name":"Nhan","email":"nhan@example.com","created_at":"2026-10-17T00:00:00.000Z"}}
```

Errors consistently use `{"error":{"code":"INVALID_CREDENTIALS","message":"Email or password is incorrect."}}`.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` / `INVALID_JSON` | Invalid fields or JSON object |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password; same message for both |
| 401 | `UNAUTHENTICATED` | Missing/invalid token or user no longer exists |
| 403 | `FORBIDDEN_ORIGIN` | Browser request from a disallowed origin |
| 404 | `NOT_FOUND` | Unknown route or unsupported method |
| 409 | `EMAIL_EXISTS` | Email already registered, case insensitive |
| 413 | `BODY_TOO_LARGE` | Body exceeds 16 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | POST is not JSON |
| 500 | `INTERNAL_ERROR` | Unexpected server failure |

Passwords use salted asynchronous scrypt (N=32768, r=8, p=3). JWTs use HS256
through `jose`, with issuer and audience verification. The `jwt` cookie has
HttpOnly, SameSite=Strict, Path=/, and Secure in production. POST routes also
check Origin and reject cross-site Fetch Metadata requests. Responses are not cached.

As requested, JWT expiration, refresh, and revocation are deferred. The cookie is
a browser-session cookie, but a copied JWT has no expiry. Rate limiting and
account recovery are also not implemented; this is currently a local application.

`npm test` runs real local HTTP requests against isolated in-memory databases,
plus storage persistence and constraint tests. Frontend browser integration is
deferred until the frontend is built.
