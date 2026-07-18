/* ═══════════════════════════════════════════════════════════════
   868 VIBEZ v2 — radio.js  (Tab 2 — Radio Hub)
   T&T stations by frequency (low→high), company logo rows,
   built-in Call/WhatsApp from the verified research, working play.

   THE 95.1 FIX: v1 deduped stations by name and kept only ONE
   stream URL — if that one died, the station was just broken.
   Now every duplicate directory entry is kept as a FALLBACK URL,
   and playback automatically tries the next mirror on failure.

   Radio STOPS when you leave this tab (spec).
═══════════════════════════════════════════════════════════════ */
'use strict';
(function () {
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const $ = id => document.getElementById(id);

/* ── Verified contact numbers (from the researched, confirmed table).
   tier 'ok' = confirmed/partial → live buttons.
   tier 'unv' = unverified → tap shows a confirm first. ── */
const CONTACTS = [
  { m: /slam/i,                     phone: '+18686241005', wa: '+18687077526', tier: 'ok' },
  { m: /vibe\s*ct/i,                phone: '+18686235105', wa: '+18683881051', tier: 'ok' },
  { m: /boom/i,                     phone: '+18686276937', wa: '+18683229494', tier: 'ok' },
  { m: /talk\s*city/i,              phone: '+18686224911', wa: '+18683944911', tier: 'ok' },
  { m: /next\s*99/i,                phone: '+18686283006', wa: '+18683104991', tier: 'ok' },
  { m: /sangeet/i,                  phone: '+18686230106', wa: '+18683431061', tier: 'ok' },
  { m: /radio\s*90\.?5/i,           phone: '+18686229050', wa: '+18683649050', tier: 'ok' },
  { m: /sky\s*99/i,                 phone: '+18686252759', wa: '+18683339950', tier: 'ok' },
  { m: /bacchanal/i,                phone: '+18686852260', wa: '',             tier: 'ok' },
  { m: /street/i,                   phone: '+18686390791', wa: '',             tier: 'ok' },
  { m: /isaac/i,                    phone: '+18686221981', wa: '+18682751981', tier: 'ok' },
  { m: /sweet/i,                    phone: '+18686284100', wa: '+18683484100', tier: 'ok' },
  { m: /103\s*fm|^103\b/i,          phone: '+18686289222', wa: '+18686284103', tier: 'ok' },
  { m: /ultimate|95\.?1/i,          phone: '+18686252095', wa: '+18683949595', tier: 'ok' },
  { m: /music\s*radio\s*97/i,       phone: '+18686229797', wa: '+18683249797', tier: 'ok' },
  { m: /wack/i,                     phone: '+18686529774', wa: '',             tier: 'ok' },
  { m: /tambrin/i,                  phone: '+18686393437', wa: '',             tier: 'ok' },
  { m: /hott\s*93/i,                phone: '+18686258426', wa: '',             tier: 'ok' },
  { m: /star\s*9?47/i,              phone: '+18686282947', wa: '',             tier: 'ok' },
  { m: /w\s*107/i,                  phone: '+18686284107', wa: '',             tier: 'ok' },
  { m: /power\s*102/i,              phone: '+18686276937', wa: '',             tier: 'ok' },
  { m: /heartbeat/i,                phone: '+18682223104', wa: '',             tier: 'ok' },
  { m: /jaagriti/i,                 phone: '+18686632250', wa: '',             tier: 'ok' },
  { m: /wefm|96\.?1/i,              phone: '+18686286044', wa: '',             tier: 'ok' },
  { m: /i\s*95\.?5/i,               phone: '+18686284955', wa: '',             tier: 'ok' },
  { m: /freedom/i,                  phone: '+18686273223', wa: '+18683061065', tier: 'unv' },
  { m: /107\.?7|music\s*for\s*life/i, phone: '+18686289107', wa: '',           tier: 'unv' },
  { m: /iconic/i,                   phone: '+18686283131', wa: '+18683299979', tier: 'unv' },
];
const contactFor = name => CONTACTS.find(c => c.m.test(name)) || null;

const RB = ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];

const R = VZ.radio = {
  stations: [],           // { id, name, freq, genre, urls:[primary, ...mirrors] }
  world: [
    { id: 'rp1', name: 'Radio Paradise — Main Mix', freq: null, genre: 'Eclectic', urls: ['https://stream.radioparadise.com/mp3-192'] },
    { id: 'rp2', name: 'Radio Paradise — Mellow',   freq: null, genre: 'Chill',    urls: ['https://stream.radioparadise.com/mellow-192'] },
    { id: 'rp3', name: 'Radio Paradise — Rock',     freq: null, genre: 'Rock',     urls: ['https://stream.radioparadise.com/rock-192'] },
  ],
  state: 'idle', current: null, _urlIdx: 0,
  loadState: 'idle',

  freqOf(name) { const m = name.match(/(\d{2,3}(?:\.\d)?)\s*(?:FM|fm)?\b/); return m ? parseFloat(m[1]) : 9999; },

  async loadStations(force = false) {
    if (this.loadState === 'loading') return;
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem('vz2_tt') || 'null');
        if (c && Date.now() - c.at < 864e5 && c.list?.length) { this.stations = c.list; this.loadState = 'ready'; render(); return; }
      } catch {}
    }
    this.loadState = 'loading'; render();
    const path = '/json/stations/search?countrycode=TT&hidebroken=true&order=clickcount&reverse=true&limit=150';
    for (const server of RB) {
      try {
        const res = await fetch(server + path);
        if (!res.ok) continue;
        const raw = await res.json();
        // Group by normalized name: FIRST entry = primary URL, the rest
        // become fallback mirrors (this is the 95.1 fix).
        const groups = new Map();
        raw.forEach(s => {
          const url = s.url_resolved || s.url;
          if (!/^https:\/\//i.test(url) || s.hls) return;
          const key = s.name.trim().toLowerCase().replace(/\s+/g, ' ');
          if (!groups.has(key)) groups.set(key, { name: s.name.trim(), genre: (s.tags || '').split(',').slice(0, 2).join(' · ') || 'Trinidad & Tobago', urls: [] });
          const g = groups.get(key);
          if (!g.urls.includes(url)) g.urls.push(url);
        });
        this.stations = [...groups.values()].map((g, i) => ({
          id: 'tt' + i, name: g.name, genre: g.genre, urls: g.urls, freq: this.freqOf(g.name),
        })).sort((a, b) => a.freq - b.freq);
        this.loadState = 'ready';
        localStorage.setItem('vz2_tt', JSON.stringify({ at: Date.now(), list: this.stations }));
        render();
        return;
      } catch (e) { VZ.logError('radio.load', e); }
    }
    this.loadState = 'error'; render();
  },

  all() { return [...this.stations, ...this.world]; },

  play(st, urlIdx = 0) {
    if (urlIdx >= st.urls.length) {
      this.state = 'error'; render();
      VZ.toast(`Could not connect to ${st.name}${st.urls.length > 1 ? ` (tried ${st.urls.length} servers)` : ''}.`, 'error', 3200);
      return;
    }
    this.current = st; this._urlIdx = urlIdx; this.state = 'loading'; render();
    VZ.engine.playRadio({ url: st.urls[urlIdx] }, s => {
      if (s === 'error' && this.current === st && this._urlIdx === urlIdx) {
        this.play(st, urlIdx + 1);              // auto-try the next mirror
        return;
      }
      if (this.current === st) { this.state = s; render(); }
    }).then(() => {
      if (this.current === st) {
        this.state = 'playing'; render();
        VZ.toast(`📻 ${st.name}`, 'ok', 1800);
        if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: st.name, artist: '868 Vibez Radio' });
      }
    }).catch(() => {
      if (this.current === st && this._urlIdx === urlIdx) this.play(st, urlIdx + 1);
    });
  },

  stop() { VZ.engine.stopRadio(); this.state = 'idle'; this.current = null; render(); },
  toggle(id) {
    const st = this.all().find(s => s.id === id); if (!st) return;
    (this.current?.id === id && this.state !== 'idle' && this.state !== 'error') ? this.stop() : this.play(st);
  },
};

/* Spec: radio stops when leaving the tab */
document.addEventListener('vz:tab', e => { if (e.detail !== 'radio' && R.state !== 'idle') R.stop(); });

/* Unverified-number confirm */
window.vzRadioCall = (id, kind) => {
  const st = R.all().find(s => s.id === id); if (!st) return;
  const c = contactFor(st.name); if (!c) return;
  const num = kind === 'wa' ? (c.wa || c.phone) : c.phone;
  const go = () => {
    if (kind === 'wa') window.open(`https://wa.me/${num.replace(/[^\d]/g, '')}`, '_blank');
    else location.href = `tel:${num}`;
  };
  if (c.tier === 'unv' && !confirm(`${st.name}'s number couldn't be independently verified — it may be outdated.\n\nContinue to ${kind === 'wa' ? 'WhatsApp' : 'call'} ${num}?`)) return;
  go();
};

function stationRow(s) {
  const cur = R.current?.id === s.id;
  const playing = cur && R.state === 'playing';
  const loading = cur && R.state === 'loading';
  const c = contactFor(s.name);
  return `
    <div class="radio-row ${playing ? 'on-air' : ''}">
      <img class="radio-logo" src="icons/icon-192.png" alt=""/>
      <div class="radio-main">
        <div class="radio-name">${esc(s.name)}</div>
        <div class="radio-sub">${s.freq && s.freq < 200 ? s.freq.toFixed(1) + ' FM' : esc(s.genre)}${playing ? ' · <b class="onair">ON AIR</b>' : loading ? ' · connecting…' : ''}</div>
        ${c ? `<div class="radio-contact">
          <button class="pill call ${c.tier}" onclick="vzRadioCall('${s.id}','call')">📞 Call</button>
          ${c.wa ? `<button class="pill wa ${c.tier}" onclick="vzRadioCall('${s.id}','wa')">💬 WhatsApp</button>` : ''}
        </div>` : ''}
      </div>
      <button class="radio-play ${playing ? 'stop' : ''}" data-toggle="${s.id}">${playing ? '⏹' : loading ? '…' : '▶'}</button>
    </div>`;
}

function render() {
  const box = $('radioBody'); if (!box) return;
  box.innerHTML = `
    <div class="sec-label">🇹🇹 Music Stations${R.stations.length ? ` · ${R.stations.length}` : ''}
      <button class="mini-add" id="radioRefresh">↻</button></div>
    ${R.loadState === 'loading' ? `<div class="lib-empty">Loading T&T stations…</div>` :
      R.loadState === 'error' ? `<div class="lib-empty">Couldn't reach the station directory.<br><button class="btn" id="radioRetry">Retry</button></div>` :
      R.stations.map(stationRow).join('')}
    <div class="sec-label">🌎 World Radio</div>
    ${R.world.map(stationRow).join('')}`;
  $('radioRefresh')?.addEventListener('click', () => R.loadStations(true));
  $('radioRetry')?.addEventListener('click', () => R.loadStations(true));
  box.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => R.toggle(b.dataset.toggle)));
}

document.addEventListener('DOMContentLoaded', () => { render(); R.loadStations(); });
})();
