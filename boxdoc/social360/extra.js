/* Social360 (EPISJ 360) — media, caixa de entrada, análise, definições, diálogos e eventos */
'use strict';
window.QUIET = false;
const _toast = toast;
toast = function (m, k, a) { if (window.QUIET && k !== 'err') return; _toast(m, k, a); };
const _name = Store.name.bind(Store);
Store.name = function (id) {
  for (const w of Store.all('workspaces')) { const m = (w.members || []).find(x => x.id === id && x.n); if (m) return m.n; }
  return _name(id);
};

/* ================= MEDIA ================= */
function readImage(file, max) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = rej;
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
        if (file.type === 'image/svg+xml' || file.type === 'image/gif') return res({ url: fr.result, w: img.width, h: img.height });
        const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
        res({ url: c.toDataURL('image/jpeg', 0.82), w, h });
      };
      img.onerror = rej; img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function imgDims(file) { return new Promise(res => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => { res({ w: i.naturalWidth, h: i.naturalHeight }); URL.revokeObjectURL(u); }; i.onerror = () => { res(null); URL.revokeObjectURL(u); }; i.src = u; }); }
/* primeira página de um PDF como imagem (pdf.js da EPISJ 360) */
async function pdfThumb(file) {
  try {
    const pdfjs = await import(new URL('../lib/pdf.min.mjs', location.href).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.mjs', location.href).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pg = await doc.getPage(1); const v0 = pg.getViewport({ scale: 1 }); const sc = 600 / Math.max(v0.width, v0.height);
    const v = pg.getViewport({ scale: sc }); const c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
    return { thumb: c.toDataURL('image/jpeg', 0.8), pages: doc.numPages, w: c.width, h: c.height };
  } catch (e) { console.warn(e); return { thumb: '', pages: 0 }; }
}
const Media = {
  async upload(files, ws) {
    const out = [];
    for (const f of files) {
      const kind = f.type.startsWith('video') ? 'video' : f.type.startsWith('image') ? 'image' : f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? 'pdf' : null;
      if (!kind) { toast(`${f.name}: só imagens, vídeos ou PDF.`, 'err'); continue; }
      const m = { id: uid('m'), ws: ws.id, name: f.name, kind, createdAt: nowISO(), createdBy: Store.me, size: f.size };
      try {
        if (kind === 'pdf') Object.assign(m, await pdfThumb(f));
        if (Store.mode === 'sb') {
          // 0.1: tudo no armazenamento privado; na base de dados fica só uma miniatura leve (abre depressa mesmo com centenas de ficheiros)
          if (f.size > 50 * 1024 * 1024) { toast(`${f.name}: máximo 50 MB por ficheiro.`, 'err'); continue; }
          if (kind === 'image') { const t = await readImage(f, 360); m.thumb = t.url; const d = await imgDims(f); if (d) { m.w = d.w; m.h = d.h; } }
          toast(`A carregar ${f.name}…`);
          const path = ws.id + '/' + m.id + '-' + f.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
          const { error } = await Store.sb.storage.from('s360').upload(path, f, { contentType: f.type, upsert: false });
          if (error) throw error;
          m.storage = path;
          // o Instagram só aceita JPEG: guarda também uma cópia em JPEG das imagens noutros formatos
          if (kind === 'image' && !/jpe?g$/i.test(f.type)) { try { const j = await readImage(f, 2048); const b = await (await fetch(j.url)).blob(); const r2 = await Store.sb.storage.from('s360').upload(path + '.jpg', b, { contentType: 'image/jpeg', upsert: true }); if (!r2.error) m.jpg = path + '.jpg'; } catch (e) {} }
        } else if (kind === 'pdf') {
          if (Store.assets) { const r = await Store.assets.upload(f); m.assetId = r.id; m.url = r.url; }
          else if (f.size < 3 * 1024 * 1024) m.url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
          else { m.url = URL.createObjectURL(f); m.temp = true; toast('PDF grande: fica disponível só nesta sessão (modo local).'); }
        } else if (Store.assets) {
          if (f.size > 20 * 1024 * 1024) { toast(`${f.name}: máximo 20 MB.`, 'err'); continue; }
          toast(`A carregar ${f.name}…`);
          const r = await Store.assets.upload(f);
          m.assetId = r.id; m.url = r.url;
          if (kind === 'image') { try { const d = await readImage(f, 64); m.w = d.w; m.h = d.h; } catch (e) {} }
        } else if (kind === 'image') {
          const d = await readImage(f, Store.mode === 'db' ? 900 : 1400); Object.assign(m, d);
        } else {
          if (Store.mode === 'db') { toast('Só editores podem carregar vídeos para a biblioteca partilhada.', 'err'); continue; }
          m.url = URL.createObjectURL(f); m.temp = true;
          toast('Vídeo disponível só nesta sessão (o modo local não guarda vídeos).');
        }
        Store.put('media', m); out.push(m);
      } catch (e) { toast(`Não foi possível carregar ${f.name}${e && e.message ? ': ' + e.message : '.'}`, 'err'); }
    }
    return out;
  },
  used(id) { return Store.all('posts').filter(p => (p.mediaIds || []).includes(id)); },
  html(ws) {
    const q = (UI.mediaQ || '').toLowerCase();
    const ms = Store.all('media').filter(m => m.ws === ws.id && (!UI.mediaK || m.kind === UI.mediaK) && (!q || (m.name || '').toLowerCase().includes(q))).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const sel = S.media[UI.mediaSel];
    return `<div class="mwrap"><div>
      ${canEdit(ws) ? `<div class="dz" id="dz">Arraste imagens, vídeos ou PDF para aqui, ou <button class="btn sm imp" data-act="mupload">Carregar ficheiros</button><input type="file" id="mfile" multiple accept="image/*,video/*,application/pdf" class="hidden"></div>` : ''}
      <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center"><label class="search" style="width:260px">${I.search}<input id="mq" placeholder="Pesquisar media" value="${esc(UI.mediaQ || '')}" data-in="mq"></label>
        <div class="seg">${[['', 'Tudo'], ['image', 'Imagens'], ['video', 'Vídeos'], ['pdf', 'PDF']].map(([k, n]) => `<button class="${(UI.mediaK || '') === k ? 'on' : ''}" data-act="mkind" data-v="${k}">${n}</button>`).join('')}</div><span class="muted" style="margin-left:auto">${ms.length} ficheiros</span></div>
      <div class="mgrid">${ms.slice(0, UI.mediaN || 120).map(m => `<div class="mcard ${UI.mediaSel === m.id ? 'on' : ''}" data-act="msel" data-id="${m.id}"><div class="im">${mTag(m)}<span class="k">${m.kind === 'video' ? 'VÍDEO' : m.kind === 'pdf' ? 'PDF' + (m.pages ? ' · ' + m.pages + ' p.' : '') : 'IMG'}</span></div><div class="nm">${esc(m.name)}<small>${Media.used(m.id).length} publicações · ${ago(m.createdAt)}</small></div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">A biblioteca está vazia.</div>'}</div>${ms.length > (UI.mediaN || 120) ? `<div style="text-align:center;margin:12px 0"><button class="btn sm" data-act="more" data-k="mediaN" data-n="120">Mostrar mais (${ms.length - (UI.mediaN || 120)})</button></div>` : ''}</div>
      ${sel ? `<div class="mdet">${mTag(sel, '', sel.kind === 'video' ? 'controls' : '')}<input class="inp" data-mren="${sel.id}" value="${esc(sel.name)}" ${canEdit(ws) ? '' : 'readonly'}>
        <div class="muted">${sel.w ? sel.w + '×' + sel.h + ' px · ' : ''}${sel.size ? (sel.size / 1048576).toFixed(1) + ' MB · ' : ''}carregado por ${esc(Store.name(sel.createdBy))}</div>
        ${Media.used(sel.id).length ? `<div><b style="font-size:12.5px">Usado em</b>${Media.used(sel.id).slice(0, 6).map(p => `<div class="item" data-act="open" data-pid="${p.id}" style="padding:4px 0">${stPill(p.status)}<span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(p.text || '(sem texto)')}</span></div>`).join('')}</div>` : ''}
        ${canEdit(ws) ? `<button class="btn pri" data-act="mnew" data-id="${sel.id}">${I.plus} Criar publicação</button><button class="btn bad" data-act="mdel" data-id="${sel.id}">Eliminar</button>` : ''}</div>` : ''}</div>`;
  }
};

/* ================= CAIXA DE ENTRADA ================= */
const IB_T = { comment: 'Comentário', message: 'Mensagem', review: 'Avaliação', mention: 'Menção' };
const Inbox = {
  list(ws) {
    let l = Store.all('inbox').filter(i => i.ws === ws.id);
    if (UI.inboxF === 'open') l = l.filter(i => !i.done); else if (UI.inboxF === 'done') l = l.filter(i => i.done); else if (UI.inboxF === 'mine') l = l.filter(i => i.assignee === Store.me);
    if (UI.inboxPlat) l = l.filter(i => pageOf(ws, i.pageId)?.platform === UI.inboxPlat);
    const pr = { neg: 0, neu: 1, pos: 2 };
    return l.sort((a, b) => UI.inboxSort === 'prio' ? (pr[a.sentiment] - pr[b.sentiment]) || b.at.localeCompare(a.at) : b.at.localeCompare(a.at));
  },
  html(ws) {
    const l = Inbox.list(ws); const it = S.inbox[UI.inboxSel];
    const plats = [...new Set(ws.pages.map(p => p.platform))];
    return `<div class="ibx"><div class="ibl"><div class="f">
      <div class="seg">${[['open', 'Por tratar'], ['mine', 'Minhas'], ['done', 'Tratadas'], ['all', 'Todas']].map(([k, n]) => `<button class="${UI.inboxF === k ? 'on' : ''}" data-act="ibf" data-v="${k}">${n}</button>`).join('')}</div>
      <select class="inp" style="width:auto;height:30px" data-ch="ibplat"><option value="">Todas as redes</option>${plats.map(p => `<option value="${p}" ${UI.inboxPlat === p ? 'selected' : ''}>${PLAT[p].n}</option>`).join('')}</select>
      <select class="inp" style="width:auto;height:30px" data-ch="ibsort"><option value="prio" ${UI.inboxSort === 'prio' ? 'selected' : ''}>Prioridade</option><option value="new" ${UI.inboxSort === 'new' ? 'selected' : ''}>Mais recentes</option></select>
      ${canEdit(ws) ? `<button class="btn sm ghost" data-act="ibadd">+ Registar mensagem</button>` : ''}</div>
      <div class="l">${l.map(i => { const pg = pageOf(ws, i.pageId); return `<div class="ibi ${UI.inboxSel === i.id ? 'on' : ''} ${i.done ? 'done' : ''} ${i.read ? '' : 'unread'}" data-act="ibsel" data-id="${i.id}"><span class="avatar" style="background:${colorFor(i.author)}">${esc(initials(i.author))}</span><div class="b"><div class="n">${pg ? pfBadge(pg.platform, 'sm') : ''}${esc(i.author)}<span class="sent sent-${i.sentiment}">${{ pos: 'Positivo', neu: 'Neutro', neg: 'Negativo' }[i.sentiment]}</span><span class="tm">${ago(i.at)}</span></div><div class="t">${esc(IB_T[i.type] || '')} · ${esc(i.text)}</div></div></div>`; }).join('') || '<div class="empty"><div class="eic">' + I.checkc + '</div>Tudo tratado</div>'}</div></div>
      <div class="ibd">${it ? Inbox.detail(it, ws) : '<div class="empty" style="margin:auto">Escolha uma conversa.</div>'}</div></div>`;
  },
  detail(it, ws) {
    const pg = pageOf(ws, it.pageId); const post = it.postId && S.posts[it.postId];
    const ids = [...new Set([...(ws.members || []).map(m => m.id), Store.me])];
    return `<div class="h"><span class="avatar" style="background:${colorFor(it.author)}">${esc(initials(it.author))}</span><div><b>${esc(it.author)}</b><div class="muted">${pg ? esc(PLAT[pg.platform].n + ' · ' + pg.name) : ''} · ${esc(IB_T[it.type] || '')}</div></div><div style="flex:1"></div>
      <select class="inp" style="width:auto;height:30px" data-ch="ibsent" data-id="${it.id}" ${canEdit(ws) ? '' : 'disabled'}>${[['pos', 'Positivo'], ['neu', 'Neutro'], ['neg', 'Negativo']].map(([k, n]) => `<option value="${k}" ${it.sentiment === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select class="inp" style="width:auto;height:30px" data-ch="ibassign" data-id="${it.id}" ${canEdit(ws) ? '' : 'disabled'}><option value="">Sem responsável</option>${ids.map(id => `<option value="${id}" ${it.assignee === id ? 'selected' : ''}>${esc(Store.name(id))}</option>`).join('')}</select>
      ${canEdit(ws) ? `<button class="btn sm ${it.done ? '' : 'ok'}" data-act="ibdone" data-id="${it.id}">${it.done ? 'Reabrir' : I.check + ' Marcar como tratada'}</button>` : ''}</div>
      <div class="th">${post ? `<div class="card" style="font-size:12.5px;align-self:stretch;cursor:pointer" data-act="open" data-pid="${post.id}"><span class="muted">Na publicação:</span> ${esc((post.text || '').slice(0, 140))}</div>` : ''}
        <div class="msg">${esc(it.text)}<small>${fmtDT(it.at)}</small></div>
        ${(it.replies || []).map(r => `<div class="msg me">${esc(r.text)}<small>${esc(Store.name(r.by))} · ${fmtDT(r.at)}</small></div>`).join('')}</div>
      ${canEdit(ws) ? `<div class="rp"><textarea class="inp" id="ibr" rows="3" placeholder="Escreva a resposta… (registada aqui; o envio para a rede é simulado)"></textarea><div style="display:flex;gap:6px">${Store.sample ? `<button class="btn sm" data-act="ibai" data-id="${it.id}">${I.spark.replace('<svg', '<svg width="13" height="13"')} Sugerir resposta</button>` : ''}<div style="flex:1"></div><button class="btn pri sm" data-act="ibsend" data-id="${it.id}">Responder</button></div></div>` : ''}`;
  }
};

/* ================= ANÁLISE ================= */
const PBASE = { facebook: 1.0, instagram: 1.6, linkedin: 0.8, x: 0.7, tiktok: 2.6, youtube: 1.4, pinterest: 0.9, gbp: 0.5, threads: 0.6, universal: 0.4 };
const Analytics = {
  metrics(p, pg) {
    const r = rnd(p.id + pg.id); const b = PBASE[pg.platform] || 1;
    const imp = Math.round((600 + r() * 4200) * b * (p.mediaIds?.length ? 1.3 : 0.8));
    const eng = Math.round(imp * (0.02 + r() * 0.07));
    return { imp, reach: Math.round(imp * (0.62 + r() * 0.25)), eng, clicks: Math.round(eng * (0.15 + r() * 0.4)), shares: Math.round(eng * r() * 0.12) };
  },
  rows(ws, days) {
    const from = Date.now() - days * 86400000;
    const out = [];
    Store.all('posts').filter(p => p.ws === ws.id && p.status === 'published' && p.date && new Date(p.date).getTime() >= from).forEach(p => p.pageIds.forEach(id => { const pg = pageOf(ws, id); if (pg) out.push({ p, pg, m: Analytics.metrics(p, pg) }); }));
    return out;
  },
  bestTimes(ws) {
    const rows = Analytics.rows(ws, 3650); const by = {};
    rows.forEach(r => { const d = new Date(r.p.date); const k = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); const o = by[k] || (by[k] = { s: 0, n: 0 }); o.s += r.m.eng / r.m.imp; o.n++; });
    const l = Object.entries(by).map(([h, o]) => ({ h, v: o.s / o.n })).sort((a, b) => b.v - a.v).slice(0, 3).map(x => ({ h: x.h, label: `${x.h} — envolvimento médio ${(x.v * 100).toFixed(1)}%` }));
    const def = [{ h: '09:00', label: '09:00 — manhã' }, { h: '12:30', label: '12:30 — almoço' }, { h: '18:30', label: '18:30 — fim do dia' }];
    return l.length ? l.concat(def.filter(d => !l.some(x => x.h === d.h))).slice(0, 4) : def;
  },
  html(ws) {
    const d = UI.range; const rows = Analytics.rows(ws, d); const prev = Analytics.rows(ws, d * 2).filter(r => new Date(r.p.date).getTime() < Date.now() - d * 86400000);
    const sum = (rs, k) => rs.reduce((a, r) => a + r.m[k], 0);
    const imp = sum(rows, 'imp'), eng = sum(rows, 'eng'), clicks = sum(rows, 'clicks'), reach = sum(rows, 'reach');
    const pImp = sum(prev, 'imp');
    const delta = pImp ? ((imp - pImp) / pImp * 100) : null;
    const posts = new Set(rows.map(r => r.p.id)).size;
    const top = Object.values(rows.reduce((a, r) => { const o = a[r.p.id] || (a[r.p.id] = { p: r.p, imp: 0, eng: 0, pages: [] }); o.imp += r.m.imp; o.eng += r.m.eng; o.pages.push(r.pg); return a; }, {})).sort((a, b) => b.eng - a.eng).slice(0, 8);
    return `<div class="an"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div class="seg">${[7, 30, 90].map(n => `<button class="${d === n ? 'on' : ''}" data-act="range" data-v="${n}">${n} dias</button>`).join('')}</div>
      <span class="demo">ⓘ Números de demonstração: sem ligação às redes, são estimados a partir das publicações marcadas como publicadas.</span><div style="flex:1"></div><button class="btn sm" data-act="report">Copiar relatório</button></div>
      <div class="kpis">
        <div class="kpi"><div class="l">Publicações</div><div class="v">${posts}</div><div class="d">últimos ${d} dias</div></div>
        <div class="kpi"><div class="l">Impressões</div><div class="v">${nf(imp)}</div><div class="d">${delta === null ? 'sem período anterior' : (delta >= 0 ? '▲ ' : '▼ ') + Math.abs(delta).toFixed(0) + '% vs período anterior'}</div></div>
        <div class="kpi"><div class="l">Alcance</div><div class="v">${nf(reach)}</div><div class="d">contas únicas estimadas</div></div>
        <div class="kpi"><div class="l">Interações</div><div class="v">${nf(eng)}</div><div class="d">gostos, comentários, partilhas</div></div>
        <div class="kpi"><div class="l">Taxa de envolvimento</div><div class="v">${imp ? (eng / imp * 100).toFixed(1) : '0'}%</div><div class="d">interações ÷ impressões</div></div>
        <div class="kpi"><div class="l">Cliques</div><div class="v">${nf(clicks)}</div><div class="d">em ligações</div></div>
      </div>
      <div class="card"><h4>Impressões por dia</h4><div class="chart" id="ch-line" style="height:220px"></div></div>
      <div class="an2"><div class="card"><h4>Interações por rede</h4><div class="chart" id="ch-bar"></div></div>
        <div class="card"><h4>Melhores horas para publicar <span class="muted" style="font-weight:400">· taxa de envolvimento média</span></h4><div id="ch-hm"></div></div></div>
      <div class="card"><h4>Publicações com melhor desempenho</h4>${top.length ? `<table class="tb" style="border:0"><thead><tr><th>Publicação</th><th>Redes</th><th>Data</th><th style="text-align:right">Impressões</th><th style="text-align:right">Interações</th><th style="text-align:right">Envolvimento</th></tr></thead><tbody>${top.map(t => `<tr class="r" data-act="open" data-pid="${t.p.id}"><td><div class="tx" style="max-width:420px">${esc(t.p.text)}</div></td><td>${t.pages.map(g => pfBadge(g.platform, 'sm')).join(' ')}</td><td>${fmtDate(t.p.date)}</td><td style="text-align:right">${nf(t.imp)}</td><td style="text-align:right">${nf(t.eng)}</td><td style="text-align:right">${(t.eng / t.imp * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table>` : '<div class="muted">Ainda não há publicações publicadas neste período.</div>'}</div></div>`;
  },
  mount(ws) {
    const d = UI.range; const rows = Analytics.rows(ws, d);
    // linha
    const days = []; for (let i = d - 1; i >= 0; i--) { const x = new Date(); x.setDate(x.getDate() - i); days.push({ k: dayKey(x), d: x, v: 0 }); }
    const ix = Object.fromEntries(days.map((x, i) => [x.k, i]));
    rows.forEach(r => { const i = ix[dayKey(r.p.date)]; if (i !== undefined) days[i].v += r.m.imp; });
    lineChart($('#ch-line'), days.map(x => ({ x: fmtDate(x.d), v: x.v })));
    // barras
    const byP = {}; rows.forEach(r => byP[r.pg.platform] = (byP[r.pg.platform] || 0) + r.m.eng);
    barChart($('#ch-bar'), Object.entries(byP).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, label: PLAT[k].n, v })));
    heatmap($('#ch-hm'), Analytics.rows(ws, 3650));
  }
};
function lineChart(el, data) {
  if (!el) return; const W = el.clientWidth || 800, H = 220, P = { l: 44, r: 12, t: 12, b: 26 };
  const max = Math.max(1, ...data.map(d => d.v)); const nice = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / nice) * nice;
  const X = i => P.l + (data.length < 2 ? 0 : i * (W - P.l - P.r) / (data.length - 1)), Y = v => P.t + (1 - v / top) * (H - P.t - P.b);
  const grid = [0, .25, .5, .75, 1].map(f => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(top * f)}" y2="${Y(top * f)}" stroke="#eef0f3"/><text x="${P.l - 6}" y="${Y(top * f) + 4}" text-anchor="end" font-size="11" fill="#8a909c">${nf(top * f)}</text>`).join('');
  const step = Math.ceil(data.length / 8);
  const xl = data.map((d, i) => i % step === 0 ? `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#8a909c">${esc(d.x)}</text>` : '').join('');
  const path = data.map((d, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(d.v).toFixed(1)).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Impressões por dia">${grid}${xl}<path d="${path} L${X(data.length - 1)},${Y(0)} L${X(0)},${Y(0)}Z" fill="#2a78d6" opacity=".08"/><path d="${path}" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round"/><line id="lx" y1="${P.t}" y2="${H - P.b}" stroke="#8a909c" stroke-dasharray="3 3" opacity="0"/><circle id="lc" r="5" fill="#2a78d6" stroke="#fff" stroke-width="2" opacity="0"/><rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" id="lh"/></svg><div class="tip hidden"></div>`;
  const svg = $('svg', el), tip = $('.tip', el), lx = $('#lx', el), lc = $('#lc', el);
  $('#lh', el).addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect(); const sx = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((sx - P.l) / ((W - P.l - P.r) / Math.max(1, data.length - 1)))));
    lx.setAttribute('x1', X(i)); lx.setAttribute('x2', X(i)); lx.setAttribute('opacity', 1); lc.setAttribute('cx', X(i)); lc.setAttribute('cy', Y(data[i].v)); lc.setAttribute('opacity', 1);
    tip.classList.remove('hidden'); tip.innerHTML = `<b>${esc(data[i].x)}</b><br>${nf(data[i].v)} impressões`; tip.style.left = (X(i) * r.width / W) + 'px'; tip.style.top = (Y(data[i].v) * r.height / H) + 'px';
  });
  $('#lh', el).addEventListener('mouseleave', () => { tip.classList.add('hidden'); lx.setAttribute('opacity', 0); lc.setAttribute('opacity', 0); });
}
function barChart(el, data) {
  if (!el) return; if (!data.length) { el.innerHTML = '<div class="muted">Sem dados.</div>'; return; }
  const max = Math.max(...data.map(d => d.v));
  el.innerHTML = data.map(d => `<div style="display:flex;align-items:center;gap:8px;margin:6px 0" title="${esc(d.label)}: ${nf(d.v)} interações">${pfBadge(d.k, 'sm')}<span style="width:110px;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.label)}</span><div style="flex:1;height:14px;background:#f1f2f4;border-radius:4px"><div style="width:${(d.v / max * 100).toFixed(1)}%;height:100%;background:#2a78d6;border-radius:0 4px 4px 0"></div></div><span style="width:56px;text-align:right;font-size:12.5px;font-variant-numeric:tabular-nums">${nf(d.v)}</span></div>`).join('');
}
function heatmap(el, rows) {
  if (!el) return;
  const hrs = [8, 10, 12, 14, 16, 18, 20, 22], dn = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const g = {}; rows.forEach(r => { const d = new Date(r.p.date); const wd = (d.getDay() + 6) % 7; const hb = hrs.reduce((b, h) => d.getHours() >= h ? h : b, 8); const k = wd + ':' + hb; const o = g[k] || (g[k] = { s: 0, n: 0 }); o.s += r.m.eng / r.m.imp; o.n++; });
  const vals = Object.values(g).map(o => o.s / o.n); const mx = Math.max(0.0001, ...vals);
  const ramp = ['#f1f2f4', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
  let h = `<div class="hm"><span></span>${hrs.map(x => `<span style="text-align:center">${x}h</span>`).join('')}`;
  dn.forEach((d, wd) => { h += `<span>${d}</span>` + hrs.map(hb => { const o = g[wd + ':' + hb]; const v = o ? o.s / o.n : 0; const c = o ? ramp[1 + Math.min(5, Math.floor(v / mx * 5.99))] : ramp[0]; return `<span class="c" style="background:${c}" title="${d} ${hb}h: ${o ? (v * 100).toFixed(1) + '% (' + o.n + ' publ.)' : 'sem dados'}"></span>`; }).join(''); });
  el.innerHTML = h + '</div><div class="muted" style="margin-top:8px">Mais escuro = maior envolvimento. Passe o rato para ver os valores.</div>';
}

/* ================= DEFINIÇÕES ================= */
const TZS = ['Atlantic/Azores', 'Europe/Lisbon', 'Atlantic/Madeira', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'America/Sao_Paulo', 'America/New_York', 'UTC'];
const Settings = {
  tabs: [['geral', 'Geral'], ['paginas', 'Páginas'], ['membros', 'Membros e funções'], ['aprovacoes', 'Fluxo de aprovação'], ['etiquetas', 'Etiquetas'], ['modelos', 'Modelos'], ['dados', 'Dados']],
  html(ws) {
    const t = UI.setTab;
    return `<div class="set"><nav>${Settings.tabs.map(([k, n]) => `<div class="item ${t === k ? 'on' : ''}" data-act="settab" data-v="${k}">${n}</div>`).join('')}</nav><div class="pane">${Settings[t] ? Settings[t](ws) : ''}</div></div>`;
  },
  geral(ws) {
    const a = canAdmin(ws);
    return `<h3>Geral</h3><div class="fld"><label>Nome do espaço de trabalho</label><input class="inp" data-wsf="name" value="${esc(ws.name)}" ${a ? '' : 'readonly'}></div>
      <div class="fld"><label>Cor</label><div style="display:flex;gap:6px">${COLORS.map(c => `<button data-act="wscolor" data-v="${c}" ${a ? '' : 'disabled'} style="width:28px;height:28px;border-radius:8px;border:2px solid ${ws.color === c ? '#111' : 'transparent'};background:${c}"></button>`).join('')}</div></div>
      <div class="fld"><label>Fuso horário</label><select class="inp" data-wsf="tz" ${a ? '' : 'disabled'}>${TZS.map(z => `<option ${ws.tz === z ? 'selected' : ''}>${z}</option>`).join('')}</select></div>
      <span class="tgl ${ws.autoCrop !== false ? 'on' : ''}" ${a ? 'data-act="autocrop"' : ''}><i></i>Recortar as imagens nas pré-visualizações ao formato de cada rede (desligado: mostra a imagem inteira)</span>
      <div class="muted">A sua função neste espaço: <b>${{ admin: 'Administrador', editor: 'Editor', aprovador: 'Aprovador / cliente' }[role(ws)]}</b></div>
      ${a && canNewWS() ? `<hr style="border:0;border-top:1px solid var(--line)"><div><button class="btn bad" data-act="delws">Eliminar espaço de trabalho</button></div>` : ''}`;
  },
  paginas(ws) {
    const sb = Store.mode === 'sb', a = canAdmin(ws);
    if (sb && a && !Meta.lista[ws.id] && !Meta.aCarregar[ws.id]) Meta.carregar(ws).then(render);
    const contas = Meta.lista[ws.id] || [];
    const sel = pg => { if (!sb || !['facebook', 'instagram'].includes(pg.platform)) return ''; const ops = contas.filter(c => pg.platform === 'facebook' || c.ig);
      if (!a) return `<span class="muted" style="width:170px">${pg.meta ? '✓ publica sozinha' : 'publicar à mão'}</span>`;
      return `<select class="inp" data-pgmeta="${pg.id}" style="width:210px;height:30px" title="Conta da Meta onde esta página publica"><option value="">Publicar à mão (sem ligação)</option>${ops.map(c => `<option value="${esc(c.fb)}" ${pg.meta && pg.meta.fb === c.fb ? 'selected' : ''}>${esc(pg.platform === 'instagram' ? '@' + c.igNome : c.fbNome)}</option>`).join('')}</select>`; };
    return `<h3>Páginas</h3><p class="muted" style="margin:0">${sb ? 'As páginas do Facebook e do Instagram ligadas à Meta publicam sozinhas à hora marcada, mesmo com os computadores desligados. As outras redes ficam «por publicar à mão»: o Social360 lembra e regista.' : 'Cada página corresponde a uma conta numa rede. Sem a base de dados da EPISJ 360, o envio é simulado.'}</p>
      ${sb && a ? `<div class="metabox"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b style="flex:1">Facebook e Instagram</b><button class="btn pri" data-act="metaligar">${contas.length ? 'Ligar mais páginas / voltar a ligar' : 'Ligar ao Facebook e Instagram'}</button>${contas.length ? '<button class="btn" data-act="metaauto">Usar estas contas nas páginas</button>' : ''}</div>
        ${contas.length ? contas.map(c => `<div class="rowl">${pfBadge('facebook')}<div class="g"><b>${esc(c.fbNome)}</b>${c.ig ? ` · ${pfBadge('instagram', 'sm')} @${esc(c.igNome)}` : ' · <span class="muted">sem Instagram profissional associado</span>'}<div class="muted">${c.estado === 'ok' ? 'Ligada' : ii('alert') + ' ' + esc(c.erro || 'A autorização expirou: volte a ligar.')} · por ${esc(Store.name(c.por))} · ${ago(c.em)}</div></div><button class="btn sm bad" data-act="metadesligar" data-id="${esc(c.fb)}">Desligar</button></div>`).join('') : `<p class="muted" style="margin:6px 0 0">Entre com uma conta que administre a página do Facebook da escola. O Instagram tem de ser uma conta profissional associada a essa página.</p>`}</div>` : ''}
      <div>${ws.pages.map(pg => `<div class="rowl">${pfBadge(pg.platform, 'lg')}<div class="g"><input class="inp" data-pgf="name" data-id="${pg.id}" value="${esc(pg.name)}" ${a ? '' : 'readonly'} style="height:30px"></div><input class="inp" data-pgf="handle" data-id="${pg.id}" value="${esc(pg.handle || '')}" placeholder="@utilizador" style="width:150px;height:30px" ${a ? '' : 'readonly'}>${sel(pg) || `<span class="muted" style="width:210px">${esc(PLAT[pg.platform].n)}${sb ? ' · publicar à mão' : ''}</span>`}${a ? `<button class="btn sm bad" data-act="rmpage" data-id="${pg.id}">Remover</button>` : ''}</div>`).join('') || '<div class="muted">Sem páginas.</div>'}</div>
      ${canAdmin(ws) ? `<div><button class="btn pri" data-act="addpage">${I.plus} Adicionar página</button></div>` : ''}`;
  },
  membros(ws) {
    const a = canAdmin(ws);
    const ms = ws.members || [];
    return `<h3>Membros e funções</h3>
      ${Store.mode === 'sb' ? '<p class="muted" style="margin:0">A Direção (Direção Pedagógica, Direção Executiva e administradores da EPISJ 360) tem sempre acesso total a todos os espaços.</p>' : ''}
      <p class="muted" style="margin:0"><b>Administrador</b>: tudo, incluindo definições. <b>Editor</b>: cria, edita, agenda e aprova. <b>Aprovador / cliente</b>: só vê, comenta e aprova — não vê notas internas.</p>
      <div>${ms.map(m => `<div class="rowl">${avatar(m.id)}<div class="g"><b>${esc(Store.name(m.id))}</b>${m.id === Store.me ? ' <span class="muted">(a sua conta)</span>' : ''}</div>
        <select class="inp" style="width:190px;height:32px" data-mrole="${m.id}" ${a && m.id !== Store.me ? '' : 'disabled'}>${[['admin', 'Administrador'], ['editor', 'Editor'], ['aprovador', 'Aprovador / cliente']].map(([k, n]) => `<option value="${k}" ${m.role === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        ${Store.mode === 'local' && m.id !== Store.me ? `<button class="btn sm" data-act="actas" data-id="${m.id}">Agir como</button>` : ''}
        ${a && m.id !== Store.me ? `<button class="btn sm bad" data-act="rmmember" data-id="${m.id}">Remover</button>` : ''}</div>`).join('')}</div>
      ${Store.mode === 'local' && Store.me !== 'local' ? `<div class="banner" style="border-radius:8px">Está a agir como ${esc(Store.name(Store.me))}. <button class="btn sm" data-act="actas" data-id="local">Voltar a mim</button></div>` : ''}
      ${a && Store.mode === 'sb' ? `<div class="fld"><label>Adicionar pessoa</label><div style="display:flex;gap:8px"><input class="inp" id="msearch" placeholder="Nome ou email do Office 365 da escola…" data-in="msearch" autocomplete="off"><select class="inp" id="mrole" style="width:200px"><option value="editor">Editor</option><option value="aprovador">Aprovador / cliente</option><option value="admin">Administrador</option></select></div><div id="mresults"></div><div class="muted">A pessoa entra na EPISJ 360 com o Office 365 da escola e passa a ver o Social360 com esta função. A Direção vê sempre tudo.</div></div>` : ''}
      ${a && Store.mode !== 'sb' ? (Store.mode === 'db' ? `<div class="fld"><label>Adicionar pessoa</label><input class="inp" id="msearch" placeholder="Procurar por nome na organização…" data-in="msearch"><div id="mresults"></div><div class="muted">A pessoa também precisa de acesso a esta app: partilha-a no Claude com nível “Contribuidor” (ou “Leitor” para quem só vê).</div></div>`
        : `<div class="fld"><label>Adicionar membro (modo local, para testar fluxos)</label><div style="display:flex;gap:8px"><input class="inp" id="mname" placeholder="Nome"><select class="inp" id="mrole" style="width:200px"><option value="editor">Editor</option><option value="aprovador">Aprovador / cliente</option><option value="admin">Administrador</option></select><button class="btn pri" data-act="addlocalmember">Adicionar</button></div><div class="muted">Em modo local só há um utilizador real; use “Agir como” para testar aprovações em vários níveis.</div></div>`) : ''}`;
  },
  aprovacoes(ws) {
    const a = canAdmin(ws); const ap = ws.approval || { mode: 'none', steps: [] }; const ids = (ws.members || []).map(m => m.id);
    const opt = (k, t, d) => `<label class="radio ${ap.mode === k ? 'on' : ''}"><input type="radio" name="apm" value="${k}" ${ap.mode === k ? 'checked' : ''} ${a ? '' : 'disabled'} data-apm><div><div class="t">${t}</div><div class="muted">${d}</div></div></label>`;
    return `<h3>Fluxo de aprovação</h3>
      ${opt('none', 'Sem aprovação', 'As publicações podem ser agendadas diretamente.')}
      ${opt('optional', 'Aprovação opcional', 'Pode pedir aprovação, mas não é obrigatória para agendar.')}
      ${opt('required', 'Aprovação obrigatória', 'Nada é agendado sem uma aprovação.')}
      ${opt('multi', 'Aprovação em vários níveis', 'Passos por ordem (ex.: revisão interna → cliente). Cada passo pode ter um aprovador definido.')}
      ${ap.mode === 'multi' ? `<div class="fld"><label>Passos</label>${(ap.steps || []).map((s, i) => `<div class="step"><span class="n">${i + 1}</span><input class="inp" data-stn="${i}" value="${esc(s.name)}" style="height:32px;flex:1" ${a ? '' : 'readonly'}><select class="inp" data-sta="${i}" style="width:200px;height:32px" ${a ? '' : 'disabled'}><option value="">Qualquer membro</option>${ids.map(id => `<option value="${id}" ${s.approver === id ? 'selected' : ''}>${esc(Store.name(id))}</option>`).join('')}</select>${a ? `<button class="icbtn" data-act="stup" data-i="${i}" title="Subir">↑</button><button class="icbtn" data-act="strm" data-i="${i}" title="Remover">${I.x}</button>` : ''}</div>`).join('')}${a ? `<div><button class="btn sm" data-act="stadd">+ Adicionar passo</button></div>` : ''}</div>`
        : ap.mode !== 'none' ? `<div class="fld"><label>Aprovador</label><select class="inp" data-sta="0" ${a ? '' : 'disabled'}><option value="">Qualquer membro</option>${ids.map(id => `<option value="${id}" ${(ap.steps?.[0]?.approver) === id ? 'selected' : ''}>${esc(Store.name(id))}</option>`).join('')}</select></div>` : ''}
      ${['required', 'multi'].includes(ap.mode) ? `<span class="tgl ${ap.resetOnEdit !== false ? 'on' : ''}" ${a ? 'data-act="apreset"' : ''}><i></i>Recomeçar a aprovação quando o conteúdo é alterado</span>` : ''}`;
  },
  etiquetas(ws) {
    return `<h3>Etiquetas</h3><p class="muted" style="margin:0">Organiza por campanha, pilar de conteúdo ou cliente, e filtra em qualquer vista.</p>
      <div>${(ws.labels || []).map(l => `<div class="rowl"><span class="dot" style="background:${l.color};width:14px;height:14px"></span><div class="g">${esc(l.name)} <span class="muted">· ${wsPosts(ws).filter(p => (p.labels || []).includes(l.id)).length} publicações</span></div>${canEdit(ws) ? `<button class="btn sm" data-act="editlabel" data-id="${l.id}">Editar</button><button class="btn sm bad" data-act="rmlabel" data-id="${l.id}">Eliminar</button>` : ''}</div>`).join('') || '<div class="muted">Sem etiquetas.</div>'}</div>
      ${canEdit(ws) ? `<div style="display:flex;gap:8px"><button class="btn pri" data-act="addlabel">${I.plus} Nova etiqueta</button>${wsList().length > 1 ? '<button class="btn" data-act="copylabels">Copiar etiquetas de outro espaço</button>' : ''}</div>` : ''}`;
  },
  modelos(ws) {
    const ts = Store.all('templates').filter(t => t.ws === ws.id);
    return `<h3>Modelos de publicação</h3><p class="muted" style="margin:0">Guarde estruturas que repete. Crie um modelo a partir de qualquer publicação (menu “Guardar como modelo” no editor).</p>
      <div>${ts.map(t => `<div class="rowl"><div class="g"><b>${esc(t.name)}</b><div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.text)}</div></div>${canEdit(ws) ? `<button class="btn sm pri" data-act="usetpl" data-id="${t.id}">Usar</button><button class="btn sm bad" data-act="rmtpl" data-id="${t.id}">Eliminar</button>` : ''}</div>`).join('') || '<div class="muted">Sem modelos.</div>'}</div>`;
  },
  dados(ws) {
    return `<h3>Dados</h3><div class="muted">Social360 ${S360_VER} · armazenamento: <b>${Store.mode === 'sb' ? 'base de dados da EPISJ 360 (Supabase), partilhada com a equipa e com tempo real' : Store.mode === 'db' ? 'partilhado (todas as pessoas com acesso veem os mesmos dados)' : 'local (só neste navegador)'}</b></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="export">Copiar exportação deste espaço (JSON)</button>${canNewWS() ? `<button class="btn imp" data-act="import">Importar JSON</button>` : ''}${Store.mode !== 'sb' && canEdit(ws) && !Store.all('workspaces').some(w => w.name === 'Café Aurora') ? `<button class="btn" data-act="example">Carregar dados de exemplo</button>` : ''}${Store.mode === 'local' ? `<button class="btn bad" data-act="wipe">Apagar todos os dados locais</button>` : ''}</div>`;
  }
};

/* ================= LIGAÇÃO À META ================= */
const Meta = {
  lista: {}, aCarregar: {},
  async carregar(ws) {
    if (Store.mode !== 'sb') return [];
    this.aCarregar[ws.id] = true;
    try { const { data, error } = await Store.sb.rpc('s360_meta_listar', { p_ws: ws.id }); if (!error) this.lista[ws.id] = data || []; } catch (e) {}
    this.aCarregar[ws.id] = false; return this.lista[ws.id] || [];
  },
  esperar(ws) {
    const n0 = (this.lista[ws.id] || []).length; let fim = Date.now() + 5 * 60000;
    const ver = async () => { const l = await this.carregar(ws); render(); if (Date.now() < fim && l.length === n0 && !this._ok) setTimeout(ver, 4000); };
    this._ok = false; setTimeout(ver, 4000);
  }
};
window.addEventListener('message', async e => {
  if (e.origin !== location.origin || !e.data || !e.data.s360meta) return;
  const ws = curWS(); if (!ws) return;
  Meta._ok = true; await Meta.carregar(ws);
  if (e.data.s360meta === 'ok') { A.metaauto(); render(); toast('Ligação à Meta feita.'); }
});
function metaSemApp() {
  dialog({ title: 'Ligação à Meta ainda por ativar', ok: null, cancel: 'Fechar',
    body: `<p style="margin:0">Para o Social360 publicar no Facebook e no Instagram, a escola precisa de uma <b>aplicação da Meta</b> (gratuita). É um passo único, feito por quem administra a página do Facebook da escola.</p><p style="margin:0">Depois de criada, o administrador da EPISJ 360 guarda o identificador e a chave da aplicação no servidor, e este botão passa a funcionar para toda a gente.</p><p class="muted" style="margin:0">Até lá, as publicações agendadas ficam marcadas como publicadas à hora certa e lembram de publicar à mão.</p>` });
}

/* ================= DIÁLOGOS ================= */
function labelDialog(ws, l, cb) {
  let col = l?.color || LABEL_COLORS[(ws.labels || []).length % LABEL_COLORS.length];
  dialog({
    title: l ? 'Editar etiqueta' : 'Nova etiqueta', ok: l ? 'Guardar' : 'Criar',
    body: `<div class="fld"><label>Nome</label><input class="inp" id="ln" value="${esc(l?.name || '')}" placeholder="Ex.: Campanha de verão"></div><div class="fld"><label>Cor</label><div style="display:flex;gap:6px;flex-wrap:wrap" id="lcs">${LABEL_COLORS.map(c => `<button type="button" data-c="${c}" style="width:26px;height:26px;border-radius:50%;border:2px solid ${c === col ? '#111' : 'transparent'};background:${c}"></button>`).join('')}</div></div>`,
    onOpen: ov => $('#lcs', ov).onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; col = b.dataset.c; $$('#lcs button', ov).forEach(x => x.style.borderColor = x.dataset.c === col ? '#111' : 'transparent'); },
    onOk: ov => {
      const n = $('#ln', ov).value.trim(); if (!n) { toast('Dê um nome à etiqueta.', 'err'); return false; }
      const w = clone(S.workspaces[ws.id]); w.labels = w.labels || [];
      let out;
      if (l) { out = w.labels.find(x => x.id === l.id); out.name = n; out.color = col; } else { out = { id: uid('l'), name: n, color: col }; w.labels.push(out); }
      Store.put('workspaces', w); cb && cb(out);
    }
  });
}
function addPageDialog(ws) {
  let plat = 'instagram';
  dialog({
    title: 'Adicionar página', ok: 'Adicionar', wide: true,
    body: `<div class="plat-grid" id="pg-g">${Object.entries(PLAT).map(([k, p]) => `<button type="button" class="plat-opt ${k === plat ? 'on' : ''}" data-p="${k}">${pfBadge(k, 'lg')}<span>${esc(p.n)}</span></button>`).join('')}</div>
      <div style="display:flex;gap:10px"><div class="fld" style="flex:1"><label>Nome da página</label><input class="inp" id="pgn" value="${esc(ws.name)}"></div><div class="fld" style="flex:1"><label>Utilizador / identificador</label><input class="inp" id="pgh" placeholder="ex.: minhamarca"></div></div>
      <div class="muted">Ligação simulada: não pedimos palavras-passe nem acesso às suas contas. A página serve para planear, pré-visualizar, aprovar e agendar.</div>`,
    onOpen: ov => $('#pg-g', ov).onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; plat = b.dataset.p; $$('.plat-opt', ov).forEach(x => x.classList.toggle('on', x.dataset.p === plat)); },
    onOk: ov => {
      const w = clone(S.workspaces[ws.id]);
      w.pages.push({ id: ws.id + '-' + uid(''), platform: plat, name: $('#pgn', ov).value.trim() || PLAT[plat].n, handle: $('#pgh', ov).value.trim().replace(/^@/, '') });
      Store.put('workspaces', w); toast('Página adicionada.');
    }
  });
}
function newWSDialog() {
  let col = COLORS[wsList().length % COLORS.length];
  dialog({
    title: 'Novo espaço de trabalho', ok: 'Criar',
    body: `<p class="muted" style="margin:0">Um espaço por marca ou cliente, com as suas páginas, pessoas e regras de aprovação.</p><div class="fld"><label>Nome</label><input class="inp" id="wn" placeholder="Ex.: Escola Profissional"></div><div class="fld"><label>Cor</label><div style="display:flex;gap:6px" id="wcs">${COLORS.map(c => `<button type="button" data-c="${c}" style="width:28px;height:28px;border-radius:8px;border:2px solid ${c === col ? '#111' : 'transparent'};background:${c}"></button>`).join('')}</div></div>`,
    onOpen: ov => $('#wcs', ov).onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; col = b.dataset.c; $$('#wcs button', ov).forEach(x => x.style.borderColor = x.dataset.c === col ? '#111' : 'transparent'); },
    onOk: ov => {
      const n = $('#wn', ov).value.trim(); if (!n) { toast('Dê um nome ao espaço.', 'err'); return false; }
      const w = { id: uid('w'), name: n, color: col, createdAt: nowISO(), createdBy: Store.me, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Atlantic/Azores', pages: [], labels: [], approval: { mode: 'none', steps: [{ id: uid('s'), name: 'Aprovação', approver: null }] }, members: [{ id: Store.me, role: 'admin' }] };
      Store.put('workspaces', w); UI.ws = w.id; UI.view = 'feed'; UI.f = { pages: [], labels: [], status: [], q: '' }; saveUI(); render();
      setTimeout(() => addPageDialog(w), 60);
    }
  });
}
function shareDialog(p) {
  if (Store.mode === 'sb' || EMBED) {
    dialog({
      title: p ? 'Partilhar publicação para feedback' : 'Partilhar com a equipa', ok: null, cancel: 'Fechar',
      body: `<ol style="margin:0;padding-left:20px;line-height:1.7"><li>Em <b>Definições → Membros</b>, junte a pessoa ao espaço com a função certa (por exemplo <i>Aprovador / cliente</i>, que comenta e aprova mas não vê notas internas).</li><li>A pessoa entra na <b>EPISJ 360</b> com o Office 365 da escola e abre o módulo <b>Social360</b>.</li>${p ? '<li>Recebe uma notificação quando pedir aprovação ou a mencionar num comentário (@nome).</li>' : ''}</ol>
        ${p ? `<div style="display:flex;gap:8px"><input class="inp" readonly value="${esc((p.text || '').split('\n')[0].slice(0, 80))}"><button class="btn pri" id="cpy">Copiar texto</button></div>` : ''}
        ${Store.mode !== 'sb' ? '<div class="banner" style="border-radius:8px">Sem ligação à base de dados, o que fizer fica só neste navegador e mais ninguém o vê.</div>' : ''}`,
      onOpen: ov => { const b = $('#cpy', ov); if (b) b.onclick = () => copyText(p.text || ''); }
    });
    return;
  }
  const anchor = p ? '#post-' + p.id : '#' + UI.view;
  dialog({
    title: p ? 'Partilhar publicação para feedback' : 'Partilhar com a equipa ou clientes', ok: null, cancel: 'Fechar',
    body: `<p style="margin:0">Para outra pessoa ver, comentar e aprovar:</p>
      <ol style="margin:0;padding-left:20px;line-height:1.7"><li>Na página desta app no Claude, abre <b>Partilhar</b> e dá acesso à pessoa (nível <b>Contribuidor</b> para comentar e aprovar).</li><li>Nas <b>Definições → Membros</b>, adiciona-a ao espaço com a função certa (ex.: <i>Aprovador / cliente</i>, que não vê notas internas).</li><li>Envia-lhe a ligação da app com este final, para abrir diretamente ${p ? 'esta publicação' : 'esta vista'}:</li></ol>
      <div style="display:flex;gap:8px"><input class="inp" readonly value="${esc(anchor)}"><button class="btn pri" id="cpy">Copiar</button></div>
      ${Store.mode === 'local' ? '<div class="banner" style="border-radius:8px">Está em modo local: os dados só existem neste navegador, por isso outras pessoas não os veem.</div>' : ''}`,
    onOpen: ov => $('#cpy', ov).onclick = () => copyText(anchor)
  });
}
function multiPop(el, items, getSel, toggle) {
  const draw = () => items.map(it => `<button class="pi" data-v="${it.v}"><span class="chk ${getSel().includes(it.v) ? 'on' : ''}" style="width:16px;height:16px;border-radius:4px;border:1.5px solid #c5c9d2;display:inline-grid;place-items:center;${getSel().includes(it.v) ? 'background:var(--acc);border-color:var(--acc)' : ''}">${getSel().includes(it.v) ? '<span style="color:#fff;font-size:10px">✓</span>' : ''}</span>${it.h}</button>`).join('') || '<div class="muted" style="padding:8px">Nada para filtrar.</div>';
  const p = openPop(el, draw(), v => { toggle(v); p.innerHTML = draw(); return true; });
}

/* ================= EVENTOS ================= */
function go(v, fromParent) {
  if (!fromParent) Bridge.send({ t: 'view', v });
  UI.jump = true; UI.view = v; UI.notif = false; UI.sideOpen = false; selected.clear(); saveUI();
  try { history.replaceState(null, '', '#' + v); } catch (e) {}
  render();
}
function postById(el) { return S.posts[el.dataset.pid]; }
function toggleArr(a, v) { const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); }
const A = {
  ws(el) { UI.feedA = UI.feedB = UI.listN = UI.kN = UI.gridN = 0; UI.ws = el.dataset.id; UI.f = { pages: [], labels: [], status: [], q: '' }; selected.clear(); if (!VIEWS[UI.view] && !OTHER[UI.view]) UI.view = 'feed'; saveUI(); render(); },
  newws: () => { if (!canNewWS()) { toast('Só a Direção cria espaços de trabalho.', 'err'); return; } newWSDialog(); },
  wsepisj() {
    if (!canNewWS()) return;
    const id = uid('w');
    const w = { id, name: 'EPISJ', color: '#1a5fd0', createdAt: nowISO(), createdBy: Store.me, tz: 'Atlantic/Azores',
      pages: [['facebook', 'Escola Profissional da Ilha de São Jorge', 'episj'], ['instagram', 'EPISJ', 'episj'], ['linkedin', 'Escola Profissional da Ilha de São Jorge', 'episj'], ['youtube', 'EPISJ', 'episj']].map(([p, n, h]) => ({ id: id + '-' + p, platform: p, name: n, handle: h })),
      labels: [{ id: uid('l'), name: 'Cursos e candidaturas', color: '#2563eb' }, { id: uid('l'), name: 'Atividades e visitas', color: '#d97706' }, { id: uid('l'), name: 'FCT e estágios', color: '#db2777' }, { id: uid('l'), name: 'Avisos', color: '#64748b' }],
      approval: { mode: 'required', steps: [{ id: uid('s'), name: 'Aprovação da Direção', approver: null }], resetOnEdit: true },
      members: [{ id: Store.me, role: 'admin' }] };
    Store.put('workspaces', w); UI.ws = id; UI.view = 'feed'; saveUI(); render(); toast('Espaço da EPISJ criado.');
  },
  viewsmenu(el) {
    const ws = curWS(); const vs = Store.all('views').filter(v => v.ws === ws.id);
    const any = UI.f.pages.length || UI.f.labels.length || UI.f.status.length || UI.f.q;
    openPop(el, `${vs.map(v => `<button class="pi" data-v="o:${v.id}">${ii('star')} ${esc(v.name)} <span class="muted" style="margin-left:auto">${esc(VIEWS[v.view] || '')}</span></button>`).join('') || '<div class="muted" style="padding:8px">Ainda sem vistas guardadas.</div>'}${any ? '<hr><button class="pi" data-v="save">＋ Guardar a vista atual</button>' : ''}${vs.length ? '<hr><div class="ph">Apagar</div>' + vs.map(v => `<button class="pi bad" data-v="d:${v.id}">✕ ${esc(v.name)}</button>`).join('') : ''}`, v => {
      if (v === 'save') A.saveview();
      else if (v.startsWith('o:')) { const x = S.views[v.slice(2)]; if (x) { UI.f = clone(x.f); go(x.view); } }
      else if (v.startsWith('d:')) Store.del('views', v.slice(2));
    });
  },
  example: async () => { const id = await loadExample(); UI.ws = id; UI.view = 'feed'; saveUI(); render(); toast('Dados de exemplo carregados.'); },
  go: el => go(el.dataset.v),
  side: () => { UI.sideOpen = !UI.sideOpen; render(); },
  new: () => Comp.start(null),
  newmenu(el) {
    const ws = curWS(); const ts = Store.all('templates').filter(t => t.ws === ws.id);
    openPop(el, `<button class="pi" data-v="new">${ii('pencil')} Nova publicação</button><button class="pi" data-v="newnd">${ii('pin')} Ideia sem data</button>${ts.length ? '<hr><div class="ph">A partir de modelo</div>' + ts.map(t => `<button class="pi" data-v="t:${t.id}">${ii('file')} ${esc(t.name)}</button>`).join('') : ''}`, v => {
      if (v === 'new') Comp.start(null);
      else if (v === 'newnd') Comp.start(null, { data: { date: null } });
      else useTemplate(v.slice(2));
    }, { alignRight: true });
  },
  newday(el) { const [y, m, d] = el.dataset.d.split('-').map(Number); const dt = new Date(y, m - 1, d, 10, 0); if (dt < new Date()) { dt.setTime(Date.now() + 3600000); dt.setMinutes(0, 0, 0); } Comp.start(null, { date: dt.toISOString() }); },
  open(el) { const p = postById(el); if (p) Comp.start(p); },
  ptab(el) { UI.car['tab:' + el.dataset.pid] = el.dataset.id; render(); },
  car(el) { const k = el.dataset.k; UI.car[k] = Math.max(0, (UI.car[k] || 0) + +el.dataset.d); if (Comp.open) Comp.renderPreview(); render(); },
  focusc(el) { if (Comp.open) { Comp.side = 'comments'; Comp.renderSide(); const c = $('#cm-' + el.dataset.cid); if (c) { c.scrollIntoView({ block: 'center' }); c.style.outline = '2px solid var(--acc)'; setTimeout(() => c.style.outline = '', 1200); } } },
  approve(el) { const p = postById(el); if (p) Act.approve(p); },
  reject(el) { const p = postById(el); if (p) Act.askReject(p); },
  reqap(el) { const p = postById(el); if (p) Act.requestApproval(p); },
  sched(el) { const p = postById(el); if (p) Act.schedule(p); },
  unsched(el) { const p = postById(el); if (p) Act.unschedule(p); },
  retry(el) { const p = postById(el); if (p) Act.retry(p); },
  markpub(el) { const p = postById(el); if (p) Act.markPublished(p); },
  async metaligar(el) {
    const ws = curWS(); const w = window.open('about:blank', 's360meta', 'width=620,height=760');
    try {
      const { data, error } = await Store.sb.functions.invoke('s360-meta', { body: { acao: 'inicio', ws: ws.id } });
      if (error || !data) throw new Error((error && error.message) || 'sem resposta');
      if (data.erro === 'sem_app') { if (w) w.close(); metaSemApp(); return; }
      if (data.erro) throw new Error(data.erro === 'sem_permissao' ? 'Só os administradores do espaço podem ligar contas.' : data.erro);
      if (w) w.location = data.url; else location.href = data.url;
      Meta.esperar(ws);
    } catch (e) { if (w) w.close(); toast('Não foi possível começar a ligação: ' + e.message, 'err'); }
  },
  async metadesligar(el) {
    const ws = curWS(); const fb = el.dataset.id; const c = (Meta.lista[ws.id] || []).find(x => x.fb === fb);
    dialog({ title: 'Desligar da Meta', danger: true, ok: 'Desligar', body: `<p style="margin:0">Desligar <b>${esc(c ? c.fbNome : fb)}</b>${c && c.igNome ? ` e <b>@${esc(c.igNome)}</b>` : ''}? As publicações agendadas para estas páginas deixam de sair sozinhas.</p>`, onOk: async () => {
      try { await Store.sb.rpc('s360_meta_desligar', { p_ws: ws.id, p_fb: fb }); const w = clone(ws); w.pages.forEach(p => { if (p.meta && p.meta.fb === fb) delete p.meta; }); Store.put('workspaces', w); await Meta.carregar(ws); render(); toast('Desligada.'); } catch (e) { toast('Não foi possível desligar.', 'err'); }
    } });
  },
  metaauto() {
    const ws = curWS(); const w = clone(ws); let n = 0;
    (Meta.lista[ws.id] || []).forEach(c => {
      const ja = p => p.meta && p.meta.fb === c.fb;
      if (!w.pages.some(p => p.platform === 'facebook' && ja(p))) { const alvo = w.pages.find(p => p.platform === 'facebook' && !p.meta); if (alvo) alvo.meta = { fb: c.fb }; else w.pages.push({ id: w.id + '-' + uid(''), platform: 'facebook', name: c.fbNome, handle: '', meta: { fb: c.fb } }); n++; }
      if (c.ig && !w.pages.some(p => p.platform === 'instagram' && ja(p))) { const alvo = w.pages.find(p => p.platform === 'instagram' && !p.meta); if (alvo) alvo.meta = { fb: c.fb, ig: c.ig }; else w.pages.push({ id: w.id + '-' + uid(''), platform: 'instagram', name: c.igNome, handle: c.igNome, meta: { fb: c.fb, ig: c.ig } }); n++; }
    });
    if (n) Store.put('workspaces', w); toast(n ? `${n} página(s) do Social360 ligada(s).` : 'As páginas já estão ligadas.');
  },
  dup(el) { const p = postById(el); if (p) { Act.duplicate(p); toast('Duplicada como rascunho.'); } },
  del(el) { const p = postById(el); if (p) Act.remove(p); },
  qc(el) { const i = $('#qc-' + el.dataset.pid); const p = postById(el); if (p && i.value.trim()) { Act.comment(p, i.value.trim(), false); i.value = ''; } },
  pmenu(el) {
    const p = postById(el); const ws = curWS();
    openPop(el, `<button class="pi" data-v="open">Abrir</button>${canEdit(ws) ? `<button class="pi" data-v="dup">Duplicar</button>${wsList().length > 1 ? '<button class="pi" data-v="dupws">Duplicar noutro espaço</button>' : ''}` : ''}<button class="pi" data-v="copy">Copiar texto</button><button class="pi" data-v="link">Partilhar ligação</button>${canEdit(ws) ? `<hr><button class="pi bad" data-v="del">Eliminar</button>` : ''}`, v => {
      if (v === 'open') Comp.start(p);
      if (v === 'dup') { Act.duplicate(p); toast('Duplicada.'); }
      if (v === 'dupws') setTimeout(() => pickWS(el, id => { Act.duplicate(p, id); toast('Duplicada para ' + S.workspaces[id].name + '.'); }), 0);
      if (v === 'copy') copyText(p.text);
      if (v === 'link') shareDialog(p);
      if (v === 'del') Act.remove(p);
    }, { alignRight: true });
  },
  wsmenu(el) {
    const ws = curWS();
    openPop(el, `<button class="pi" data-v="set">${ii('gear')} Definições do espaço</button><button class="pi" data-v="pages">${ii('plug')} Páginas</button><button class="pi" data-v="mem">${ii('users')} Membros</button><button class="pi" data-v="ap">${ii('checkc')} Fluxo de aprovação</button>`, v => { UI.setTab = { set: 'geral', pages: 'paginas', mem: 'membros', ap: 'aprovacoes' }[v]; go('definicoes'); });
  },
  addpage: () => addPageDialog(curWS()),
  addlabel: () => labelDialog(curWS()),
  editlabel: el => labelDialog(curWS(), labelOf(curWS(), el.dataset.id)),
  rmlabel(el) {
    const ws = curWS(); const l = labelOf(ws, el.dataset.id);
    dialog({ title: 'Eliminar etiqueta', danger: true, ok: 'Eliminar', body: `<p style="margin:0">Eliminar “${esc(l.name)}”? As publicações ficam, só perdem a etiqueta.</p>`, onOk: () => { const w = clone(ws); w.labels = w.labels.filter(x => x.id !== l.id); Store.put('workspaces', w); wsPosts(ws).filter(p => (p.labels || []).includes(l.id)).forEach(p => { const n = clone(p); n.labels = n.labels.filter(x => x !== l.id); Store.put('posts', n); }); UI.f.labels = UI.f.labels.filter(x => x !== l.id); } });
  },
  fpage(el) { toggleArr(UI.f.pages, el.dataset.id); saveUI(); render(); },
  flabel(el) { toggleArr(UI.f.labels, el.dataset.id); saveUI(); render(); },
  fst(el) { toggleArr(UI.f.status, el.dataset.v); saveUI(); render(); },
  fclear() { UI.f = { pages: [], labels: [], status: [], q: '' }; saveUI(); render(); },
  fstatus: el => multiPop(el, Object.entries(STATUS).map(([k, s]) => ({ v: k, h: s.n })), () => UI.f.status, v => { toggleArr(UI.f.status, v); saveUI(); render(); }),
  flabels: el => multiPop(el, (curWS().labels || []).map(l => ({ v: l.id, h: `<span class="dot" style="background:${l.color}"></span>${esc(l.name)}` })), () => UI.f.labels, v => { toggleArr(UI.f.labels, v); saveUI(); render(); }),
  fpages: el => multiPop(el, curWS().pages.map(p => ({ v: p.id, h: pfBadge(p.platform, 'sm') + esc(p.name) })), () => UI.f.pages, v => { toggleArr(UI.f.pages, v); saveUI(); render(); }),
  saveview() {
    dialog({ title: 'Guardar vista', ok: 'Guardar', body: `<div class="fld"><label>Nome</label><input class="inp" id="vn" placeholder="Ex.: Natal — por aprovar"></div><div class="muted">Guarde a vista atual (${VIEWS[UI.view]}) com os filtros aplicados.</div>`, onOk: ov => { Store.put('views', { id: uid('v'), ws: curWS().id, name: $('#vn', ov).value.trim() || 'Vista', view: UI.view, f: clone(UI.f), createdBy: Store.me }); toast('Vista guardada.'); } });
  },
  openview(el, e) { if (e.target.closest('[data-act="delview"]')) return; const v = S.views[el.dataset.id]; if (!v) return; UI.f = clone(v.f); go(v.view); },
  delview(el) { Store.del('views', el.dataset.id); },
  feedmore(el) { if (el.dataset.v === 'b') UI.feedB = (UI.feedB || 6) + 20; else UI.feedA = (UI.feedA || 30) + 30; UI.keepScroll = true; render(); },
  more(el) { UI[el.dataset.k] = (UI[el.dataset.k] || +el.dataset.n) + +el.dataset.n; render(); },
  caltoday() { UI.calDate = null; render(); },
  calnav(el) { const d = calBase(); if (UI.calMode === 'week') d.setDate(d.getDate() + 7 * +el.dataset.d); else { d.setDate(1); d.setMonth(d.getMonth() + +el.dataset.d); } UI.calDate = d.toISOString(); render(); },
  calmode(el) { UI.calMode = el.dataset.v; saveUI(); render(); },
  calday(el) { const [y, m, d] = el.dataset.d.split('-').map(Number); UI.calDate = new Date(y, m - 1, d).toISOString(); UI.calMode = 'week'; render(); },
  sort(el) { const k = el.dataset.k; UI.sort = UI.sort.k === k ? { k, d: -UI.sort.d } : { k, d: 1 }; saveUI(); render(); },
  selall(el, e) { e.stopPropagation(); const ids = filtered(curWS()).map(p => p.id); const all = ids.every(i => selected.has(i)); ids.forEach(i => all ? selected.delete(i) : selected.add(i)); render(); },
  selone(el, e) { e.stopPropagation(); const id = el.dataset.pid; selected.has(id) ? selected.delete(id) : selected.add(id); render(); },
  bulk(el) {
    const v = el.dataset.v; const ps = [...selected].map(id => S.posts[id]).filter(Boolean); const ws = curWS();
    if (v === 'clear') { selected.clear(); render(); return; }
    if (v === 'label') { openPop(el, (ws.labels || []).map(l => `<button class="pi" data-v="${l.id}"><span class="dot" style="background:${l.color}"></span>${esc(l.name)}</button>`).join('') || '<div class="muted" style="padding:8px">Sem etiquetas.</div>', id => { ps.forEach(p => { if (!(p.labels || []).includes(id)) { const n = clone(p); n.labels = [...(n.labels || []), id]; Store.put('posts', n); } }); toast('Etiqueta aplicada a ' + ps.length + '.'); }); return; }
    if (v === 'copyws') { pickWS(el, id => { ps.forEach(p => Act.duplicate(p, id)); toast(ps.length + ' duplicadas para ' + S.workspaces[id].name + '.'); }); return; }
    if (v === 'del') {
      dialog({ title: 'Eliminar publicações', danger: true, ok: 'Eliminar ' + ps.length, body: `<p style="margin:0">Eliminar ${ps.length} publicações?</p>`, onOk: () => { const keep = ps.map(clone); window.QUIET = true; ps.forEach(p => Store.del('posts', p.id)); window.QUIET = false; selected.clear(); toast(ps.length + ' eliminadas.', '', { label: 'Anular', fn: () => keep.forEach(p => Store.put('posts', p)) }); render(); } });
      return;
    }
    let ok = 0; window.QUIET = true;
    ps.forEach(p => { let r = null; if (v === 'approve' && canApprove(p, ws)) r = Act.approve(p); if (v === 'reqap' && ['draft', 'changes'].includes(p.status)) r = Act.requestApproval(p, true); if (v === 'sched' && p.status !== 'published') r = Act.schedule(p); if (v === 'dup') r = Act.duplicate(p); if (r) ok++; });
    window.QUIET = false;
    toast(`${ok} de ${ps.length} publicações atualizadas.` + (ok < ps.length ? ' As restantes não cumprem os requisitos.' : ''));
  },
  notif() { UI.notif = !UI.notif; render(); },
  readall() { const ws = curWS(); notifsFor(ws).filter(n => !(n.readBy || []).includes(Store.me)).forEach(n => { const x = clone(n); x.readBy = [...(x.readBy || []), Store.me]; Store.put('notifs', x); }); },
  nopen(el) { const n = S.notifs[el.dataset.id]; if (!n) return; if (!(n.readBy || []).includes(Store.me)) { const x = clone(n); x.readBy = [...(x.readBy || []), Store.me]; Store.put('notifs', x); } UI.notif = false; const p = S.posts[n.postId]; if (p) Comp.start(p); else render(); },
  share: () => shareDialog(null),
  /* media */
  mupload: () => $('#mfile').click(),
  mkind(el) { UI.mediaK = el.dataset.v; render(); },
  msel(el) { UI.mediaSel = UI.mediaSel === el.dataset.id ? null : el.dataset.id; render(); },
  mnew(el) { Comp.start(null, { data: { mediaIds: [el.dataset.id] } }); },
  mdel(el) {
    const m = S.media[el.dataset.id]; const used = Media.used(m.id);
    dialog({ title: 'Eliminar ficheiro', danger: true, ok: 'Eliminar', body: `<p style="margin:0">Eliminar “${esc(m.name)}”?${used.length ? ` Está a ser usado em ${used.length} publicação(ões) — será retirado delas.` : ''}</p>`, onOk: async () => {
      used.forEach(p => { const n = clone(p); n.mediaIds = n.mediaIds.filter(x => x !== m.id); n.comments = (n.comments || []).filter(c => c.mediaId !== m.id); Store.put('posts', n); });
      Store.del('media', m.id); UI.mediaSel = null;
      if (m.assetId && Store.assets) try { await Store.assets.delete(m.assetId); } catch (e) {}
      if (m.storage && Store.mode === 'sb') try { await Store.sb.storage.from('s360').remove([m.storage].concat(m.jpg ? [m.jpg] : [])); } catch (e) {}
    } });
  },
  /* caixa de entrada */
  ibf(el) { UI.inboxF = el.dataset.v; saveUI(); render(); },
  ibsel(el) { UI.inboxSel = el.dataset.id; const it = S.inbox[el.dataset.id]; if (it && !it.read && canEdit(curWS())) { const n = clone(it); n.read = true; Store.put('inbox', n); } render(); },
  ibdone(el) { const n = clone(S.inbox[el.dataset.id]); n.done = !n.done; n.read = true; Store.put('inbox', n); toast(n.done ? 'Marcada como tratada.' : 'Reaberta.'); },
  ibsend(el) { const t = $('#ibr').value.trim(); if (!t) return; const n = clone(S.inbox[el.dataset.id]); n.replies = [...(n.replies || []), { id: uid('r'), by: Store.me, text: t, at: nowISO() }]; n.read = true; Store.put('inbox', n); toast('Resposta registada (envio simulado).'); },
  async ibai(el) {
    const it = S.inbox[el.dataset.id]; const ws = curWS(); const ta = $('#ibr'); const pg = pageOf(ws, it.pageId);
    el.disabled = true; ta.value = '';
    try {
      const r = await Store.sample(`És o gestor de comunidade da marca "${ws.name}". Escreva em português europeu (pt-PT). Escreva uma resposta curta, simpática e profissional a este ${IB_T[it.type] || 'contacto'} recebido no ${pg ? PLAT[pg.platform].n : 'canal'} (sentimento: ${it.sentiment}). Se for uma reclamação, pede desculpa e propõe resolver por mensagem privada. Responde só com o texto da resposta.\n\nDe ${it.author}: "${it.text}"`, { cache: false, onText: ({ text }) => { ta.value = text; } });
      ta.value = (r && r.text || ta.value).trim();
    } catch (e) { if (e && e.code === 'not_granted') Store.sample = null; toast('O assistente não respondeu.', 'err'); }
    el.disabled = false;
  },
  ibadd() {
    const ws = curWS();
    dialog({ title: 'Registar mensagem recebida', ok: 'Registar', body: `<div class="muted">Sem ligação às redes, pode registar aqui comentários e mensagens recebidos para os tratar em equipa.</div>
      <div style="display:flex;gap:8px"><div class="fld" style="flex:1"><label>Página</label><select class="inp" id="ipg">${ws.pages.map(p => `<option value="${p.id}">${esc(PLAT[p.platform].n + ' — ' + p.name)}</option>`).join('')}</select></div><div class="fld" style="flex:1"><label>Tipo</label><select class="inp" id="ity">${Object.entries(IB_T).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div></div>
      <div class="fld"><label>Autor</label><input class="inp" id="iau" placeholder="Nome ou utilizador"></div><div class="fld"><label>Texto</label><textarea class="inp" id="itx" rows="3"></textarea></div>
      <div class="fld"><label>Sentimento</label><select class="inp" id="ise"><option value="neu">Neutro</option><option value="pos">Positivo</option><option value="neg">Negativo</option></select></div>`,
      onOk: ov => { const t = $('#itx', ov).value.trim(); if (!t) { toast('Escreva o texto.', 'err'); return false; } const it = { id: uid('i'), ws: ws.id, pageId: $('#ipg', ov).value, type: $('#ity', ov).value, author: $('#iau', ov).value.trim() || 'Anónimo', text: t, sentiment: $('#ise', ov).value, at: nowISO(), done: false, read: false, assignee: null, replies: [], postId: null }; Store.put('inbox', it); UI.inboxSel = it.id; render(); } });
  },
  /* análise */
  range(el) { UI.range = +el.dataset.v; saveUI(); render(); },
  report() {
    const ws = curWS(); const rows = Analytics.rows(ws, UI.range); const s = k => rows.reduce((a, r) => a + r.m[k], 0);
    const txt = `Relatório ${ws.name} — últimos ${UI.range} dias (valores de demonstração)\nPublicações: ${new Set(rows.map(r => r.p.id)).size}\nImpressões: ${s('imp')}\nAlcance: ${s('reach')}\nInterações: ${s('eng')}\nTaxa de envolvimento: ${s('imp') ? (s('eng') / s('imp') * 100).toFixed(1) : 0}%\nCliques: ${s('clicks')}`;
    copyText(txt);
  },
  /* definições */
  settab(el) { UI.setTab = el.dataset.v; saveUI(); render(); },
  wscolor(el) { const w = clone(curWS()); w.color = el.dataset.v; Store.put('workspaces', w); },
  delws() {
    const ws = curWS();
    dialog({ title: 'Eliminar espaço de trabalho', danger: true, ok: 'Eliminar para sempre', body: `<p style="margin:0">Isto elimina <b>${esc(ws.name)}</b> e todas as suas publicações, media, mensagens e modelos. Escreva o nome para confirmar.</p><input class="inp" id="dn">`, onOk: ov => {
      if ($('#dn', ov).value.trim() !== ws.name) { toast('O nome não corresponde.', 'err'); return false; }
      window.QUIET = true;
      ['posts', 'media', 'inbox', 'templates', 'views', 'notifs'].forEach(c => Store.all(c).filter(x => x.ws === ws.id).forEach(x => Store.del(c, x.id)));
      Store.del('workspaces', ws.id); window.QUIET = false; UI.ws = null; go('feed');
    } });
  },
  rmpage(el) {
    const ws = curWS(); const pg = pageOf(ws, el.dataset.id);
    dialog({ title: 'Remover página', danger: true, ok: 'Remover', body: `<p style="margin:0">Remover ${esc(PLAT[pg.platform].n)} “${esc(pg.name)}”? As publicações ficam mas deixam de ir para esta página.</p>`, onOk: () => {
      const w = clone(ws); w.pages = w.pages.filter(x => x.id !== pg.id); Store.put('workspaces', w);
      wsPosts(ws).filter(p => p.pageIds.includes(pg.id)).forEach(p => { const n = clone(p); n.pageIds = n.pageIds.filter(x => x !== pg.id); delete (n.custom || {})[pg.id]; Store.put('posts', n); });
      UI.f.pages = UI.f.pages.filter(x => x !== pg.id);
    } });
  },
  autocrop() { const w = clone(curWS()); w.autoCrop = w.autoCrop === false; Store.put('workspaces', w); },
  copylabels(el) {
    pickWS(el, id => {
      const src = S.workspaces[id]; const w = clone(curWS()); w.labels = w.labels || []; let n = 0;
      (src.labels || []).forEach(l => { if (!w.labels.some(x => x.name.trim().toLowerCase() === l.name.trim().toLowerCase())) { w.labels.push({ id: uid('l'), name: l.name, color: l.color }); n++; } });
      if (n) Store.put('workspaces', w); toast(n ? `${n} etiqueta(s) copiada(s) de ${src.name}.` : 'Este espaço já tem essas etiquetas.');
    });
  },
  rmmember(el) { const w = clone(curWS()); w.members = w.members.filter(m => m.id !== el.dataset.id); Store.put('workspaces', w); },
  addmember(el) {
    const id = String(el.dataset.id).trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id) && Store.mode === 'sb') { toast('Email inválido.', 'err'); return; }
    const w = clone(curWS()); const r = ($('#mrole') && $('#mrole').value) || 'editor';
    if (!w.members.some(m => String(m.id).toLowerCase() === id)) w.members.push({ id, role: r });
    if (el.dataset.nome) Store.names[id] = el.dataset.nome;
    Store.put('workspaces', w); toast('Adicionado: ' + Store.name(id) + '.'); const s = $('#msearch'); if (s) s.value = '';
  },
  addlocalmember() { const n = $('#mname').value.trim(); if (!n) return; const w = clone(curWS()); w.members.push({ id: uid('u'), role: $('#mrole').value, n }); Store.put('workspaces', w); },
  actas(el) { Store.me = el.dataset.id; toast('Agora está a agir como ' + Store.name(Store.me) + '.'); render(); },
  stadd() { const w = clone(curWS()); w.approval.steps = [...(w.approval.steps || []), { id: uid('s'), name: 'Passo ' + ((w.approval.steps || []).length + 1), approver: null }]; Store.put('workspaces', w); },
  strm(el) { const w = clone(curWS()); if (w.approval.steps.length <= 1) { toast('Precisa de pelo menos um passo.', 'err'); return; } w.approval.steps.splice(+el.dataset.i, 1); Store.put('workspaces', w); },
  stup(el) { const i = +el.dataset.i; if (!i) return; const w = clone(curWS()); const s = w.approval.steps; [s[i - 1], s[i]] = [s[i], s[i - 1]]; Store.put('workspaces', w); },
  apreset() { const w = clone(curWS()); w.approval.resetOnEdit = w.approval.resetOnEdit === false; Store.put('workspaces', w); },
  usetpl(el) { useTemplate(el.dataset.id); },
  rmtpl(el) { Store.del('templates', el.dataset.id); },
  export() { const ws = curWS(); const d = { workspace: ws }; ['posts', 'media', 'inbox', 'templates', 'views'].forEach(c => d[c] = Store.all(c).filter(x => x.ws === ws.id).map(x => c === 'media' && x.url && x.url.startsWith('blob:') ? Object.assign({}, x, { url: '' }) : x)); copyText(JSON.stringify(d)); },
  import() {
    dialog({ title: 'Importar espaço (JSON)', ok: 'Importar', body: `<div class="fld"><label>Cole aqui uma exportação do Social360</label><textarea class="inp" id="ij" rows="8"></textarea></div><div class="muted">Cria um novo espaço com novos identificadores, sem mexer nos existentes.</div>`, onOk: ov => {
      let d; try { d = JSON.parse($('#ij', ov).value); } catch (e) { toast('JSON inválido.', 'err'); return false; }
      if (!d.workspace) { toast('Não parece uma exportação do Social360.', 'err'); return false; }
      const map = {}; const nid = (o, p) => map[o] || (map[o] = uid(p));
      const w = clone(d.workspace); const oldW = w.id; w.id = nid(oldW, 'w'); w.name += ' (importado)'; w.createdAt = nowISO(); w.members = [{ id: Store.me, role: 'admin' }];
      w.pages.forEach(p => p.id = nid(p.id, w.id + '-'));
      Store.put('workspaces', w);
      (d.media || []).forEach(m => { m.id = nid(m.id, 'm'); m.ws = w.id; Store.put('media', m); });
      (d.posts || []).forEach(p => { p.id = nid(p.id, 'p'); p.ws = w.id; p.pageIds = p.pageIds.map(x => map[x]).filter(Boolean); p.mediaIds = (p.mediaIds || []).map(x => map[x]).filter(Boolean); const c = {}; Object.entries(p.custom || {}).forEach(([k, v]) => { if (map[k]) c[map[k]] = v; }); p.custom = c; (p.comments || []).forEach(x => { if (x.mediaId) x.mediaId = map[x.mediaId]; }); Store.put('posts', p); });
      (d.inbox || []).forEach(i => { i.id = uid('i'); i.ws = w.id; i.pageId = map[i.pageId]; i.postId = map[i.postId] || null; Store.put('inbox', i); });
      (d.templates || []).forEach(t => { t.id = uid('t'); t.ws = w.id; t.pageIds = (t.pageIds || []).map(x => map[x]).filter(Boolean); t.mediaIds = (t.mediaIds || []).map(x => map[x]).filter(Boolean); Store.put('templates', t); });
      UI.ws = w.id; saveUI(); toast('Importado.');
    } });
  },
  wipe() { dialog({ title: 'Apagar dados locais', danger: true, ok: 'Apagar tudo', body: '<p style="margin:0">Apaga todos os espaços, publicações e media guardados neste navegador.</p>', onOk: () => { COLLS.forEach(c => S[c] = {}); lsSet(LSKEY, '{}'); UI.ws = null; Store.emit(); } }); }
};
function pickWS(anchor, cb) {
  const cur = curWS();
  openPop(anchor, `<div class="ph">Escolha o espaço</div>${wsList().filter(w => w.id !== cur.id).map(w => `<button class="pi" data-v="${w.id}"><span class="dot" style="background:${w.color}"></span>${esc(w.name)}</button>`).join('')}`, v => cb(v));
}
function useTemplate(id) {
  const t = S.templates[id]; if (!t) return;
  Comp.start(null, { data: { text: t.text, custom: clone(t.custom || {}), pageIds: [...(t.pageIds || [])], labels: [...(t.labels || [])], mediaIds: [...(t.mediaIds || [])].filter(x => S.media[x]), format: t.format || 'post' } });
}

document.addEventListener('click', e => {
  const c = e.target.closest('[data-cact]');
  if (c && Comp.open && CA[c.dataset.cact]) { e.preventDefault(); if (!c.disabled) CA[c.dataset.cact](c, e); return; }
  const t = e.target.closest('[data-act]');
  if (t && A[t.dataset.act]) {
    if (t.closest('#comp') && !['car', 'focusc'].includes(t.dataset.act)) return;
    if (t.tagName !== 'INPUT') e.preventDefault();
    if (!t.disabled) A[t.dataset.act](t, e);
    return;
  }
  if (UI.notif && !e.target.closest('#npanel')) { UI.notif = false; render(); }
});
let qT = 0, msT = 0;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.in === 'q') { UI.f.q = t.value; clearTimeout(qT); qT = setTimeout(() => { saveUI(); render(); }, 160); }
  if (t.dataset.in === 'mq') { UI.mediaQ = t.value; clearTimeout(qT); qT = setTimeout(render, 160); }
  if (t.dataset.in === 'msearch') {
    clearTimeout(msT); msT = setTimeout(async () => {
      const ws = curWS(); const box = $('#mresults'); if (!box) return;
      if (Store.mode === 'sb') {
        const q = norm2(t.value); const has = id => (ws.members || []).some(m => String(m.id).toLowerCase() === id);
        const hits = q ? Store.pessoas.filter(p => !has(p.email) && (norm2(p.nome).includes(q) || p.email.includes(q))).slice(0, 8) : [];
        const em = t.value.trim().toLowerCase(); const isEm = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) && !has(em) && !hits.some(h => h.email === em);
        box.innerHTML = hits.map(h => `<div class="rowl">${avatar(h.email)}<div class="g">${esc(h.nome || h.email)}<div class="muted">${esc(h.email)}</div></div><button class="btn sm" data-act="addmember" data-id="${esc(h.email)}" data-nome="${esc(h.nome || '')}">Adicionar</button></div>`).join('') + (isEm ? `<div class="rowl">${avatar(em)}<div class="g">${esc(em)}</div><button class="btn sm" data-act="addmember" data-id="${esc(em)}">Adicionar este email</button></div>` : '') || (q ? '<div class="muted" style="padding:6px 0">Ninguém encontrado entre os formadores — escreva o email completo.</div>' : '');
        return;
      }
      const hits = await Store.search(t.value);
      box.innerHTML = hits.filter(h => !(ws.members || []).some(m => m.id === h.id)).slice(0, 8).map(h => `<div class="rowl">${avatar(h.id)}<div class="g">${esc(h.name || 'Sem nome')}</div><button class="btn sm" data-act="addmember" data-id="${esc(h.id)}">Adicionar</button></div>`).join('') || '<div class="muted" style="padding:6px 0">Ninguém encontrado.</div>';
    }, 250);
  }
});
const norm2 = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
document.addEventListener('focusin', e => { if (Store.mode !== 'sb' && e.target.dataset && e.target.dataset.in === 'msearch' && !e.target.value) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
document.addEventListener('change', e => {
  const t = e.target; const ws = curWS(); if (!ws || t.closest('#comp')) return;
  if (t.dataset.ch === 'wssel') { if (t.value === '__novo') { t.value = ws.id; A.newws(); return; } A.ws({ dataset: { id: t.value } }); return; }
  if (t.dataset.ch === 'gridpage') { UI.gridPage = t.value; saveUI(); render(); }
  if (t.dataset.ch === 'ibplat') { UI.inboxPlat = t.value; render(); }
  if (t.dataset.ch === 'ibsort') { UI.inboxSort = t.value; saveUI(); render(); }
  if (t.dataset.ch === 'ibsent' || t.dataset.ch === 'ibassign') { const n = clone(S.inbox[t.dataset.id]); if (t.dataset.ch === 'ibsent') n.sentiment = t.value; else n.assignee = t.value || null; Store.put('inbox', n); }
  if (t.dataset.wsf) { const w = clone(ws); w[t.dataset.wsf] = t.value.trim() || w[t.dataset.wsf]; Store.put('workspaces', w); toast('Guardado.'); }
  if (t.dataset.pgmeta) { const w = clone(ws); const pg = w.pages.find(p => p.id === t.dataset.pgmeta); const c = (Meta.lista[ws.id] || []).find(x => x.fb === t.value); if (!c) delete pg.meta; else pg.meta = pg.platform === 'instagram' ? { fb: c.fb, ig: c.ig } : { fb: c.fb }; Store.put('workspaces', w); toast(c ? 'Página ligada.' : 'Ligação retirada.'); return; }
  if (t.dataset.pgf) { const w = clone(ws); const pg = w.pages.find(p => p.id === t.dataset.id); pg[t.dataset.pgf] = t.value.trim().replace(/^@/, ''); Store.put('workspaces', w); }
  if (t.dataset.mrole) { const w = clone(ws); w.members.find(m => m.id === t.dataset.mrole).role = t.value; Store.put('workspaces', w); }
  if (t.hasAttribute('data-apm')) { const w = clone(ws); w.approval = w.approval || { steps: [] }; w.approval.mode = t.value; if (!w.approval.steps?.length) w.approval.steps = [{ id: uid('s'), name: 'Aprovação', approver: null }]; Store.put('workspaces', w); }
  if (t.dataset.stn !== undefined) { const w = clone(ws); w.approval.steps[+t.dataset.stn].name = t.value.trim() || 'Passo'; Store.put('workspaces', w); }
  if (t.dataset.sta !== undefined) { const w = clone(ws); w.approval.steps = w.approval.steps?.length ? w.approval.steps : [{ id: uid('s'), name: 'Aprovação', approver: null }]; w.approval.steps[+t.dataset.sta].approver = t.value || null; Store.put('workspaces', w); }
  if (t.dataset.mren) { const m = clone(S.media[t.dataset.mren]); m.name = t.value.trim() || m.name; Store.put('media', m); }
  if (t.id === 'mfile') { Media.upload([...t.files], ws).then(ms => { if (ms[0]) UI.mediaSel = ms[0].id; render(); }); }
});
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.qc) { e.preventDefault(); const b = $(`[data-act="qc"][data-pid="${e.target.dataset.qc}"]`); if (b) A.qc(b); return; }
  if (e.key === 'Escape') {
    if (popEl) { closePop(); return; }
    const ovs = $$('.ov').filter(o => o.id !== 'comp-ov'); if (ovs.length) { ovs.pop().remove(); return; }
    if (Comp.open) { Comp.close(); return; }
    if (UI.notif) { UI.notif = false; render(); }
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || Comp.open || $$('.ov').length) return;
  if (e.key === 'c' && curWS() && canEdit(curWS())) { e.preventDefault(); Comp.start(null); }
  if (e.key === '/') { const q = $('#q'); if (q) { e.preventDefault(); q.focus(); } }
  if (UI.view === 'calendario' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) A.calnav({ dataset: { d: e.key === 'ArrowLeft' ? -1 : 1 } });
  const n = '12345'.indexOf(e.key); if (n >= 0 && curWS()) go(Object.keys(VIEWS)[n]);
});

/* arrastar e largar */
let dragId = null;
document.addEventListener('dragstart', e => {
  const el = e.target.closest && e.target.closest('[draggable="true"][data-pid]'); if (!el || el.closest('#comp')) return;
  dragId = el.dataset.pid; e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); closePop();
});
document.addEventListener('dragend', e => { dragId = null; $$('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); });
document.addEventListener('dragover', e => {
  const dz = e.target.closest && e.target.closest('#dz'); if (dz && e.dataTransfer.types.includes('Files')) { e.preventDefault(); dz.classList.add('over'); return; }
  if (!dragId) return; const t = e.target.closest('[data-drop]'); if (!t) return;
  e.preventDefault(); $$('.over').forEach(x => x !== t && x.classList.remove('over')); t.classList.add('over');
});
document.addEventListener('dragleave', e => { const t = e.target.closest && e.target.closest('[data-drop],#dz'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('over'); });
document.addEventListener('drop', e => {
  const dz = e.target.closest && e.target.closest('#dz');
  if (dz && e.dataTransfer.files.length) { e.preventDefault(); dz.classList.remove('over'); Media.upload([...e.dataTransfer.files], curWS()).then(ms => { if (ms[0]) UI.mediaSel = ms[0].id; render(); }); return; }
  if (!dragId) return; const t = e.target.closest('[data-drop]'); if (!t) return;
  e.preventDefault(); t.classList.remove('over');
  const p = S.posts[dragId]; dragId = null; if (!p) return;
  const [kind, val] = t.dataset.drop.split(/:(.*)/s);
  if (kind === 'day') {
    const [y, m, d] = val.split('-').map(Number); const old = p.date ? new Date(p.date) : new Date(new Date().setHours(10, 0, 0, 0));
    const nd = new Date(y, m - 1, d, old.getHours(), old.getMinutes());
    if (p.status === 'scheduled' && nd < new Date()) { toast('Não pode agendar para o passado.', 'err'); return; }
    if (dayKey(nd) === dayKey(old) && p.date) return;
    const n = clone(p); n.date = nd.toISOString(); hist(n, 'mudou a data para ' + fmtDT(n.date)); Store.put('posts', n); toast('Movida para ' + fmtDT(n.date) + '.');
  }
  if (kind === 'col') kanbanDrop(p, val);
  if (kind === 'grid') {
    const q = S.posts[val]; if (!q || q.id === p.id) return;
    if (q.status === 'published') { toast('Não pode trocar com uma publicação já publicada.', 'err'); return; }
    const a = clone(p), b = clone(q); [a.date, b.date] = [b.date, a.date];
    if ((a.status === 'scheduled' && new Date(a.date) < new Date()) || (b.status === 'scheduled' && new Date(b.date) < new Date())) { toast('A troca deixaria uma publicação agendada no passado.', 'err'); return; }
    hist(a, 'reordenou na grelha'); hist(b, 'reordenou na grelha'); Store.put('posts', a); Store.put('posts', b); toast('Ordem trocada.');
  }
});

/* rotas por hash */
let pendingPost = null;
function route() {
  const h = (location.hash || '').slice(1);
  if (h.startsWith('post-')) { pendingPost = h.slice(5); tryPending(); return; }
  if (VIEWS[h] || OTHER[h]) { UI.view = h; render(); }
}
function tryPending() {
  if (!pendingPost) return; const p = S.posts[pendingPost];
  if (p) { pendingPost = null; UI.ws = p.ws; render(); setTimeout(() => Comp.start(p), 30); }
}
window.addEventListener('hashchange', route);
Store.onChange(tryPending);
window.addEventListener('resize', () => { if (Comp.open) Comp.renderHead(); const b = $('#sidebtn'); if (b) b.style.display = innerWidth <= 820 ? '' : 'none'; });

/* arranque */
Bridge.onView = v => { if ((VIEWS[v] || OTHER[v]) && v !== UI.view) { if (Comp.open) Comp.close(true); go(v, true); } };
Bridge.onInfo = d => { if (d.pessoas) Store.setPessoas(d.pessoas); if (d.me && Store.meInfo) Object.assign(Store.meInfo, d.me); render(); };
(async function boot() {
  render();
  await Store.init();
  if (Store.initView && (VIEWS[Store.initView] || OTHER[Store.initView])) UI.view = Store.initView;
  try { if (Store.user && Store.user.isOwner) Store.isOwner = !!(await Store.user.isOwner()); } catch (e) {}
  route(); render(); tick();
  setInterval(tick, 30000);
  setInterval(() => { if (!Comp.open && ['feed', 'inbox'].includes(UI.view)) render(); }, 60000);
})();
