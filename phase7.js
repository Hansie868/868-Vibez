/* ============================================================
   868 VIBEZ — Phase 7: UI/UX Refinement
   1. Dynamic themes (5 colours from V7 suggestion)
   2. Page transition animations
   3. Glassmorphic polish
   ============================================================ */
'use strict';

/* ══ 1. THEME ENGINE ══ */
const ThemeEngine = {

  THEMES: {
    midnight: {
      name:  'Midnight Black',
      emoji: '🖤',
      vars: {
        '--cyan':    '#00e5ff',
        '--mag':     '#f0007a',
        '--purple':  '#8b5cf6',
        '--green':   '#00e676',
        '--orange':  '#f97316',
        '--bg':      '#050505',
        '--bg2':     '#0d0d0d',
        '--bg3':     '#141414',
        '--bg4':     '#1a1a1a',
      }
    },
    gold: {
      name:  'Chrome Gold',
      emoji: '✨',
      vars: {
        '--cyan':    '#d4a017',
        '--mag':     '#f0007a',
        '--purple':  '#b8860b',
        '--green':   '#00e676',
        '--orange':  '#fbbf24',
        '--bg':      '#050400',
        '--bg2':     '#0d0b00',
        '--bg3':     '#141200',
        '--bg4':     '#1a1800',
      }
    },
    crimson: {
      name:  'Crimson Red',
      emoji: '🔴',
      vars: {
        '--cyan':    '#ff4d6d',
        '--mag':     '#ff0040',
        '--purple':  '#c0392b',
        '--green':   '#00e676',
        '--orange':  '#ff6b35',
        '--bg':      '#050003',
        '--bg2':     '#0d0005',
        '--bg3':     '#140007',
        '--bg4':     '#1a000a',
      }
    },
    electric: {
      name:  'Electric Blue',
      emoji: '⚡',
      vars: {
        '--cyan':    '#00b0ff',
        '--mag':     '#00e5ff',
        '--purple':  '#0066ff',
        '--green':   '#00e676',
        '--orange':  '#00d4ff',
        '--bg':      '#000508',
        '--bg2':     '#000c12',
        '--bg3':     '#001018',
        '--bg4':     '#001520',
      }
    },
    neon: {
      name:  'Neon Green',
      emoji: '💚',
      vars: {
        '--cyan':    '#00e676',
        '--mag':     '#00ff9d',
        '--purple':  '#00c853',
        '--green':   '#00ff6a',
        '--orange':  '#76ff03',
        '--bg':      '#000805',
        '--bg2':     '#00100a',
        '--bg3':     '#001510',
        '--bg4':     '#001a14',
      }
    }
  },

  _current: 'midnight',

  apply(themeId, persist = true) {
    const theme = this.THEMES[themeId] || this.THEMES.midnight;
    this._current = themeId;
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    document.body.dataset.theme = themeId;
    if (persist) localStorage.setItem('vz_theme', themeId);
    // Update active state in theme picker
    document.querySelectorAll('.theme-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.theme === themeId)
    );
    MS.emit('theme:changed', { themeId, theme });
  },

  load() {
    const saved = localStorage.getItem('vz_theme') || 'midnight';
    this.apply(saved, false);
  },

  current() { return this._current; }
};

MS.theme = ThemeEngine;

/* ══ 2. PAGE TRANSITIONS ══ */
const PageTransitions = {

  _prev: null,

  install() {
    const orig = window.showPage;
    if (!orig || orig._p7) return;

    window.showPage = function(name) {
      const prevPage = document.querySelector('.page.active');
      const prevName = prevPage?.dataset?.page;
      if (prevName === name) return;

      const pages = ['stream','player','video','library','dj'];
      const prevIdx = pages.indexOf(prevName);
      const nextIdx = pages.indexOf(name);
      const dir = nextIdx > prevIdx ? 1 : -1;

      // Outgoing page
      if (prevPage) {
        prevPage.style.transition = 'transform .22s cubic-bezier(.4,0,.2,1), opacity .22s';
        prevPage.style.transform  = `translateX(${dir * -100}%)`;
        prevPage.style.opacity    = '0';
        setTimeout(() => {
          prevPage.style.transition = '';
          prevPage.style.transform  = '';
          prevPage.style.opacity    = '';
        }, 240);
      }

      // Call original
      orig(name);

      // Incoming page — slide in from opposite side
      const nextPage = document.querySelector('.page.active');
      if (nextPage && nextPage !== prevPage) {
        nextPage.style.transform  = `translateX(${dir * 100}%)`;
        nextPage.style.opacity    = '0';
        nextPage.style.transition = 'none';
        requestAnimationFrame(() => {
          nextPage.style.transition = 'transform .22s cubic-bezier(.4,0,.2,1), opacity .22s';
          nextPage.style.transform  = 'translateX(0)';
          nextPage.style.opacity    = '1';
          setTimeout(() => {
            nextPage.style.transition = '';
            nextPage.style.transform  = '';
            nextPage.style.opacity    = '';
          }, 240);
        });
      }
    };
    window.showPage._p7 = true;
  }
};

MS.pageTransitions = PageTransitions;

/* ══ UI ══ */
document.addEventListener('DOMContentLoaded', () => {

  // Load saved theme
  ThemeEngine.load();

  // Install page transitions
  setTimeout(() => PageTransitions.install(), 100);

  // Build theme picker and inject into Library settings
  const libContent = document.querySelector('#page-library .lib-content');
  if (libContent) {
    const themeView = document.createElement('div');
    themeView.dataset.subview = 'themes';
    themeView.style.cssText = 'display:none;padding:20px;overflow-y:auto';
    themeView.innerHTML = `
      <div class="section-label" style="padding:0 0 12px">App Theme</div>
      <div class="theme-grid" id="themeGrid"></div>
      <div class="section-label" style="padding:16px 0 8px">Settings</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:12px">
          <div>
            <div style="font-size:13px;font-weight:600">Page Transitions</div>
            <div style="font-size:11px;color:var(--t3);margin-top:2px">Animated slide between pages</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="transToggle" checked>
            <span class="toggle-knob"></span>
          </label>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:12px">
          <div>
            <div style="font-size:13px;font-weight:600">Ambient Glows</div>
            <div style="font-size:11px;color:var(--t3);margin-top:2px">Background lighting effects</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="glowToggle" checked>
            <span class="toggle-knob"></span>
          </label>
        </div>
      </div>`;
    libContent.appendChild(themeView);

    // Render theme chips
    const grid = themeView.querySelector('#themeGrid');
    if (grid) {
      Object.entries(ThemeEngine.THEMES).forEach(([id, t]) => {
        const btn = document.createElement('button');
        btn.className = `theme-chip ${ThemeEngine._current === id ? 'active' : ''}`;
        btn.dataset.theme = id;
        btn.innerHTML = `<span class="tc-emoji">${t.emoji}</span><span class="tc-name">${t.name}</span>`;
        btn.onclick = () => ThemeEngine.apply(id);
        grid.appendChild(btn);
      });
    }
  }

  // Add Themes tab
  const subtabBar = document.querySelector('#page-library .subtab-bar');
  if (subtabBar && !subtabBar.querySelector('[data-sub="themes"]')) {
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.dataset.sub = 'themes';
    btn.textContent = 'Themes';
    subtabBar.appendChild(btn);
  }

  // Wire toggle switches
  document.getElementById('transToggle')?.addEventListener('change', e => {
    if (!e.target.checked) {
      // Disable transitions
      window.showPage._p7 = false;
      const orig = window.showPage;
      window.showPage = function(name) { orig._orig?.(name) || orig(name); };
    } else {
      PageTransitions.install();
    }
  });

  document.getElementById('glowToggle')?.addEventListener('change', e => {
    document.querySelectorAll('.ambient').forEach(el =>
      el.style.display = e.target.checked ? '' : 'none'
    );
  });

  // Inject theme + settings CSS
  const style = document.createElement('style');
  style.textContent = `
    /* Theme grid */
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px;
      margin-bottom: 8px;
    }
    .theme-chip {
      display: flex; flex-direction: column;
      align-items: center; gap: 6px;
      padding: 16px 12px;
      background: var(--bg2);
      border: 2px solid var(--border);
      border-radius: 16px;
      cursor: pointer;
      transition: all .15s;
      -webkit-tap-highlight-color: transparent;
    }
    .theme-chip:active { transform: scale(.95); }
    .theme-chip.active {
      border-color: var(--cyan);
      background: rgba(0,229,255,.06);
      box-shadow: 0 0 16px rgba(0,229,255,.2);
    }
    .tc-emoji { font-size: 28px; }
    .tc-name  { font-size: 11px; font-weight: 700; text-align: center; }

    /* Toggle switch */
    .toggle-switch { position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer; }
    .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .toggle-knob {
      position: absolute; inset: 0;
      background: rgba(255,255,255,.15);
      border-radius: 24px;
      transition: background .2s;
    }
    .toggle-knob::before {
      content: '';
      position: absolute;
      width: 18px; height: 18px;
      left: 3px; top: 3px;
      background: white;
      border-radius: 50%;
      transition: transform .2s;
      box-shadow: 0 1px 4px rgba(0,0,0,.4);
    }
    .toggle-switch input:checked + .toggle-knob { background: var(--cyan); }
    .toggle-switch input:checked + .toggle-knob::before { transform: translateX(20px); }

    /* Glassmorphic upgrades */
    .vz-card, .sp-glass {
      box-shadow: 0 4px 24px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.05) !important;
    }
    .bottom-nav {
      box-shadow: 0 -4px 32px rgba(0,0,0,.5) !important;
    }
    #miniPlayer {
      box-shadow: 0 -2px 20px rgba(0,0,0,.4) !important;
    }

    /* Smooth page base */
    .page { will-change: transform, opacity; }

    /* Theme-aware primary button */
    .vz-btn.primary {
      background: var(--cyan) !important;
      border-color: var(--cyan) !important;
      box-shadow: 0 0 20px color-mix(in srgb, var(--cyan), transparent 55%) !important;
    }
    .np-play-btn {
      background: var(--cyan) !important;
      box-shadow: 0 0 32px color-mix(in srgb, var(--cyan), transparent 45%) !important;
    }
    .nav-item.active .ni-icon { background-color: var(--cyan) !important; }
    .nav-item.active::before  { background: var(--cyan) !important; box-shadow: 0 0 10px var(--cyan) !important; }
    .mp-play { background: var(--cyan) !important; box-shadow: 0 0 12px color-mix(in srgb, var(--cyan), transparent 45%) !important; }
    .dd-play.a-play { background: rgba(0,229,255,.18) !important; border-color: var(--cyan) !important; color: var(--cyan) !important; box-shadow: 0 0 16px color-mix(in srgb, var(--cyan), transparent 55%) !important; }
    .genre-chip.active, .g-chip.active { background: color-mix(in srgb,var(--cyan),transparent 88%) !important; border-color: var(--cyan) !important; color: var(--cyan) !important; }
    .subtab.active { background: var(--cyan) !important; border-color: var(--cyan) !important; }
  `;
  document.head.appendChild(style);

  console.info('[Phase7] UI/UX Refinement active');
});
