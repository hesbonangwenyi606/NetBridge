const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  gateway: '<rect x="3" y="12" width="18" height="8" rx="2"/><path d="M7 12V5m10 7V5M7 16h.01M11 16h.01M15 16h2M9 5a5 5 0 0 1 6 0M6 2a10 10 0 0 1 12 0"/>',
  device: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
  link: '<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5l8-3Z"/><path d="m8 11 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  logout: '<path d="M9 4H5v16h4m5-12 4 4-4 4m-6-4h10"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.globe}</svg>`;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not yet';
const time = (value) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No report yet';
const statusLabel = { PENDING: 'Pending', PAIRED: 'Paired', APPROVED: 'Approved', REVOKED: 'Revoked', ACTIVE: 'Open', ENDED: 'Ended' };
const badge = (status) => `<span class="badge ${escape(status.toLowerCase())}"><span class="status-dot"></span>${statusLabel[status] ?? escape(status)}</span>`;
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const state = { user: null, token: sessionStorage.getItem('netbridge.session'), page: 'overview', authMode: 'login', filter: 'ALL', search: '', loading: true, busy: false, error: '', summary: null, gateways: [], devices: [], connections: [], cursors: {}, health: null, updatedAt: null };
const pages = { overview: 'Overview', gateways: 'Gateways', devices: 'Devices', connections: 'Connections' };
let refreshTimer;
let modalReturnFocus;
let loadVersion = 0;

function toast(message, error = false) {
  const item = document.createElement('div');
  item.className = `toast ${error ? 'toast-error' : ''}`;
  item.textContent = message;
  document.querySelector('#toasts').append(item);
  while (document.querySelector('#toasts').children.length > 2) document.querySelector('#toasts').firstElementChild.remove();
  setTimeout(() => item.remove(), 6000);
}

function setToken(value) {
  state.token = value;
  if (value) sessionStorage.setItem('netbridge.session', value);
  else sessionStorage.removeItem('netbridge.session');
}

async function api(path, { method = 'GET', body, publicRequest = false } = {}) {
  const requestToken = state.token;
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (requestToken && !publicRequest) headers.Authorization = `Bearer ${requestToken}`;
  let response;
  try { response = await fetch(`/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('Cannot reach NetBridge. Check your connection and try again.'); }
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !publicRequest) {
      if (requestToken && requestToken === state.token) { resetSession(); render(); }
      throw new Error('Your session has expired. Please sign in again.');
    }
    const message = response.status === 429 ? 'Too many attempts. Please wait a minute and try again.' : Array.isArray(data.message) ? data.message.join('. ') : data.message;
    throw new Error(message ?? `Request failed (${response.status}). Please try again.`);
  }
  return data;
}

function resetSession() {
  setToken(null);
  state.user = null;
  state.summary = null;
  state.gateways = []; state.devices = []; state.connections = [];
  state.cursors = {}; state.error = ''; state.loading = false;
  clearInterval(refreshTimer);
  document.querySelector('#toasts').replaceChildren();
  if (modal.open) modal.close();
}

async function load({ quiet = false } = {}) {
  if (!state.user || state.busy) return;
  const token = state.token;
  const version = ++loadVersion;
  if (!quiet) { state.loading = true; render(); }
  try {
    const summary = await api('/dashboard');
    const [gateways, devices, connections] = await Promise.all([
      api('/gateways?limit=100'), api('/devices?limit=100'), api('/connections?limit=100'),
    ]);
    if (token !== state.token || version !== loadVersion) return;
    state.summary = summary; state.gateways = gateways.items; state.devices = devices.items; state.connections = connections.items;
    state.cursors = { gateways: gateways.nextCursor, devices: devices.nextCursor, connections: connections.nextCursor };
    state.error = ''; state.updatedAt = new Date();
  } catch (error) { if (token === state.token && version === loadVersion) state.error = error.message; }
  finally { if (token === state.token && version === loadVersion) { state.loading = false; render(); } }
}

async function checkHealth() {
  try { const response = await fetch('/v1/health/ready', { signal: AbortSignal.timeout(15000) }); state.health = response.ok; }
  catch { state.health = false; }
  const element = document.querySelector('#api-status');
  if (element) element.outerHTML = healthBadge();
}

function healthBadge() {
  return `<span id="api-status" class="api-status ${state.health === false ? 'offline' : ''}"><span class="status-dot"></span>${state.health === null ? 'Checking API' : state.health ? 'API available' : 'API unavailable'}</span>`;
}

function brand() { return '<span class="brand-mark" aria-hidden="true">N</span><span>netbridge<span class="brand-period">.</span></span>'; }

function renderAuth() {
  const register = state.authMode === 'register';
  return `<div class="auth-layout"><aside class="auth-story"><a class="brand" href="#">${brand()}</a><div class="auth-story-content"><span class="eyebrow light">A LITTLE CLOSER TO HOME</span><h1>Your network.<br>Your devices.<br><em>Your space.</em></h1><p>One calm place to manage your private network, wherever your day takes you.</p><div class="network-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><div class="network-hub">${icon('gateway')}</div><div class="network-node node-a">${icon('device')}</div><div class="network-node node-b">${icon('globe')}</div><div class="network-node node-c">${icon('shield')}</div><span class="network-label">Built around you</span></div></div><div class="auth-story-footer">${icon('shield')} Your gateways. Only the devices you approve.</div></aside><main id="main" class="auth-main"><span class="auth-top-note">YOUR PRIVATE WORKSPACE</span><div class="auth-card"><div class="auth-icon">${icon(register ? 'plus' : 'shield')}</div><h2>${register ? 'Make yourself at home.' : 'Welcome back.'}</h2><p class="muted">${register ? 'Create your account and bring your network together.' : 'Sign in to your NetBridge workspace.'}</p><form id="auth-form">${register ? '<label>Full name<input name="fullName" autocomplete="name" placeholder="First and last name" maxlength="161" required></label>' : ''}<label>Email address<input type="email" name="email" autocomplete="email" placeholder="you@example.com" maxlength="254" required></label>${register ? '<label>Contact number<input type="tel" name="contact" autocomplete="tel" minlength="7" maxlength="30" pattern="[+0-9() .-]{7,30}" placeholder="e.g. +254 712 345 678" required></label>' : ''}<label>Password<span class="password-input"><input id="password" type="password" name="password" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="${register ? 'At least 12 characters' : 'Enter your password'}" minlength="12" maxlength="128" required><button type="button" class="icon-button" data-action="password" aria-label="Show password">${icon('eye')}</button></span></label>${register ? '<label>Confirm password<input type="password" name="confirmPassword" autocomplete="new-password" placeholder="Confirm your password" minlength="12" maxlength="128" required></label><p class="field-help">Use 12–128 characters and a password you don’t use elsewhere.</p>' : ''}<p id="auth-error" class="form-error" role="alert"></p><button class="button primary full" type="submit">${register ? 'Create account' : 'Sign in'} ${icon('arrow')}</button></form><p class="auth-switch">${register ? 'Already have an account?' : 'New to NetBridge?'} <button class="text-button" data-action="auth-mode">${register ? 'Sign in' : 'Create an account'}</button></p><div class="auth-note">${icon('shield')} You decide which devices belong.</div></div><div class="auth-bottom">NetBridge &copy; ${new Date().getFullYear()}<span>Private by design. Simple by choice.</span></div></main></div>`;
}

function skeleton() {
  return '<div class="loading-block" role="status"><span class="spinner"></span><h2>Gathering your network</h2><p class="muted">Loading your gateways, devices, and recent activity…</p></div>';
}

function render() {
  const active = document.activeElement;
  const searchFocused = active?.id === 'resource-search';
  const selection = searchFocused ? active.selectionStart : null;
  if (!state.user) { app.innerHTML = renderAuth(); return; }
  const userName = [state.user.firstName, state.user.lastName].filter(Boolean).join(' ') || state.user.email.split('@')[0];
  app.innerHTML = `<div class="app-layout"><aside class="sidebar" id="sidebar"><a href="#overview" class="brand">${brand()}</a><div class="workspace-label">PERSONAL WORKSPACE</div><nav aria-label="Main navigation">${Object.entries(pages).map(([key, label]) => `<a href="#${key}" class="nav-item ${state.page === key ? 'selected' : ''}" ${state.page === key ? 'aria-current="page"' : ''}>${icon({ overview: 'grid', gateways: 'gateway', devices: 'device', connections: 'link' }[key])}<span>${label}</span>${key === 'devices' && state.summary?.pendingDevices ? `<span class="nav-count">${state.summary.pendingDevices}</span>` : ''}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="help-card"><span class="help-symbol">${icon('globe')}</span><h3>A bridge to your network</h3><p>Your first gateway is a great place to start.</p><button class="text-button" data-action="guide">See how it works ${icon('arrow')}</button></div><button class="help-link" data-action="guide">${icon('help')} Getting started ${icon('chevron')}</button><div class="account-card"><div class="avatar">${escape(userName.slice(0, 2).toUpperCase())}</div><div class="account-text"><strong>${escape(userName)}</strong><span title="${escape(state.user.email)}">${escape(state.user.email)}</span></div><button class="icon-button" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button></div></div></aside><div class="main-layout"><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="menu" aria-label="Toggle navigation">${icon('menu')}</button><span>Workspace</span>${icon('chevron')}<strong>${pages[state.page]}</strong></div><div class="topbar-actions">${healthBadge()}<span class="topbar-divider"></span><span class="small-avatar">${escape(userName.charAt(0).toUpperCase())}</span></div></header><main id="main" class="content" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">YOUR NETWORK, WITHIN REACH</div><h1>${state.page === 'overview' ? 'Workspace overview' : pages[state.page]}</h1><p class="muted">${{ overview: 'A little clarity for everything connected to you.', gateways: 'Your home and office gateways, all in one place.', devices: 'Choose which devices belong on your network.', connections: 'A clear record of your device and gateway sessions.' }[state.page]}</p></div><div class="heading-actions"><button class="button secondary refresh-button" data-action="refresh" ${state.loading ? 'disabled' : ''}>${icon('refresh')}<span>Refresh</span></button><button class="button primary" data-action="${state.page === 'devices' ? 'add-device' : state.page === 'connections' ? 'add-connection' : 'add-gateway'}">${icon('plus')}${state.page === 'devices' ? 'Add device' : state.page === 'connections' ? 'New session' : 'Add gateway'}</button></div></div>${state.error ? `<div class="error-banner" role="alert"><span>${escape(state.error)}</span><button class="text-button" data-action="refresh">Try again</button></div>` : ''}${state.loading && !state.summary ? skeleton() : state.page === 'overview' ? overview() : resourcePage()}<footer class="content-footer"><span>${icon('shield')} Your workspace. Your approval.</span><span>${state.updatedAt ? `Updated ${state.updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Awaiting first sync'}</span></footer></main></div></div>`;
  if (searchFocused) { const field = document.querySelector('#resource-search'); field?.focus(); field?.setSelectionRange(selection, selection); }
}

function overview() {
  const stats = state.summary ?? { pairedGateways: '—', approvedDevices: '—', activeConnections: '—', pendingDevices: '—' };
  return `<section class="welcome-panel"><div><span class="eyebrow">MAKE YOURSELF AT HOME</span><h2>One place.<br>All your network.</h2><p>Bring your gateways and trusted devices<br class="desktop-only"> together in a workspace that’s yours.</p><button class="button dark" data-action="guide">Explore your workspace ${icon('arrow')}</button></div><div class="welcome-art" aria-hidden="true"><div class="welcome-orbit orbit-one"></div><div class="welcome-orbit orbit-two"></div><div class="welcome-orbit orbit-three"></div><div class="welcome-center">${icon('gateway')}</div><div class="welcome-device">${icon('device')}<span class="little-check">${icon('check')}</span></div><div class="welcome-shield">${icon('shield')}</div><span class="art-label">YOUR OWN LITTLE NETWORK</span></div><span class="welcome-corner">NETBRIDGE / WORKSPACE</span></section><section class="stats-grid" aria-label="Network overview">${[
    ['gateway', 'Paired gateways', stats.pairedGateways, 'Ready for approved devices', 'gateways'],
    ['device', 'Approved devices', stats.approvedDevices, 'Devices you’ve welcomed in', 'devices'],
    ['link', 'Open sessions', stats.activeConnections, 'Connection records in progress', 'connections'],
    ['clock', 'Pending approval', stats.pendingDevices, 'Waiting for your review', 'devices'],
  ].map(([i, label, count, description, page]) => `<a class="stat-card" href="#${page}"><div class="stat-top"><span class="stat-icon ${i === 'clock' ? 'amber' : ''}">${icon(i)}</span>${icon('chevron')}</div><strong class="stat-number">${count}</strong><h3>${label}</h3><p>${description}</p></a>`).join('')}</section><section class="section"><div class="section-heading"><div><h2>Your gateways <span class="count-pill">${state.gateways.length}${state.cursors.gateways ? '+' : ''}</span></h2><p class="muted">A familiar place for every connection.</p></div><a href="#gateways" class="text-link">View all gateways ${icon('arrow')}</a></div>${state.gateways.length ? `<div class="gateway-grid">${state.gateways.slice(0, 3).map(gatewayCard).join('')}</div>` : empty('gateway', 'Your network starts here', 'Add your first home or office gateway, then pair it with your gateway agent.', 'Add your first gateway', 'add-gateway')}</section><section class="section activity-section"><div class="section-heading"><div><h2>Recent sessions</h2><p class="muted">The latest entries in your connection history.</p></div><a href="#connections" class="text-link">View history ${icon('arrow')}</a></div>${connectionsTable(state.connections.slice(0, 5))}</section><div class="scope-note">${icon('help')} Connection sessions are management records. Creating one does not start a traffic tunnel.</div>`;
}

function gatewayCard(gateway) {
  return `<article class="gateway-card"><div class="card-top"><div class="resource-icon">${icon('gateway')}</div>${badge(gateway.status)}</div><h3>${escape(gateway.name)}</h3><p class="resource-id">${escape(gateway.id.slice(0, 8))}</p><div class="gateway-detail"><span>${icon('clock')} Last report</span><strong>${time(gateway.lastSeenAt)}</strong></div><div class="card-actions">${gateway.status === 'PENDING' ? `<button class="button small secondary" data-action="pairing" data-id="${gateway.id}">${icon('link')} Pair gateway</button>` : `<span class="card-meta">Added ${date(gateway.createdAt)}</span>`}${gateway.status !== 'REVOKED' ? `<button class="icon-button danger-hover" data-action="revoke-gateway" data-id="${gateway.id}" aria-label="Revoke ${escape(gateway.name)}" title="Revoke gateway">${icon('close')}</button>` : ''}</div></article>`;
}

function empty(i, title, description, label, action) {
  return `<div class="empty-state"><span class="empty-icon">${icon(i)}</span><h3>${title}</h3><p>${description}</p>${label ? `<button class="button secondary" data-action="${action}">${icon('plus')}${label}</button>` : ''}</div>`;
}

function resourcePage() {
  const kind = state.page;
  const items = state[kind].filter((item) => (state.filter === 'ALL' || item.status === state.filter) && `${item.name ?? ''} ${item.id} ${item.platform ?? ''} ${nameFor('gateways', item.gatewayId)} ${nameFor('devices', item.deviceId)}`.toLowerCase().includes(state.search.toLowerCase()));
  const filters = kind === 'gateways' ? ['ALL', 'PENDING', 'PAIRED', 'REVOKED'] : kind === 'devices' ? ['ALL', 'PENDING', 'APPROVED', 'REVOKED'] : ['ALL', 'ACTIVE', 'ENDED'];
  return `<section class="resource-section"><div class="resource-toolbar"><div class="filter-tabs" role="group" aria-label="Filter by status">${filters.map((filter) => `<button class="filter-tab ${state.filter === filter ? 'active' : ''}" data-action="filter" data-filter="${filter}" aria-pressed="${state.filter === filter}">${filter === 'ALL' ? 'All ' + kind : statusLabel[filter]}</button>`).join('')}</div><label class="search-field">${icon('search')}<input id="resource-search" type="search" placeholder="Search ${kind}…" aria-label="Search ${kind}" value="${escape(state.search)}"></label></div>${kind === 'gateways' ? (items.length ? `<div class="gateway-grid">${items.map(gatewayCard).join('')}</div>` : empty('gateway', state.gateways.length ? 'No gateways match' : 'A home for your network', state.gateways.length ? 'Try another search or status filter.' : 'Add a gateway to get your private workspace started.', state.gateways.length ? '' : 'Add gateway', 'add-gateway')) : kind === 'devices' ? devicesTable(items) : connectionsTable(items)}${state.cursors[kind] ? '<div class="pagination"><span>More records are available. Search and filters apply to loaded records.</span><button class="button secondary" data-action="load-more">Load more</button></div>' : ''}</section>${kind === 'connections' ? '<div class="scope-note">' + icon('help') + ' Sessions track connection intent and history. They don’t establish network tunnels.</div>' : ''}`;
}

function nameFor(kind, id) { return state[kind].find((item) => item.id === id)?.name ?? (id ? `…${id.slice(-8)}` : ''); }

function devicesTable(devices) {
  if (!devices.length) return empty('device', state.devices.length ? 'No devices match' : 'Make room for your devices', state.devices.length ? 'Try another search or status filter.' : 'Register a phone or computer, then approve it when you’re ready.', state.devices.length ? '' : 'Add your first device', 'add-device');
  return `<div class="table-scroll"><table><thead><tr><th>Device</th><th>Platform</th><th>Status</th><th>Added</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${devices.map((device) => `<tr><td><div class="table-name"><span class="table-icon">${icon('device')}</span><span><strong>${escape(device.name)}</strong><small>${device.id.slice(0, 8)}</small></span></div></td><td><span class="platform-label">${escape(device.platform)}</span></td><td>${badge(device.status)}</td><td class="date-cell">${date(device.createdAt)}</td><td><div class="row-actions">${device.status === 'PENDING' ? `<button class="button small primary" data-action="approve-device" data-id="${device.id}">${icon('check')} Approve</button>` : ''}${device.status !== 'REVOKED' ? `<button class="button small subtle-danger" data-action="revoke-device" data-id="${device.id}">Revoke</button>` : '<span class="muted">—</span>'}</div></td></tr>`).join('')}</tbody></table></div>`;
}

function connectionsTable(connections) {
  if (!connections.length) return empty('link', state.page === 'connections' && state.connections.length ? 'No sessions match' : 'A fresh start', state.connections.length ? 'Try another search or status filter.' : 'Your connection history will appear here. Pair a gateway and approve a device to record your first session.', '', '');
  return `<div class="table-scroll"><table><thead><tr><th>Device &amp; gateway</th><th>Status</th><th>Started</th><th>Ended</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${connections.map((connection) => `<tr><td><div class="table-name"><span class="table-icon">${icon('link')}</span><span><strong>${escape(nameFor('devices', connection.deviceId))}</strong><small>${escape(nameFor('gateways', connection.gatewayId))}</small></span></div></td><td>${badge(connection.status)}</td><td class="date-cell">${time(connection.startedAt)}</td><td class="date-cell">${connection.endedAt ? time(connection.endedAt) : 'In progress'}</td><td>${connection.status === 'ACTIVE' ? `<button class="button small secondary" data-action="end-connection" data-id="${connection.id}">End session</button>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}

function openModal(title, subtitle, content) {
  modalReturnFocus = document.activeElement;
  modal.innerHTML = `<div class="modal-head"><div><h2 id="modal-title">${title}</h2><p class="muted">${subtitle}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div>${content}`;
  if (!modal.open) modal.showModal();
}

function showCreate(kind) {
  if (kind === 'connection') {
    const gateways = state.gateways.filter((g) => g.status === 'PAIRED');
    const devices = state.devices.filter((d) => d.status === 'APPROVED' && !state.connections.some((c) => c.deviceId === d.id && c.status === 'ACTIVE'));
    if (!gateways.length || !devices.length) {
      openModal('A couple of things first', 'A new session needs a paired gateway and an approved device without an open session.', `<div class="info-panel">${icon('link')} Pair a gateway and approve a device, then come back to create a session. If you have more resources, load them from their pages first.</div><div class="modal-footer"><button class="button primary" data-action="close-modal">Got it</button></div>`);
      return;
    }
    openModal('New connection session', 'Record a session between one of your approved devices and gateways.', `<form id="create-form" data-kind="connection"><label>Gateway<select name="gatewayId" required>${gateways.map((g) => `<option value="${g.id}">${escape(g.name)}</option>`).join('')}</select></label><label>Device<select name="deviceId" required>${devices.map((d) => `<option value="${d.id}">${escape(d.name)}</option>`).join('')}</select></label><p class="field-help">This creates a management record. It does not start a network tunnel.</p>${formFooter('Create session')}</form>`);
    return;
  }
  openModal(kind === 'gateway' ? 'Add a gateway' : 'Add a device', kind === 'gateway' ? 'Give your home or office gateway a familiar name.' : 'Register a device, then explicitly approve it for your workspace.', `<form id="create-form" data-kind="${kind}"><label>${kind === 'gateway' ? 'Gateway' : 'Device'} name<input name="name" placeholder="${kind === 'gateway' ? 'e.g. Home gateway' : 'e.g. My Android phone'}" maxlength="80" required></label>${kind === 'device' ? '<label>Platform<select name="platform"><option value="android">Android</option><option value="ios">iOS</option><option value="linux">Linux</option><option value="windows">Windows</option><option value="macos">macOS</option></select></label><div class="info-panel">' + icon('shield') + ' New devices are pending until you approve them.</div>' : ''}${formFooter(kind === 'gateway' ? 'Add gateway' : 'Add device')}</form>`);
}

function formFooter(label) { return `<p class="form-error" role="alert"></p><div class="modal-footer"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">${label}${icon('arrow')}</button></div>`; }

function showPairing(gateway, result) {
  const expires = new Date(result.pairingExpiresAt);
  openModal('Pair your gateway', `Connect “${escape(gateway.name)}” to its gateway agent.`, `<ol class="pairing-steps"><li><span>1</span><div><strong>Open your gateway agent</strong><p>Use the trusted agent on your home or office gateway.</p></div></li><li><span>2</span><div><strong>Transfer this one-time pairing token</strong><p>It expires at ${escape(expires.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}. Keep it private.</p></div></li></ol><div class="token-box"><label for="pairing-token">PAIRING TOKEN</label><div><input id="pairing-token" readonly value="${escape(result.pairingToken)}" aria-label="Pairing token"><button class="icon-button" data-action="copy-token" aria-label="Copy pairing token">${icon('copy')}</button></div></div><div class="info-panel">${icon('shield')} The agent consumes the token at <code>/v1/gateway-agent/pair</code>. Pairing is complete when the gateway status changes to Paired.</div><div class="modal-footer"><button class="button primary" data-action="check-pairing">Done, check status ${icon('refresh')}</button></div>`);
}

function confirmAction(action, id) {
  const kind = action.includes('gateway') ? 'gateway' : action.includes('device') ? 'device' : 'connection';
  const item = state[kind === 'gateway' ? 'gateways' : kind === 'device' ? 'devices' : 'connections'].find((entry) => entry.id === id);
  if (!item) return;
  const revoke = action.startsWith('revoke');
  openModal(revoke ? `Revoke ${kind}?` : action === 'approve-device' ? 'Approve this device?' : 'End this session?', revoke ? `“${escape(item.name)}” will be revoked. Its open session records will be closed.` : action === 'approve-device' ? `Only approve “${escape(item.name)}” if it belongs in your workspace.` : 'This closes the session record and preserves it in your history.', `<div class="info-panel">${icon('shield')}${revoke ? 'Revocation is permanent. To use it again, register it as a new resource.' : action === 'approve-device' ? 'Approval lets you create connection records for this device.' : 'Ending a record does not stop a network tunnel.'}</div><form id="confirm-form" data-action-name="${action}" data-id="${id}"><p class="form-error" role="alert"></p><div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button ${revoke ? 'danger' : 'primary'}">${revoke ? 'Revoke ' + kind : action === 'approve-device' ? 'Approve device' : 'End session'}</button></div></form>`);
}

function guide() {
  openModal('A small bridge. A good beginning.', 'Get your workspace ready in three simple steps.', `<ol class="pairing-steps guide-steps"><li><span>1</span><div><strong>Add and pair a gateway</strong><p>Name your home or office gateway. Privately transfer its one-time pairing token to your gateway agent.</p></div></li><li><span>2</span><div><strong>Welcome your devices</strong><p>Register your phone or computer, then approve the devices you trust.</p></div></li><li><span>3</span><div><strong>Keep track of sessions</strong><p>Create and end connection records, and review them in your history.</p></div></li></ol><div class="info-panel">${icon('help')} NetBridge currently manages gateways, approvals, and session records. Traffic tunneling and gateway agent software are separate components.</div><div class="modal-footer"><button class="button primary" data-action="close-modal">Make yourself at home ${icon('arrow')}</button></div>`);
}

async function submitForm(form, work) {
  if (state.busy) return;
  state.busy = true;
  const submit = form.querySelector('[type="submit"]');
  const error = form.querySelector('.form-error');
  submit.disabled = true;
  const original = submit.innerHTML;
  submit.innerHTML = '<span class="spinner"></span> Please wait…';
  error.textContent = '';
  try { await work(); }
  catch (reason) { if (form.isConnected) error.textContent = reason.message; else toast(reason.message, true); }
  finally { state.busy = false; if (form.isConnected) { submit.disabled = false; submit.innerHTML = original; } }
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === 'auth-form') {
    submitForm(form, async () => {
      const registering = state.authMode === 'register';
      const credentials = { email: data.email, password: data.password };
      if (registering) {
        if (data.password !== data.confirmPassword) throw new Error('Passwords do not match.');
        const [firstName, ...remainingNames] = data.fullName.trim().split(/\s+/);
        const lastName = remainingNames.join(' ');
        if (!firstName || !lastName) throw new Error('Enter your first and last name.');
        if (firstName.length > 80 || lastName.length > 80) throw new Error('First and last name must each be 80 characters or fewer.');
        await api('/auth/register', { method: 'POST', body: { ...credentials, firstName, lastName, contact: data.contact.trim() }, publicRequest: true });
        state.authMode = 'login';
        state.busy = false;
        render();
        const emailInput = document.querySelector('#auth-form input[name="email"]');
        emailInput.value = data.email;
        document.querySelector('#password').focus();
        toast('Account created. Sign in to open your workspace.');
        return;
      }
      const login = await api('/auth/login', { method: 'POST', body: credentials, publicRequest: true });
      setToken(login.accessToken);
      state.user = await api('/auth/me');
      state.busy = false;
      navigate('overview');
      await load();
      startRefresh();
      checkHealth();
      toast('Welcome back.');
    });
  } else if (form.id === 'create-form') {
    submitForm(form, async () => {
      const kind = form.dataset.kind;
      const result = await api(kind === 'gateway' ? '/gateways' : kind === 'device' ? '/devices' : '/connections', { method: 'POST', body: data });
      state.busy = false;
      if (kind === 'gateway') showPairing(result, result);
      else modal.close();
      await load({ quiet: true });
      toast(kind === 'gateway' ? 'Gateway added. Pair it with your agent.' : kind === 'device' ? 'Device added. Review it before approval.' : 'Session record created.');
    });
  } else if (form.id === 'confirm-form') {
    submitForm(form, async () => {
      const action = form.dataset.actionName;
      const prefix = action.includes('gateway') ? 'gateways' : action.includes('device') ? 'devices' : 'connections';
      const verb = action.startsWith('revoke') ? 'revoke' : action.startsWith('approve') ? 'approve' : 'end';
      await api(`/${prefix}/${form.dataset.id}/${verb}`, { method: 'POST' });
      modal.close(); state.busy = false;
      await load({ quiet: true });
      toast(verb === 'approve' ? 'Device approved.' : verb === 'end' ? 'Session record ended.' : 'Resource revoked. Its open session records have been closed.');
    });
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === 'auth-mode') { state.authMode = state.authMode === 'login' ? 'register' : 'login'; render(); }
    if (action === 'password') { const input = document.querySelector('#password'); input.type = input.type === 'password' ? 'text' : 'password'; button.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password'); }
    if (action === 'menu') document.querySelector('#sidebar')?.classList.toggle('expanded');
    if (action === 'guide') guide();
    if (action === 'close-modal' && !state.busy) modal.close();
    if (action === 'refresh') { await Promise.all([load(), checkHealth()]); }
    if (action === 'add-gateway') showCreate('gateway');
    if (action === 'add-device') showCreate('device');
    if (action === 'add-connection') showCreate('connection');
    if (['revoke-gateway', 'revoke-device', 'approve-device', 'end-connection'].includes(action)) confirmAction(action, button.dataset.id);
    if (action === 'filter') { state.filter = button.dataset.filter; render(); }
    if (action === 'copy-token') {
      const input = document.querySelector('#pairing-token');
      try { await navigator.clipboard.writeText(input.value); toast('Pairing token copied. Keep it private.'); }
      catch { input.focus(); input.select(); toast('Select and copy the pairing token.'); }
    }
    if (action === 'check-pairing') { modal.close(); await load(); }
    if (action === 'pairing') {
      button.disabled = true;
      const gateway = state.gateways.find((g) => g.id === button.dataset.id);
      const result = await api(`/gateways/${gateway.id}/pairing-token`, { method: 'POST' });
      showPairing(gateway, result);
    }
    if (action === 'load-more') {
      button.disabled = true;
      const kind = state.page;
      const next = await api(`/${kind}?limit=100&cursor=${encodeURIComponent(state.cursors[kind])}`);
      const ids = new Set(state[kind].map((item) => item.id));
      state[kind].push(...next.items.filter((item) => !ids.has(item.id)));
      state.cursors[kind] = next.nextCursor;
      render();
    }
    if (action === 'logout') {
      button.disabled = true;
      await api('/auth/logout', { method: 'POST' });
      resetSession(); location.hash = ''; render(); toast('You’re signed out.');
    }
  } catch (error) { toast(error.message, true); }
  finally { if (button.isConnected) button.disabled = false; }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'resource-search') { state.search = event.target.value; render(); }
});
modal.addEventListener('cancel', (event) => { if (state.busy) event.preventDefault(); });
modal.addEventListener('close', () => {
  modal.innerHTML = '';
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
  else document.querySelector('#main')?.focus({ preventScroll: true });
});
modal.addEventListener('click', (event) => { if (event.target === modal && !state.busy) { const box = modal.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.close(); } });

function navigate(page) {
  state.page = pages[page] ? page : 'overview';
  state.search = ''; state.filter = 'ALL';
  if (location.hash !== `#${state.page}`) history.replaceState(null, '', `#${state.page}`);
  render();
}
window.addEventListener('hashchange', () => {
  if (location.hash === '#main') {
    document.querySelector('#main')?.focus();
    if (state.user) history.replaceState(null, '', `#${state.page}`);
    return;
  }
  if (state.user) { navigate(location.hash.slice(1)); document.querySelector('#main')?.focus(); }
});
function startRefresh() { clearInterval(refreshTimer); refreshTimer = setInterval(() => { if (!document.hidden && !modal.open && !state.busy) { load({ quiet: true }); checkHealth(); } }, 60000); }

async function boot() {
  if (state.token) {
    try { state.user = await api('/auth/me'); }
    catch (error) {
      if (state.token) { app.innerHTML = `<main id="main" class="boot"><div class="brand-mark">N</div><h1>Can’t open your workspace yet</h1><p>${escape(error.message)}</p><button class="button primary" id="retry-boot">Try again</button></main>`; document.querySelector('#retry-boot').addEventListener('click', boot); return; }
    }
  }
  navigate(location.hash.slice(1));
  if (state.user) { await load(); startRefresh(); }
  checkHealth();
}
boot();
