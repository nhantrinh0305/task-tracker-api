import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createAuth } from './auth.js';
import { handleUserRoute, HttpError } from './user-routes.js';
import { handleTaskRoute } from './todo-routes.js';

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers,
  });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body exceeds 16 KiB.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Provide a JSON object.');
  }
}

export function createApp({ db, secret, secure = false, origin = 'http://localhost:3000' }) {
  const auth = createAuth(secret, secure);
  const allowedOrigin = new URL(origin).origin;
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, allowedOrigin);
      const path = url.pathname;
      const taskRoute = (path === '/api/tasks' && ['GET', 'POST'].includes(request.method)) ||
        (/^\/api\/tasks\/[^/]+$/.test(path) && ['PUT', 'DELETE'].includes(request.method));
      if (taskRoute) {
        const user = await auth.authenticate(request, db);
        if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
        if (request.method !== 'GET' &&
            ((request.headers.origin && request.headers.origin !== allowedOrigin) ||
              request.headers['sec-fetch-site'] === 'cross-site')) {
          throw new HttpError(403, 'FORBIDDEN_ORIGIN', 'Request origin is not allowed.');
        }
        const body = ['POST', 'PUT'].includes(request.method) ? await readJson(request) : undefined;
        const result = handleTaskRoute(request.method, url, body, db, user.id);
        return send(response, result.status, result.body);
      }
      if (request.method === 'GET' && path === '/api/auth/me') {
        const user = await auth.authenticate(request, db);
        if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
        return send(response, 200, { user });
      }
      if (request.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(path)) {
        if ((request.headers.origin && request.headers.origin !== allowedOrigin) ||
            request.headers['sec-fetch-site'] === 'cross-site') {
          throw new HttpError(403, 'FORBIDDEN_ORIGIN', 'Request origin is not allowed.');
        }
        const body = await readJson(request);
        const user = await handleUserRoute(path, body, db);
        return send(response, path.endsWith('register') ? 201 : 200, { user }, {
          'Set-Cookie': await auth.cookie(user.id),
        });
      }
      throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Request failed:', error);
      if (!response.destroyed) send(response, error.status || 500, {
        error: { code: error.code && error instanceof HttpError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof HttpError ? error.message : 'An unexpected error occurred.' },
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { default: db } = await import('./db.js');
  const port = Number(process.env.PORT || 3000);
  const server = createApp({ db, secret: process.env.JWT_SECRET,
    secure: process.env.NODE_ENV === 'production',
    origin: process.env.APP_ORIGIN || `http://localhost:${port}` });
  server.listen(port, '127.0.0.1', () => console.log(`API listening at http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(() => db.close()));
  }
}
