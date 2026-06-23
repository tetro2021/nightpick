'use strict';

// ===== CATEGORY CONFIG =====
// Add new categories here — all views derive from this array automatically.
const CATEGORIES = [
  { id:'activity', label:'Activity',          icon:'⚡', color:'#a598ff', colorDim:'rgba(165,152,255,0.11)', colorGlow:'rgba(165,152,255,0.25)' },
  { id:'food',     label:'Food',              icon:'🍽️', color:'#f09348', colorDim:'rgba(240,147,72,0.11)',  colorGlow:'rgba(240,147,72,0.25)'  },
  { id:'drink',    label:'Drink',             icon:'🥤', color:'#3dd6a3', colorDim:'rgba(61,214,163,0.11)',  colorGlow:'rgba(61,214,163,0.25)'  },
  // isModifier=true → appears as a Suggest tab but is handled separately in Generate.
  // Each modifier carries an `appliesTo` attribute naming the suggestion type it decorates.
  { id:'modifier', label:'Modifiers', icon:'🎲', color:'#f472b6', colorDim:'rgba(244,114,182,0.11)', colorGlow:'rgba(244,114,182,0.25)', isModifier:true },
];

// ===== API CLIENT =====
const API = {
  token: localStorage.getItem('np_token'),

  setToken(t) {
    this.token = t;
    t ? localStorage.setItem('np_token', t) : localStorage.removeItem('np_token');
  },

  async req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${path}`, opts);
    if (res.status === 401) { Auth.signOut(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },

  get:    (p)    => API.req('GET',    p),
  post:   (p, b) => API.req('POST',   p, b),
  put:    (p, b) => API.req('PUT',    p, b),
  delete: (p)    => API.req('DELETE', p),
};

// ===== AUTH STATE =====
let currentUser = null;

const Auth = {
  config: { inviteOnly: false },

  async init() {
    try { this.config = await API.get('/config'); } catch {}
    if (!API.token) return;
    try { currentUser = await API.get('/auth/me'); } catch { API.setToken(null); }
  },

  signOut() {
    currentUser = null;
    API.setToken(null);
    Router.go('/auth');
  },
};

// ===== TOAST =====
function toast(msg, type = 'info') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 3200);
}

// ===== MODAL =====
function openModal(html, afterInsert) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay"></div><div class="modal">${html}</div>`;
  root.classList.add('active');
  root.querySelector('.modal-overlay').onclick = closeModal;
  const closeBtn = root.querySelector('.modal-close');
  if (closeBtn) closeBtn.onclick = closeModal;
  if (afterInsert) afterInsert(root.querySelector('.modal'));
}

function closeModal() {
  const root = document.getElementById('modal-root');
  root.classList.remove('active');
  root.innerHTML = '';
}

// ===== DOM HELPERS =====
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(ts) { return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
function fmtShort(ts) { return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function initial(name) { return (name||'?')[0].toUpperCase(); }
function catById(id) { return CATEGORIES.find(c=>c.id===id); }
// Format an integer number of minutes as "1h 30m" / "45m" / "2h"
function fmtDuration(mins) {
  const m = Math.round(Number(mins));
  if (!Number.isFinite(m) || m <= 0) return '';
  const h = Math.floor(m / 60), rem = m % 60;
  return h ? (rem ? `${h}h ${rem}m` : `${h}h`) : `${rem}m`;
}
function catVars(cat) { return `--cat-color:${cat.color};--cat-color-dim:${cat.colorDim};--cat-color-glow:${cat.colorGlow}`; }
function setApp(html) { document.getElementById('app').innerHTML = html; }
function loadingView() { setApp('<div class="loading-screen"><div class="spinner"></div></div>'); }

function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

// ===== ROUTER =====
const Router = {
  go(hash) { window.location.hash = hash; },
  current() {
    const h = window.location.hash.replace('#','') || '/';
    const parts = h.split('/').filter(Boolean);
    return { view: parts[0] || 'home', id: parts[1] || null, sub: parts[2] || null };
  },
  async dispatch() {
    updateNav();
    const { view, id } = this.current();
    if (!currentUser && view !== 'auth' && view !== 'join') { this.go('/auth'); return; }
    if (currentUser && view === 'auth') { this.go('/pools'); return; }
    try {
      if (view === 'auth')   { await renderAuth(); return; }
      if (view === 'pools')  { await renderPools(); return; }
      if (view === 'pool' && id) { await renderPool(id); return; }
      if (view === 'browse') { await renderBrowse(); return; }
      if (view === 'join' && id) { await renderJoin(id); return; }
      this.go(currentUser ? '/pools' : '/auth');
    } catch(err) {
      console.error(err);
      setApp(`<div class="view"><div class="error-banner">${esc(err.message)}</div><button class="btn btn-ghost" onclick="history.back()">← Go back</button></div>`);
    }
  },
};

function updateNav() {
  const links = document.getElementById('nav-links');
  const right = document.getElementById('nav-right');
  if (!currentUser) {
    links.innerHTML = '';
    right.innerHTML = '';
    return;
  }
  const { view } = Router.current();
  links.innerHTML = [
    ['pools',  'My Pools'],
    ['browse', 'Browse'],
  ].map(([v,label]) => `<li><button class="nav-link ${view===v?'active':''}" onclick="Router.go('/${v}')">${label}</button></li>`).join('');
  right.innerHTML = `<span class="nav-user">Hi, ${esc(currentUser.displayName)}</span><button class="btn-signout" onclick="Auth.signOut()">Sign out</button>`;
}

// ===== AUTH VIEW =====
async function renderAuth() {
  const pending = sessionStorage.getItem('np_pending_join');
  setApp(`
    <div class="auth-view">
      <div class="auth-card">
        <div class="auth-logo">NightPick</div>
        <div class="auth-subtitle">Plan your night, together.</div>
        <div class="auth-tabs">
          <button class="auth-tab active" id="tab-signin" onclick="switchAuthTab('signin')">Sign in</button>
          <button class="auth-tab" id="tab-signup" onclick="switchAuthTab('signup')">Create account</button>
        </div>
        <div id="auth-form-area"></div>
      </div>
    </div>
  `);
  renderAuthForm('signin');
}

function switchAuthTab(mode) {
  document.getElementById('tab-signin').classList.toggle('active', mode==='signin');
  document.getElementById('tab-signup').classList.toggle('active', mode==='signup');
  renderAuthForm(mode);
}

function renderAuthForm(mode) {
  const area = document.getElementById('auth-form-area');
  if (mode === 'signin') {
    area.innerHTML = `
      <form class="auth-form" id="signin-form">
        <div id="auth-error"></div>
        <div class="field"><label>Username</label><input class="input" type="text" name="username" placeholder="your_username" required autocomplete="username" maxlength="20"/></div>
        <div class="field"><label>Password</label><input class="input" type="password" name="password" placeholder="••••••••" required autocomplete="current-password"/></div>
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Sign in</button>
      </form>
    `;
    document.getElementById('signin-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const r = await API.post('/auth/login', { username: fd.get('username'), password: fd.get('password') });
        API.setToken(r.token); currentUser = r.user;
        const pending = sessionStorage.getItem('np_pending_join');
        if (pending) { sessionStorage.removeItem('np_pending_join'); Router.go(`/join/${pending}`); }
        else Router.go('/pools');
      } catch(err) {
        document.getElementById('auth-error').innerHTML = `<div class="auth-error">${esc(err.message)}</div>`;
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    };
  } else {
    const inviteOnly = Auth.config?.inviteOnly;
    area.innerHTML = `
      <form class="auth-form" id="signup-form">
        <div id="auth-error"></div>
        <div class="field"><label>Display name</label><input class="input" type="text" name="displayName" placeholder="Your name" required maxlength="30"/></div>
        <div class="field">
          <label>Username</label>
          <input class="input" type="text" name="username" placeholder="letters, numbers, underscores" required maxlength="20" autocomplete="username" pattern="[a-zA-Z0-9_]{3,20}" title="3–20 characters: letters, numbers, underscores only"/>
        </div>
        <div class="field"><label>Password</label><input class="input" type="password" name="password" placeholder="Min 6 characters" required autocomplete="new-password" minlength="6"/></div>
        ${inviteOnly ? `
        <div class="field">
          <label>Invite code</label>
          <input class="input" type="text" name="inviteCode" placeholder="xxxxxxxx" required maxlength="8" autocomplete="off" style="letter-spacing:.12em;font-family:monospace"/>
        </div>` : ''}
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Create account</button>
      </form>
    `;
    document.getElementById('signup-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Creating account…';
      try {
        const r = await API.post('/auth/register', {
          username:    fd.get('username'),
          password:    fd.get('password'),
          displayName: fd.get('displayName'),
          inviteCode:  fd.get('inviteCode') || undefined,
        });
        API.setToken(r.token); currentUser = r.user;
        const pending = sessionStorage.getItem('np_pending_join');
        if (pending) { sessionStorage.removeItem('np_pending_join'); Router.go(`/join/${pending}`); }
        else Router.go('/pools');
      } catch(err) {
        document.getElementById('auth-error').innerHTML = `<div class="auth-error">${esc(err.message)}</div>`;
        btn.disabled = false; btn.textContent = 'Create account';
      }
    };
  }
}

// ===== MY POOLS VIEW =====
async function renderPools() {
  loadingView();
  const pools = await API.get('/pools');
  const totalItems = pools.reduce((s,p) => s + Object.values(p.counts||{}).reduce((a,b)=>a+b,0), 0);

  setApp(`
    <div class="view">
      <div class="page-header">
        <div class="page-header-left">
          <h1>My Pools</h1>
          <p>${pools.length} pool${pools.length!==1?'s':''} · ${totalItems} suggestions total</p>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-primary" onclick="openCreatePoolModal()">+ New Pool</button>
        </div>
      </div>
      ${pools.length === 0
        ? `<div class="empty-pools"><div class="empty-icon">🌙</div><p>No pools yet</p><p class="empty-sub">Create a pool and invite friends to start collecting ideas.</p><button class="btn btn-primary" style="margin-top:16px" onclick="openCreatePoolModal()">Create your first pool</button></div>`
        : `<div class="pools-grid">${pools.map(poolCard).join('')}</div>`
      }
    </div>
  `);
}

function poolCard(p) {
  const isOwner = p.my_role === 'owner';
  const totalCount = Object.values(p.counts||{}).reduce((a,b)=>a+b,0);
  return `
    <div class="pool-card" onclick="Router.go('/pool/${esc(p.id)}')">
      <div class="pool-card-top">
        <div>
          <div class="pool-card-name">${esc(p.name)}</div>
          ${p.description ? `<div class="pool-card-desc">${esc(p.description)}</div>` : ''}
        </div>
        <div class="pool-card-badges">
          ${p.is_published ? '<span class="badge badge-published">● Published</span>' : '<span class="badge badge-private">Private</span>'}
          <span class="badge ${isOwner?'badge-owner':'badge-contributor'}">${isOwner?'Owner':'Contributor'}</span>
        </div>
      </div>
      <div class="pool-card-counts">
        ${CATEGORIES.map(cat => `<span class="cat-pill" style="${catVars(cat)}">${cat.icon} ${p.counts?.[cat.id]||0} ${cat.label}</span>`).join('')}
      </div>
      <div class="pool-card-footer">
        <span class="pool-card-meta">${p.member_count} member${p.member_count!==1?'s':''} · Created ${fmtShort(p.created_at)}</span>
        <span class="btn btn-ghost btn-sm">Open →</span>
      </div>
    </div>
  `;
}

function openCreatePoolModal() {
  openModal(`
    <button class="modal-close">×</button>
    <div class="modal-title">Create a new pool</div>
    <form id="create-pool-form">
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="field"><label>Pool name *</label><input class="input" name="name" placeholder="e.g. Friday Night Ideas" required maxlength="60" autofocus/></div>
        <div class="field"><label>Description</label><textarea class="input" name="description" placeholder="What's this pool for?" maxlength="200"></textarea></div>
        <div class="field">
          <label>Duplicate suggestions</label>
          <div class="toggle-wrapper">
            <label class="toggle">
              <input type="checkbox" id="allow-dup-toggle" checked/>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
            <span class="toggle-label" id="allow-dup-label">Allowed — members can add any text</span>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create pool</button>
      </div>
    </form>
  `, (modal) => {
    const dupToggle = modal.querySelector('#allow-dup-toggle');
    const dupLabel  = modal.querySelector('#allow-dup-label');
    dupToggle.addEventListener('change', () => {
      dupLabel.textContent = dupToggle.checked
        ? 'Allowed — members can add any text'
        : 'Blocked — similar text will be rejected';
    });
    modal.querySelector('#create-pool-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const pool = await API.post('/pools', { name: fd.get('name'), description: fd.get('description'), allowDuplicates: dupToggle.checked });
        closeModal();
        toast(`"${pool.name}" created!`, 'success');
        Router.go(`/pool/${pool.id}`);
      } catch(err) {
        toast(err.message, 'error');
        btn.disabled = false; btn.textContent = 'Create pool';
      }
    };
  });
}

// ===== POOL DETAIL VIEW =====
let poolState = { pool:null, suggestions:null, members:null, tab:'suggest', activeCategory:null };

async function renderPool(id) {
  loadingView();
  let pool;
  try { pool = await API.get(`/pools/${id}`); }
  catch(err) {
    setApp(`<div class="view"><div class="error-banner">${esc(err.message)}</div><button class="btn btn-ghost" onclick="Router.go('/pools')">← My Pools</button></div>`);
    return;
  }

  const suggestions = await API.get(`/pools/${id}/suggestions`);
  poolState = { pool, suggestions, members: null, tab: 'suggest', activeCategory: CATEGORIES[0].id };

  renderPoolShell();
  renderPoolTab('suggest');
}

function renderPoolShell() {
  const { pool } = poolState;
  const isOwner = pool.my_role === 'owner';
  const isMember = !!pool.my_role;
  const totalCount = Object.values(pool.counts||{}).reduce((a,b)=>a+b,0);

  setApp(`
    <div class="view">
      <button class="back-link" onclick="Router.go('/pools')">← My Pools</button>

      <div class="pool-header">
        <div class="pool-header-top">
          <div class="pool-header-info">
            <div class="pool-title">${esc(pool.name)}</div>
            ${pool.description ? `<div class="pool-desc">${esc(pool.description)}</div>` : ''}
            <div class="pool-header-badges">
              ${pool.is_published ? '<span class="badge badge-published">● Published</span>' : '<span class="badge badge-private">🔒 Private</span>'}
              ${!pool.allow_duplicates ? '<span class="badge badge-no-dupes">No duplicates</span>' : ''}
              <span class="pool-stat">👥 ${pool.member_count} member${pool.member_count!==1?'s':''}</span>
              <span class="pool-stat">💡 ${totalCount} suggestions</span>
            </div>
          </div>
          <div class="pool-header-actions" id="pool-header-actions">
            ${isMember ? renderPoolHeaderActions(pool) : ''}
          </div>
        </div>
      </div>

      <div class="pool-tabs">
        <button class="pool-tab active" id="ptab-suggest" onclick="switchPoolTab('suggest')">Suggest</button>
        <button class="pool-tab" id="ptab-generate" onclick="switchPoolTab('generate')">Generate</button>
        ${isMember ? `<button class="pool-tab" id="ptab-members" onclick="switchPoolTab('members')">Members</button>` : ''}
        ${isMember ? `<button class="pool-tab" id="ptab-saved" onclick="switchPoolTab('saved')">Saved</button>` : ''}
      </div>

      <div id="pool-tab-content"></div>
    </div>
  `);
  attachPoolHeaderActions();
}

function renderPoolHeaderActions(pool) {
  const isOwner = pool.my_role === 'owner';
  return `
    ${isOwner ? `
      <button class="btn ${pool.is_published?'btn-ghost':'btn-success'} btn-sm" id="btn-publish">
        ${pool.is_published ? '🔒 Unpublish' : '🌐 Publish'}
      </button>
      <button class="btn btn-ghost btn-sm" id="btn-edit-pool">Edit</button>
    ` : ''}
    <button class="btn btn-ghost btn-sm" id="btn-invite">Invite link</button>
    ${isOwner
      ? `<button class="btn btn-danger btn-sm" id="btn-delete-pool">Delete pool</button>`
      : `<button class="btn btn-ghost btn-sm" id="btn-leave-pool">Leave</button>`}
  `;
}

function attachPoolHeaderActions() {
  const { pool } = poolState;
  const isOwner = pool.my_role === 'owner';

  document.getElementById('btn-publish')?.addEventListener('click', async () => {
    try {
      const r = await API.post(`/pools/${pool.id}/publish`);
      poolState.pool.is_published = r.is_published;
      toast(r.is_published ? 'Pool is now public on Browse.' : 'Pool is now private.', 'success');
      renderPoolShell();
      renderPoolTab(poolState.tab);
      attachPoolHeaderActions();
    } catch(err) { toast(err.message, 'error'); }
  });

  document.getElementById('btn-invite')?.addEventListener('click', async () => {
    try {
      const r = await API.get(`/pools/${pool.id}/invite-code`);
      const link = `${location.origin}/#/join/${r.code}`;
      openModal(`
        <button class="modal-close">×</button>
        <div class="modal-title">Invite link</div>
        <p style="font-size:13px;color:var(--text-dim);margin-bottom:14px">Share this link to let others contribute to <strong>${esc(pool.name)}</strong>.</p>
        <div class="invite-link-row">
          <div class="invite-link-box" id="invite-link-text">${esc(link)}</div>
          <button class="btn btn-ghost btn-sm" id="btn-copy-invite">Copy</button>
          ${isOwner ? `<button class="btn btn-ghost btn-sm" id="btn-refresh-code">Refresh</button>` : ''}
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:10px">Anyone with this link can join and contribute. Refreshing generates a new link and invalidates the old one.</p>
      `, (modal) => {
        modal.querySelector('#btn-copy-invite').onclick = () => {
          navigator.clipboard.writeText(link).then(() => toast('Link copied!', 'success')).catch(() => toast('Copy failed — copy manually.', 'error'));
        };
        modal.querySelector('#btn-refresh-code')?.addEventListener('click', async () => {
          try {
            const r2 = await API.post(`/pools/${pool.id}/invite-code/refresh`);
            const newLink = `${location.origin}/#/join/${r2.code}`;
            modal.querySelector('#invite-link-text').textContent = newLink;
            modal.querySelector('#btn-copy-invite').onclick = () => navigator.clipboard.writeText(newLink).then(()=>toast('Link copied!','success'));
            toast('Invite link refreshed.', 'success');
          } catch(err) { toast(err.message, 'error'); }
        });
      });
    } catch(err) { toast(err.message, 'error'); }
  });

  document.getElementById('btn-edit-pool')?.addEventListener('click', () => {
    const allowDupChecked = pool.allow_duplicates !== 0;
    openModal(`
      <button class="modal-close">×</button>
      <div class="modal-title">Edit pool</div>
      <form id="edit-pool-form">
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="field"><label>Pool name *</label><input class="input" name="name" value="${esc(pool.name)}" required maxlength="60"/></div>
          <div class="field"><label>Description</label><textarea class="input" name="description" maxlength="200">${esc(pool.description||'')}</textarea></div>
          <div class="field">
            <label>Duplicate suggestions</label>
            <div class="toggle-wrapper">
              <label class="toggle">
                <input type="checkbox" id="edit-dup-toggle" ${allowDupChecked?'checked':''}/>
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
              <span class="toggle-label" id="edit-dup-label">${allowDupChecked?'Allowed — members can add any text':'Blocked — similar text will be rejected'}</span>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    `, (modal) => {
      const editDupToggle = modal.querySelector('#edit-dup-toggle');
      const editDupLabel  = modal.querySelector('#edit-dup-label');
      editDupToggle.addEventListener('change', () => {
        editDupLabel.textContent = editDupToggle.checked
          ? 'Allowed — members can add any text'
          : 'Blocked — similar text will be rejected';
      });
      modal.querySelector('#edit-pool-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await API.put(`/pools/${pool.id}`, { name: fd.get('name'), description: fd.get('description'), allowDuplicates: editDupToggle.checked });
          poolState.pool.name = fd.get('name'); poolState.pool.description = fd.get('description');
          poolState.pool.allow_duplicates = editDupToggle.checked ? 1 : 0;
          closeModal(); toast('Pool updated.', 'success');
          renderPoolShell(); renderPoolTab(poolState.tab); attachPoolHeaderActions();
        } catch(err) { toast(err.message, 'error'); }
      };
    });
  });

  document.getElementById('btn-delete-pool')?.addEventListener('click', () => {
    openModal(`
      <button class="modal-close">×</button>
      <div class="modal-title">Delete pool?</div>
      <p style="font-size:14px;color:var(--text-dim);margin-bottom:20px">This will permanently delete <strong>${esc(pool.name)}</strong> and all its suggestions. This cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-danger" id="confirm-delete">Delete permanently</button>
      </div>
    `, (modal) => {
      modal.querySelector('#confirm-delete').onclick = async () => {
        try { await API.delete(`/pools/${pool.id}`); closeModal(); toast('Pool deleted.', 'success'); Router.go('/pools'); }
        catch(err) { toast(err.message, 'error'); }
      };
    });
  });

  document.getElementById('btn-leave-pool')?.addEventListener('click', () => {
    openModal(`
      <button class="modal-close">×</button>
      <div class="modal-title">Leave pool?</div>
      <p style="font-size:14px;color:var(--text-dim);margin-bottom:20px">You'll need a new invite link to rejoin <strong>${esc(pool.name)}</strong>.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-danger" id="confirm-leave">Leave pool</button>
      </div>
    `, (modal) => {
      modal.querySelector('#confirm-leave').onclick = async () => {
        try { await API.delete(`/pools/${pool.id}/members/${currentUser.id}`); closeModal(); toast('Left the pool.', 'success'); Router.go('/pools'); }
        catch(err) { toast(err.message, 'error'); }
      };
    });
  });
}

function switchPoolTab(tab) {
  poolState.tab = tab;
  document.querySelectorAll('.pool-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`ptab-${tab}`)?.classList.add('active');
  renderPoolTab(tab);
}

async function renderPoolTab(tab) {
  if (tab === 'suggest') renderSuggestTab();
  else if (tab === 'generate') renderGenerateTab();
  else if (tab === 'members') await renderMembersTab();
  else if (tab === 'saved') await renderSavedTab();
}

// ===== OPTIONAL ATTRIBUTE FIELDS =====
// Data-driven: returns the optional attribute inputs that apply to a category.
// To add a new attribute later (e.g. location for all categories), extend these three.
function hasAttributeFields(catId) { return catId === 'activity' || catId === 'modifier'; }

function attributeFieldsHTML(catId, attrs = {}, idPrefix = 'attr') {
  let html = '';
  if (catId === 'activity') {
    const mins = attrs.estimatedMinutes || 0;
    const h = Math.floor(mins / 60), m = mins % 60;
    html += `
      <div class="attr-field">
        <label class="attr-label">⏱ Estimated time</label>
        <div class="time-picker">
          <input type="number" id="${idPrefix}-hours" class="time-input" min="0" max="24" placeholder="0" value="${h||''}"/>
          <span class="time-unit">hr</span>
          <input type="number" id="${idPrefix}-mins" class="time-input" min="0" max="59" placeholder="0" value="${m||''}"/>
          <span class="time-unit">min</span>
        </div>
      </div>`;
  }
  if (catId === 'modifier') {
    const targets = CATEGORIES.filter(c => !c.isModifier);
    const selected = attrs.appliesTo || targets[0]?.id;
    html += `
      <div class="attr-field">
        <label class="attr-label">Applies to</label>
        <select id="${idPrefix}-appliesTo" class="attr-select">
          ${targets.map(c => `<option value="${c.id}" ${c.id===selected?'selected':''}>${c.icon} ${esc(c.label)}</option>`).join('')}
        </select>
      </div>`;
  }
  return html;
}

// Read-only attribute pills shown on a suggestion card
function suggestionAttrPillsHTML(s) {
  const pills = [];
  const mins = s.attributes?.estimatedMinutes;
  if (mins) pills.push(`<span class="suggestion-time-pill">⏱ ${esc(fmtDuration(mins))}</span>`);
  if (s.category_id === 'modifier') {
    const target = catById(s.attributes?.appliesTo) || CATEGORIES.find(c => !c.isModifier);
    if (target) pills.push(`<span class="modifier-applies-pill">→ ${target.icon} ${esc(target.label)}</span>`);
  }
  return pills.length ? `<div class="suggestion-attrs">${pills.join('')}</div>` : '';
}

function readAttributeFields(catId, idPrefix = 'attr') {
  const attrs = {};
  if (catId === 'activity') {
    const h = parseInt(document.getElementById(`${idPrefix}-hours`)?.value) || 0;
    const m = parseInt(document.getElementById(`${idPrefix}-mins`)?.value) || 0;
    const total = Math.min(h * 60 + m, 1440);
    if (total > 0) attrs.estimatedMinutes = total;
  }
  if (catId === 'modifier') {
    const sel = document.getElementById(`${idPrefix}-appliesTo`)?.value;
    if (sel) attrs.appliesTo = sel;
  }
  return attrs;
}

// ===== DOWNLOADS =====
function downloadCSV(rows, filename) {
  const cell = v => {
    const s = String(v ?? '');
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n'); // BOM for Excel
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: filename,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function downloadSuggestions() {
  const { pool, suggestions } = poolState;
  const rows = [['Category', 'Text', 'Added By', 'Estimated Time', 'Applies To']];
  CATEGORIES.forEach(cat => {
    suggestions.filter(s => s.category_id === cat.id).forEach(s => {
      const time    = s.attributes?.estimatedMinutes ? fmtDuration(s.attributes.estimatedMinutes) : '';
      const applies = cat.isModifier ? (catById(s.attributes?.appliesTo) || CATEGORIES.find(c => !c.isModifier))?.label || '' : '';
      rows.push([cat.label, s.text, s.added_by_name, time, applies]);
    });
  });
  downloadCSV(rows, `${pool.name} - Suggestions.csv`);
}

function downloadCombos() {
  if (!lastGeneratedData) return;
  const { pool } = poolState;
  const { combos } = lastGeneratedData;
  const colCats = CATEGORIES.filter(c => !c.isModifier);
  const hasTime = combos.some(r => r._timeMins != null);
  const headers = ['#', ...colCats.map(c => c.label), ...(hasTime ? ['Total Time'] : [])];
  const rows = [headers];
  combos.forEach((row, i) => {
    const cells = [String(i + 1)];
    colCats.forEach(cat => {
      const items = (row[cat.id] || []).map((item, idx) => {
        const mod = row._mods?.[cat.id]?.[idx];
        return mod ? `${item.text} [${mod.text}]` : item.text;
      });
      cells.push(items.join(' / '));
    });
    if (hasTime) cells.push(row._timeMins != null ? fmtDuration(row._timeMins) : '');
    rows.push(cells);
  });
  downloadCSV(rows, `${pool.name} - Combinations.csv`);
}

// ===== SUGGEST TAB =====
function renderSuggestTab() {
  const { pool, suggestions } = poolState;
  const isMember = !!pool.my_role;
  const cat = catById(poolState.activeCategory);

  const content = document.getElementById('pool-tab-content');
  content.innerHTML = `
    <div class="category-tabs" id="cat-tabs"></div>
    ${isMember ? `
      <div class="add-form" id="add-form" style="${catVars(cat)}">
        <span class="add-form-icon" id="add-form-icon">${cat.icon}</span>
        <input type="text" id="suggestion-input" placeholder="Add a ${cat.label.toLowerCase()}…" maxlength="200" autocomplete="off"/>
        <button class="btn-add" id="add-btn" style="background:${cat.color}">Add</button>
      </div>
      <div id="add-details-box"></div>
      <div id="suggest-toolbar"></div>
    ` : `<div class="readonly-notice">👁 You're viewing this pool as a guest — join to contribute suggestions.</div>`}
    <div id="suggestions-area"></div>
  `;

  renderCategoryTabs();
  renderAddDetails();
  renderSuggestToolbar();
  renderSuggestions();

  if (isMember) {
    const addBtn = document.getElementById('add-btn');
    const addInput = document.getElementById('suggestion-input');
    const doAdd = async () => {
      const text = addInput.value.trim();
      if (!text) { addInput.focus(); return; }
      addBtn.disabled = true;
      try {
        const attributes = readAttributeFields(poolState.activeCategory, 'add');
        const s = await API.post(`/pools/${pool.id}/suggestions`, { categoryId: poolState.activeCategory, text, attributes });
        poolState.suggestions.push(s);
        poolState.pool.counts = poolState.pool.counts || {};
        poolState.pool.counts[poolState.activeCategory] = (poolState.pool.counts[poolState.activeCategory]||0)+1;
        addInput.value = '';
        addInput.focus();
        renderCategoryTabs();
        renderAddDetails(); // reset the detail inputs
        renderSuggestions();
      } catch(err) { toast(err.message, 'error'); }
      finally { addBtn.disabled = false; }
    };
    addBtn.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', e => { if(e.key==='Enter') doAdd(); });
  }
}

// Optional "Add details" disclosure under the add form — only for categories with attributes
function renderAddDetails() {
  const box = document.getElementById('add-details-box');
  if (!box) return;
  const catId = poolState.activeCategory;
  if (!hasAttributeFields(catId)) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <details class="add-details">
      <summary class="details-toggle">＋ Add details</summary>
      <div class="details-panel">${attributeFieldsHTML(catId, {}, 'add')}</div>
    </details>`;
}

// Suggest toolbar: "Let Nightpick Suggest" (member-only) + "Guess times" (owner + activity only)
function renderSuggestToolbar() {
  const bar = document.getElementById('suggest-toolbar');
  if (!bar) return;
  const isMember = !!poolState.pool.my_role;
  const isOwner  = poolState.pool.my_role === 'owner';
  const cat      = catById(poolState.activeCategory);
  const showSuggest = isMember && Auth.config.llmEnabled;
  const showGuess   = isMember && poolState.activeCategory === 'activity' && Auth.config.llmEnabled;

  if (!showSuggest && !showGuess) { bar.innerHTML = ''; return; }

  const buttons = [];
  if (showSuggest) buttons.push(`<button class="btn-guess" id="suggest-ai-btn" style="${catVars(cat)}">✨ Let Nightpick Suggest</button>`);
  if (showGuess)   buttons.push(`<button class="btn-guess" id="guess-btn" style="${catVars(catById('activity'))}">⏱ Guess times</button>`);
  bar.innerHTML = `<div class="suggest-toolbar-row">${buttons.join('')}</div>`;

  if (showSuggest) document.getElementById('suggest-ai-btn').addEventListener('click', runSuggestItem);
  if (showGuess)   document.getElementById('guess-btn').addEventListener('click', runGuessTimes);
}

async function runSuggestItem() {
  const btn   = document.getElementById('suggest-ai-btn');
  const input = document.getElementById('suggestion-input');
  if (!btn || !input) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '✨ Thinking…';
  try {
    const { text } = await API.post(`/pools/${poolState.pool.id}/suggest-item`, { categoryId: poolState.activeCategory });
    input.value = text;
    input.focus();
    toast('Suggestion ready — review and click Add!', 'info');
  } catch(err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function runGuessTimes() {
  const btn = document.getElementById('guess-btn');
  if (!btn) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '✨ Guessing…';
  try {
    const { updated } = await API.post(`/pools/${poolState.pool.id}/estimate-times`);
    if (!updated || updated.length === 0) {
      toast('Every activity already has a time estimate.', 'info');
    } else {
      const byId = new Map(updated.map(u => [u.id, u]));
      poolState.suggestions = poolState.suggestions.map(s => byId.get(s.id) || s);
      renderSuggestions();
      toast(`Estimated ${updated.length} activit${updated.length===1?'y':'ies'}.`, 'success');
    }
  } catch(err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function renderCategoryTabs() {
  const tabs = document.getElementById('cat-tabs');
  if (!tabs) return;
  const counts = poolState.pool.counts || {};
  tabs.innerHTML = CATEGORIES.map(cat => `
    <button class="tab-btn ${poolState.activeCategory===cat.id?'active':''}" style="${catVars(cat)}" data-cat="${cat.id}">
      <span class="tab-icon">${cat.icon}</span>${cat.label}
      <span class="tab-count">${counts[cat.id]||0}</span>
    </button>
  `).join('');
  tabs.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      poolState.activeCategory = btn.dataset.cat;
      renderCategoryTabs();
      renderAddDetails();
      renderSuggestToolbar();
      renderSuggestions();
      // update add form placeholder
      const cat = catById(poolState.activeCategory);
      const inp = document.getElementById('suggestion-input');
      const icon = document.getElementById('add-form-icon');
      const addBtn = document.getElementById('add-btn');
      if (inp) inp.placeholder = `Add a ${cat.label.toLowerCase()}…`;
      if (icon) icon.textContent = cat.icon;
      if (addBtn) addBtn.style.background = cat.color;
    });
  });
}

function renderSuggestions() {
  const { pool, suggestions } = poolState;
  const cat = catById(poolState.activeCategory);
  const isOwner = pool.my_role === 'owner';
  const catSuggestions = suggestions.filter(s => s.category_id === poolState.activeCategory).slice().reverse();
  const area = document.getElementById('suggestions-area');
  if (!area) return;

  if (catSuggestions.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="empty-icon">${cat.icon}</div><p class="empty-primary">No ${cat.label.toLowerCase()} suggestions yet</p><p class="empty-sub">Be the first to add one!</p></div>`;
    return;
  }

  area.innerHTML = `
    <div class="suggestions-header">
      <div class="suggestions-title" style="${catVars(cat)}"><span class="dot"></span>${catSuggestions.length} ${cat.label} suggestion${catSuggestions.length!==1?'s':''}</div>
      <button class="btn-dl" id="export-suggestions-btn" title="Download all suggestions as CSV">⬇ Export all</button>
    </div>
    <div class="suggestions-grid">
      ${catSuggestions.map(s => {
        const canEdit = isOwner || s.added_by === currentUser?.id;
        return `
          <div class="suggestion-card" style="${catVars(cat)}" data-id="${s.id}">
            <div class="suggestion-content">
              <div class="suggestion-text">${esc(s.text)}</div>
              ${suggestionAttrPillsHTML(s)}
              <div class="suggestion-meta">
                <span class="suggestion-user">${esc(s.added_by_name)}</span>
                <span class="suggestion-dot"></span>
                <span class="suggestion-date">${fmtShort(s.created_at)}</span>
              </div>
            </div>
            <div class="suggestion-actions">
              ${canEdit ? `<button class="edit-btn" data-id="${s.id}" title="Edit">✎</button>` : ''}
              ${canEdit ? `<button class="delete-btn" data-id="${s.id}" title="Delete">×</button>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  document.getElementById('export-suggestions-btn')?.addEventListener('click', downloadSuggestions);

  area.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await API.delete(`/pools/${pool.id}/suggestions/${btn.dataset.id}`);
        poolState.suggestions = poolState.suggestions.filter(s => s.id !== btn.dataset.id);
        poolState.pool.counts[poolState.activeCategory] = Math.max(0, (poolState.pool.counts[poolState.activeCategory]||1)-1);
        renderCategoryTabs();
        renderSuggestions();
        toast('Suggestion removed.', 'success');
      } catch(err) { toast(err.message, 'error'); }
    });
  });

  area.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const s = poolState.suggestions.find(x => x.id === btn.dataset.id);
      if (s) openEditSuggestionModal(s);
    });
  });
}

function openEditSuggestionModal(s) {
  const cat = catById(s.category_id);
  openModal(`
    <button class="modal-close">×</button>
    <div class="modal-title">Edit ${esc(cat?.label || 'suggestion')}</div>
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label>Text *</label><input type="text" id="edit-text" class="input" maxlength="200" value="${esc(s.text)}"/></div>
      ${hasAttributeFields(s.category_id) ? `<div class="field">${attributeFieldsHTML(s.category_id, s.attributes || {}, 'edit')}</div>` : ''}
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="edit-cancel">Cancel</button>
      <button type="button" class="btn btn-primary" id="edit-save">Save changes</button>
    </div>
  `, (modal) => {
    const input = modal.querySelector('#edit-text');
    input.focus();
    modal.querySelector('#edit-cancel').onclick = closeModal;
    const save = async () => {
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      const saveBtn = modal.querySelector('#edit-save');
      saveBtn.disabled = true;
      try {
        const attributes = readAttributeFields(s.category_id, 'edit');
        const updated = await API.put(`/pools/${poolState.pool.id}/suggestions/${s.id}`, { text, attributes });
        poolState.suggestions = poolState.suggestions.map(x => x.id === updated.id ? updated : x);
        closeModal();
        renderSuggestions();
        toast('Suggestion updated.', 'success');
      } catch(err) { toast(err.message, 'error'); saveBtn.disabled = false; }
    };
    modal.querySelector('#edit-save').onclick = save;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  });
}

// ===== GENERATE TAB =====
let lastGenSettings = null;
let lastGeneratedData = null;

function renderGenerateTab() {
  const hasModifiers = CATEGORIES.some(c => c.isModifier);
  const colCats = CATEGORIES.filter(c => !c.isModifier);
  const lgs = lastGenSettings || {};
  const tlMinH = Math.floor((lgs.minMins||60) / 60), tlMinM = (lgs.minMins||60) % 60;
  const tlMaxH = Math.floor((lgs.maxMins||180) / 60), tlMaxM = (lgs.maxMins||180) % 60;
  const content = document.getElementById('pool-tab-content');
  content.innerHTML = `
    <div class="generate-controls">
      <div class="gen-ctrl" id="combo-count-ctrl">
        <span class="control-label">Combinations</span>
        <input type="number" class="count-input" id="combo-count" value="${lgs.count||5}" min="1" max="50"/>
      </div>
      <button class="btn-generate" id="generate-btn">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Generate
      </button>
      <button class="btn-reshuffle" id="reshuffle-btn" style="display:none">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1 4h10M1 4l3-3M1 4l3 3M15 12H5M15 12l-3-3M15 12l-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Reshuffle
      </button>
      <button class="btn-dl" id="export-combos-btn" style="display:none" title="Download combinations as CSV">⬇ Export</button>
      ${poolState.pool?.my_role === 'owner' ? `<button class="btn-save-combo" id="save-combo-btn" style="display:none">💾 Save</button>` : ''}
    </div>
    <details class="gen-advanced" ${lgs.advancedOpen?'open':''}>
      <summary class="details-toggle">⚙ Advanced options</summary>
      <div class="details-panel">
        <div class="gen-ctrl">
          <span class="control-label">By time limit</span>
          <div class="toggle-wrapper">
            <label class="toggle">
              <input type="checkbox" id="time-limit-toggle" ${lgs.timeLimitMode?'checked':''}>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
            <span class="toggle-label" id="time-limit-label">${lgs.timeLimitMode?'Active':'Off'}</span>
          </div>
        </div>
        <div class="time-limit-row" id="time-limit-row" style="${lgs.timeLimitMode?'':'display:none'}">
          <span class="control-label">Time window</span>
          <div class="time-limit-inputs">
            <div class="time-bound">
              <span class="time-bound-label">Min</span>
              <div class="time-picker">
                <input type="number" id="time-min-hours" class="time-input" min="0" max="24" placeholder="0" value="${tlMinH||''}"/>
                <span class="time-unit">hr</span>
                <input type="number" id="time-min-mins" class="time-input" min="0" max="59" placeholder="0" value="${tlMinM||''}"/>
                <span class="time-unit">min</span>
              </div>
            </div>
            <div class="time-bound">
              <span class="time-bound-label">Max</span>
              <div class="time-picker">
                <input type="number" id="time-max-hours" class="time-input" min="0" max="24" placeholder="0" value="${tlMaxH||''}"/>
                <span class="time-unit">hr</span>
                <input type="number" id="time-max-mins" class="time-input" min="0" max="59" placeholder="0" value="${tlMaxM||''}"/>
                <span class="time-unit">min</span>
              </div>
            </div>
          </div>
        </div>
        <div class="gen-ctrl">
          <span class="control-label">Allow repeats</span>
          <div class="toggle-wrapper">
            <label class="toggle">
              <input type="checkbox" id="replacement-toggle" ${lgs.withReplacement!==false?'checked':''}>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
            <span class="toggle-label" id="toggle-label">${lgs.withReplacement!==false?'Yes — same item can repeat':'No — each item used once'}</span>
          </div>
        </div>
        <div class="gen-ctrl">
          <span class="control-label">Per combination</span>
          <div class="cat-counts-row">
            ${colCats.map(cat=>`
              <div class="cat-count-item" style="${catVars(cat)}">
                <span class="cat-count-icon">${cat.icon}</span>
                <input type="number" class="cat-count-input" id="cat-count-${cat.id}"
                       value="${lgs.catCounts?.[cat.id]||1}" min="1" max="10"/>
              </div>
            `).join('')}
          </div>
        </div>
        ${hasModifiers ? `
        <div class="gen-ctrl">
          <span class="control-label">Modifiers</span>
          <div class="toggle-wrapper">
            <label class="toggle">
              <input type="checkbox" id="modifier-toggle" ${lgs.includeModifiers?'checked':''}>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
            <span class="toggle-label" id="modifier-label">${lgs.includeModifiers?'Included':'Excluded'}</span>
          </div>
        </div>
        <div class="chance-row" id="chance-row" style="${lgs.includeModifiers?'':'display:none'}">
          <span class="control-label">Modifier chance</span>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" class="chance-slider" id="chance-slider" min="0" max="100" value="${lgs.modifierChance??50}"/>
            <span class="chance-display" id="chance-display">${lgs.modifierChance??50}%</span>
          </div>
        </div>
        ` : ''}
        <div class="gen-ctrl">
          <span class="control-label">Max per user</span>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="number" class="cat-count-input" id="max-per-user" min="1" max="100" placeholder="∞" value="${lgs.maxPerUser||''}"/>
            <span class="toggle-label">per category</span>
          </div>
        </div>
      </div>
    </details>
    <div id="results-area">
      <div class="generate-placeholder">
        <div class="placeholder-glyph">✦</div>
        <p class="placeholder-text">Set your options and click Generate</p>
        <p class="placeholder-sub">Combinations are drawn from this pool's suggestions</p>
      </div>
    </div>
  `;

  const toggle = document.getElementById('replacement-toggle');
  const toggleLabel = document.getElementById('toggle-label');
  toggle.addEventListener('change', () => {
    toggleLabel.textContent = toggle.checked ? 'Yes — same item can repeat' : 'No — each item used once';
  });

  const timeLimitToggle = document.getElementById('time-limit-toggle');
  const timeLimitLabel  = document.getElementById('time-limit-label');
  const timeLimitRow    = document.getElementById('time-limit-row');
  timeLimitToggle.addEventListener('change', () => {
    const on = timeLimitToggle.checked;
    timeLimitLabel.textContent = on ? 'Active' : 'Off';
    timeLimitRow.style.display = on ? '' : 'none';
  });

  if (hasModifiers) {
    const modToggle    = document.getElementById('modifier-toggle');
    const modLabel     = document.getElementById('modifier-label');
    const chanceRow    = document.getElementById('chance-row');
    const chanceSlider = document.getElementById('chance-slider');
    const chanceDisplay = document.getElementById('chance-display');
    modToggle.addEventListener('change', () => {
      modLabel.textContent = modToggle.checked ? 'Included' : 'Excluded';
      chanceRow.style.display = modToggle.checked ? '' : 'none';
    });
    chanceSlider.addEventListener('input', () => {
      chanceDisplay.textContent = `${chanceSlider.value}%`;
    });
  }

  const doGenerate = () => {
    const timeLimitMode = document.getElementById('time-limit-toggle')?.checked || false;
    const withReplacement = document.getElementById('replacement-toggle').checked;
    const includeModifiers = hasModifiers && document.getElementById('modifier-toggle').checked;
    const modifierChance = hasModifiers ? parseInt(document.getElementById('chance-slider')?.value ?? 50) : 0;
    const maxPerUser = parseInt(document.getElementById('max-per-user')?.value) || 0;
    const catCounts = {};
    colCats.forEach(cat => {
      catCounts[cat.id] = Math.max(1, Math.min(10, parseInt(document.getElementById(`cat-count-${cat.id}`)?.value || 1)));
    });
    const advancedOpen = document.querySelector('.gen-advanced')?.open || false;

    const count = Math.max(1, Math.min(50, parseInt(document.getElementById('combo-count').value)||5));
    if (timeLimitMode) {
      const minMins = (parseInt(document.getElementById('time-min-hours')?.value) || 0) * 60
                    + (parseInt(document.getElementById('time-min-mins')?.value)  || 0);
      const maxMins = (parseInt(document.getElementById('time-max-hours')?.value) || 0) * 60
                    + (parseInt(document.getElementById('time-max-mins')?.value)  || 0);
      if (maxMins <= 0) { toast('Set a maximum time first.', 'error'); return; }
      if (minMins > maxMins) { toast('Minimum time must be ≤ maximum time.', 'error'); return; }
      lastGenSettings = { count, withReplacement, includeModifiers, modifierChance, catCounts, advancedOpen, timeLimitMode, minMins, maxMins, maxPerUser };
      runGenerateByTime(count, minMins, maxMins, withReplacement, includeModifiers, modifierChance, catCounts, maxPerUser);
    } else {
      lastGenSettings = { count, withReplacement, includeModifiers, modifierChance, catCounts, advancedOpen, timeLimitMode: false, maxPerUser };
      runGenerate(count, withReplacement, includeModifiers, modifierChance, catCounts, null, 'results-area', 'reshuffle-btn', maxPerUser);
    }
  };

  document.getElementById('generate-btn').addEventListener('click', doGenerate);
  document.getElementById('reshuffle-btn').addEventListener('click', doGenerate);
  document.getElementById('export-combos-btn')?.addEventListener('click', downloadCombos);

  document.getElementById('save-combo-btn')?.addEventListener('click', () => {
    if (!lastGeneratedData) return;
    const pool = poolState.pool;
    const defaultLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    openModal(`
      <button class="modal-close">×</button>
      <div class="modal-title">Save combination set</div>
      <div class="field">
        <label>Label</label>
        <input class="input" id="save-label-input" placeholder="e.g. Friday Night Picks" maxlength="80" value="${esc(defaultLabel)}"/>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="confirm-save-combo">Save</button>
      </div>
    `, (modal) => {
      const inp = modal.querySelector('#save-label-input');
      inp.focus(); inp.select();
      modal.querySelector('#confirm-save-combo').onclick = async () => {
        const btn = modal.querySelector('#confirm-save-combo');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await API.post(`/pools/${pool.id}/saved-combos`, { label: inp.value.trim(), data: lastGeneratedData });
          closeModal();
          toast('Combination set saved!', 'success');
          const sb = document.getElementById('save-combo-btn');
          if (sb) { sb.disabled = true; setTimeout(() => { sb.disabled = false; }, 8000); }
        } catch(err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Save'; }
      };
    });
  });

  if (lastGenSettings) doGenerate();
}

// Shared combo-grid renderer used by live generation and saved-set display.
// Per-item modifiers come from row._mods[catId][idx]; falls back to the legacy
// single row._modifier (older saved sets) on the primary activity item.
function comboGridHTML(combos, { withReplacement = true, cc = {}, truncated = false, actualCount = combos.length } = {}) {
  const colCats  = CATEGORIES.filter(c => !c.isModifier);
  const modCat   = CATEGORIES.find(c => c.isModifier);
  const actCatId = (colCats.find(c => c.id === 'activity') || colCats[0])?.id;

  const resolveMod = (row, catId, idx) => {
    if (row._mods) return row._mods[catId]?.[idx] || null;
    if (row._modifier && catId === actCatId && idx === 0) return row._modifier; // legacy saved sets
    return null;
  };
  const modPill = (mod) => mod && modCat
    ? `<div class="combo-modifier-pill" style="--mod-color:${modCat.color}">${esc(modCat.icon)} ${esc(mod.text)}</div>` : '';

  const hasRowTime = combos.some(r => r._timeMins != null);
  const colTemplate = `${hasRowTime ? '52px' : '36px'} repeat(${colCats.length},1fr)`;
  let html = '';
  if (truncated) html += `<div class="warning-banner">⚠ Only ${actualCount} combination${actualCount!==1?'s':''} generated — not enough unique suggestions without repeats.</div>`;
  html += `
    <div class="results-meta">
      <span class="results-count">${combos.length} combination${combos.length!==1?'s':''}</span>
      <span class="results-mode">${withReplacement?'with repeats':'no repeats'}</span>
    </div>
    <div class="combo-grid-header" style="grid-template-columns:${colTemplate}">
      <div></div>
      ${colCats.map(cat=>`<div class="combo-col-header" style="${catVars(cat)}">${cat.icon} ${esc(cat.label)}${cc[cat.id]>1?` <span style="opacity:.55">×${cc[cat.id]}</span>`:''}</div>`).join('')}
    </div>
    <div class="combo-grid">
      ${combos.map((row,i)=>`
        <div class="combo-row" style="grid-template-columns:${colTemplate};animation-delay:${i*40}ms">
          <div class="combo-row-number">
            <span>${i+1}</span>
            ${row._timeMins != null ? `<div class="row-time">⏱ ${fmtDuration(row._timeMins)}</div>` : ''}
          </div>
          ${colCats.map(cat=>`
            <div class="combo-cell" style="${catVars(cat)}">
              <div class="combo-cell-label">${esc(cat.label)}${cc[cat.id]>1?`<span class="cell-count-badge"> ×${cc[cat.id]}</span>`:''}</div>
              ${(row[cat.id]||[]).map((item, idx)=>`
                <div class="combo-cell-item${cc[cat.id]>1?' multi':''}">
                  <div class="combo-cell-text">${esc(item.text)}</div>
                  ${cat.id === actCatId && item.attributes?.estimatedMinutes ? `<div class="combo-item-time">⏱ ${fmtDuration(item.attributes.estimatedMinutes)}</div>` : ''}
                  ${modPill(resolveMod(row, cat.id, idx))}
                  <div class="combo-cell-user">by ${esc(item.added_by_name)}</div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;
  return html;
}

// For each user in items, keep at most maxPerUser of their suggestions (random selection).
function applyMaxPerUser(items, maxPerUser) {
  if (!maxPerUser || maxPerUser <= 0) return items;
  const byUser = new Map();
  for (const s of items) {
    if (!byUser.has(s.added_by)) byUser.set(s.added_by, []);
    byUser.get(s.added_by).push(s);
  }
  const out = [];
  byUser.forEach(userItems => out.push(...shuffle([...userItems]).slice(0, maxPerUser)));
  return out;
}

function runGenerate(count, withReplacement, includeModifiers=false, modifierChance=50, catCounts=null, suggOverride=null, resultsId='results-area', reshuffleId='reshuffle-btn', maxPerUser=0) {
  const suggestions = suggOverride || poolState.suggestions;
  const resultsArea = document.getElementById(resultsId);
  const reshuffleBtn = document.getElementById(reshuffleId);

  const colCats = CATEGORIES.filter(c => !c.isModifier);
  const modCat  = CATEGORIES.find(c => c.isModifier);

  // Per-category pick counts (default 1)
  const cc = {};
  colCats.forEach(cat => { cc[cat.id] = Math.max(1, catCounts?.[cat.id] || 1); });

  const pools = {};
  let anyEmpty = false;
  colCats.forEach(cat => {
    const items = applyMaxPerUser(suggestions.filter(s => s.category_id === cat.id), maxPerUser);
    if (items.length === 0) anyEmpty = true;
    pools[cat.id] = shuffle(items);
  });

  if (anyEmpty) {
    resultsArea.innerHTML = `<div class="error-banner">⚠ Each category needs at least one suggestion before you can generate. Switch to the Suggest tab to add some.</div>`;
    reshuffleBtn.style.display = 'none';
    return;
  }

  // Max no-repeat combos = floor(poolSize / picksPerRow) for the most constrained category
  const minPoolSize = Math.min(...colCats.map(cat => Math.floor(pools[cat.id].length / cc[cat.id])));
  const actualCount = withReplacement ? count : Math.min(count, minPoolSize);
  const truncated = !withReplacement && actualCount < count;

  if (!withReplacement && actualCount === 0) {
    resultsArea.innerHTML = `<div class="error-banner">⚠ Not enough unique suggestions for the selected per-combination counts — add more or enable "Allow repeats".</div>`;
    reshuffleBtn.style.display = 'none';
    return;
  }

  // Build per-type modifier pools (each modifier targets a suggestion type via attributes.appliesTo).
  // Legacy/unset modifiers default to 'activity', preserving the original behavior.
  const colCatIds = new Set(colCats.map(c => c.id));
  const defaultModTarget = (colCats.find(c => c.id === 'activity') || colCats[0])?.id;
  const modPools = {};   // catId → shuffled modifiers for that type
  const modUsed  = {};   // catId → depletion index (no-repeat mode)
  if (includeModifiers && modCat) {
    suggestions.filter(s => s.category_id === modCat.id).forEach(m => {
      const target = m.attributes?.appliesTo || defaultModTarget;
      if (!colCatIds.has(target)) return;
      (modPools[target] ||= []).push(m);
    });
    Object.keys(modPools).forEach(k => { modPools[k] = shuffle(modPools[k]); modUsed[k] = 0; });
  }

  // Roll a modifier for a single item of category `catId` (per-item, so any pick can get one)
  const rollModifier = (catId) => {
    const pool = modPools[catId];
    if (!pool || pool.length === 0) return null;
    if (Math.random() * 100 >= modifierChance) return null;
    if (withReplacement) return pool[Math.floor(Math.random() * pool.length)];
    return modUsed[catId] < pool.length ? pool[modUsed[catId]++] : null;
  };

  const combos = [];
  for (let i = 0; i < actualCount; i++) {
    const row = { _mods: {} };
    colCats.forEach(cat => {
      const n = cc[cat.id];
      if (withReplacement) {
        row[cat.id] = Array.from({length: n}, () =>
          pools[cat.id][Math.floor(Math.random() * pools[cat.id].length)]);
      } else {
        row[cat.id] = pools[cat.id].slice(i * n, i * n + n);
      }
      // Independent modifier roll for every item in the cell
      row._mods[cat.id] = row[cat.id].map(() =>
        includeModifiers ? rollModifier(cat.id) : null);
    });
    combos.push(row);
  }

  resultsArea.innerHTML = comboGridHTML(combos, { withReplacement, cc, truncated, actualCount });
  reshuffleBtn.style.display = 'flex';
  // Store for Save/Export; expose action buttons
  lastGeneratedData = { settings: { count, withReplacement, includeModifiers, modifierChance, catCounts: cc }, combos };
  document.getElementById('save-combo-btn')?.style.setProperty('display', 'flex');
  document.getElementById('export-combos-btn')?.style.setProperty('display', 'flex');
}

// Time-limit generate: each of `count` combo rows independently fills activities within [minMins, maxMins].
// cc[activity] acts as a hard cap on activities per row; the time window determines how many actually fit.
function runGenerateByTime(count, minMins, maxMins, withReplacement, includeModifiers, modifierChance, catCounts, maxPerUser=0) {
  const suggestions  = poolState.suggestions;
  const resultsArea  = document.getElementById('results-area');
  const reshuffleBtn = document.getElementById('reshuffle-btn');

  const colCats = CATEGORIES.filter(c => !c.isModifier);
  const modCat  = CATEGORIES.find(c => c.isModifier);
  const cc = {};
  colCats.forEach(cat => { cc[cat.id] = Math.max(1, catCounts?.[cat.id] || 1); });

  // Only activities with time estimates are eligible.
  const timedPool = applyMaxPerUser(
    suggestions.filter(s => s.category_id === 'activity' && s.attributes?.estimatedMinutes > 0),
    maxPerUser
  );
  if (timedPool.length === 0) {
    resultsArea.innerHTML = `<div class="error-banner">⚠ No activities have time estimates — add some via ＋ Add details or use "⏱ Guess times" first.</div>`;
    reshuffleBtn.style.display = 'none';
    return;
  }

  for (const cat of colCats.filter(c => c.id !== 'activity')) {
    if (applyMaxPerUser(suggestions.filter(s => s.category_id === cat.id), maxPerUser).length === 0) {
      resultsArea.innerHTML = `<div class="error-banner">⚠ Each category needs at least one suggestion before you can generate.</div>`;
      reshuffleBtn.style.display = 'none';
      return;
    }
  }

  const otherPools = {};
  colCats.forEach(cat => {
    if (cat.id !== 'activity')
      otherPools[cat.id] = shuffle(applyMaxPerUser(suggestions.filter(s => s.category_id === cat.id), maxPerUser));
  });

  // Per-type modifier pools (same logic as runGenerate).
  const colCatIds = new Set(colCats.map(c => c.id));
  const defaultModTarget = (colCats.find(c => c.id === 'activity') || colCats[0])?.id;
  const modPools = {}, modUsed = {};
  if (includeModifiers && modCat) {
    suggestions.filter(s => s.category_id === modCat.id).forEach(m => {
      const target = m.attributes?.appliesTo || defaultModTarget;
      if (!colCatIds.has(target)) return;
      (modPools[target] ||= []).push(m);
    });
    Object.keys(modPools).forEach(k => { modPools[k] = shuffle(modPools[k]); modUsed[k] = 0; });
  }
  const rollModifier = (catId) => {
    const pool = modPools[catId];
    if (!pool || pool.length === 0) return null;
    if (Math.random() * 100 >= modifierChance) return null;
    if (withReplacement) return pool[Math.floor(Math.random() * pool.length)];
    return modUsed[catId] < pool.length ? pool[modUsed[catId]++] : null;
  };

  // No-repeat: track used activity ids across rows.
  const usedActIds = new Set();
  const combos = [];
  let shortRows = 0;

  for (let i = 0; i < count; i++) {
    const eligible = withReplacement
      ? [...timedPool]
      : timedPool.filter(a => !usedActIds.has(a.id));
    if (eligible.length === 0) break; // no more unique activities available

    // Greedy fill per row: pick up to cc[activity] activities that fit within maxMins.
    const shuffled = shuffle(eligible);
    let rowTotal = 0;
    const pickedActs = [];
    for (const act of shuffled) {
      if (pickedActs.length >= cc.activity) break;
      const m = act.attributes.estimatedMinutes;
      if (rowTotal + m <= maxMins) { pickedActs.push(act); rowTotal += m; }
    }

    if (!withReplacement) pickedActs.forEach(a => usedActIds.add(a.id));
    if (rowTotal < minMins) shortRows++;

    const row = { _mods: {}, _timeMins: rowTotal };
    row.activity = pickedActs;
    row._mods.activity = pickedActs.map(() => includeModifiers ? rollModifier('activity') : null);
    colCats.forEach(cat => {
      if (cat.id === 'activity') return;
      const pool = otherPools[cat.id], n = cc[cat.id];
      if (withReplacement) {
        row[cat.id] = Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)]);
      } else {
        row[cat.id] = Array.from({ length: n }, (_, j) => pool[(combos.length * n + j) % pool.length]);
      }
      row._mods[cat.id] = row[cat.id].map(() => includeModifiers ? rollModifier(cat.id) : null);
    });
    combos.push(row);
  }

  reshuffleBtn.style.display = 'flex';

  if (combos.length === 0) {
    resultsArea.innerHTML = `<div class="error-banner">⚠ No combinations could be generated. Try widening the time window, enabling "Allow repeats", or lowering the minimum.</div>`;
    return;
  }

  let html = '';
  if (combos.length < count) {
    html += `<div class="warning-banner">⚠ Only ${combos.length} combination${combos.length !== 1 ? 's' : ''} generated — ran out of unique timed activities.</div>`;
  } else if (shortRows > 0) {
    html += `<div class="warning-banner">⚠ ${shortRows} combination${shortRows !== 1 ? 's' : ''} couldn't reach the minimum time of ${fmtDuration(minMins)}. Try Reshuffle or lower the minimum.</div>`;
  }
  html += comboGridHTML(combos, { withReplacement, cc, truncated: false });
  resultsArea.innerHTML = html;

  lastGeneratedData = { settings: { timeLimitMode: true, count, minMins, maxMins, withReplacement, includeModifiers, modifierChance, catCounts: cc }, combos };
  document.getElementById('save-combo-btn')?.style.setProperty('display', 'flex');
  document.getElementById('export-combos-btn')?.style.setProperty('display', 'flex');
}

// ===== MEMBERS TAB =====
async function renderMembersTab() {
  const { pool } = poolState;
  const isOwner = pool.my_role === 'owner';
  const content = document.getElementById('pool-tab-content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const members = await API.get(`/pools/${pool.id}/members`);
  poolState.members = members;

  // Get invite code for display
  let inviteLink = '';
  try {
    const r = await API.get(`/pools/${pool.id}/invite-code`);
    inviteLink = `${location.origin}/#/join/${r.code}`;
  } catch {}

  content.innerHTML = `
    <div class="invite-section">
      <h3>Invite link</h3>
      <div class="invite-link-row">
        <div class="invite-link-box" id="invite-link-display">${esc(inviteLink)}</div>
        <button class="btn btn-ghost btn-sm" id="btn-copy-link">Copy</button>
        ${isOwner ? `<button class="btn btn-ghost btn-sm" id="btn-refresh-invite">Refresh code</button>` : ''}
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px">Share this with anyone you want to invite as a contributor.</p>
    </div>

    <div class="members-list" id="members-list">
      ${members.map(m => memberRow(m, isOwner, pool.created_by)).join('')}
    </div>
  `;

  document.getElementById('btn-copy-link').onclick = () => {
    navigator.clipboard.writeText(inviteLink).then(()=>toast('Invite link copied!','success')).catch(()=>toast('Copy failed.','error'));
  };

  document.getElementById('btn-refresh-invite')?.addEventListener('click', async () => {
    try {
      const r = await API.post(`/pools/${pool.id}/invite-code/refresh`);
      inviteLink = `${location.origin}/#/join/${r.code}`;
      document.getElementById('invite-link-display').textContent = inviteLink;
      toast('Invite link refreshed. Old link is now invalid.', 'success');
    } catch(err) { toast(err.message,'error'); }
  });

  content.querySelectorAll('.btn-remove-member').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      const name = btn.dataset.name;
      try {
        await API.delete(`/pools/${pool.id}/members/${uid}`);
        toast(`${name} removed.`, 'success');
        poolState.members = poolState.members.filter(m=>m.id!==uid);
        poolState.pool.member_count = Math.max(1, poolState.pool.member_count-1);
        document.getElementById('members-list').innerHTML = poolState.members.map(m=>memberRow(m,isOwner,pool.created_by)).join('');
        // Re-attach listeners
        content.querySelectorAll('.btn-remove-member').forEach(b=>b.addEventListener('click',()=>{}));
        await renderMembersTab();
      } catch(err) { toast(err.message,'error'); }
    });
  });
}

function memberRow(m, isOwner, createdBy) {
  const isPoolOwner = m.id === createdBy;
  const canRemove = isOwner && !isPoolOwner && m.id !== currentUser?.id;
  return `
    <div class="member-row">
      <div class="member-avatar">${esc(initial(m.display_name))}</div>
      <div class="member-info">
        <div class="member-name">${esc(m.display_name)} ${m.id===currentUser?.id?'<span style="font-size:11px;color:var(--text-muted)">(you)</span>':''}</div>
        <div class="member-joined">Joined ${fmtDate(m.joined_at)}</div>
      </div>
      <div class="member-actions">
        <span class="badge ${isPoolOwner?'badge-owner':'badge-contributor'}">${isPoolOwner?'Owner':'Contributor'}</span>
        ${canRemove ? `<button class="btn btn-ghost btn-sm btn-remove-member" data-uid="${esc(m.id)}" data-name="${esc(m.display_name)}">Remove</button>` : ''}
      </div>
    </div>
  `;
}

// ===== SAVED COMBOS TAB =====
function renderSavedComboSet(data) {
  if (!data?.combos?.length) return '<p style="font-size:13px;color:var(--text-muted);padding:12px 0">No combinations in this set.</p>';
  const colCats = CATEGORIES.filter(c => !c.isModifier);
  const cc = {};
  colCats.forEach(cat => { cc[cat.id] = data.settings?.catCounts?.[cat.id] || 1; });
  return comboGridHTML(data.combos, { withReplacement: !!data.settings?.withReplacement, cc });
}

async function renderSavedTab() {
  const { pool } = poolState;
  const isOwner = pool.my_role === 'owner';
  const content = document.getElementById('pool-tab-content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  let savedCombos = [];
  try { savedCombos = await API.get(`/pools/${pool.id}/saved-combos`); } catch {}

  if (savedCombos.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💾</div>
        <p class="empty-primary">No saved combinations yet</p>
        <p class="empty-sub">${isOwner ? 'Generate a set and click "💾 Save" to save it here.' : 'The pool owner hasn\'t saved any combinations yet.'}</p>
      </div>`;
    return;
  }

  content.innerHTML = `<div class="saved-combos-list">${savedCombos.map(sc=>`
    <div class="saved-combo-card" data-id="${esc(sc.id)}">
      <div class="saved-combo-header">
        <div>
          <div class="saved-combo-label">${esc(sc.label || 'Untitled set')}</div>
          <div class="saved-combo-meta">Saved ${fmtDate(sc.created_at)} · ${sc.data.combos?.length||0} combination${(sc.data.combos?.length||0)!==1?'s':''}</div>
        </div>
        ${isOwner ? `<button class="btn btn-ghost btn-sm delete-saved-btn" data-id="${esc(sc.id)}">Delete</button>` : ''}
      </div>
      <div class="saved-combo-grid">${renderSavedComboSet(sc.data)}</div>
    </div>
  `).join('')}</div>`;

  content.querySelectorAll('.delete-saved-btn').forEach(btn => {
    btn.onclick = async () => {
      try {
        await API.delete(`/pools/${pool.id}/saved-combos/${btn.dataset.id}`);
        btn.closest('.saved-combo-card').remove();
        toast('Deleted.', 'success');
        if (!document.querySelector('.saved-combo-card')) await renderSavedTab();
      } catch(err) { toast(err.message, 'error'); }
    };
  });
}

// ===== JOIN VIEW =====
async function renderJoin(code) {
  if (!currentUser) {
    sessionStorage.setItem('np_pending_join', code);
    Router.go('/auth');
    return;
  }
  loadingView();
  try {
    const r = await API.post(`/join/${code}`);
    if (r.alreadyMember) {
      toast(`You're already in "${r.poolName}".`, 'info');
    } else {
      toast(`Joined "${r.poolName}"! Welcome.`, 'success');
    }
    Router.go(`/pool/${r.poolId}`);
  } catch(err) {
    setApp(`
      <div class="view" style="max-width:480px;margin:60px auto;text-align:center">
        <div class="error-banner" style="margin-bottom:20px">${esc(err.message)}</div>
        <button class="btn btn-ghost" onclick="Router.go('/pools')">← Go to My Pools</button>
      </div>
    `);
  }
}

// ===== BROWSE VIEW =====
let browseState = { query:'', pools:[], total:0, offset:0 };

async function renderBrowse(query='', offset=0) {
  if (!offset) loadingView();
  const data = await API.get(`/browse?q=${encodeURIComponent(query)}&limit=24&offset=${offset}`);
  browseState = { query, pools: offset ? [...browseState.pools, ...data.pools] : data.pools, total: data.total, offset };

  setApp(`
    <div class="view view-wide">
      <div class="page-header">
        <div class="page-header-left">
          <h1>Browse Pools</h1>
          <p>Discover published suggestion pools and add ideas to your own</p>
        </div>
      </div>
      <div class="browse-search-row">
        <input class="input" type="search" id="browse-search" placeholder="Search pools…" value="${esc(query)}"/>
        <button class="btn btn-ghost" id="browse-search-btn">Search</button>
      </div>
      <div class="browse-stats">${data.total} published pool${data.total!==1?'s':''}</div>
      ${browseState.pools.length === 0
        ? `<div class="browse-empty"><div class="empty-icon">🌍</div><p style="font-size:14px;color:var(--text-dim)">No published pools yet${query?` matching "${esc(query)}"`:''}</p></div>`
        : `<div class="pools-grid">${browseState.pools.map(browseCard).join('')}</div>`
      }
      ${browseState.pools.length < data.total ? `<div style="text-align:center;margin-top:24px"><button class="btn btn-ghost" id="load-more-btn">Load more</button></div>` : ''}
    </div>
  `);

  const searchInput = document.getElementById('browse-search');
  const doSearch = () => renderBrowse(searchInput.value.trim());
  document.getElementById('browse-search-btn').onclick = doSearch;
  searchInput.addEventListener('keydown', e => { if(e.key==='Enter') doSearch(); });
  document.getElementById('load-more-btn')?.addEventListener('click', () => renderBrowse(browseState.query, browseState.offset+24));
}

function browseCard(p) {
  const total = p.suggestion_count || 0;
  return `
    <div class="browse-card" onclick="renderBrowsePool('${esc(p.id)}')">
      <div>
        <div class="browse-card-title">${esc(p.name)}</div>
        ${p.description ? `<div class="browse-card-desc">${esc(p.description)}</div>` : ''}
      </div>
      <div class="browse-card-meta">
        <span class="browse-meta-item">👤 ${esc(p.creator_name)}</span>
        <span class="browse-meta-item">👥 ${p.member_count} member${p.member_count!==1?'s':''}</span>
        <span class="browse-meta-item">💡 ${total} suggestion${total!==1?'s':''}</span>
      </div>
      <div class="browse-card-footer">
        <span class="badge badge-published">● Published</span>
        <span class="btn btn-ghost btn-sm">View →</span>
      </div>
    </div>
  `;
}

async function renderBrowsePool(id) {
  loadingView();
  const [pool, suggestions] = await Promise.all([API.get(`/pools/${id}`), API.get(`/pools/${id}/suggestions`)]);

  // Load my pools for the "copy" feature
  let myPools = [];
  try { myPools = await API.get('/pools'); } catch {}

  let activecat = CATEGORIES[0].id;

  const renderBrowseSuggestions = () => {
    const cat = catById(activecat);
    const catSuggestions = suggestions.filter(s => s.category_id === activecat);
    const area = document.getElementById('browse-suggestions-area');
    if (!area) return;
    if (catSuggestions.length === 0) {
      area.innerHTML = `<div class="empty-state"><div class="empty-icon">${cat.icon}</div><p class="empty-primary">No ${cat.label.toLowerCase()} suggestions</p></div>`;
      return;
    }
    area.innerHTML = `
      <div class="suggestions-grid">
        ${catSuggestions.map(s => `
          <div class="suggestion-card" style="${catVars(cat)}">
            <div class="suggestion-content">
              <div class="suggestion-text">${esc(s.text)}</div>
              ${suggestionAttrPillsHTML(s)}
              <div class="suggestion-meta">
                <span class="suggestion-user">${esc(s.added_by_name)}</span>
                <span class="suggestion-dot"></span>
                <span class="suggestion-date">${fmtShort(s.created_at)}</span>
              </div>
            </div>
            ${currentUser ? `<button class="copy-btn" data-text="${esc(s.text)}" data-cat="${esc(s.category_id)}" title="Add to my pool">+</button>` : ''}
          </div>
        `).join('')}
      </div>
    `;
    area.querySelectorAll('.copy-btn').forEach(btn => {
      btn.onclick = () => openAddToMyPoolModal(btn.dataset.text, btn.dataset.cat, myPools);
    });
  };

  const totalCount = Object.values(pool.counts||{}).reduce((a,b)=>a+b,0);

  setApp(`
    <div class="view">
      <button class="back-link" onclick="renderBrowse('${esc(browseState.query||'')}')">← Back to Browse</button>
      <div class="pool-header">
        <div class="pool-header-top">
          <div class="pool-header-info">
            <div class="pool-title">${esc(pool.name)}</div>
            ${pool.description?`<div class="pool-desc">${esc(pool.description)}</div>`:''}
            <div class="pool-header-badges">
              <span class="badge badge-published">● Published</span>
              <span class="pool-stat">👤 by ${esc(pool.creator_name)}</span>
              <span class="pool-stat">👥 ${pool.member_count} member${pool.member_count!==1?'s':''}</span>
              <span class="pool-stat">💡 ${totalCount} suggestions</span>
            </div>
          </div>
        </div>
      </div>

      <div class="pool-tabs">
        <button class="pool-tab active" id="bptab-suggest" onclick="switchBrowseTab('suggest')">Suggestions</button>
        <button class="pool-tab" id="bptab-generate" onclick="switchBrowseTab('generate')">Generate</button>
        <button class="pool-tab" id="bptab-saved" onclick="switchBrowseTab('saved')">Saved</button>
      </div>

      <div id="browse-tab-content">
        <div class="category-tabs" id="browse-cat-tabs"></div>
        ${currentUser ? `<div class="readonly-notice">💡 Click <strong>+</strong> on any suggestion to copy it into one of your own pools.</div>` : ''}
        <div id="browse-suggestions-area"></div>
      </div>
    </div>
  `);

  // Wire up category tabs
  const renderBrowseCatTabs = () => {
    const tabs = document.getElementById('browse-cat-tabs');
    if (!tabs) return;
    tabs.innerHTML = CATEGORIES.map(cat=>`
      <button class="tab-btn ${activecat===cat.id?'active':''}" style="${catVars(cat)}" data-cat="${cat.id}">
        <span class="tab-icon">${cat.icon}</span>${cat.label}
        <span class="tab-count">${pool.counts?.[cat.id]||0}</span>
      </button>
    `).join('');
    tabs.querySelectorAll('.tab-btn').forEach(btn=>{
      btn.onclick=()=>{ activecat=btn.dataset.cat; renderBrowseCatTabs(); renderBrowseSuggestions(); };
    });
  };

  window.switchBrowseTab = (tab) => {
    document.querySelectorAll('.pool-tab').forEach(b=>b.classList.remove('active'));
    document.getElementById(`bptab-${tab}`)?.classList.add('active');
    const c=document.getElementById('browse-tab-content');
    if (tab==='suggest') {
      c.innerHTML=`<div class="category-tabs" id="browse-cat-tabs"></div>${currentUser?`<div class="readonly-notice">💡 Click <strong>+</strong> on any suggestion to copy it into one of your own pools.</div>`:''}<div id="browse-suggestions-area"></div>`;
      renderBrowseCatTabs(); renderBrowseSuggestions();
    } else if (tab==='saved') {
      c.innerHTML='<div class="loading"><div class="spinner"></div></div>';
      API.get(`/pools/${pool.id}/saved-combos`).then(savedCombos => {
        if (!savedCombos.length) {
          c.innerHTML=`<div class="empty-state"><div class="empty-icon">💾</div><p class="empty-primary">No saved combinations</p><p class="empty-sub">The pool owner hasn't saved any combinations yet.</p></div>`;
          return;
        }
        c.innerHTML=`<div class="saved-combos-list">${savedCombos.map(sc=>`
          <div class="saved-combo-card">
            <div class="saved-combo-header">
              <div>
                <div class="saved-combo-label">${esc(sc.label||'Untitled set')}</div>
                <div class="saved-combo-meta">Saved ${fmtDate(sc.created_at)} · ${sc.data.combos?.length||0} combination${(sc.data.combos?.length||0)!==1?'s':''}</div>
              </div>
            </div>
            <div class="saved-combo-grid">${renderSavedComboSet(sc.data)}</div>
          </div>
        `).join('')}</div>`;
      }).catch(()=>{ c.innerHTML='<div class="error-banner">Could not load saved combinations.</div>'; });
    } else {
      const hasModifiers = CATEGORIES.some(c => c.isModifier);
      const bColCats = CATEGORIES.filter(c => !c.isModifier);
      c.innerHTML = `
        <div class="generate-controls">
          <div class="gen-ctrl">
            <span class="control-label">Combinations</span>
            <input type="number" class="count-input" id="b-combo-count" value="5" min="1" max="50"/>
          </div>
          <button class="btn-generate" id="b-generate-btn">Generate</button>
          <button class="btn-reshuffle" id="b-reshuffle-btn" style="display:none">Reshuffle</button>
        </div>
        <details class="gen-advanced">
          <summary class="details-toggle">⚙ Advanced options</summary>
          <div class="details-panel">
            <div class="gen-ctrl">
              <span class="control-label">Allow repeats</span>
              <div class="toggle-wrapper">
                <label class="toggle"><input type="checkbox" id="b-replacement-toggle" checked><span class="toggle-track"><span class="toggle-thumb"></span></span></label>
                <span class="toggle-label" id="b-toggle-label">Yes — same item can repeat</span>
              </div>
            </div>
            <div class="gen-ctrl">
              <span class="control-label">Per combination</span>
              <div class="cat-counts-row">
                ${bColCats.map(cat=>`
                  <div class="cat-count-item" style="${catVars(cat)}">
                    <span class="cat-count-icon">${cat.icon}</span>
                    <input type="number" class="cat-count-input" id="b-cat-count-${cat.id}" value="1" min="1" max="10"/>
                  </div>
                `).join('')}
              </div>
            </div>
            ${hasModifiers ? `
            <div class="gen-ctrl">
              <span class="control-label">Modifiers</span>
              <div class="toggle-wrapper">
                <label class="toggle"><input type="checkbox" id="b-modifier-toggle"><span class="toggle-track"><span class="toggle-thumb"></span></span></label>
                <span class="toggle-label" id="b-modifier-label">Excluded</span>
              </div>
            </div>
            <div class="chance-row" id="b-chance-row" style="display:none">
              <span class="control-label">Modifier chance</span>
              <div style="display:flex;align-items:center;gap:10px">
                <input type="range" class="chance-slider" id="b-chance-slider" min="0" max="100" value="50"/>
                <span class="chance-display" id="b-chance-display">50%</span>
              </div>
            </div>
            ` : ''}
          </div>
        </details>
        <div id="b-results-area"><div class="generate-placeholder"><div class="placeholder-glyph">✦</div><p class="placeholder-text">Click Generate</p></div></div>
      `;
      const tgl = document.getElementById('b-replacement-toggle');
      const lbl = document.getElementById('b-toggle-label');
      tgl.onchange = () => { lbl.textContent = tgl.checked ? 'Yes — same item can repeat' : 'No — each item used once'; };
      if (hasModifiers) {
        const modTgl = document.getElementById('b-modifier-toggle');
        const modLbl = document.getElementById('b-modifier-label');
        const chanceRow = document.getElementById('b-chance-row');
        const chanceSlider = document.getElementById('b-chance-slider');
        const chanceDisplay = document.getElementById('b-chance-display');
        modTgl.onchange = () => {
          modLbl.textContent = modTgl.checked ? 'Included' : 'Excluded';
          chanceRow.style.display = modTgl.checked ? '' : 'none';
        };
        chanceSlider.oninput = () => { chanceDisplay.textContent = `${chanceSlider.value}%`; };
      }
      const doGen = () => {
        const cnt = Math.max(1, Math.min(50, parseInt(document.getElementById('b-combo-count').value)||5));
        const wr  = document.getElementById('b-replacement-toggle').checked;
        const incMod = hasModifiers && document.getElementById('b-modifier-toggle').checked;
        const modChance = hasModifiers ? parseInt(document.getElementById('b-chance-slider')?.value ?? 50) : 0;
        const bCatCounts = {};
        bColCats.forEach(cat => {
          bCatCounts[cat.id] = Math.max(1, Math.min(10, parseInt(document.getElementById(`b-cat-count-${cat.id}`)?.value || 1)));
        });
        runGenerate(cnt, wr, incMod, modChance, bCatCounts, suggestions, 'b-results-area', 'b-reshuffle-btn');
      };
      document.getElementById('b-generate-btn').onclick = doGen;
      document.getElementById('b-reshuffle-btn').onclick = doGen;
    }
  };

  renderBrowseCatTabs();
  renderBrowseSuggestions();
}

function openAddToMyPoolModal(text, categoryId, myPools) {
  const cat = catById(categoryId);
  if (!myPools || myPools.length === 0) {
    openModal(`
      <button class="modal-close">×</button>
      <div class="modal-title">Add to my pool</div>
      <div class="no-pools-msg">You don't have any pools yet.<br/><br/><button class="btn btn-primary" onclick="closeModal();openCreatePoolModal()">Create a pool first</button></div>
    `);
    return;
  }
  openModal(`
    <button class="modal-close">×</button>
    <div class="modal-title">Add to my pool</div>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:14px">Adding <strong>${esc(cat.icon)} ${esc(text)}</strong> as a ${esc(cat.label)}.</p>
    <div class="pool-options">
      ${myPools.map(p=>`
        <button class="pool-option" data-pool-id="${esc(p.id)}" data-pool-name="${esc(p.name)}">
          <div style="flex:1;min-width:0">
            <div class="pool-option-name">${esc(p.name)}</div>
            <div class="pool-option-meta">${p.counts?.[categoryId]||0} ${esc(cat.label.toLowerCase())}s · ${p.member_count} member${p.member_count!==1?'s':''}${!p.allow_duplicates?'<span class="pool-option-nodup">No duplicates</span>':''}</div>
          </div>
          <span class="pool-option-arrow">→</span>
        </button>
      `).join('')}
    </div>
  `, (modal) => {
    modal.querySelectorAll('.pool-option').forEach(btn => {
      btn.onclick = async () => {
        const poolId = btn.dataset.poolId;
        const poolName = btn.dataset.poolName;
        btn.disabled = true;
        try {
          await API.post(`/pools/${poolId}/suggestions`, { categoryId, text });
          closeModal();
          toast(`Added to "${poolName}"!`, 'success');
        } catch(err) {
          if (err.message?.toLowerCase().includes('similar suggestion')) {
            // Inline duplicate error — no point retrying on the same pool
            btn.classList.add('pool-option-rejected');
            btn.querySelector('.pool-option-meta').innerHTML =
              `<span class="pool-option-dup-err">✗ Already exists in this pool</span>`;
            btn.querySelector('.pool-option-arrow').style.display = 'none';
          } else {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        }
      };
    });
  });
}

// ===== INIT =====
async function init() {
  window.addEventListener('hashchange', () => Router.dispatch());
  await Auth.init();
  await Router.dispatch();
}

init();
