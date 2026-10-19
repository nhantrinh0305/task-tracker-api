const $ = id => document.getElementById(id);
const labels = { 'to-do': 'To do', 'in-progress': 'In progress', done: 'Done' };
let tasks = [], page = 1, mode = 'loading', editing = null, deleting = null, toastTimer; let user = null, pagination = { total: 0, totalPages: 0 }, busy = false, loadVersion = 0;
const escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const trash = '<svg class="trash-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg>';
function notify(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}
function render() {
  const auth = ['login', 'register'].includes(mode);
  $('workspace').hidden = auth; $('auth-view').hidden = !auth; $('account').hidden = !user; $('session-message').hidden = true; $('retry-session').hidden = true; if (user) { $('user-name').textContent = user.name; $('avatar').textContent = user.name.slice(0, 1).toUpperCase(); }
  if (auth) {
    const register = mode === 'register';
    $('auth-title').textContent = register ? 'Make a little space.' : 'Welcome back.';
    $('auth-copy').textContent = register ? 'Your next step starts with a simple list.' : 'A little space for everything on your list.';
    $('name-field').hidden = !register; $('name').required = register;
    $('password').minLength = register ? 12 : 1; $('password-hint').hidden = !register;
    $('password').autocomplete = register ? 'new-password' : 'current-password';
    $('auth-submit').textContent = register ? 'Create account' : 'Sign in';
    $('switch-copy').textContent = register ? 'Already have an account?' : 'New to Taskspace?';
    $('switch-auth').textContent = register ? 'Sign in' : 'Create an account';
    return;
  }
  const items = tasks;
  const totalPages = Math.max(1, pagination.totalPages);
  page = Math.max(1, Math.min(page, totalPages));
  $('count').textContent = pagination.total;
  $('previous').disabled = page === 1 || mode !== 'tasks';
  $('next').disabled = page >= totalPages || mode !== 'tasks';
  $('range').textContent = pagination.total ? ((page - 1) * 10 + 1) + '–' + Math.min(page * 10, pagination.total) + ' of ' + pagination.total + ' tasks' : '0 tasks';
  $('page-label').textContent = 'Page ' + page + ' of ' + totalPages;
  const list = $('task-list');
  list.setAttribute('aria-busy', String(mode === 'loading'));
  if (mode === 'loading') {
    list.innerHTML = '<div class="state-message"><h2>Loading your tasks…</h2></div>' + '<div class="skeleton-row" aria-hidden="true"><div class="skeleton"></div></div>'.repeat(4);
    $('range').textContent = 'Loading…'; return;
  }
  if (mode === 'error') {
    list.innerHTML = '<div class="state-message"><div class="state-symbol" aria-hidden="true">↻</div><h2>Couldn’t load your tasks</h2><p>Check your connection, then try again.</p><button class="secondary" data-action="retry">Try again</button></div>';
    $('range').textContent = 'Tasks unavailable'; return;
  }
  if (!items.length) {
    list.innerHTML = '<div class="state-message"><div class="state-symbol" aria-hidden="true">＋</div><h2>A little space for your next step</h2><p>Add your first task. Keep it simple, and take it from there.</p><button class="primary" data-action="create">Create your first task</button></div>'; return;
  }
  list.innerHTML = items.map(task => '<article class="task-row"><div class="task-description"><span aria-hidden="true" class="status-icon ' + task.status + '">' + (task.status === 'done' ? '✓' : '') + '</span><span class="description-text ' + (task.status === 'done' ? 'done-text' : '') + '">' + escapeHtml(task.description) + '</span></div><span class="badge ' + task.status + '">' + labels[task.status] + '</span><span class="updated">' + escapeHtml(new Date(task.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + '</span><div class="row-actions"><button class="edit-button" data-action="edit" data-id="' + task.id + '" aria-label="Edit ' + escapeHtml(task.description) + '">Edit</button><button class="icon-button" data-action="delete" data-id="' + task.id + '" aria-label="Delete ' + escapeHtml(task.description) + '">' + trash + '</button></div></article>').join('');
}

async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'The request failed. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function setMode(value) { mode = value; render(); window.scrollTo(0, 0); }
function signInRequired(message = '') {
  loadVersion++;
  user = null; tasks = []; page = 1; pagination = { total: 0, totalPages: 0 };
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('auth-form').reset(); $('auth-error').textContent = message; setMode('login');
}
function handleError(error, target) {
  if (error.status === 401) signInRequired('Please sign in to continue.');
  else $(target).textContent = error.message;
}
function setBusy(value) {
  busy = value;
  for (const id of ['task-form', 'auth-form', 'delete-dialog']) {
    $(id).querySelectorAll('input,textarea,select,button').forEach(element => { element.disabled = value; });
  }
  $('logout').disabled = value;
}
async function loadTasks(targetPage = page) {
  const version = ++loadVersion;
  mode = 'loading'; render();
  try {
    const result = await api('/api/tasks?page=' + targetPage);
    if (version !== loadVersion) return;
    if (targetPage > Math.max(1, result.pagination.totalPages)) return loadTasks(Math.max(1, result.pagination.totalPages));
    tasks = result.tasks; pagination = result.pagination; page = pagination.page;
    mode = 'tasks'; render();
  } catch (error) {
    if (version !== loadVersion) return;
    if (error.status === 401) signInRequired('Please sign in to continue.');
    else { mode = 'error'; render(); }
  }
}
async function restoreSession() {
  $('retry-session').hidden = true;
  $('session-message').textContent = 'Opening your workspace…';
  try {
    user = (await api('/api/auth/me')).user;
    await loadTasks(1);
  } catch (error) {
    if (error.status === 401) signInRequired();
    else {
      $('session-message').textContent = error.message;
      $('retry-session').hidden = false;
    }
  }
}
function openTask(id = null) {
  if (busy) return;
  editing = id;
  const task = tasks.find(item => item.id === id);
  $('dialog-title').textContent = task ? 'Edit task' : 'New task';
  $('save-task').textContent = task ? 'Save changes' : 'Create task';
  $('description').value = task?.description ?? '';
  $('status').value = task?.status ?? 'to-do';
  $('form-error').textContent = ''; $('task-dialog').showModal(); $('description').focus();
}
$('new-task').onclick = () => openTask();
document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => $('task-dialog').close());
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); }));
$('task-form').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  const description = $('description').value.trim();
  const body = { description, status: $('status').value };
  if (!description || description.includes('\0') || new TextEncoder().encode(JSON.stringify(body)).length > 16384) {
    $('form-error').textContent = 'Enter a nonblank description under 16 KiB, without null characters.'; return;
  }
  $('form-error').textContent = '';
  const creating = editing === null;
  setBusy(true); $('save-task').textContent = 'Saving…';
  try {
    await api(creating ? '/api/tasks' : '/api/tasks/' + editing, { method: creating ? 'POST' : 'PUT', body });
    $('task-dialog').close(); notify(creating ? 'Task created' : 'Changes saved');
    await loadTasks(creating ? 1 : page);
  } catch (error) { handleError(error, 'form-error'); }
  finally { setBusy(false); $('save-task').textContent = creating ? 'Create task' : 'Save changes'; }
};
$('task-list').onclick = event => {
  const button = event.target.closest('button[data-action]');
  if (!button || busy) return;
  const id = Number(button.dataset.id);
  if (button.dataset.action === 'create') openTask();
  if (button.dataset.action === 'retry') loadTasks();
  if (button.dataset.action === 'edit') openTask(id);
  if (button.dataset.action === 'delete') {
    deleting = id; $('delete-description').textContent = tasks.find(item => item.id === id).description;
    $('delete-error').textContent = '';
    $('delete-dialog').showModal(); $('cancel-delete').focus();
  }
};
for (const id of ['close-delete', 'cancel-delete']) $(id).onclick = () => $('delete-dialog').close();
$('confirm-delete').onclick = async () => {
  if (busy) return;
  setBusy(true); $('delete-error').textContent = ''; $('confirm-delete').textContent = 'Deleting…';
  try {
    await api('/api/tasks/' + deleting, { method: 'DELETE' });
    $('delete-dialog').close(); notify('Task deleted'); await loadTasks();
  } catch (error) { handleError(error, 'delete-error'); }
  finally { setBusy(false); $('confirm-delete').textContent = 'Delete task'; }
};
$('previous').onclick = () => loadTasks(page - 1);
$('next').onclick = () => loadTasks(page + 1);
$('retry-session').onclick = restoreSession;
document.querySelector('.brand').onclick = event => { event.preventDefault(); if (user) loadTasks(1); else setMode('login'); };
$('switch-auth').onclick = () => {
  $('auth-form').reset(); $('auth-error').textContent = '';
  setMode(mode === 'register' ? 'login' : 'register');
};
$('auth-form').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  const registering = mode === 'register';
  const body = { email: $('email').value.trim(), password: $('password').value };
  if (registering) body.name = $('name').value.trim();
  if ((registering && !body.name) || new TextEncoder().encode(body.password).length > 1024) {
    $('auth-error').textContent = 'Provide a nonblank name and a password of at most 1024 bytes.'; return;
  }
  $('auth-error').textContent = ''; setBusy(true); $('auth-submit').textContent = registering ? 'Creating account…' : 'Signing in…';
  try {
    user = (await api('/api/auth/' + (registering ? 'register' : 'login'), { method: 'POST', body })).user;
    $('auth-form').reset(); page = 1;
    await loadTasks(1);
  } catch (error) { $('auth-error').textContent = error.message; }
  finally { setBusy(false); $('auth-submit').textContent = registering ? 'Create account' : 'Sign in'; }
};
$('logout').onclick = async () => {
  if (busy) return;
  setBusy(true);
  try { await api('/api/auth/logout', { method: 'POST' }); signInRequired(); }
  catch (error) { notify(error.message); }
  finally { setBusy(false); }
};
restoreSession();
