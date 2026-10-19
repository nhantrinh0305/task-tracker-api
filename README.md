# Task tracker API

## Web interface

Run the API using the setup below, then open http://localhost:3000 in your browser.
The approved dark interface is served by the API itself. Register or sign in to
create, edit, delete, and page through your own tasks. Tasks persist in SQLite;
the browser restores your session on reload. Forms display validation and network
errors and prevent duplicate submissions while a request is in progress.

Local task tracker using Node.js ES modules and SQLite through `better-sqlite3`.

## Project progress

- **Complete:** Persistent SQLite storage, HTTP server, registration/login,
  password hashing, JWT cookies, authenticated user lookup, and authenticated task CRUD with pagination.
- **Complete:** Responsive dark UI connected to authentication and task CRUD.
- **Current boundary:** Authentication and task routes are implemented and tested locally.
  The frontend is integrated with the local API.

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
plus storage persistence and constraint tests. The frontend has also been checked in a browser against an isolated in-memory database.


## Task API contract

All task routes require the session cookie. Missing or invalid authentication returns
`401 UNAUTHENTICATED`. Every operation is restricted to the signed-in user's tasks.

| Method | Path | JSON input | Success |
| --- | --- | --- | --- |
| GET | `/api/tasks?page=1` | None | 200, tasks and pagination |
| POST | `/api/tasks` | `description`, optional `status` | 201, `{ "task": ... }` |
| PUT | `/api/tasks/:id` | `description`, `status`, or both | 200, `{ "task": ... }` |
| DELETE | `/api/tasks/:id` | None | 204, empty response body |

GET returns all stored task fields: `id`, `user_id`, `description`, `status`,
`created_at`, and `updated_at`. Tasks are ordered by ID descending (newest first),
with exactly 10 tasks per page at most. `page` defaults to 1 and must be a positive
safe integer whose calculated offset is also safe; repeated page parameters are
rejected. Pages beyond the last page return an empty tasks array.

```json
{"tasks":[],"pagination":{"page":1,"pageSize":10,"total":0,"totalPages":0}}
```

Description is trimmed and must be a nonblank string without null characters.
Status must be `to-do`, `in-progress`, or `done`; creation defaults to `to-do`
when status is omitted. PUT supports full and partial changes: omitted fields
remain unchanged, and at least one editable field is required. Other fields,
including `user_id`, are rejected. Ownership is always taken from the session.

Task IDs must be positive safe integers. Invalid fields, IDs, or pagination return
`400 INVALID_INPUT`. Missing tasks and tasks owned by another user both return
`404 NOT_FOUND`. PATCH is not supported.

POST and PUT require a JSON object with `Content-Type: application/json` and a
16 KiB body limit, using the same errors as authentication routes. POST, PUT, and
DELETE enforce the configured Origin and reject cross-site Fetch Metadata requests.
Task responses are not cached. Tests cover CRUD, full/partial PUT, pagination,
validation, authentication, and isolation between users.



POST /api/auth/logout returns 204 and clears the current browser cookie; it does not revoke copied JWTs. Token expiration and revocation remain deferred.
