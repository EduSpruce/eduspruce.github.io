/* Social360 (EPISJ 360) — estado da interface, lógica de publicações, vistas principais */
'use strict';
const UIKEY = 's360:ui:v1';
const UI = Object.assign({
  ws: null, view: 'feed', f: { pages: [], labels: [], status: [], q: '' }, calMode: 'month', calDate: null,
  sort: { k: 'date', d: 1 }, gridPage: null, range: 30, inboxF: 'open', inboxPlat: '', inboxSort: 'prio', inboxSel: null,
  mediaSel: null, mediaQ: '', mediaK: '', setTab: 'geral', car: {}, notif: false, sideOpen: false
}, (() => { try { return JSON.parse(lsGet(UIKEY) || '{}'); } catch (e) { return {}; } })());
UI.car = {}; UI.notif = false; UI.sideOpen = false;
if (!UI.f) UI.f = { pages: [], labels: [], status: [], q: '' };
const saveUI = () => lsSet(UIKEY, JSON.stringify({ ws: UI.ws, view: UI.view, f: UI.f, calMode: UI.calMode, sort: UI.sort, gridPage: UI.gridPage, range: UI.range, inboxF: UI.inboxF, inboxSort: UI.inboxSort, setTab: UI.setTab }));
const selected = new Set();
const VIEWS = { feed: 'Feed', calendario: 'Calendário', grelha: 'Grelha', lista: 'Lista', aprovacoes: 'Aprovações' };
const OTHER = { inbox: 'Caixa de entrada', analise: 'Análise', media: 'Biblioteca de media', definicoes: 'Definições' };

/* ---------- espaço de trabalho e permissões ---------- */
function wsList() { return Store.all('workspaces').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')); }
function curWS() { const l = wsList(); return S.workspaces[UI.ws] || l[0] || null; }
function role(ws) {
  if (Store.mode === 'local') return Store.embedInfo && Store.embedInfo.ro ? 'aprovador' : 'admin';
  if (Store.mode === 'sb') { if (Store.meInfo && Store.meInfo.direcao) return 'admin'; const m = (ws?.members || []).find(x => String(x.id).toLowerCase() === Store.me); return m ? m.role : 'aprovador'; }
  const m = (ws?.members || []).find(x => x.id === Store.me);
  if (m) return m.role;
  if (Store.isOwner || ws?.createdBy === Store.me) return 'admin';
  return 'editor';
}
const canEdit = ws => !Store.readOnly && ws && role(ws) !== 'aprovador';
const canAdmin = ws => !Store.readOnly && ws && role(ws) === 'admin';
const pageOf = (ws, id) => (ws?.pages || []).find(p => p.id === id);
const labelOf = (ws, id) => (ws?.labels || []).find(l => l.id === id);
const mediaOf = id => S.media[id];
const mUrl = m => m ? (m.storage && Store.mode === 'sb' ? Store.signed(m.storage) : m.assetId ? '/_blob/' + m.assetId : m.url) : '';
const canNewWS = () => !Store.readOnly && (Store.mode !== 'sb' || !!(Store.meInfo && Store.meInfo.direcao));
const mTag = (m, cls = '', extra = '') => !m ? '' : m.kind === 'pdf' ? `<img class="${cls}" src="${esc(m.thumb || '')}" alt="${esc(m.name || '')}" loading="lazy" draggable="false" ${extra}>` : m.kind === 'image' && m.storage && !mUrl(m) ? `<img class="${cls}" src="${esc(m.thumb || '')}" alt="${esc(m.name || '')}" loading="lazy" draggable="false" ${extra}>` : m.kind === 'video' ? `<video class="${cls}" src="${esc(mUrl(m))}" muted playsinline preload="metadata" ${extra}></video>` : `<img class="${cls}" src="${esc(mUrl(m))}" alt="${esc(m.name || '')}" loading="lazy" draggable="false" ${extra}>`;
const lblChip = l => l ? `<span class="lbl" style="background:${l.color}1a;color:${l.color}"><span class="dot" style="background:${l.color};width:7px;height:7px"></span>${esc(l.name)}</span>` : '';
const avatar = (id, cls = '') => `<span class="avatar ${cls}" style="background:${colorFor(id || 'x')}" title="${esc(Store.name(id))}">${esc(initials(Store.name(id)))}</span>`;

/* ---------- aprovações ---------- */
function steps(ws) {
  const a = ws?.approval || { mode: 'none' };
  if (a.mode === 'none') return [];
  if (a.mode === 'multi') return a.steps?.length ? a.steps : [{ id: 's1', name: 'Aprovação', approver: null }];
  return [(a.steps && a.steps[0]) || { id: 's1', name: 'Aprovação', approver: null }];
}
const needsApproval = ws => ['required', 'multi'].includes(ws?.approval?.mode);
function apState(p, ws) {
  const ss = steps(ws), ap = p.approvals || [];
  const isDone = s => ap.some(a => a.step === s.id);
  const next = ss.find(s => !isDone(s));
  return { ss, done: ss.filter(isDone).length, total: ss.length, next, full: ss.length > 0 && !next, isDone };
}
function canApprove(p, ws) {
  if (Store.readOnly || p.status === 'published') return false;
  const { next } = apState(p, ws);
  if (!next) return false;
  if (next.approver && next.approver !== Store.me && Store.mode !== 'local') return false;
  return ['review', 'draft', 'changes'].includes(p.status) || (p.status === 'scheduled' && !apState(p, ws).full);
}
function hist(p, what) { p.history = [...(p.history || []), { at: nowISO(), by: Store.me, what }].slice(-60); }
function notify(ws, text, postId, to = '*') {
  Store.put('notifs', { id: uid('n'), ws: ws.id, text, postId, by: Store.me, to, at: nowISO(), readBy: [] });
}
/* comentários novos (por conta, guardado neste aparelho) */
const SEENK = () => 's360:seen:' + Store.me;
let SEEN = null;
function seenMap() { if (!SEEN) { try { SEEN = JSON.parse(lsGet(SEENK()) || '{}'); } catch (e) { SEEN = {}; } } return SEEN; }
function markSeen(p) { const m = seenMap(); m[p.id] = (p.comments || []).reduce((t, c) => (c.at || '') > t ? c.at : t, nowISO()); // relógios de outros computadores podem estar adiantados
  const keys = Object.keys(m); if (keys.length > 3000) keys.sort((a, b) => m[a].localeCompare(m[b])).slice(0, 1000).forEach(k => delete m[k]); lsSet(SEENK(), JSON.stringify(m)); }
function unreadC(p) { const t = seenMap()[p.id] || ''; return (p.comments || []).filter(c => c.by !== Store.me && !c.resolved && c.at > t && !(c.internal && role(S.workspaces[p.ws]) === 'aprovador')).length; }
const unreadTag = p => { const n = unreadC(p); return n ? `<span class="newc" title="${n} comentário${n > 1 ? 's' : ''} novo${n > 1 ? 's' : ''}">${n} novo${n > 1 ? 's' : ''}</span>` : ''; };
/* páginas ligadas à Meta (publicação a sério) */
const ligada = pg => !!(pg && ['facebook', 'instagram'].includes(pg.platform) && pg.meta && pg.meta.fb && Store.mode === 'sb');
const liga = p => { const ws = S.workspaces[p.ws]; return (p.pageIds || []).some(id => ligada(pageOf(ws, id))); };
function pubHTML(p) {
  const ws = S.workspaces[p.ws]; const r = p.pub || {};
  const linhas = (p.pageIds || []).map(id => { const pg = pageOf(ws, id); const x = r[id]; if (!pg || !x) return ''; 
    const nome = `${pfBadge(pg.platform, 'sm')} ${esc(pg.name)}`;
    if (x.estado === 'ok') return `<div class="pubr ok">${nome} · publicada${x.url ? ` · <a href="${esc(x.url)}" target="_blank" rel="noopener">ver ↗</a>` : ''}</div>`;
    if (x.estado === 'manual') return `<div class="pubr man">${nome} · publicar à mão nesta rede</div>`;
    if (x.estado === 'aguarda') return `<div class="pubr">${nome} · o Instagram está a processar o vídeo…</div>`;
    return `<div class="pubr err">${nome} · ${esc(x.erro || 'falhou')}</div>`; }).join('');
  return linhas ? `<div class="pubbox">${linhas}</div>` : '';
}
function textFor(p, pageId) { const c = p.custom?.[pageId]; return c && c.on !== false && typeof c.text === 'string' ? c.text : p.text; }

const Act = {
  requestApproval(p, silent) {
    const ws = S.workspaces[p.ws]; p = clone(p);
    if (!steps(ws).length) { toast('Este espaço não usa aprovações. Ative-as nas definições.'); return; }
    p.status = 'review'; p.rejected = null; hist(p, 'pediu aprovação');
    Store.put('posts', p);
    const nx = apState(p, ws).next;
    notify(ws, `${Store.name(Store.me)} pediu aprovação: "${(p.text || '').slice(0, 60)}"`, p.id, nx?.approver || '*');
    if (!silent) toast('Aprovação pedida.');
    return p;
  },
  approve(p) {
    const ws = S.workspaces[p.ws];
    if (!canApprove(p, ws)) { toast('Não pode aprovar este passo.', 'err'); return; }
    p = clone(p);
    const st = apState(p, ws);
    p.approvals = [...(p.approvals || []), { step: st.next.id, by: Store.me, at: nowISO() }];
    hist(p, `aprovou (${st.next.name})`);
    const st2 = apState(p, ws);
    if (st2.full) {
      if (p.autoSchedule && p.date) { p.status = new Date(p.date) <= new Date() ? 'published' : 'scheduled'; p.autoSchedule = false; hist(p, 'agendou automaticamente após aprovação'); }
      else p.status = 'approved';
      notify(ws, `Publicação aprovada: "${(p.text || '').slice(0, 60)}"`, p.id, p.createdBy || '*');
    } else {
      p.status = 'review';
      notify(ws, `Passo "${st.next.name}" aprovado — falta "${st2.next.name}"`, p.id, st2.next.approver || '*');
    }
    Store.put('posts', p);
    toast(st2.full ? (p.status === 'scheduled' ? 'Aprovada e agendada.' : 'Publicação aprovada.') : `Passo ${st2.done}/${st2.total} aprovado.`);
    return p;
  },
  reject(p, reason) {
    const ws = S.workspaces[p.ws]; p = clone(p);
    p.status = 'changes'; p.approvals = []; p.autoSchedule = false;
    p.rejected = { by: Store.me, at: nowISO(), reason: reason || '' };
    if (reason) p.comments = [...(p.comments || []), { id: uid('c'), by: Store.me, text: reason, internal: false, at: nowISO(), resolved: false }];
    hist(p, 'pediu alterações');
    Store.put('posts', p);
    notify(ws, `Alterações pedidas: ${reason || '(sem motivo)'}`, p.id, p.createdBy || '*');
    toast('Alterações pedidas.');
    return p;
  },
  askReject(p, after) {
    dialog({
      title: 'Pedir alterações', ok: 'Pedir alterações', body: `<div class="fld"><label>O que deve mudar?</label><textarea class="inp" rows="4" id="rj" placeholder="Ex.: trocar a imagem, rever o texto…"></textarea></div>`,
      onOk: ov => { const r = Act.reject(p, $('#rj', ov).value.trim()); after && after(r); }
    });
  },
  problems(p) {
    const ws = S.workspaces[p.ws], out = [];
    if (!p.pageIds?.length) out.push('Escolha pelo menos uma página.');
    p.pageIds.forEach(id => {
      const pg = pageOf(ws, id); if (!pg) return;
      const pl = PLAT[pg.platform];
      const t = textFor(p, id);
      if (t.length > pl.lim) out.push(`${pl.n}: o texto passa o limite de ${pl.lim} caracteres.`);
      if (pl.needsMedia && !p.mediaIds?.length) out.push(`${pl.n} precisa de uma imagem ou vídeo.`);
    });
    if (!(p.text || '').trim() && !p.mediaIds?.length) out.push('A publicação está vazia.');
    const li = p.pageIds.some(id => pageOf(ws, id)?.platform === 'linkedin');
    if (li && p.format === 'poll') {
      const o = (p.poll && p.poll.opts || []).filter(x => x.trim());
      if (o.length < 2) out.push('Sondagem do LinkedIn: precisa de 2 a 4 opções.');
      if (o.some(x => x.length > 30)) out.push('Sondagem do LinkedIn: cada opção tem no máximo 30 caracteres.');
      if (!(p.text || '').trim()) out.push('Sondagem do LinkedIn: escreva a pergunta no texto.');
      if (p.mediaIds?.length) out.push('Sondagem do LinkedIn: não leva imagens nem vídeos.');
    }
    if (li && p.format === 'document' && !(p.mediaIds || []).some(id => mediaOf(id)?.kind === 'pdf')) out.push('Documento do LinkedIn: carregue um PDF.');
    (p.mediaIds || []).forEach(id => { const m = mediaOf(id); if (m && m.kind === 'pdf' && !(li && p.format === 'document')) out.push(`“${m.name}” é um PDF: só pode ir como Documento do LinkedIn.`); });
    return out;
  },
  schedule(p) {
    const ws = S.workspaces[p.ws]; p = clone(p);
    const pr = Act.problems(p);
    if (pr.length) { toast(pr[0], 'err'); return null; }
    if (!p.date) { toast('Escolha a data e hora primeiro.', 'err'); return null; }
    if (new Date(p.date) < new Date(Date.now() - 60000)) { toast('A data já passou — escolha uma data futura ou use “Publicar agora”.', 'err'); return null; }
    if (needsApproval(ws) && !apState(p, ws).full) {
      p.autoSchedule = true;
      if (p.status !== 'review') { p.status = 'review'; hist(p, 'pediu aprovação'); notify(ws, `${Store.name(Store.me)} pediu aprovação: "${(p.text || '').slice(0, 60)}"`, p.id, apState(p, ws).next?.approver || '*'); }
      hist(p, 'marcou para agendar após aprovação');
      Store.put('posts', p);
      toast('Fica agendada automaticamente assim que for aprovada.');
      return p;
    }
    p.status = 'scheduled'; p.autoSchedule = false; hist(p, 'agendou para ' + fmtDT(p.date));
    Store.put('posts', p); toast('Agendada para ' + fmtDT(p.date) + '.');
    return p;
  },
  unschedule(p) {
    const ws = S.workspaces[p.ws]; p = clone(p);
    p.status = apState(p, ws).full ? 'approved' : 'draft'; p.autoSchedule = false; hist(p, 'cancelou o agendamento');
    Store.put('posts', p); toast('Agendamento cancelado.'); return p;
  },
  publishNow(p) {
    const ws = S.workspaces[p.ws]; p = clone(p);
    const pr = Act.problems(p);
    if (pr.length) { toast(pr[0], 'err'); return null; }
    if (needsApproval(ws) && !apState(p, ws).full) { toast('Esta publicação precisa de ser aprovada antes de sair.', 'err'); return null; }
    if (Store.mode === 'sb') {
      p.date = nowISO(); p.status = 'scheduled'; p.autoSchedule = false; hist(p, 'pediu para publicar agora');
      Store.put('posts', p); toast(liga(p) ? 'Vai ser publicada dentro de um minuto.' : 'Fica marcada como publicada dentro de um minuto (estas páginas publicam-se à mão).'); return p;
    }
    p.date = nowISO(); p.status = 'published'; p.publishedAt = nowISO(); hist(p, 'publicou');
    Store.put('posts', p); toast('Marcada como publicada (envio simulado).'); return p;
  },
  retry(p) {
    p = clone(p); p.status = 'scheduled'; p.date = nowISO(); p.autoSchedule = false; hist(p, 'pediu para tentar publicar outra vez');
    Store.put('posts', p); toast('Vai tentar outra vez dentro de um minuto (as páginas já publicadas não se repetem).'); return p;
  },
  markPublished(p) {
    p = clone(p); p.status = 'published'; p.publishedAt = nowISO(); hist(p, 'marcou como publicada à mão');
    Store.put('posts', p); toast('Marcada como publicada.'); return p;
  },
  duplicate(p, wsId) {
    const n = clone(p); n.id = uid('p'); n.status = 'draft'; n.approvals = []; n.comments = []; n.rejected = null; n.autoSchedule = false;
    n.createdAt = nowISO(); n.createdBy = Store.me; n.history = [{ at: nowISO(), by: Store.me, what: 'duplicou a publicação' }];
    if (wsId && wsId !== p.ws) { const tw = S.workspaces[wsId]; n.ws = wsId; n.pageIds = []; n.labels = []; n.custom = {}; if (tw.pages[0]) n.pageIds = [tw.pages[0].id]; }
    if (n.date && new Date(n.date) < new Date()) n.date = null;
    Store.put('posts', n); return n;
  },
  remove(p) {
    const keep = clone(p);
    Store.del('posts', p.id);
    toast('Publicação eliminada.', '', { label: 'Anular', fn: () => Store.put('posts', keep) });
  },
  comment(p, text, internal, extra = {}) {
    const ws = S.workspaces[p.ws]; p = clone(p);
    const c = Object.assign({ id: uid('c'), by: Store.me, text, internal: !!internal, at: nowISO(), resolved: false }, extra);
    p.comments = [...(p.comments || []), c];
    Store.put('posts', p);
    const mentions = (ws.members || []).filter(m => m.id !== Store.me && text.includes('@' + Store.name(m.id)));
    mentions.forEach(m => notify(ws, `${Store.name(Store.me)} mencionou-o: "${text.slice(0, 70)}"`, p.id, m.id));
    notify(ws, `${Store.name(Store.me)} comentou: "${text.slice(0, 70)}"`, p.id, '*');
    return p;
  }
};

/* Publicação automática simulada quando chega a hora (só sem a base de dados: com ela, publica o servidor a cada minuto) */
function tick() {
  if (!Store.ready || Store.readOnly || Store.mode === 'sb') return;
  const now = Date.now();
  Store.all('posts').forEach(p => {
    if (p.status === 'scheduled' && p.date && new Date(p.date).getTime() <= now) {
      const ws = S.workspaces[p.ws]; if (!ws || !canEdit(ws)) return;
      const n = clone(p); n.status = 'published'; n.publishedAt = nowISO(); hist(n, 'publicou automaticamente (simulado)');
      Store.put('posts', n);
      Store.put('notifs', { id: 'pub-' + p.id, ws: ws.id, text: `Publicada: "${(p.text || '').slice(0, 60)}"`, postId: p.id, by: Store.me, to: '*', at: nowISO(), readBy: [] }); // id fixo: vários computadores abertos não repetem o aviso
    }
  });
}

/* ---------- filtros ---------- */
function wsPosts(ws) { return Store.all('posts').filter(p => p.ws === ws.id); }
function filtered(ws, opts = {}) {
  const f = UI.f; const q = (f.q || '').toLowerCase();
  return wsPosts(ws).filter(p => {
    if (f.pages.length && !p.pageIds.some(i => f.pages.includes(i))) return false;
    if (f.labels.length && !(p.labels || []).some(i => f.labels.includes(i))) return false;
    if (!opts.ignoreStatus && f.status.length && !f.status.includes(p.status)) return false;
    if (q && !((p.text || '').toLowerCase().includes(q) || Object.values(p.custom || {}).some(c => (c.text || '').toLowerCase().includes(q)))) return false;
    return true;
  });
}
const byDate = (a, b) => (a.date ? new Date(a.date).getTime() : -Infinity) - (b.date ? new Date(b.date).getTime() : -Infinity);

/* ---------- pré-visualizações ---------- */
function richText(t) {
  return esc(t).replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, '$1<span class="ht">$2</span>').replace(/(^|\s)(@[\w.]+)/g, '$1<span class="ht">$2</span>').replace(/(https?:\/\/[^\s<]+)/g, '<span class="ht">$1</span>');
}
function pvMedia(p, cls, pageId, opts) {
  const ms = (p.mediaIds || []).map(mediaOf).filter(Boolean);
  if (!ms.length) return opts.placeholder ? `<div class="md ${cls}"><div class="ph">Sem media</div></div>` : '';
  const pins = opts.pins ? (p.comments || []).filter(c => c.mediaId && !c.resolved) : [];
  const pinHTML = m => pins.filter(c => c.mediaId === m.id).map(c => `<span class="pin-dot" style="left:${c.x}%;top:${c.y}%" data-act="focusc" data-cid="${c.id}" title="${esc(c.text)}">${(p.comments || []).filter(x => x.mediaId).indexOf(c) + 1}</span>`).join('');
  if (opts.carousel && ms.length > 1) {
    const k = p.id + ':' + pageId; const i = Math.min(UI.car[k] || 0, ms.length - 1); const m = ms[i];
    return `<div class="md ${cls}" data-annot="${m.id}">${mTag(m)}${pinHTML(m)}<span class="mcnt">${i + 1}/${ms.length}</span>${i > 0 ? `<button class="cnav l" data-act="car" data-k="${k}" data-d="-1">‹</button>` : ''}${i < ms.length - 1 ? `<button class="cnav r" data-act="car" data-k="${k}" data-d="1">›</button>` : ''}<div class="dots">${ms.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div></div>`;
  }
  if (ms.length > 1 && opts.grid) return `<div class="md ${cls}"><div class="grid2">${ms.slice(0, 4).map(m => `<div style="position:relative" data-annot="${m.id}">${mTag(m)}${pinHTML(m)}</div>`).join('')}</div>${ms.length > 4 ? `<span class="mcnt">+${ms.length - 4}</span>` : ''}</div>`;
  const m = ms[0];
  return `<div class="md ${cls}" data-annot="${m.id}">${mTag(m)}${pinHTML(m)}${ms.length > 1 ? `<span class="mcnt">1/${ms.length}</span>` : ''}</div>`;
}
function preview(p, pageId, opts = {}) {
  const ws = S.workspaces[p.ws];
  const h = preview0(p, pageId, opts);
  return ws && ws.autoCrop === false ? h.replace('<div class="pv', '<div class="nocrop pv') : h;
}
function linkedinExtra(p) {
  if (p.format === 'poll') {
    const o = (p.poll && p.poll.opts || []).filter(x => x.trim());
    const d = (p.poll && p.poll.dur) || 7;
    return `<div class="poll">${o.map(x => `<div class="po">${esc(x)}</div>`).join('') || '<div class="muted">Acrescente 2 a 4 opções</div>'}<div class="muted" style="margin-top:6px">0 votos · ${d === 1 ? '1 dia' : d === 14 ? '2 semanas' : d + ' dias'} restantes</div></div>`;
  }
  if (p.format === 'document') {
    const m = mediaOf(p.mediaIds?.[0]);
    return `<div class="docpv">${m && m.kind === 'pdf' ? `<img src="${esc(m.thumb || '')}" alt="">` : '<div class="ph">Escolha um PDF</div>'}<div class="dt"><b>${esc(p.docTitle || (m ? m.name.replace(/\.pdf$/i, '') : 'Documento'))}</b>${m && m.pages ? ` · ${m.pages} páginas` : ''}</div></div>`;
  }
  return null;
}
function preview0(p, pageId, opts = {}) {
  const ws = S.workspaces[p.ws]; const pg = pageOf(ws, pageId);
  if (!pg) return `<div class="pv"><div class="tx" style="padding:14px">${richText(p.text) || '<span class="muted">Escreva algo…</span>'}</div>${pvMedia(p, 'wide', pageId, opts)}</div>`;
  const t = textFor(p, pageId); const tx = richText(t) || '<span class="muted">Escreva algo…</span>';
  const when = p.date ? (p.status === 'published' ? ago(p.date) : fmtDT(p.date)) : 'Agora';
  const av = `<span class="pf lg" style="background:${ws.color || '#888'}">${esc(initials(pg.name))}</span>`;
  const fc = p.firstComment ? `<div class="fc"><b>${esc(pg.handle || pg.name)}</b> ${richText(p.firstComment)}</div>` : '';
  switch (pg.platform) {
    case 'instagram': {
      const story = ['story', 'reel'].includes(p.format);
      if (story) return vertical(p, pg, t, pageId, opts, 'heart chat send');
      return `<div class="pv">
        <div class="hd">${av}<div><div class="nm">${esc(pg.handle || pg.name)}</div><div class="sb">${esc(ws.name)}</div></div><span style="margin-left:auto">${I.dots.replace('<svg', '<svg width="18"')}</span></div>
        ${pvMedia(p, 'sq', pageId, Object.assign({ placeholder: true, carousel: true }, opts))}
        <div class="icons"><span>${ii('heart')}</span><span>${ii('chat')}</span><span>${ii('send')}</span><span class="r">${ii('bookmark')}</span></div>
        <div class="tx" style="padding-top:4px"><b>${esc(pg.handle || pg.name)}</b> ${tx}</div>${fc}
        <div class="tx sb" style="font-size:11px;color:var(--ink3);text-transform:uppercase">${esc(when)}</div></div>`;
    }
    case 'tiktok': return vertical(p, pg, t, pageId, opts, 'heart chat up');
    case 'youtube': {
      if (p.format === 'short') return vertical(p, pg, t, pageId, opts, 'thumb thumbdown chat');
      const [title, ...rest] = t.split('\n');
      return `<div class="pv">${pvMedia(p, 'wide', pageId, Object.assign({ placeholder: true }, opts))}<div class="yt-t">${esc(title) || '<span class="muted">Título do vídeo</span>'}</div><div class="hd" style="padding-top:4px">${av.replace('lg', '')}<div class="sb">${esc(pg.name)} · ${esc(when)}</div></div><div class="tx" style="color:var(--ink2);font-size:13px">${richText(rest.join('\n').trim())}</div></div>`;
    }
    case 'pinterest': {
      const [title, ...rest] = t.split('\n');
      return `<div class="pv" style="max-width:320px"><div class="pin">${pvMedia(p, '', pageId, Object.assign({ placeholder: true }, opts))}</div><div class="yt-t" style="padding-top:0">${esc(title)}</div><div class="tx" style="font-size:13px;color:var(--ink2)">${richText(rest.join('\n').trim())}</div><div class="hd" style="padding-top:0">${av.replace('lg', '')}<div class="sb">${esc(pg.name)}</div></div></div>`;
    }
    case 'gbp': return `<div class="pv"><div class="hd">${av}<div><div class="nm">${esc(pg.name)}</div><div class="sb">${esc(FMT[p.format] || 'Novidade')} · ${esc(when)}</div></div></div>${pvMedia(p, 'wide', pageId, opts)}<div class="tx" style="padding-top:10px">${tx}</div><span class="gbtn">Saber mais</span></div>`;
    case 'x': case 'threads': {
      const handle = '@' + (pg.handle || '').replace(/^@/, '');
      return `<div class="pv" style="padding:12px;display:flex;gap:10px">${av}<div style="flex:1;min-width:0"><div style="font-size:13.5px"><b>${esc(pg.name)}</b> <span class="muted">${esc(handle)} · ${esc(when)}</span></div><div class="tx" style="padding:3px 0 8px">${tx}</div><div style="border-radius:14px;overflow:hidden">${pvMedia(p, 'wide', pageId, Object.assign({ grid: true }, opts))}</div><div style="display:flex;justify-content:space-between;color:var(--ink3);font-size:13px;margin-top:8px;max-width:320px"><span>${ii('chat')}</span><span>${ii('repeat')}</span><span>${ii('heart')}</span><span>${ii('bars')}</span></div></div></div>`;
    }
    case 'linkedin': return `<div class="pv"><div class="hd">${av}<div><div class="nm">${esc(pg.name)}</div><div class="sb">${nf(1200 + hash(pg.id) % 9000)} seguidores<br>${esc(when)} · ${ii('globe')}</div></div></div><div class="tx">${tx}</div>${linkedinExtra(p) ?? pvMedia(p, 'wide', pageId, Object.assign({ grid: true }, opts))}<div class="acts"><span>${ii('thumb')} Gosto</span><span>${ii('chat')} Comentar</span><span>${ii('repeat')} Republicar</span><span>${ii('send')} Enviar</span></div></div>`;
    case 'universal': {
      const [title, ...rest] = t.split('\n');
      return `<div class="pv" style="padding:18px"><div class="muted" style="text-transform:uppercase;font-size:11px;letter-spacing:.06em">${esc(FMT[p.format] || 'Conteúdo')} · ${esc(pg.name)}</div><h2 style="margin:6px 0 10px;font-family:Georgia,serif">${esc(title) || 'Sem título'}</h2>${pvMedia(p, 'wide', pageId, opts)}<div class="tx" style="padding:10px 0 0">${richText(rest.join('\n').trim())}</div></div>`;
    }
    default: {
      const story = ['story', 'reel'].includes(p.format);
      if (story) return vertical(p, pg, t, pageId, opts, 'thumb chat up');
      return `<div class="pv"><div class="hd">${av}<div><div class="nm">${esc(pg.name)}</div><div class="sb">${esc(when)} · ${ii('globe')}</div></div></div><div class="tx">${tx}</div>${pvMedia(p, 'wide', pageId, Object.assign({ grid: true }, opts))}<div class="acts"><span>${ii('thumb')} Gosto</span><span>${ii('chat')} Comentar</span><span>${ii('up')} Partilhar</span></div></div>`;
    }
  }
}
function vertical(p, pg, t, pageId, opts, ic) {
  const [a, b, c] = ic.split(' ').map(ii);
  const trial = pg.platform === 'instagram' && p.format === 'reel' && p.trial && p.trial.on;
  return `<div class="pv vert">${pvMedia(p, '', pageId, Object.assign({ placeholder: true, carousel: true }, opts))}${trial ? '<span class="trialb">Reel de teste · só para não seguidores</span>' : ''}<div class="vside"><div>${a}<small>${nf(hash(p.id) % 900 + 40)}</small></div><div>${b}<small>${hash(p.id) % 90}</small></div><div>${c}</div></div><div class="vov"><div class="nm">@${esc(pg.handle || pg.name)}</div>${richText(t)}${p.music && ['instagram', 'tiktok'].includes(pg.platform) ? `<div class="mus">${ii('music')} ${esc(p.music)}</div>` : ''}</div></div>`;
}

/* ---------- casca da app ---------- */
let rq = 0;
function render() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; doRender(); }); }
Store.onChange(() => { render(); if (typeof Comp !== 'undefined' && Comp.open) Comp.sync(); });

function doRender() {
  const app = $('#app');
  const ae = document.activeElement; const aid = ae && ae.id; const sel = ae && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  const scrollEl = $('.content'); const sc = scrollEl ? scrollEl.scrollTop : 0; const sv = app.dataset.v;
  if (!Store.ready) { app.innerHTML = `<div style="margin:auto;display:flex;align-items:center;gap:10px;color:var(--ink2)"><span class="spin"></span> A carregar o Cadência…</div>`; return; }
  const ws = curWS();
  if (ws && UI.ws !== ws.id) UI.ws = ws.id;
  if (!ws) { app.innerHTML = (EMBED ? '' : railHTML(null)) + `<div class="main">${EMBED ? bannerHTML() : ''}<div class="content">${onboardingHTML()}</div></div>`; Bridge.send({ t: 'badge', n: 0, ap: 0 }); return; }
  const v = UI.view;
  const isPostView = !!VIEWS[v];
  app.innerHTML = (EMBED ? '' : railHTML(ws) + sideHTML(ws)) + `<div class="main">${topHTML(ws)}${bannerHTML()}${isPostView ? filtersHTML(ws) : ''}<div class="content" id="content">${viewHTML(ws)}</div></div>` + (selected.size && v === 'lista' ? bulkHTML(ws) : '') + (UI.notif ? notifHTML(ws) : '');
  app.dataset.v = v;
  if (EMBED) { const n = Store.all('inbox').filter(i => i.ws === ws.id && !i.read && !i.done).length; const ap = wsPosts(ws).filter(p => p.status === 'review' && canApprove(p, ws)).length; if (n !== UI._bn || ap !== UI._ba) { UI._bn = n; UI._ba = ap; Bridge.send({ t: 'badge', n, ap }); } }
  if (sv === v && !UI.jump) { const c = $('.content'); if (c) c.scrollTop = sc; }
  else if (v === 'feed') { const a = $('#today-anchor'); const c = $('.content'); if (a && c) c.scrollTop = a.offsetTop - 60; }
  UI.jump = false;
  if (aid) { const el = document.getElementById(aid); if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  afterRender(ws);
}
function afterRender(ws) { if (UI.view === 'analise' && typeof Analytics !== 'undefined') Analytics.mount(ws); }

function railHTML(ws) {
  const unread = ws ? Store.all('inbox').filter(i => i.ws === ws.id && !i.read && !i.done).length : 0;
  return `<div class="rail"><div class="logo" title="Social360">S</div>
    ${wsList().map(w => `<button class="wsb ${ws && w.id === ws.id ? 'on' : ''}" style="background:${w.color}" data-act="ws" data-id="${w.id}" title="${esc(w.name)}">${esc(initials(w.name))}</button>`).join('')}
    ${!Store.readOnly ? `<button class="add" data-act="newws" title="Novo espaço de trabalho">+</button>` : ''}
    <div class="sp"></div>
    ${ws ? `<button class="ic ${UI.view === 'inbox' ? 'on' : ''}" data-act="go" data-v="inbox" title="Caixa de entrada">${I.inbox}${unread ? `<span class="badge">${unread}</span>` : ''}</button>
    <button class="ic ${UI.view === 'analise' ? 'on' : ''}" data-act="go" data-v="analise" title="Análise">${I.chart}</button>
    <button class="ic ${UI.view === 'media' ? 'on' : ''}" data-act="go" data-v="media" title="Biblioteca de media">${I.media}</button>
    <button class="ic ${UI.view === 'definicoes' ? 'on' : ''}" data-act="go" data-v="definicoes" title="Definições">${I.gear}</button>` : ''}
    ${avatar(Store.me)}</div>`;
}
function sideHTML(ws) {
  const posts = wsPosts(ws);
  const cntPage = id => posts.filter(p => p.pageIds.includes(id)).length;
  const cntLbl = id => posts.filter(p => (p.labels || []).includes(id)).length;
  const views = Store.all('views').filter(v => v.ws === ws.id);
  return `<aside class="side ${UI.sideOpen ? 'open' : ''}">
    <div class="wshead"><div class="av" style="background:${ws.color}">${esc(initials(ws.name))}</div><div style="min-width:0;flex:1"><div class="nm">${esc(ws.name)}</div><div class="sub">${ws.pages.length} páginas · ${posts.length} publicações</div></div><button class="icbtn" data-act="wsmenu">${I.dots}</button></div>
    <div class="scroll">
      <div class="sec" style="margin-top:2px">
        ${Object.entries(VIEWS).map(([k, n]) => `<div class="item ${UI.view === k ? 'on' : ''}" data-act="go" data-v="${k}">${{ feed: I.feed, calendario: I.cal, grelha: I.grid, lista: I.list, aprovacoes: I.kanban }[k].replace('<svg', '<svg width="16" height="16"')}${n}${k === 'aprovacoes' ? `<span class="cnt">${posts.filter(p => p.status === 'review').length || ''}</span>` : ''}</div>`).join('')}
      </div>
      <div class="sec"><h4>Páginas ${canAdmin(ws) ? `<button data-act="addpage" title="Ligar página">+</button>` : ''}</h4>
        ${ws.pages.length ? ws.pages.map(pg => `<div class="item" data-act="fpage" data-id="${pg.id}"><span class="chk ${UI.f.pages.includes(pg.id) ? 'on' : ''}"></span>${pfBadge(pg.platform)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pg.name)}</span><span class="cnt">${cntPage(pg.id)}</span></div>`).join('') : `<div class="muted" style="padding:4px 8px">Ainda sem páginas.</div>`}
      </div>
      <div class="sec"><h4>Etiquetas ${canEdit(ws) ? `<button data-act="addlabel" title="Nova etiqueta">+</button>` : ''}</h4>
        ${(ws.labels || []).map(l => `<div class="item" data-act="flabel" data-id="${l.id}"><span class="chk ${UI.f.labels.includes(l.id) ? 'on' : ''}"></span><span class="dot" style="background:${l.color}"></span>${esc(l.name)}<span class="cnt">${cntLbl(l.id)}</span></div>`).join('') || `<div class="muted" style="padding:4px 8px">Sem etiquetas.</div>`}
      </div>
      <div class="sec"><h4>Vistas guardadas</h4>
        ${views.map(v => `<div class="item" data-act="openview" data-id="${v.id}">${I.list.replace('<svg', '<svg width="14" height="14"')}${esc(v.name)}<button class="icbtn" style="width:22px;height:22px;margin-left:auto" data-act="delview" data-id="${v.id}" title="Apagar">${I.x.replace('<svg', '<svg width="12" height="12"')}</button></div>`).join('') || `<div class="muted" style="padding:4px 8px">Filtre e use “Guardar vista”.</div>`}
      </div>
    </div></aside>`;
}
function topHTML(ws) {
  const unread = notifsFor(ws).filter(n => !(n.readBy || []).includes(Store.me)).length;
  const isPV = !!VIEWS[UI.view];
  const wsSel = `<select class="inp wssel" data-ch="wssel" title="Espaço de trabalho">${wsList().map(w => `<option value="${w.id}" ${w.id === ws.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}${canNewWS() ? '<option value="__novo">＋ Novo espaço de trabalho…</option>' : ''}</select>`;
  if (EMBED) return `<div class="top">${wsSel}<h2 style="margin:0;font-size:16px;white-space:nowrap">${esc(VIEWS[UI.view] || OTHER[UI.view] || '')}</h2>
    <div class="sp"></div>
    ${isPV ? `<label class="search">${I.search}<input id="q" placeholder="Pesquisar publicações  /" value="${esc(UI.f.q)}" data-in="q"></label>` : ''}
    <button class="icbtn" data-act="notif" title="Notificações">${I.bell}${unread ? `<span class="badge">${unread > 9 ? '9+' : unread}</span>` : ''}</button>
    <button class="btn" data-act="share" title="Partilhar">${I.share}<span class="lt">Partilhar</span></button>
    ${canEdit(ws) ? `<div style="display:flex"><button class="btn pri" data-act="new" style="border-radius:8px 0 0 8px" title="Criar publicação (C)">${I.plus}<span class="lt">Criar publicação</span></button><button class="btn pri" data-act="newmenu" style="border-radius:0 8px 8px 0;border-left:1px solid rgba(255,255,255,.35);padding:0 8px">▾</button></div>` : ''}
  </div>`;
  return `<div class="top"><button class="icbtn" data-act="side" style="display:${innerWidth <= 820 ? '' : 'none'}" id="sidebtn">${I.menu}</button>
    ${isPV ? `<div class="tabs">${Object.entries(VIEWS).map(([k, n]) => `<button class="tab ${UI.view === k ? 'on' : ''}" data-act="go" data-v="${k}">${{ feed: I.feed, calendario: I.cal, grelha: I.grid, lista: I.list, aprovacoes: I.kanban }[k]}<span>${n}</span></button>`).join('')}</div>` : `<h2 style="margin:0;font-size:17px">${OTHER[UI.view] || ''}</h2>`}
    <div class="sp"></div>
    ${isPV ? `<label class="search">${I.search}<input id="q" placeholder="Pesquisar publicações  /" value="${esc(UI.f.q)}" data-in="q"></label>` : ''}
    <button class="icbtn" data-act="notif" title="Notificações">${I.bell}${unread ? `<span class="badge">${unread > 9 ? '9+' : unread}</span>` : ''}</button>
    <button class="btn" data-act="share">${I.share} Partilhar</button>
    ${canEdit(ws) ? `<div style="display:flex"><button class="btn pri" data-act="new" style="border-radius:8px 0 0 8px">${I.plus} Criar publicação</button><button class="btn pri" data-act="newmenu" style="border-radius:0 8px 8px 0;border-left:1px solid rgba(255,255,255,.35);padding:0 8px">▾</button></div>` : ''}
  </div>`;
}
function bannerHTML() {
  if (Store.readOnly) return `<div class="banner">${ii('lock')} Tem acesso só de leitura — pode ver tudo mas não alterar.</div>`;
  if (Store.slow) return `<div class="banner">⏳ Ainda não foi possível confirmar os dados mais recentes; o que vês pode estar desatualizado.</div>`;
  if (Store.mode === 'local') return EMBED ? `<div class="banner">${ii('save')} Sem ligação à base de dados da EPISJ 360${Store.sbErro ? ' (' + esc(Store.sbErro) + ')' : ''}: entre com o Office 365 da escola para partilhar com a equipa. Por agora, o que fizer fica só neste navegador.</div>` : `<div class="banner">${ii('save')} Modo local: os dados ficam guardados só neste navegador.</div>`;
  return '';
}
function filtersHTML(ws) {
  const f = UI.f; const any = f.pages.length || f.labels.length || f.status.length || f.q;
  return `<div class="filters">
    <button class="btn sm" data-act="fstatus">Estado ${f.status.length ? `(${f.status.length})` : ''} ▾</button>
    <button class="btn sm" data-act="flabels">Etiquetas ${f.labels.length ? `(${f.labels.length})` : ''} ▾</button>
    <button class="btn sm" data-act="fpages">Páginas ${f.pages.length ? `(${f.pages.length})` : ''} ▾</button>
    ${EMBED ? `<button class="btn sm" data-act="viewsmenu">${ii('star')} Vistas guardadas ▾</button>` : ''}
    ${f.pages.map(id => { const pg = pageOf(ws, id); return pg ? `<span class="chip on">${pfBadge(pg.platform, 'sm')}${esc(pg.name)}<button data-act="fpage" data-id="${id}">×</button></span>` : ''; }).join('')}
    ${f.labels.map(id => { const l = labelOf(ws, id); return l ? `<span class="chip on"><span class="dot" style="background:${l.color};width:8px;height:8px"></span>${esc(l.name)}<button data-act="flabel" data-id="${id}">×</button></span>` : ''; }).join('')}
    ${f.status.map(s => `<span class="chip on">${STATUS[s].n}<button data-act="fst" data-v="${s}">×</button></span>`).join('')}
    ${any ? `<button class="btn ghost sm" data-act="fclear">Limpar filtros</button><button class="btn ghost sm" data-act="saveview">${ii('star')} Guardar vista</button>` : ''}
    <div style="flex:1"></div><span class="muted">${filtered(ws).length} publicações</span></div>`;
}
function viewHTML(ws) {
  switch (UI.view) {
    case 'calendario': return calHTML(ws);
    case 'grelha': return gridHTML(ws);
    case 'lista': return listHTML(ws);
    case 'aprovacoes': return kanbanHTML(ws);
    case 'inbox': return typeof Inbox !== 'undefined' ? Inbox.html(ws) : '';
    case 'analise': return typeof Analytics !== 'undefined' ? Analytics.html(ws) : '';
    case 'media': return typeof Media !== 'undefined' ? Media.html(ws) : '';
    case 'definicoes': return typeof Settings !== 'undefined' ? Settings.html(ws) : '';
    default: return feedHTML(ws);
  }
}
function onboardingHTML() {
  if (Store.mode === 'sb' || (EMBED && Store.mode === 'local')) {
    if (!canNewWS()) return `<div class="onb"><h1>Social360</h1><p class="muted" style="font-size:14px">Ainda não foi adicionado a nenhum espaço de trabalho do Social360. Peça à Direção para o juntar à equipa (Definições → Membros).</p></div>`;
    return `<div class="onb"><h1>Bem-vindo ao Social360</h1><p class="muted" style="font-size:14px">Planeie, reveja, aprove e agende as publicações das redes sociais da escola num só sítio. Cada espaço de trabalho tem as suas páginas, a sua equipa e as suas regras de aprovação.</p>
      <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap"><button class="btn pri" data-act="wsepisj">${I.plus} Criar o espaço da EPISJ</button><button class="btn" data-act="newws">Criar outro espaço</button></div>
      <p class="muted" style="margin-top:16px">“Criar o espaço da EPISJ” já traz as páginas de Facebook, Instagram, LinkedIn e YouTube da escola e aprovação pela Direção. Pode mudar tudo depois em Definições.</p>
      ${Store.mode === 'local' ? `<p class="muted"><button class="btn sm ghost" data-act="example">Carregar dados de exemplo (só neste navegador)</button></p>` : ''}</div>`;
  }
  return `<div class="onb"><h1>Bem-vindo ao Social360</h1><p class="muted" style="font-size:14px">Planeie, colabore, aprove e agende conteúdo para redes sociais num só sítio. Comece por criar um espaço de trabalho para cada marca ou cliente.</p>
    ${Store.readOnly ? '<p>Ainda não há espaços de trabalho e só tem acesso de leitura.</p>' : `<div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap"><button class="btn pri" data-act="newws">${I.plus} Criar espaço de trabalho</button><button class="btn" data-act="example">Carregar dados de exemplo</button></div>
    <p class="muted" style="margin-top:16px">Os dados de exemplo criam duas marcas fictícias (Café Aurora e Livraria Maré) com publicações, comentários e mensagens para experimentar.</p>`}</div>`;
}

/* ---------- Feed ---------- */
function feedHTML(ws) {
  const posts = filtered(ws).sort(byDate);
  if (!ws.pages.length) return emptyPages(ws);
  if (!posts.length) return emptyPosts(ws);
  // 0.1: com centenas de publicações, mostra uma janela à volta de hoje (mais antigas e mais recentes a pedido)
  const tk = dayKey(new Date());
  let ti = posts.findIndex(p => p.date && dayKey(p.date) >= tk); if (ti < 0) ti = posts.length;
  const nd = posts.filter(p => !p.date).length; const before = UI.feedB || 6, after = UI.feedA || 30;
  const a0 = Math.max(nd, ti - before), a1 = Math.min(posts.length, ti + after);
  const vis = posts.slice(0, Math.min(nd, 30)).concat(posts.slice(a0, a1));
  let out = '<div class="feed">', last = null, anch = false;
  if (a0 > nd) out += `<div style="text-align:center;margin:10px 0"><button class="btn sm" data-act="feedmore" data-v="b">↑ Mostrar anteriores (${a0 - nd})</button></div>`;
  vis.forEach(p => {
    const k = p.date ? dayKey(p.date) : 'none';
    if (!anch && p.date && k >= tk) { out += '<div id="today-anchor"></div>'; anch = true; }
    if (k !== last) { out += `<div class="dayh">${p.date ? fmtDate(p.date, { weekday: 'long', day: 'numeric', month: 'long' }) + (k === dayKey(new Date()) ? ' · Hoje' : '') : 'Sem data'}</div>`; last = k; }
    out += feedRow(p, ws);
  });
  if (a1 < posts.length) out += `<div style="text-align:center;margin:10px 0"><button class="btn sm" data-act="feedmore" data-v="a">Mostrar mais (${posts.length - a1}) ↓</button></div>`;
  return out + '</div>';
}
function feedRow(p, ws) {
  const sel = UI.car['tab:' + p.id] && p.pageIds.includes(UI.car['tab:' + p.id]) ? UI.car['tab:' + p.id] : p.pageIds[0];
  const st = apState(p, ws);
  const cs = (p.comments || []).filter(c => !c.resolved);
  return `<div class="frow" id="fr-${p.id}">
    <div class="fcard">
      <div class="ptabs">${p.pageIds.map(id => { const pg = pageOf(ws, id); return pg ? `<button class="ptab ${id === sel ? 'on' : ''}" data-act="ptab" data-pid="${p.id}" data-id="${id}">${pfBadge(pg.platform, 'sm')}${esc(pg.name)}${p.custom?.[id]?.on ? ' •' : ''}</button>` : ''; }).join('')}
        <span style="margin-left:auto" class="muted">${p.date ? fmtTime(p.date) : ''} ${p.format && p.format !== 'post' ? '· ' + (FMT[p.format] || '') : ''}</span></div>
      <div class="fprev" data-act="open" data-pid="${p.id}">${preview(p, sel, { pins: true })}</div>
    </div>
    <div class="fside">
      <div class="row">${stPill(p.status)}${p.autoSchedule ? '<span class="muted">· agenda ao aprovar</span>' : ''}${unreadTag(p)}<span style="flex:1"></span><button class="icbtn" data-act="pmenu" data-pid="${p.id}" style="width:28px;height:28px">${I.dots}</button></div>
      <div class="muted">${I.clock.replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')} ${fmtDT(p.date)}</div>
      ${(p.labels || []).length ? `<div class="row">${p.labels.map(id => lblChip(labelOf(ws, id))).join('')}</div>` : ''}
      ${st.total ? `<div><div class="muted" style="margin-bottom:4px">Aprovação ${st.done}/${st.total}${st.next ? ' · próximo: ' + esc(st.next.name) : ''}</div><div class="apbar">${st.ss.map(s => `<span class="s ${st.isDone(s) ? 'done' : ''}" title="${esc(s.name)}"></span>`).join('')}</div></div>` : ''}
      ${p.status === 'changes' && p.rejected?.reason ? `<div class="mini-c"><div class="b" style="background:#fde8e8"><div class="n">Alterações pedidas</div>${esc(p.rejected.reason)}</div></div>` : ''}
      ${pubHTML(p)}
      <div class="row">${actionButtons(p, ws, true)}</div>
      ${cs.slice(-2).map(c => `<div class="mini-c">${avatar(c.by, 'sm')}<div class="b ${c.internal ? 'int' : ''}"><div class="n">${esc(Store.name(c.by))} <span class="muted">${ago(c.at)}${c.internal ? ' · interno' : ''}</span></div>${esc(c.text)}</div></div>`).join('')}
      ${cs.length > 2 ? `<button class="morel" data-act="open" data-pid="${p.id}">Ver os ${cs.length} comentários</button>` : ''}
      ${!Store.readOnly ? `<div class="qc"><input id="qc-${p.id}" placeholder="Escreva um comentário…" data-qc="${p.id}"><button class="btn sm" data-act="qc" data-pid="${p.id}">Enviar</button></div>` : ''}
    </div></div>`;
}
function actionButtons(p, ws, small) {
  const s = small ? 'sm' : '';
  const b = [];
  const ed = canEdit(ws);
  if (p.status === 'published') return `<span class="muted">Publicada ${p.publishedAt ? ago(p.publishedAt) : ''}</span>`;
  if (p.status === 'publishing') return `<span class="muted">A publicar…</span>`;
  if (p.status === 'failed') return ed ? `<button class="btn pri ${s}" data-act="retry" data-pid="${p.id}">Tentar outra vez</button><button class="btn ${s}" data-act="markpub" data-pid="${p.id}">Marcar como publicada</button>` : '';
  if (canApprove(p, ws) && p.status === 'review') { b.push(`<button class="btn ok ${s}" data-act="approve" data-pid="${p.id}">${I.check} Aprovar</button>`); b.push(`<button class="btn ${s}" data-act="reject" data-pid="${p.id}">Pedir alterações</button>`); }
  if (ed && ['draft', 'changes'].includes(p.status) && steps(ws).length) b.push(`<button class="btn ${s}" data-act="reqap" data-pid="${p.id}">Pedir aprovação</button>`);
  if (ed && ['draft', 'changes', 'approved'].includes(p.status) && (!needsApproval(ws) || apState(p, ws).full)) b.push(`<button class="btn pri ${s}" data-act="sched" data-pid="${p.id}">Agendar</button>`);
  if (ed && p.status === 'scheduled') b.push(`<button class="btn ${s}" data-act="unsched" data-pid="${p.id}">Cancelar agendamento</button>`);
  if (canApprove(p, ws) && p.status !== 'review' && ['draft', 'changes'].includes(p.status)) b.push(`<button class="btn ok ${s}" data-act="approve" data-pid="${p.id}">${I.check} Aprovar</button>`);
  return b.join('');
}
function emptyPages(ws) { return `<div class="empty"><div class="eic">${I.plug}</div><h3>Ligue a primeira página</h3><p>Adicione as páginas de redes sociais deste espaço para começar a planear.</p>${canAdmin(ws) ? `<button class="btn pri" data-act="addpage">${I.plus} Adicionar página</button>` : ''}</div>`; }
function emptyPosts(ws) { const any = UI.f.pages.length || UI.f.labels.length || UI.f.status.length || UI.f.q; return `<div class="empty"><div class="eic">${I.note}</div><h3>${any ? 'Nada corresponde aos filtros' : 'Ainda não há publicações'}</h3>${any ? `<button class="btn" data-act="fclear">Limpar filtros</button>` : canEdit(ws) ? `<button class="btn pri" data-act="new">${I.plus} Criar publicação</button>` : ''}</div>`; }

/* ---------- Calendário ---------- */
function calBase() { return UI.calDate ? new Date(UI.calDate) : new Date(); }
function calHTML(ws) {
  const base = calBase(); const mode = UI.calMode;
  const posts = filtered(ws).filter(p => p.date);
  const byDay = {}; posts.forEach(p => (byDay[dayKey(p.date)] = byDay[dayKey(p.date)] || []).push(p));
  Object.values(byDay).forEach(a => a.sort(byDate));
  let start, n, title;
  if (mode === 'week') {
    start = new Date(base); const wd = (start.getDay() + 6) % 7; start.setDate(start.getDate() - wd); n = 7;
    const end = new Date(start); end.setDate(end.getDate() + 6);
    title = fmtDate(start, { day: 'numeric', month: 'short' }) + ' – ' + fmtDate(end, { day: 'numeric', month: 'short', year: 'numeric' });
  } else {
    const first = new Date(base.getFullYear(), base.getMonth(), 1); start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); n = 42;
    title = base.toLocaleDateString(LOC, { month: 'long', year: 'numeric' }); title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  const today = dayKey(new Date());
  const dn = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  let cells = '';
  for (let i = 0; i < n; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = dayKey(d);
    const items = byDay[k] || []; const max = mode === 'week' ? 99 : 3;
    cells += `<div class="cell ${mode === 'month' && d.getMonth() !== base.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''}" data-drop="day:${k}">
      <span class="dn">${d.getDate()}</span>${canEdit(ws) ? `<button class="plus" data-act="newday" data-d="${k}" title="Criar publicação neste dia">+</button>` : ''}
      ${items.slice(0, max).map(p => evHTML(p, ws, mode === 'week')).join('')}
      ${items.length > max ? `<button class="morel" data-act="calday" data-d="${k}">+${items.length - max} mais</button>` : ''}</div>`;
  }
  return `<div class="calbar"><button class="btn sm" data-act="caltoday">Hoje</button><button class="icbtn" data-act="calnav" data-d="-1">${I.left}</button><button class="icbtn" data-act="calnav" data-d="1">${I.right}</button><h2>${esc(title)}</h2><div style="flex:1"></div>
    <span class="muted" style="margin-right:8px">Arraste para mudar a data</span>
    <div class="seg"><button class="${mode === 'month' ? 'on' : ''}" data-act="calmode" data-v="month">Mês</button><button class="${mode === 'week' ? 'on' : ''}" data-act="calmode" data-v="week">Semana</button></div></div>
    <div class="cal ${mode === 'week' ? 'week' : ''}">${dn.map(x => `<div class="dh">${x}</div>`).join('')}${cells}</div>`;
}
function evHTML(p, ws, big) {
  const pg = pageOf(ws, p.pageIds[0]);
  const lock = p.status === 'published' || p.status === 'publishing' || !canEdit(ws);
  const col = { publishing: '#2a78d6', failed: '#d03b3b', draft: '#8a909c', review: '#c98500', changes: '#d03b3b', approved: '#0ca30c', scheduled: '#2a78d6', published: '#6d4fc2' }[p.status];
  const m = mediaOf(p.mediaIds?.[0]);
  return `<div class="ev ${lock ? 'locked' : ''}" style="border-left-color:${col}" ${lock ? '' : 'draggable="true"'} data-pid="${p.id}" data-act="open">
    <div class="t">${p.pageIds.slice(0, 4).map(id => { const g = pageOf(ws, id); return g ? pfBadge(g.platform, 'sm') : ''; }).join('')}${p.pageIds.length > 4 ? `<span class="muted">+${p.pageIds.length - 4}</span>` : ''}<span>${fmtTime(p.date)}</span>${unreadC(p) ? '<i class="newdot" title="Comentários novos"></i>' : ''}${(p.comments || []).filter(c => !c.resolved).length ? `<span class="muted" style="margin-left:auto">${ii('chat')} ${p.comments.filter(c => !c.resolved).length}</span>` : ''}</div>
    ${big && m ? mTag(m, 'th') : ''}
    <div class="x">${esc((pg ? textFor(p, pg.id) : p.text) || '(sem texto)')}</div>
    <div style="display:flex;gap:4px;align-items:center">${stPill(p.status).replace('class="st', 'style="font-size:10.5px;padding:0 6px" class="st')}${(p.labels || []).slice(0, 2).map(id => { const l = labelOf(ws, id); return l ? `<span class="dot" style="background:${l.color};width:8px;height:8px" title="${esc(l.name)}"></span>` : ''; }).join('')}</div>
    ${!Store.readOnly ? `<div class="acts">${canApprove(p, ws) && p.status === 'review' ? `<button data-act="approve" data-pid="${p.id}">Aprovar</button>` : ''}${canEdit(ws) && ['draft', 'approved', 'changes'].includes(p.status) && (!needsApproval(ws) || apState(p, ws).full) ? `<button data-act="sched" data-pid="${p.id}">Agendar</button>` : ''}${canEdit(ws) ? `<button data-act="dup" data-pid="${p.id}">Duplicar</button><button data-act="del" data-pid="${p.id}">Eliminar</button>` : ''}</div>` : ''}
  </div>`;
}

/* ---------- Grelha (planeador visual de feed) ---------- */
function gridHTML(ws) {
  const ig = ws.pages.filter(p => ['instagram', 'tiktok', 'pinterest', 'facebook', 'threads'].includes(p.platform));
  if (!ig.length) return `<div class="empty"><h3>Sem páginas visuais</h3><p>A grelha mostra o feed de Instagram (ou TikTok, Pinterest…). Ligue uma dessas páginas.</p></div>`;
  const pg = ig.find(p => p.id === UI.gridPage) || ig.find(p => p.platform === 'instagram') || ig[0];
  const posts = filtered(ws).filter(p => p.pageIds.includes(pg.id) && p.date).sort((a, b) => byDate(b, a));
  return `<div class="gwrap">
    <div class="gprof"><span class="pf lg" style="width:64px;height:64px;font-size:20px;background:${ws.color}">${esc(initials(pg.name))}</span><div style="flex:1"><div style="font-weight:700;font-size:16px">${esc(pg.handle || pg.name)}</div><div class="muted">${posts.length} publicações planeadas e publicadas · arraste para reorganizar</div></div>
      <select class="inp" style="width:auto" data-ch="gridpage">${ig.map(p => `<option value="${p.id}" ${p.id === pg.id ? 'selected' : ''}>${esc(PLAT[p.platform].n)} — ${esc(p.name)}</option>`).join('')}</select></div>
    ${posts.length ? `<div class="ggrid">${posts.slice(0, UI.gridN || 60).map(p => { const m = mediaOf(p.mediaIds?.[0]); const lock = p.status === 'published' || p.status === 'publishing' || !canEdit(ws); return `<div class="gt ${lock ? 'lock' : ''}" ${lock ? '' : 'draggable="true"'} data-pid="${p.id}" data-drop="grid:${p.id}" data-act="open">${m ? mTag(m) : `<div class="noimg">${esc(textFor(p, pg.id))}</div>`}<span class="gs">${stPill(p.status).replace('class="st', 'style="font-size:10px" class="st')}</span>${p.mediaIds?.length > 1 ? `<span class="gl">${ii('images')} ${p.mediaIds.length}</span>` : lock ? '<span class="gl">' + ii('lock') + '</span>' : ''}<div class="gd">${fmtDT(p.date)}</div></div>`; }).join('')}</div>${posts.length > (UI.gridN || 60) ? `<div style="text-align:center;margin:12px 0"><button class="btn sm" data-act="more" data-k="gridN" data-n="60">Mostrar mais (${posts.length - (UI.gridN || 60)})</button></div>` : ''}` : `<div class="empty">Ainda sem publicações para esta página.</div>`}
  </div>`;
}

/* ---------- Lista ---------- */
function listHTML(ws) {
  const s = UI.sort;
  const val = (p, k) => k === 'date' ? (p.date ? new Date(p.date).getTime() : 0) : k === 'status' ? Object.keys(STATUS).indexOf(p.status) : k === 'text' ? (p.text || '').toLowerCase() : k === 'comments' ? (p.comments || []).length : k === 'updated' ? (p.updatedAt || '') : 0;
  const posts = filtered(ws).sort((a, b) => { const x = val(a, s.k), y = val(b, s.k); return (x > y ? 1 : x < y ? -1 : 0) * s.d; });
  const ids = posts.map(p => p.id);
  [...selected].forEach(id => { if (!S.posts[id]) selected.delete(id); });
  const all = ids.length && ids.every(i => selected.has(i));
  const th = (k, n) => `<th class="s" data-act="sort" data-k="${k}">${n}${s.k === k ? (s.d > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  if (!posts.length) return emptyPosts(ws);
  return `<div class="lwrap"><table class="tb"><thead><tr><th style="width:34px"><input type="checkbox" data-act="selall" ${all ? 'checked' : ''}></th><th style="width:50px"></th>${th('text', 'Publicação')}<th>Páginas</th>${th('date', 'Data')}${th('status', 'Estado')}<th>Etiquetas</th>${th('comments', 'Coment.')}${th('updated', 'Alterada')}</tr></thead><tbody>
    ${posts.slice(0, UI.listN || 150).map(p => { const m = mediaOf(p.mediaIds?.[0]); return `<tr class="r ${selected.has(p.id) ? 'sel' : ''}" data-act="open" data-pid="${p.id}"><td data-stop><input type="checkbox" data-act="selone" data-pid="${p.id}" ${selected.has(p.id) ? 'checked' : ''}></td><td>${m ? mTag(m, 'th') : '<div class="th"></div>'}</td><td><div class="tx">${esc(p.text || '(sem texto)')}</div></td><td>${p.pageIds.map(id => { const g = pageOf(ws, id); return g ? pfBadge(g.platform, 'sm') : ''; }).join(' ')}</td><td style="white-space:nowrap">${fmtDT(p.date)}</td><td>${stPill(p.status)}</td><td>${(p.labels || []).map(id => lblChip(labelOf(ws, id))).join(' ')}</td><td>${(p.comments || []).length || ''}${unreadC(p) ? ' <i class="newdot"></i>' : ''}</td><td class="muted" style="white-space:nowrap">${p.updatedAt ? ago(p.updatedAt) : ''}</td></tr>`; }).join('')}
  </tbody></table>${posts.length > (UI.listN || 150) ? `<div style="text-align:center;margin:12px 0"><button class="btn sm" data-act="more" data-k="listN" data-n="150">Mostrar mais (${posts.length - (UI.listN || 150)})</button> <span class="muted">“Selecionar tudo” inclui as ${posts.length} publicações filtradas.</span></div>` : ''}</div>`;
}
function bulkHTML(ws) {
  const n = selected.size;
  return `<div class="bulk"><b>${n} selecionada${n > 1 ? 's' : ''}</b><span style="width:8px"></span>
    <button class="btn sm" data-act="bulk" data-v="approve">Aprovar</button>
    ${canEdit(ws) ? `<button class="btn sm" data-act="bulk" data-v="reqap">Pedir aprovação</button><button class="btn sm" data-act="bulk" data-v="sched">Agendar</button><button class="btn sm" data-act="bulk" data-v="label">Etiquetar</button><button class="btn sm" data-act="bulk" data-v="dup">Duplicar</button>${wsList().length > 1 ? `<button class="btn sm" data-act="bulk" data-v="copyws">Duplicar noutro espaço</button>` : ''}<button class="btn sm bad" data-act="bulk" data-v="del">Eliminar</button>` : ''}
    <button class="btn sm" data-act="bulk" data-v="clear">✕</button></div>`;
}

/* ---------- Aprovações (quadro) ---------- */
const KCOLS = [['draft', 'Rascunho'], ['review', 'Em aprovação'], ['changes', 'Alterações pedidas'], ['approved', 'Aprovado'], ['scheduled', 'Agendado'], ['failed', 'Falhou'], ['published', 'Publicado']];
function kanbanHTML(ws) {
  const posts = filtered(ws, { ignoreStatus: true }).sort(byDate);
  return `<div class="kb">${KCOLS.map(([k, n]) => { const ps = posts.filter(p => p.status === k || (k === 'scheduled' && p.status === 'publishing'));
    if (k === 'failed' && !ps.length) return ''; return `<div class="kcol" data-drop="col:${k}"><h5>${stPill(k)}<span class="n">${ps.length}</span></h5><div class="lst">${ps.slice(0, UI.kN || 30).map(p => kcard(p, ws)).join('') || '<div class="muted" style="text-align:center;padding:14px 0">—</div>'}${ps.length > (UI.kN || 30) ? `<button class="btn sm" data-act="more" data-k="kN" data-n="30">Mostrar mais (${ps.length - (UI.kN || 30)})</button>` : ''}</div></div>`; }).join('')}</div>`;
}
function kcard(p, ws) {
  const m = mediaOf(p.mediaIds?.[0]); const st = apState(p, ws);
  const lock = p.status === 'published' || p.status === 'publishing' || Store.readOnly;
  return `<div class="kc" ${lock ? '' : 'draggable="true"'} data-pid="${p.id}" data-act="open">${m ? mTag(m) : ''}
    <div class="m">${p.pageIds.slice(0, 5).map(id => { const g = pageOf(ws, id); return g ? pfBadge(g.platform, 'sm') : ''; }).join('')}<span style="margin-left:auto">${p.date ? fmtDT(p.date) : 'Sem data'}</span></div>
    <div class="x">${esc(p.text || '(sem texto)')}</div>
    ${st.total && p.status !== 'published' ? `<div class="apbar">${st.ss.map(s => `<span class="s ${st.isDone(s) ? 'done' : ''}" title="${esc(s.name)}"></span>`).join('')}</div>` : ''}
    <div class="m">${(p.labels || []).map(id => { const l = labelOf(ws, id); return l ? `<span class="dot" style="background:${l.color};width:8px;height:8px"></span>` : ''; }).join('')}${(p.comments || []).length ? `<span>${ii('chat')} ${p.comments.length}</span>` : ''}${unreadC(p) ? '<i class="newdot"></i>' : ''}${p.status === 'review' && canApprove(p, ws) ? `<button class="btn ok sm" style="margin-left:auto;height:24px" data-act="approve" data-pid="${p.id}">Aprovar</button>` : ''}</div></div>`;
}
function kanbanDrop(p, to) {
  const ws = S.workspaces[p.ws];
  if (p.status === to || to === 'failed') return;
  if (to === 'published') { if (p.status === 'failed') Act.markPublished(p); else Act.publishNow(p); return; }
  if (to === 'scheduled') { Act.schedule(p); return; }
  if (to === 'review') { Act.requestApproval(p); return; }
  if (to === 'changes') { Act.askReject(p); return; }
  if (to === 'approved') {
    if (!steps(ws).length) { const n = clone(p); n.status = 'approved'; hist(n, 'marcou como aprovada'); Store.put('posts', n); return; }
    if (!canApprove(p, ws)) { toast('Não pode aprovar este passo.', 'err'); return; }
    const r = Act.approve(p);
    if (r && r.status !== 'approved' && r.status !== 'scheduled') toast('Faltam passos de aprovação.');
    return;
  }
  if (to === 'draft') { const n = clone(p); n.status = 'draft'; n.autoSchedule = false; hist(n, 'voltou a rascunho'); Store.put('posts', n); }
}

/* ---------- notificações ---------- */
function notifsFor(ws) {
  return Store.all('notifs').filter(n => n.ws === ws.id && (Store.mode === 'local' || (n.by !== Store.me && (n.to === '*' || n.to === Store.me)))).sort((a, b) => b.at.localeCompare(a.at));
}
function notifHTML(ws) {
  const ns = notifsFor(ws).slice(0, 60);
  return `<div class="npanel" id="npanel"><div class="h"><b>Notificações</b><button class="btn ghost sm" data-act="readall">Marcar todas como lidas</button></div><div class="l">
    ${ns.map(n => `<div class="ni ${(n.readBy || []).includes(Store.me) ? '' : 'un'}" data-act="nopen" data-id="${n.id}">${avatar(n.by, 'sm')}<div><div>${esc(n.text)}</div><div class="tm">${ago(n.at)}</div></div></div>`).join('') || '<div class="empty" style="padding:30px">Sem notificações.</div>'}</div></div>`;
}
