'use strict';

// ===== CATEGORY DEFINITIONS =====
// Add new categories here — the rest of the app picks them up automatically.
const CATEGORIES = [
  {
    id:       'activity',
    label:    'Activity',
    icon:     '⚡',
    color:    '#a598ff',
    colorDim: 'rgba(165,152,255,0.10)',
    colorGlow:'rgba(165,152,255,0.25)',
  },
  {
    id:       'food',
    label:    'Food',
    icon:     '🍽️',
    color:    '#f09348',
    colorDim: 'rgba(240,147,72,0.10)',
    colorGlow:'rgba(240,147,72,0.25)',
  },
  {
    id:       'drink',
    label:    'Drink',
    icon:     '🥤',
    color:    '#3dd6a3',
    colorDim: 'rgba(61,214,163,0.10)',
    colorGlow:'rgba(61,214,163,0.25)',
  },
];

// ===== DATA STORE =====
const Store = (() => {
  const KEY = 'nightpick_v1';
  let _data = null;

  function _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore corrupt data */ }
    return { suggestions: {} };
  }

  function _save() {
    localStorage.setItem(KEY, JSON.stringify(_data));
  }

  function _get() {
    if (!_data) _data = _load();
    return _data;
  }

  return {
    getSuggestions(categoryId) {
      return _get().suggestions[categoryId] || [];
    },

    addSuggestion(categoryId, text, userId) {
      const d = _get();
      if (!d.suggestions[categoryId]) d.suggestions[categoryId] = [];
      const item = {
        id:        crypto.randomUUID(),
        text:      text.trim(),
        userId:    userId.trim() || 'Anonymous',
        createdAt: Date.now(),
      };
      d.suggestions[categoryId].push(item);
      _save();
      return item;
    },

    deleteSuggestion(categoryId, id) {
      const d = _get();
      if (!d.suggestions[categoryId]) return;
      d.suggestions[categoryId] = d.suggestions[categoryId].filter(s => s.id !== id);
      _save();
    },

    getCount(categoryId) {
      return (_get().suggestions[categoryId] || []).length;
    },
  };
})();

// ===== UTILITIES =====
function catById(id) {
  return CATEGORIES.find(c => c.id === id);
}

function catCssVars(cat) {
  return `--cat-color:${cat.color};--cat-color-dim:${cat.colorDim};--cat-color-glow:${cat.colorGlow}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Fisher-Yates shuffle (mutates array, returns it)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===== APP STATE =====
let activeTab = CATEGORIES[0].id;
let userId    = localStorage.getItem('nightpick_userId') || '';

// ===== SUGGEST PAGE =====
function renderTabs() {
  const container = document.getElementById('category-tabs');
  container.innerHTML = CATEGORIES.map(cat => /* html */`
    <button
      class="tab-btn ${activeTab === cat.id ? 'active' : ''}"
      style="${catCssVars(cat)}"
      data-cat="${cat.id}"
    >
      <span class="tab-icon">${cat.icon}</span>
      ${esc(cat.label)}
      <span class="tab-count">${Store.getCount(cat.id)}</span>
    </button>
  `).join('');

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.cat;
      renderTabs();
      renderSuggestions();
      syncAddForm();
    });
  });
}

function syncAddForm() {
  const cat  = catById(activeTab);
  const form = document.getElementById('add-form');
  const icon = document.getElementById('add-form-icon');
  const btn  = document.getElementById('add-btn');
  const inp  = document.getElementById('suggestion-input');

  form.style.cssText += catCssVars(cat);
  icon.textContent   = cat.icon;
  inp.placeholder    = `Add a ${cat.label.toLowerCase()}…`;
  btn.style.background = cat.color;
  btn.style.setProperty('--cat-color', cat.color);
}

function renderSuggestions() {
  const cat         = catById(activeTab);
  const suggestions = Store.getSuggestions(activeTab).slice().reverse();
  const section     = document.getElementById('suggestions-section');

  if (suggestions.length === 0) {
    section.innerHTML = /* html */`
      <div class="empty-state">
        <div class="empty-icon">${cat.icon}</div>
        <p class="empty-primary">No ${esc(cat.label.toLowerCase())} suggestions yet</p>
        <p class="empty-sub">Type one in the box above and hit Add</p>
      </div>
    `;
    return;
  }

  section.innerHTML = /* html */`
    <div class="suggestions-header">
      <div class="suggestions-title" style="${catCssVars(cat)}">
        <span class="dot"></span>
        ${suggestions.length} ${esc(cat.label)} suggestion${suggestions.length !== 1 ? 's' : ''}
      </div>
    </div>
    <div class="suggestions-grid">
      ${suggestions.map(s => /* html */`
        <div class="suggestion-card" style="${catCssVars(cat)}">
          <div class="suggestion-content">
            <div class="suggestion-text">${esc(s.text)}</div>
            <div class="suggestion-meta">
              <span class="suggestion-user">${esc(s.userId)}</span>
              <span class="suggestion-dot"></span>
              <span class="suggestion-date">${fmtDate(s.createdAt)}</span>
            </div>
          </div>
          <button class="delete-btn" data-cat="${esc(activeTab)}" data-id="${esc(s.id)}" title="Remove">×</button>
        </div>
      `).join('')}
    </div>
  `;

  section.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      Store.deleteSuggestion(btn.dataset.cat, btn.dataset.id);
      renderTabs();
      renderSuggestions();
    });
  });
}

function handleAddSuggestion() {
  const inp  = document.getElementById('suggestion-input');
  const text = inp.value.trim();
  if (!text) { inp.focus(); return; }

  const uid = userId.trim() || 'Anonymous';
  Store.addSuggestion(activeTab, text, uid);
  inp.value = '';
  inp.focus();
  renderTabs();
  renderSuggestions();
}

// ===== GENERATE PAGE =====
function buildCombinations(count, withReplacement) {
  // Build a shuffled pool per category
  const pools = {};
  let minPoolSize = Infinity;
  let anyEmpty    = false;

  CATEGORIES.forEach(cat => {
    const items = Store.getSuggestions(cat.id);
    if (items.length === 0) { anyEmpty = true; return; }
    pools[cat.id] = shuffle([...items]);
    minPoolSize   = Math.min(minPoolSize, items.length);
  });

  if (anyEmpty) return { error: 'empty' };

  const actualCount = withReplacement ? count : Math.min(count, minPoolSize);
  const truncated   = !withReplacement && actualCount < count;

  const combos = [];
  for (let i = 0; i < actualCount; i++) {
    const row = {};
    CATEGORIES.forEach(cat => {
      const pool = pools[cat.id];
      row[cat.id] = withReplacement
        ? pool[Math.floor(Math.random() * pool.length)]
        : pool[i]; // pool already shuffled; just take slot i
    });
    combos.push(row);
  }

  return { combos, truncated, actualCount };
}

function renderCombinations() {
  const count           = Math.max(1, Math.min(50, parseInt(document.getElementById('combo-count').value, 10) || 5));
  const withReplacement = document.getElementById('replacement-toggle').checked;
  const resultsArea     = document.getElementById('results-area');
  const reshuffleBtn    = document.getElementById('reshuffle-btn');

  const result = buildCombinations(count, withReplacement);

  if (result.error === 'empty') {
    resultsArea.innerHTML = /* html */`
      <div class="error-banner">
        ⚠ Add at least one suggestion to every category before generating.
      </div>
    `;
    reshuffleBtn.style.display = 'none';
    return;
  }

  const { combos, truncated, actualCount } = result;
  const colTemplate = `36px repeat(${CATEGORIES.length}, 1fr)`;

  let html = '';

  if (truncated) {
    html += /* html */`
      <div class="warning-banner">
        ⚠ Only ${actualCount} combination${actualCount !== 1 ? 's' : ''} generated — not enough unique suggestions for more without repeats.
      </div>
    `;
  }

  html += /* html */`
    <div class="results-meta">
      <span class="results-count">${actualCount} combination${actualCount !== 1 ? 's' : ''}</span>
      <span class="results-mode">${withReplacement ? 'with repeats' : 'no repeats'}</span>
    </div>

    <div class="combo-grid-header" style="grid-template-columns:${colTemplate}">
      <div></div>
      ${CATEGORIES.map(cat => /* html */`
        <div class="combo-col-header" style="${catCssVars(cat)}">
          <span class="combo-col-header-icon">${cat.icon}</span>
          ${esc(cat.label)}
        </div>
      `).join('')}
    </div>

    <div class="combo-grid">
      ${combos.map((row, i) => /* html */`
        <div class="combo-row" style="grid-template-columns:${colTemplate};animation-delay:${(i * 40)}ms">
          <div class="combo-row-number">${i + 1}</div>
          ${CATEGORIES.map(cat => /* html */`
            <div class="combo-cell" style="${catCssVars(cat)}">
              <div class="combo-cell-label">${esc(cat.label)}</div>
              <div class="combo-cell-text">${esc(row[cat.id].text)}</div>
              <div class="combo-cell-user">by ${esc(row[cat.id].userId)}</div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;

  resultsArea.innerHTML = html;
  reshuffleBtn.style.display = 'flex';
}

// ===== NAVIGATION =====
function initNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const page = link.dataset.page;
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      link.classList.add('active');
      document.getElementById(`page-${page}`).classList.add('active');
    });
  });
}

function updateNavUser() {
  const el = document.getElementById('nav-user');
  el.textContent = userId ? `Signed in as ${userId}` : '';
}

// ===== INIT =====
function init() {
  initNav();

  // User ID persistence
  const userInput = document.getElementById('user-id-input');
  userInput.value = userId;
  updateNavUser();

  userInput.addEventListener('input', () => {
    userId = userInput.value;
    localStorage.setItem('nightpick_userId', userId);
    updateNavUser();
  });

  // Suggest page
  renderTabs();
  renderSuggestions();
  syncAddForm();

  document.getElementById('add-btn').addEventListener('click', handleAddSuggestion);
  document.getElementById('suggestion-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAddSuggestion();
  });

  // Generate page
  const toggle      = document.getElementById('replacement-toggle');
  const toggleLabel = document.getElementById('toggle-label');
  toggle.checked    = true;

  toggle.addEventListener('change', () => {
    toggleLabel.textContent = toggle.checked
      ? 'Yes — same item can appear multiple times'
      : 'No — each item used at most once';
  });

  document.getElementById('generate-btn').addEventListener('click', renderCombinations);
  document.getElementById('reshuffle-btn').addEventListener('click', renderCombinations);
}

document.addEventListener('DOMContentLoaded', init);
