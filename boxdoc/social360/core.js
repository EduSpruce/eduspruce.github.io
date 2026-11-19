/* Social360 (EPISJ 360) — núcleo: utilitários, plataformas, armazenamento, dados de exemplo */
'use strict';
const S360_VER = '0.4';
const EMBED = window.parent !== window;
/* ponte com a EPISJ 360 (mesma origem): sessão do Office 365, pessoas, vista ativa */
const Bridge = {
  pend: {}, n: 0, onView: null, onInfo: null,
  send(m) { try { if (EMBED) window.parent.postMessage(Object.assign({ s360: 1 }, m), location.origin); } catch (e) {} },
  ask(t, extra, ms = 8000) {
    return new Promise((res, rej) => {
      const id = ++this.n; this.pend[id] = res; this.send(Object.assign({ t, rid: id }, extra || {}));
      setTimeout(() => { if (this.pend[id]) { delete this.pend[id]; rej(new Error('sem resposta')); } }, ms);
    });
  }
};
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || !e.data.s360p) return;
  const d = e.data;
  if (d.rid && Bridge.pend[d.rid]) { const r = Bridge.pend[d.rid]; delete Bridge.pend[d.rid]; r(d); return; }
  if (d.t === 'view' && Bridge.onView) Bridge.onView(d.v);
  if (d.t === 'info' && Bridge.onInfo) Bridge.onInfo(d);
});
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = o => JSON.parse(JSON.stringify(o));
const nowISO = () => new Date().toISOString();
const LOC = 'pt-PT';
const fmtDate = (d, o) => new Date(d).toLocaleDateString(LOC, o || { day: 'numeric', month: 'short' });
const fmtTime = d => new Date(d).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
const fmtDT = d => d ? fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + fmtTime(d) : 'Sem data';
const dayKey = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const ago = d => {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d';
  return fmtDate(d);
};
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rnd = seed => { let x = hash(seed) || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; }; };
const nf = n => new Intl.NumberFormat(LOC, { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#2563eb', '#65a30d', '#0f766e'];
const LABEL_COLORS = ['#dc2626', '#ea580c', '#d97706', '#65a30d', '#059669', '#0891b2', '#2563eb', '#4f46e5', '#7c3aed', '#db2777', '#64748b'];
const colorFor = id => COLORS[hash(id) % COLORS.length];
const initials = n => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

/* Ícones (traço simples, desenhados à mão) */
const I = {
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  kanban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="5" height="16" rx="1"/><rect x="10" y="3" width="5" height="11" rx="1"/><rect x="17" y="3" width="4" height="7" rx="1"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
  media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M20 6L9 17l-5-5"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18l6-6-6-6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7zM19 15l1 2.6 2.5 1-2.5 1L19 22l-1-2.4-2.5-1 2.5-1z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12.6 12 20l-7.5-7.4A4.6 4.6 0 0 1 12 6.4a4.6 4.6 0 0 1 7.5 6.2z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/></svg>',
  plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  thumb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM7 10l4-8a3 3 0 0 1 3 3v4h5.6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.2 21H7"/></svg>',
  thumbdown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1zM17 14l-4 8a3 3 0 0 1-3-3v-4H4.4a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.8 3H17"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
  smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>',
  meh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 15h8M9 9h.01M15 9h.01"/></svg>',
  frown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M16 16s-1.5-2-4-2-4 2-4 2M9 9h.01M15 9h.01"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
  checkc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  images: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="14" height="14" rx="2"/><path d="M3 15V5a2 2 0 0 1 2-2h10"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12l4 4v12H4z"/><path d="M8 10h8M8 14h8M8 18h5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
};

/* ícone em linha, do tamanho do texto (substitui os emojis da interface) */
const ii = k => (I[k] || '').replace('<svg', '<svg class="ii" aria-hidden="true"');

/* Plataformas — marcadores de texto genéricos, sem logótipos */
const PLAT = {
  facebook: { n: 'Facebook', g: 'f', c: '#1f6feb', lim: 63206, fmts: ['post', 'reel', 'story'] },
  instagram: { n: 'Instagram', g: 'IG', c: '#c13584', lim: 2200, fmts: ['post', 'carousel', 'reel', 'story'], needsMedia: true },
  linkedin: { n: 'LinkedIn', g: 'in', c: '#0a66c2', lim: 3000, fmts: ['post', 'document', 'poll', 'video'] },
  x: { n: 'X', g: 'X', c: '#111111', lim: 280, fmts: ['post', 'thread'] },
  tiktok: { n: 'TikTok', g: 'TT', c: '#202020', lim: 2200, fmts: ['video', 'carousel'], needsMedia: true },
  youtube: { n: 'YouTube', g: '▶', c: '#d92c20', lim: 5000, fmts: ['video', 'short'], needsMedia: true },
  pinterest: { n: 'Pinterest', g: 'P', c: '#c8102e', lim: 500, fmts: ['pin', 'video'], needsMedia: true },
  gbp: { n: 'Google Business Profile', g: 'G', c: '#3b7ded', lim: 1500, fmts: ['update', 'offer', 'event'] },
  threads: { n: 'Threads', g: '@', c: '#333333', lim: 500, fmts: ['post'] },
  universal: { n: 'Conteúdo universal', g: '✦', c: '#64748b', lim: 100000, fmts: ['blog', 'newsletter', 'email', 'imprensa', 'outro'] }
};
const FMT = { poll: 'Sondagem', post: 'Publicação', reel: 'Reel', story: 'Story', carousel: 'Carrossel', document: 'Documento (PDF)', video: 'Vídeo', thread: 'Fio', short: 'Short', pin: 'Pin', update: 'Novidade', offer: 'Oferta', event: 'Evento', blog: 'Artigo de blogue', newsletter: 'Newsletter', email: 'Email', imprensa: 'Comunicado', outro: 'Outro' };
const pfBadge = (plat, cls = '') => { const p = PLAT[plat] || PLAT.universal; const bg = plat === 'instagram' ? 'linear-gradient(135deg,#f59e0b,#c13584 55%,#6d28d9)' : p.c; return `<span class="pf ${cls}" style="background:${bg}" title="${esc(p.n)}">${p.g}</span>`; };

const STATUS = {
  draft: { n: 'Rascunho', c: 'st-draft' },
  review: { n: 'Em aprovação', c: 'st-review' },
  changes: { n: 'Alterações pedidas', c: 'st-changes' },
  approved: { n: 'Aprovado', c: 'st-approved' },
  scheduled: { n: 'Agendado', c: 'st-scheduled' },
  publishing: { n: 'A publicar', c: 'st-scheduled' },
  failed: { n: 'Falhou a publicação', c: 'st-changes' },
  published: { n: 'Publicado', c: 'st-published' }
};
const stPill = s => `<span class="st ${STATUS[s]?.c || ''}">${STATUS[s]?.n || s}</span>`;

/* ---------- Armazenamento ---------- */
const COLLS = ['workspaces', 'posts', 'media', 'inbox', 'templates', 'views', 'notifs'];
const S = {}; COLLS.forEach(c => S[c] = {});
const LSKEY = 's360:data:v1';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

const Store = {
  mode: 'loading', db: null, user: null, assets: null, sample: null, me: 'local', readOnly: false,
  names: {}, pessoas: [], pendingNames: new Set(), loaded: new Set(), timer: null, slow: false, q: {},
  listeners: [],
  onChange(fn) { this.listeners.push(fn); },
  emit() { this.listeners.forEach(f => f()); },
  async init() {
    if (EMBED) {
      let r = null; try { r = await Bridge.ask('hello', null, 6000); } catch (e) {}
      if (r && r.view) this.initView = r.view;
      if (r && r.mode === 'sb') { try { return await this.startSB(r); } catch (e) { console.warn(e); toast('Não foi possível ligar à base de dados da EPISJ 360 (' + (e.message || e) + ').', 'err'); this.sbErro = e.message || String(e); } }
      if (r) { this.embedInfo = r; if (r.ro) this.readOnly = true; return this.startLocal(); }
    }
    const hasClaude = typeof window.claude === 'object' && window.claude && typeof window.claude.use === 'function';
    if (!hasClaude) return this.startLocal();
    let db = null, user = null;
    try { [db, user] = await Promise.all([claude.use('db'), claude.use('user')]); } catch (e) { db = null; }
    this.user = user;
    claude.use('sample').then(s => { this.sample = s; this.emit(); }).catch(() => {});
    claude.use('assets').then(a => { this.assets = a; }).catch(() => {});
    if (!db) return this.startLocal();
    this.db = db; this.mode = 'db';
    try { this.me = (user && await user.id()) || 'anon'; } catch (e) { this.me = 'anon'; }
    try { if (user && user.can) { const w = await user.can('data.write'); if (w === false) this.readOnly = true; } } catch (e) {}
    this.timer = setTimeout(() => { this.slow = true; this.ready = true; this.emit(); }, 10000);
    COLLS.forEach(c => {
      db.collection(c).onSnapshot(snap => {
        const m = {};
        snap.docs.forEach(d => { if (d.exists) m[d.id] = d.data(); });
        S[c] = m;
        if (!snap.metadata.fromCache) this.loaded.add(c);
        if (this.loaded.size === COLLS.length && this.timer) { clearTimeout(this.timer); this.timer = null; this.slow = false; }
        if (this.mode === 'db' && this.loaded.size >= 1) this.ready = true;
        this.resolveNames();
        this.emit();
      }, err => { this.loaded.add(c); toast('Não foi possível ler os dados (' + (err && err.code || 'erro') + ').', 'err'); this.emit(); });
    });
    this.resolveNames();
    this.emit();
  },
  async startSB(r) {
    this.mode = 'sb'; this.meInfo = r.me || {}; this.me = String(this.meInfo.email || '').toLowerCase() || 'anon';
    this.readOnly = !!r.ro; this.token = r.token; this.tokenExp = r.exp || 0; this.setPessoas(r.pessoas);
    if (this.meInfo.nome) this.names[this.me] = this.meInfo.nome;
    const { createClient } = await import(new URL('../../esm/supabase-2.117.3.min.js', location.href).href);
    this.sb = createClient(r.url, r.key, { accessToken: async () => this.getToken() });
    this.sid = Math.random().toString(36).slice(2, 10); this.signedCache = {};
    await this.loadAll();
    this.ready = true; this.emit();
    this.subscribe();
    setTimeout(() => this.prune(), 8000);
    setInterval(() => this.resync(), 120000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.resync(); });
  },
  // as notificações com mais de 60 dias saem da base de dados (não são dados da escola, só avisos)
  prune() {
    if (this.readOnly) return;
    const lim = new Date(Date.now() - 60 * 864e5).toISOString();
    Object.values(S.notifs).filter(n => (n.at || '') < lim).slice(0, 200).forEach(n => this.del('notifs', n.id));
  },
  setPessoas(l) {
    this.pessoas = (l || []).filter(p => p && p.email).map(p => ({ email: String(p.email).toLowerCase(), nome: p.nome || '' }));
    this.pessoas.forEach(p => { if (p.nome) this.names[p.email] = p.nome; });
  },
  async getToken() {
    if (this.token && (this.tokenExp || 0) * 1000 - Date.now() > 90000) return this.token;
    try { const r = await Bridge.ask('token'); if (r && r.token) { this.token = r.token; this.tokenExp = r.exp || 0; try { this.sb && this.sb.realtime.setAuth(r.token); } catch (e) {} } } catch (e) {}
    return this.token;
  },
  async loadAll() {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.sb.from('s360_docs').select('col,id,dados').order('col').order('id').range(from, from + 999);
      if (error) throw new Error(error.message || 'erro ao ler');
      all.push(...data); if (data.length < 1000) break;
    }
    const n = {}; COLLS.forEach(c => n[c] = {});
    all.forEach(r => { if (n[r.col]) n[r.col][r.id] = r.dados; });
    // não perder o que ainda está a ser gravado daqui
    Object.entries(this.q).forEach(([p, q]) => { if (q.busy || q.next) { const [c, id] = p.split('/'); if (S[c] && S[c][id]) n[c][id] = S[c][id]; else delete n[c][id]; } });
    COLLS.forEach(c => S[c] = n[c]);
  },
  subscribe() {
    try {
      this.ch = this.sb.channel('s360-docs-' + this.sid).on('postgres_changes', { event: '*', schema: 'public', table: 's360_docs' }, p => this.onRT(p)).subscribe(st => { this.rt = st; });
    } catch (e) { console.warn(e); }
  },
  onRT(p) {
    if (p.eventType === 'DELETE') { const o = p.old || {}; if (o.col && S[o.col] && S[o.col][o.id]) { const m = { ...S[o.col] }; delete m[o.id]; S[o.col] = m; this.emit(); } return; }
    const n = p.new || {}; if (!S[n.col] || String(n.por || '').endsWith('#' + this.sid)) return;
    const q = this.q[n.col + '/' + n.id]; if (q && (q.busy || q.next)) return;
    if (n.dados && typeof n.dados === 'object') { S[n.col] = { ...S[n.col], [n.id]: n.dados }; this.resolveNames(); this.emit(); }
    else this.fetchOne(n.col, n.id);
  },
  async fetchOne(c, id) {
    try { const { data } = await this.sb.from('s360_docs').select('dados').eq('col', c).eq('id', id).maybeSingle(); if (data) { S[c] = { ...S[c], [id]: data.dados }; this.emit(); } } catch (e) {}
  },
  async resync() {
    if (this.mode !== 'sb' || document.hidden || this._rs) return;
    this._rs = true; try { await this.loadAll(); this.emit(); } catch (e) {} this._rs = false;
  },
  signed(path) {
    const c = this.signedCache[path];
    if (c && c.exp > Date.now()) return c.url;
    if (!c || !c.busy) {
      this.signedCache[path] = { url: c ? c.url : '', exp: 0, busy: true };
      this.sb.storage.from('s360').createSignedUrl(path, 6 * 3600).then(({ data }) => { this.signedCache[path] = { url: data && data.signedUrl || '', exp: Date.now() + 5.5 * 3600000 }; this.emit(); }).catch(() => { this.signedCache[path] = { url: '', exp: Date.now() + 60000 }; });
    }
    return c ? c.url : '';
  },
  startLocal() {
    this.mode = 'local'; this.ready = true; this.me = 'local'; this.names.local = 'Tu';
    const raw = lsGet(LSKEY);
    if (raw) { try { const d = JSON.parse(raw); COLLS.forEach(c => S[c] = d[c] || {}); } catch (e) {} }
    this.emit();
  },
  saveLocal() {
    clearTimeout(this._st);
    this._st = setTimeout(() => {
      if (!lsSet(LSKEY, JSON.stringify(S))) toast('O armazenamento deste navegador está cheio — as últimas alterações podem perder-se ao recarregar.', 'err');
    }, 250);
  },
  get(c, id) { return S[c][id]; },
  all(c) { return Object.values(S[c]); },
  put(c, obj) {
    if (this.readOnly) { toast('Só tem acesso de leitura a este espaço.', 'err'); return false; }
    obj = clone(obj); obj.updatedAt = nowISO();
    S[c] = { ...S[c], [obj.id]: obj };
    if (this.mode === 'db') this.qWrite(c + '/' + obj.id, () => this.db.doc(c + '/' + obj.id).set(obj));
    else if (this.mode === 'sb') { const row = { col: c, id: obj.id, ws: c === 'workspaces' ? obj.id : (obj.ws || ''), dados: obj, t: Date.now(), por: this.me + '#' + this.sid }; this.qWrite(c + '/' + obj.id, async () => { const { error } = await this.sb.from('s360_docs').upsert(row, { onConflict: 'col,id' }); if (error) throw error; }); }
    else this.saveLocal();
    this.emit();
    return true;
  },
  del(c, id) {
    if (this.readOnly) { toast('Só tem acesso de leitura a este espaço.', 'err'); return false; }
    const m = { ...S[c] }; delete m[id]; S[c] = m;
    if (this.mode === 'db') this.qWrite(c + '/' + id, () => this.db.doc(c + '/' + id).delete());
    else if (this.mode === 'sb') this.qWrite(c + '/' + id, async () => { const { error } = await this.sb.from('s360_docs').delete().eq('col', c).eq('id', id); if (error) throw error; });
    else this.saveLocal();
    this.emit();
    return true;
  },
  qWrite(path, fn) {
    const q = this.q[path] || (this.q[path] = { busy: false, next: null });
    q.next = fn;
    if (!q.busy) this.pump(path);
  },
  async pump(path) {
    const q = this.q[path]; q.busy = true;
    while (q.next) {
      const f = q.next; q.next = null;
      try { await f(); }
      catch (e) {
        const code = e && e.code;
        if (this.mode === 'sb') {
          if (code === '42501' || /row-level security|permission/i.test(e && e.message || '')) { toast('Não tem permissão para esta alteração neste espaço.', 'err'); this.resync(); }
          else if (/fetch|network|Failed/i.test(e && e.message || '')) { await new Promise(r => setTimeout(r, 1500)); try { await f(); continue; } catch (e2) { toast('Sem ligação: a alteração não foi gravada.', 'err'); } }
          else toast('Não foi possível gravar: ' + ((e && e.message) || 'erro'), 'err');
          this.emit(); continue;
        }
        if (code === 'unavailable') { await new Promise(r => setTimeout(r, 600 + Math.random() * 800)); try { await f(); continue; } catch (e2) {} }
        if (code === 'invalid_argument') { this.readOnly = true; toast('Não tem permissão para alterar os dados desta app — modo só de leitura.', 'err'); }
        else if (code === 'quota_exceeded') toast('Espaço de dados cheio: elimina publicações ou media antigos.', 'err');
        else if (code === 'resource_exhausted') toast('Demasiadas alterações seguidas — tente outra vez daqui a pouco.', 'err');
        else toast('Não foi possível guardar (' + (code || 'erro') + ').', 'err');
        this.emit();
      }
    }
    q.busy = false;
  },
  name(id) {
    if (!id) return 'Alguém';
    if (id === this.me && this.mode === 'local') return 'Tu';
    if (this.names[id]) return this.names[id];
    if (String(id).includes('@')) return String(id).split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    return id === this.me ? 'Tu' : 'Membro';
  },
  async resolveNames() {
    if (this.mode === 'sb') return;
    if (!this.user || !this.user.profiles) return;
    const ids = new Set([this.me]);
    this.all('workspaces').forEach(w => (w.members || []).forEach(m => ids.add(m.id)));
    this.all('posts').forEach(p => { ids.add(p.createdBy); (p.comments || []).forEach(c => ids.add(c.by)); (p.approvals || []).forEach(a => ids.add(a.by)); });
    const need = [...ids].filter(i => i && !this.names[i] && !this.pendingNames.has(i) && i !== 'local' && i !== 'anon');
    if (!need.length) return;
    need.forEach(i => this.pendingNames.add(i));
    try {
      const ps = await this.user.profiles(need);
      need.forEach(i => { const p = ps && ps[i]; if (p && p.name) this.names[i] = p.name; });
      this.emit();
    } catch (e) {}
  },
  async search(q) {
    if (!this.user || !this.user.search) return [];
    try { const r = await this.user.search(q || ''); return (Array.isArray(r) ? r : (r && r.hits) || []).map(h => { if (h.name) this.names[h.id] = h.name; return h; }); } catch (e) { return []; }
  }
};

/* ---------- Media de exemplo (SVG gerado, sem imagens de terceiros) ---------- */
function artSVG(seed, title, w = 1080, h = 1080) {
  const r = rnd(seed);
  const pal = [['#f6d5b8', '#a0522d', '#4a2c1a'], ['#cde7f0', '#2e86ab', '#0b3954'], ['#e8f5d0', '#5b8c2a', '#24420f'], ['#fde2e4', '#d1495b', '#5c1a26'], ['#ece4ff', '#6d4fc2', '#2b1d5c'], ['#fff1c2', '#e09f00', '#5c4100']][Math.floor(r() * 6)];
  let shapes = '';
  for (let i = 0; i < 7; i++) {
    const cx = r() * w, cy = r() * h, rr = 60 + r() * 280;
    shapes += `<circle cx="${cx | 0}" cy="${cy | 0}" r="${rr | 0}" fill="${pal[i % 2 ? 1 : 0]}" opacity="${(0.25 + r() * 0.5).toFixed(2)}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal[0]}"/><stop offset="1" stop-color="${pal[1]}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}<text x="${w / 2}" y="${h / 2}" font-family="Georgia,serif" font-size="${Math.round(w / 11)}" fill="${pal[2]}" text-anchor="middle" dominant-baseline="middle" font-weight="700">${esc(title)}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function exampleData() {
  const me = Store.me;
  const D = (days, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const ws1 = uid('w'), ws2 = uid('w');
  const P = k => ws1 + '-' + k;
  const pages1 = [
    { id: P('fb'), platform: 'facebook', name: 'Café Aurora', handle: 'cafeaurora' },
    { id: P('ig'), platform: 'instagram', name: 'Café Aurora', handle: 'cafe.aurora' },
    { id: P('li'), platform: 'linkedin', name: 'Café Aurora, Lda.', handle: 'cafe-aurora' },
    { id: P('x'), platform: 'x', name: 'Café Aurora', handle: 'cafe_aurora' },
    { id: P('tt'), platform: 'tiktok', name: 'Café Aurora', handle: 'cafeaurora' },
    { id: P('yt'), platform: 'youtube', name: 'Café Aurora TV', handle: 'cafeauroratv' },
    { id: P('pi'), platform: 'pinterest', name: 'Café Aurora', handle: 'cafeaurora' },
    { id: P('gb'), platform: 'gbp', name: 'Café Aurora — Velas', handle: 'Velas' },
    { id: P('th'), platform: 'threads', name: 'Café Aurora', handle: 'cafe.aurora' },
    { id: P('un'), platform: 'universal', name: 'Blogue & Newsletter', handle: 'blog' }
  ];
  const L = { natal: uid('l'), prod: uid('l'), bast: uid('l'), ev: uid('l') };
  const w1 = {
    id: ws1, name: 'Café Aurora', color: '#d97706', createdAt: nowISO(), createdBy: me, tz: 'Atlantic/Azores',
    pages: pages1,
    labels: [{ id: L.natal, name: 'Campanha de Natal', color: '#dc2626' }, { id: L.prod, name: 'Produto', color: '#2563eb' }, { id: L.bast, name: 'Bastidores', color: '#059669' }, { id: L.ev, name: 'Eventos', color: '#7c3aed' }],
    approval: { mode: 'multi', steps: [{ id: uid('s'), name: 'Revisão interna', approver: null }, { id: uid('s'), name: 'Aprovação do cliente', approver: null }] },
    members: [{ id: me, role: 'admin' }]
  };
  const P2 = k => ws2 + '-' + k;
  const w2 = {
    id: ws2, name: 'Livraria Maré', color: '#0891b2', createdAt: nowISO(), createdBy: me, tz: 'Atlantic/Azores',
    pages: [{ id: P2('ig'), platform: 'instagram', name: 'Livraria Maré', handle: 'livraria.mare' }, { id: P2('fb'), platform: 'facebook', name: 'Livraria Maré', handle: 'livrariamare' }, { id: P2('li'), platform: 'linkedin', name: 'Livraria Maré', handle: 'livraria-mare' }],
    labels: [{ id: uid('l'), name: 'Novidades', color: '#0891b2' }, { id: uid('l'), name: 'Clube de leitura', color: '#db2777' }],
    approval: { mode: 'required', steps: [{ id: uid('s'), name: 'Aprovação', approver: null }] },
    members: [{ id: me, role: 'admin' }]
  };
  const mk = (ws, title, kind = 'image', w = 1080, h = 1080) => ({ id: uid('m'), ws, name: title.toLowerCase().replace(/\s+/g, '-') + '.svg', kind, url: artSVG(title + ws, title, w, h), w, h, createdAt: nowISO(), createdBy: me });
  const M = ['Latte de Avelã', 'Bolo-Rei', 'Torra Nova', 'Manhãs no Cais', 'Equipa Aurora', 'Brunch', 'Mercado de Natal', 'Grão do Pico'].map(t => mk(ws1, t));
  M.push(mk(ws1, 'Como torramos', 'image', 1280, 720));
  const M2 = ['Novidades', 'Clube de Leitura', 'Feira do Livro'].map(t => mk(ws2, t));
  const c = (text, internal = false, by = me, ageMin = 90) => ({ id: uid('c'), by, text, internal, at: new Date(Date.now() - ageMin * 60000).toISOString(), resolved: false });
  const h = what => [{ at: nowISO(), by: me, what }];
  const post = (o) => Object.assign({ id: uid('p'), ws: ws1, pageIds: [], text: '', custom: {}, mediaIds: [], firstComment: '', date: null, status: 'draft', approvals: [], labels: [], comments: [], history: h('criou a publicação'), createdBy: me, createdAt: nowISO(), format: 'post' }, o);
  const st = w1.approval.steps;
  const posts = [
    post({ pageIds: [P('ig'), P('fb')], text: 'O nosso latte de avelã voltou ☕🌰\nCremoso, quente e perfeito para as manhãs de novembro.\n\n#CaféAurora #SãoJorge #Açores', mediaIds: [M[0].id], date: D(-6, 9), status: 'published', labels: [L.prod], approvals: st.map(s => ({ step: s.id, by: me, at: D(-8, 10) })) }),
    post({ pageIds: [P('li')], text: 'Este ano começámos a trabalhar diretamente com produtores de café de pequena escala. Cada saco que torramos tem nome, origem e uma história.\n\nObrigado a toda a equipa que tornou isto possível.', mediaIds: [M[4].id], date: D(-3, 12, 30), status: 'published', labels: [L.bast], approvals: st.map(s => ({ step: s.id, by: me, at: D(-4, 10) })) }),
    post({ pageIds: [P('ig'), P('fb'), P('th')], text: 'Torra nova a sair do forno 🔥 Esta semana: grão do Pico, notas de cacau e laranja.\n\n#TorraNova #CaféDeEspecialidade', mediaIds: [M[2].id, M[7].id], format: 'carousel', date: D(1, 10), status: 'scheduled', labels: [L.prod], approvals: st.map(s => ({ step: s.id, by: me, at: D(-1, 10) })) }),
    post({ pageIds: [P('ig'), P('fb'), P('x')], text: 'O Bolo-Rei já chegou à vitrine 👑\nEncomendas para o fim de semana até quinta-feira.\n\n#Natal #BoloRei', custom: { [P('x')]: { on: true, text: 'O Bolo-Rei já chegou 👑 Encomendas para o fim de semana até quinta. #Natal' } }, mediaIds: [M[1].id], date: D(2, 11), status: 'review', labels: [L.natal], approvals: [{ step: st[0].id, by: me, at: D(0, 9) }], comments: [c('Podemos pôr o preço na imagem?', false, me, 300), c('Nota interna: confirmar stock com a cozinha antes de agendar.', true, me, 120)] }),
    post({ pageIds: [P('ig'), P('tt')], text: 'Mercado de Natal no Cais das Velas, este sábado das 10h às 18h 🎄\nVenham provar o nosso chocolate quente!', mediaIds: [M[6].id], format: 'reel', date: D(4, 18), status: 'review', labels: [L.natal, L.ev] }),
    post({ pageIds: [P('fb'), P('gb')], text: 'Novo horário de inverno: abrimos todos os dias das 7h30 às 19h. Domingo até às 13h.', date: D(3, 8, 30), status: 'approved', approvals: st.map(s => ({ step: s.id, by: me, at: D(0, 8) })), format: 'update' }),
    post({ pageIds: [P('ig')], text: 'Brunch de domingo: ovos, pão de massa mãe e o nosso café filtrado. Reserva na bio.', mediaIds: [M[5].id], date: D(6, 10), status: 'changes', labels: [L.prod], comments: [c('A foto parece escura, conseguem trocar?', false, me, 50)], rejected: { by: me, at: D(0, 7), reason: 'A foto parece escura, conseguem trocar?' } }),
    post({ pageIds: [P('yt')], text: 'Como torramos o nosso café\nDo grão verde à chávena — 6 minutos nos bastidores da torrefação do Café Aurora.', mediaIds: [M[8].id], format: 'video', date: D(8, 17), status: 'draft', labels: [L.bast] }),
    post({ pageIds: [P('pi')], text: 'Receita: latte de avelã caseiro\nTrês ingredientes e cinco minutos. Guarda para depois!', mediaIds: [M[0].id], format: 'pin', date: D(9, 20), status: 'draft', labels: [L.prod] }),
    post({ pageIds: [P('ig'), P('fb'), P('li'), P('th')], text: 'Manhãs no cais ☀️ Obrigado por fazerem parte da nossa rotina.', mediaIds: [M[3].id], date: D(11, 9), status: 'draft' }),
    post({ pageIds: [P('un')], text: 'Newsletter de dezembro\n\nNeste número: o calendário do Advento, a nova torra de inverno e os horários das festas.', format: 'newsletter', date: D(13, 9), status: 'draft', labels: [L.natal] }),
    post({ pageIds: [P('ig')], text: 'Uma manhã normal na Aurora.', mediaIds: [M[4].id], date: D(-10, 9), status: 'published', approvals: st.map(s => ({ step: s.id, by: me, at: D(-11, 10) })) }),
    post({ pageIds: [P('ig')], text: 'Grão do Pico ☕', mediaIds: [M[7].id], date: D(-14, 9), status: 'published', approvals: st.map(s => ({ step: s.id, by: me, at: D(-15, 10) })) }),
    post({ pageIds: [P('x'), P('th')], text: 'Qual é o vosso café de inverno preferido? ☕❄️', date: D(0, 16), status: 'draft' }),
    post({ ws: ws2, pageIds: [P2('ig'), P2('fb')], text: 'Chegaram as novidades de novembro 📚 Passem pela loja!', mediaIds: [M2[0].id], date: D(1, 15), status: 'review' }),
    post({ ws: ws2, pageIds: [P2('ig')], text: 'Clube de leitura: este mês lemos um clássico açoriano. Inscrições abertas.', mediaIds: [M2[1].id], date: D(5, 18), status: 'draft' })
  ];
  const ib = (pg, type, author, text, sent, ageMin, extra = {}) => Object.assign({ id: uid('i'), ws: ws1, pageId: pg, type, author, text, sentiment: sent, at: new Date(Date.now() - ageMin * 60000).toISOString(), done: false, read: false, assignee: null, replies: [], postId: null }, extra);
  const inbox = [
    ib(P('ig'), 'comment', 'marta.silva', 'Que saudades deste latte!! Já volto a passar aí 😍', 'pos', 25, { postId: posts[0].id }),
    ib(P('fb'), 'comment', 'João Avila', 'Fui ontem e esperei 20 minutos pelo café. Muito lento...', 'neg', 70, { postId: posts[0].id }),
    ib(P('fb'), 'message', 'Rita Bettencourt', 'Olá! Fazem encomendas de Bolo-Rei para empresas? Precisávamos de 6.', 'neu', 140),
    ib(P('ig'), 'message', 'pedro.azores', 'Vocês vendem o café em grão para levar?', 'neu', 260),
    ib(P('li'), 'comment', 'Ana Furtado', 'Iniciativa fantástica, parabéns à equipa!', 'pos', 1440, { postId: posts[1].id }),
    ib(P('gb'), 'review', 'Carlos M.', '★★☆☆☆ O espaço é bonito mas a música estava muito alta.', 'neg', 2000),
    ib(P('x'), 'mention', 'nuno_sj', '@cafe_aurora o melhor pequeno-almoço das Velas, sem dúvida', 'pos', 3000),
    ib(P('tt'), 'comment', 'lia.travels', 'onde fica isto? 😍', 'neu', 500)
  ];
  inbox[3].replies.push({ id: uid('r'), by: me, text: 'Olá Pedro! Sim, temos sacos de 250 g e 1 kg 😊', at: new Date(Date.now() - 200 * 60000).toISOString() });
  inbox[3].done = true; inbox[3].read = true;
  const templates = [{ id: uid('t'), ws: ws1, name: 'Novidade de produto', text: '✨ Novidade: [produto]\n\n[Descrição curta]\n\nDisponível a partir de [data] em todas as lojas.\n\n#CaféAurora', pageIds: [P('ig'), P('fb')], labels: [L.prod], mediaIds: [], createdBy: me, createdAt: nowISO() }];
  return { workspaces: [w1, w2], media: [...M, ...M2], posts, inbox, templates };
}

async function loadExample() {
  const d = exampleData();
  const jobs = [];
  for (const c of ['workspaces', 'media', 'templates', 'posts', 'inbox']) for (const o of d[c]) jobs.push([c, o]);
  if (Store.mode === 'local') { jobs.forEach(([c, o]) => { S[c][o.id] = o; }); Store.saveLocal(); Store.emit(); }
  else {
    for (const [c, o] of jobs) { o.updatedAt = nowISO(); S[c] = { ...S[c], [o.id]: o }; }
    Store.emit();
    for (let i = 0; i < jobs.length; i += 5) {
      await Promise.all(jobs.slice(i, i + 5).map(([c, o]) => Store.db.doc(c + '/' + o.id).set(clone(o)).catch(e => { if (i === 0) toast('Não foi possível guardar os dados de exemplo (' + (e && e.code) + ').', 'err'); })));
    }
  }
  return d.workspaces[0].id;
}

/* ---------- Toasts e pop-ups ---------- */
function toast(msg, kind = '', action) {
  const box = $('#toasts'); if (!box) return;
  const t = document.createElement('div'); t.className = 'toast ' + kind;
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.fn(); t.remove(); }; t.appendChild(b); }
  box.appendChild(t);
  setTimeout(() => t.remove(), action ? 7000 : 3800);
}
let popEl = null;
function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
function openPop(anchor, html, onClick, opts = {}) {
  closePop();
  const p = document.createElement('div'); p.className = 'pop'; p.innerHTML = html;
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect();
  const pw = p.offsetWidth, ph = p.offsetHeight;
  let x = opts.alignRight ? r.right - pw : r.left, y = r.bottom + 4;
  if (x + pw > innerWidth - 8) x = innerWidth - pw - 8;
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 4);
  p.style.left = Math.max(8, x) + 'px'; p.style.top = y + 'px';
  p.addEventListener('click', e => { const t = e.target.closest('[data-v]'); if (t) { e.stopPropagation(); const keep = onClick(t.dataset.v, t); if (!keep) closePop(); } });
  p.addEventListener('mousedown', e => e.stopPropagation());
  popEl = p;
  return p;
}
document.addEventListener('mousedown', e => { if (popEl && !popEl.contains(e.target)) closePop(); });

function copyText(t) {
  const done = () => toast('Copiado.');
  try { navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t)); } catch (e) { fallbackCopy(t); }
}
function fallbackCopy(t) {
  const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Copiado.'); } catch (e) { toast('Não foi possível copiar.', 'err'); }
  ta.remove();
}

/* Diálogo próprio (alert/confirm são bloqueados) */
function dialog({ title, body = '', ok = 'Confirmar', cancel = 'Cancelar', danger = false, wide = false, onOk, onOpen }) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal" style="${wide ? 'max-width:760px' : ''}"><div class="mh"><h3>${esc(title)}</h3><button class="icbtn" data-x>${I.x}</button></div><div class="mb">${body}</div><div class="mf">${cancel ? `<button class="btn" data-x>${esc(cancel)}</button>` : ''}${ok ? `<button class="btn ${danger ? 'bad' : 'pri'}" data-ok>${esc(ok)}</button>` : ''}</div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  $$('[data-x]', ov).forEach(b => b.onclick = close);
  const okb = $('[data-ok]', ov);
  if (okb) okb.onclick = async () => { const r = onOk ? await onOk(ov) : true; if (r !== false) close(); };
  ov.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && okb) okb.click(); });
  if (onOpen) onOpen(ov, close);
  const f = $('input,textarea,select', ov); if (f) setTimeout(() => f.focus(), 30);
  return { el: ov, close };
}
