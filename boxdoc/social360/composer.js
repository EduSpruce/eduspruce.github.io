/* Social360 (EPISJ 360) — compositor de publicações */
'use strict';
const EMOJIS = '😀 😂 😍 🥰 😎 🤩 🙌 👏 👍 🙏 💪 🔥 ✨ 🎉 🎄 🎁 ❤️ 💙 💚 💛 ☕ 🍰 🥐 🌰 📚 📸 🎥 🎶 🌊 ☀️ 🌧️ ❄️ 🌿 🌸 📍 🗓️ ⏰ ✅ 👉 💬'.split(' ');
const Comp = {
  open: false, post: null, orig: '', isNew: false, tab: 'all', pv: null, side: 'comments', annot: false, pendingAnnot: null, internal: false, ai: { out: '', busy: false, ctrl: null },
  start(p, preset = {}) {
    const ws = curWS(); if (!ws) return;
    if (p) { this.post = clone(p); this.isNew = false; }
    else {
      if (!canEdit(ws)) return;
      const d = preset.date || (() => { const x = new Date(); x.setDate(x.getDate() + 1); x.setHours(10, 0, 0, 0); return x.toISOString(); })();
      this.post = Object.assign({ id: uid('p'), ws: ws.id, pageIds: UI.f.pages.length ? [...UI.f.pages] : ws.pages.filter(x => x.platform !== 'universal').slice(0, 2).map(x => x.id), text: '', custom: {}, mediaIds: [], firstComment: '', date: d, status: 'draft', approvals: [], labels: UI.f.labels.length ? [...UI.f.labels] : [], comments: [], history: [], createdBy: Store.me, createdAt: nowISO(), format: 'post' }, preset.data || {});
      this.isNew = true;
    }
    this.orig = this.sig(); this.tab = 'all'; this.pv = this.post.pageIds[0] || null; this.annot = false; this.pendingAnnot = null; this.ai = { out: '', busy: false, ctrl: null };
    this.side = preset.side || 'comments';
    this.open = true;
    this.renderAll();
    if (!this.isNew) { markSeen(this.post); try { history.replaceState(null, '', '#post-' + this.post.id); } catch (e) {} }
    setTimeout(() => { const t = $('#ctext'); if (t && this.isNew) t.focus(); }, 40);
  },
  sig() { const p = this.post; return JSON.stringify([p.pageIds, p.text, p.custom, p.mediaIds, p.firstComment, p.date, p.labels, p.format, p.poll || null, p.docTitle || '', p.trial || null, p.music || '']); },
  dirty() { return this.sig() !== this.orig; },
  ws() { return S.workspaces[this.post.ws]; },
  close(force) {
    if (!force && this.dirty() && canEdit(this.ws())) {
      dialog({ title: 'Guardar alterações?', body: '<p style="margin:0">Tem alterações por guardar nesta publicação.</p>', ok: 'Guardar', cancel: 'Descartar', onOk: () => { this.commit(); this.close(true); } });
      const ov = $$('.ov').pop(); const disc = $('[data-x].btn', ov); if (disc) disc.onclick = () => { ov.remove(); this.close(true); };
      return;
    }
    if (this.ai.ctrl) try { this.ai.ctrl.abort(); } catch (e) {}
    if (!this.isNew && this.post) markSeen(this.post);
    this.open = false; const r = $('#comp-root'); if (r) r.innerHTML = '';
    try { history.replaceState(null, '', '#' + UI.view); } catch (e) {}
    render();
  },
  /* sincroniza alterações de outras pessoas sem apagar o que estou a escrever */
  sync() {
    if (!this.open) return;
    const s = S.posts[this.post.id];
    if (!s) { if (!this.isNew) { toast('Esta publicação foi eliminada.'); this.close(true); } return; }
    this.isNew = false;
    const keepDirty = this.dirty();
    ['comments', 'approvals', 'status', 'history', 'rejected', 'autoSchedule', 'publishedAt', 'updatedAt'].forEach(k => this.post[k] = clone(s[k] ?? null));
    if (!keepDirty) { ['pageIds', 'text', 'custom', 'mediaIds', 'firstComment', 'date', 'labels', 'format', 'poll', 'docTitle', 'trial', 'music'].forEach(k => this.post[k] = clone(s[k] ?? (k === 'custom' ? {} : k === 'pageIds' || k === 'mediaIds' || k === 'labels' ? [] : ['poll', 'trial'].includes(k) ? null : ''))); this.orig = this.sig(); }
    markSeen(this.post);
    this.renderHead(); this.renderSide(); this.renderFoot(); this.renderPreview();
  },
  commit(silent) {
    const ws = this.ws(); if (!canEdit(ws)) return S.posts[this.post.id] || this.post;
    const p = clone(this.post); const stored = S.posts[p.id];
    const contentChanged = stored && JSON.stringify([stored.text, stored.custom, stored.mediaIds, stored.pageIds, stored.firstComment, stored.poll || null, stored.docTitle || '']) !== JSON.stringify([p.text, p.custom, p.mediaIds, p.pageIds, p.firstComment, p.poll || null, p.docTitle || '']);
    if (!stored) hist(p, 'criou a publicação');
    else if (this.dirty()) hist(p, contentChanged ? 'editou o conteúdo' : 'alterou detalhes');
    if (stored && contentChanged && needsApproval(ws) && ws.approval.resetOnEdit !== false && (p.approvals || []).length && ['approved', 'scheduled', 'review'].includes(p.status)) {
      const wasSched = p.status === 'scheduled';
      p.approvals = []; p.status = 'review'; if (wasSched) p.autoSchedule = true;
      hist(p, 'aprovação reiniciada após edição');
      if (!silent) toast('O conteúdo mudou, por isso a aprovação recomeçou.');
    }
    if (Store.put('posts', p)) { this.post = clone(p); this.orig = this.sig(); this.isNew = false; }
    return p;
  },
  run(fn) { const p = this.commit(true); const r = fn(p); if (r) { this.post = clone(r); this.orig = this.sig(); } this.renderAll(); },

  /* ---------- render ---------- */
  renderAll() {
    const ws = this.ws(); const root = $('#comp-root');
    root.innerHTML = `<div class="ov" id="comp-ov"><div class="comp" id="comp">
      <div class="ch" id="c-head"></div>
      <div class="cb"><div class="ce" id="c-ed"></div><div class="cp" id="c-pv"></div><div class="cc" id="c-side"></div></div>
      <div class="cf" id="c-foot"></div></div></div>`;
    this.renderHead(); this.renderEditor(); this.renderPreview(); this.renderSide(); this.renderFoot();
  },
  renderHead() {
    const ws = this.ws(), p = this.post, el = $('#c-head'); if (!el) return;
    el.innerHTML = `<span class="pf lg" style="background:${ws.color}">${esc(initials(ws.name))}</span><h3>${this.isNew ? 'Nova publicação' : 'Editar publicação'} <span class="muted" style="font-weight:400">· ${esc(ws.name)}</span></h3>${stPill(p.status)}${p.autoSchedule ? '<span class="muted">· agenda automaticamente ao aprovar</span>' : ''}${p.status === 'failed' ? '<span class="muted" style="color:#b42318">· veja o motivo em Atividade</span>' : ''}<div style="flex:1"></div>
      <button class="btn sm ghost" data-cact="toggleside" id="ctgl" style="display:none">${ii('chat')} Comentários</button>
      <button class="icbtn" data-cact="close" title="Fechar (Esc)">${I.x}</button>`;
    if (innerWidth <= 1100) $('#ctgl').style.display = '';
  },
  renderEditor() {
    const ws = this.ws(), p = this.post, el = $('#c-ed'); if (!el) return;
    const ed = canEdit(ws) && !['published', 'publishing'].includes(p.status);
    const sel = p.pageIds.map(id => pageOf(ws, id)).filter(Boolean);
    const plats = [...new Set(sel.map(x => x.platform))];
    const fmts = plats.length === 1 ? PLAT[plats[0]].fmts : [...new Set(sel.flatMap(x => PLAT[x.platform].fmts))];
    if (!fmts.includes(p.format) && fmts.length) p.format = fmts[0];
    const tabPage = this.tab !== 'all' ? pageOf(ws, this.tab) : null;
    if (this.tab !== 'all' && !tabPage) this.tab = 'all';
    const cust = this.tab !== 'all' && p.custom?.[this.tab]?.on;
    const val = this.tab === 'all' ? p.text : (cust ? p.custom[this.tab].text : p.text);
    const d = p.date ? new Date(p.date) : null;
    const dv = d ? dayKey(d) : '', tv = d ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '';
    const fcPlat = plats.some(x => ['instagram', 'linkedin', 'facebook', 'youtube'].includes(x));
    el.innerHTML = `
      <div class="fld"><label>Publicar em</label><div class="pgsel">${ws.pages.map(pg => `<button class="pgo ${p.pageIds.includes(pg.id) ? 'on' : ''}" data-cact="tpage" data-id="${pg.id}" ${ed ? '' : 'disabled'}>${pfBadge(pg.platform, 'sm')}${esc(pg.name)}</button>`).join('')}${!ws.pages.length ? '<span class="muted">Sem páginas — adicione nas definições.</span>' : ''}</div></div>
      ${fmts.length > 1 ? `<div class="fld"><label>Formato <span class="muted" style="font-weight:400">· mudar o formato mantém comentários e aprovações</span></label><select class="inp" data-cch="format" ${ed ? '' : 'disabled'}>${fmts.map(f => `<option value="${f}" ${p.format === f ? 'selected' : ''}>${FMT[f] || f}</option>`).join('')}</select></div>` : ''}
      ${this.fmtExtra(p, plats, ed)}
      <div>
        <div class="etabs"><button class="etab ${this.tab === 'all' ? 'on' : ''}" data-cact="etab" data-id="all">${ii('globe')} Todas as páginas</button>${sel.map(pg => `<button class="etab ${this.tab === pg.id ? 'on' : ''}" data-cact="etab" data-id="${pg.id}">${pfBadge(pg.platform, 'sm')}${esc(PLAT[pg.platform].n)}${p.custom?.[pg.id]?.on ? '<span class="cu" title="Personalizado"></span>' : ''}</button>`).join('')}</div>
        ${tabPage ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 0"><span class="tgl ${cust ? 'on' : ''}" data-cact="custom"><i></i>Personalizar para ${esc(tabPage.name)}</span><span class="muted">${cust ? 'Este texto só vai para esta página.' : 'Use o texto comum.'}</span></div>` : '<div style="height:8px"></div>'}
        <div class="ed drop" id="c-drop"><textarea id="ctext" placeholder="Escreva a sua publicação… (arraste imagens para aqui)" ${ed && (this.tab === 'all' || cust) ? '' : 'readonly'}>${esc(val)}</textarea>
          <div class="tb2"><button data-cact="emoji" title="Emoji">${ii('smile')}</button><button data-cact="hashtag" title="Hashtags">#</button><button data-cact="mentionp" title="Mencionar">@</button>${Store.sample ? `<button data-cact="aiopen" title="Assistente de escrita" style="color:#6d4fc2;font-weight:600">${I.spark.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"')} IA</button>` : ''}<span class="sp"></span><span class="limits" id="c-lim"></span></div></div>
      </div>
      <div class="fld"><label>Media <span class="muted" style="font-weight:400">· arraste para reordenar</span></label><div class="mthumbs" id="c-thumbs">${p.mediaIds.map((id, i) => { const m = mediaOf(id); return m ? `<div class="mth" draggable="${ed}" data-mi="${i}">${mTag(m)}<span class="ix">${i + 1}</span>${ed ? `<button class="rm" data-cact="mrm" data-i="${i}">×</button>` : ''}</div>` : ''; }).join('')}
        ${ed ? `<button class="madd imp" data-cact="upload"><b>+</b>Carregar</button><button class="madd" data-cact="library"><b>▦</b>Biblioteca</button>` : ''}</div>
        <input type="file" id="c-file" accept="image/*,video/*,application/pdf" multiple class="hidden"></div>
      ${fcPlat ? `<div class="fld"><label>Primeiro comentário <span class="muted" style="font-weight:400">(Instagram, LinkedIn, Facebook, YouTube)</span></label><input class="inp" data-cin="firstComment" value="${esc(p.firstComment || '')}" placeholder="Ex.: hashtags ou ligação" ${ed ? '' : 'readonly'}></div>` : ''}
      <div class="fld"><label>Data e hora <span class="muted" style="font-weight:400">· ${esc(ws.tz || Intl.DateTimeFormat().resolvedOptions().timeZone)}</span></label><div style="display:flex;gap:8px"><input type="date" class="inp" data-cch="day" value="${dv}" ${ed ? '' : 'disabled'}><input type="time" class="inp" data-cch="time" value="${tv}" style="width:130px" ${ed ? '' : 'disabled'}>${ed ? `<button class="btn sm" data-cact="besttime" title="Sugerir melhor hora" style="height:36px">⏱ Melhor hora</button>` : ''}</div>
        ${ed && p.date ? `<button class="morel" data-cact="nodate">Remover data</button>` : ''}</div>
      <div class="fld"><label>Etiquetas</label><div style="display:flex;flex-wrap:wrap;gap:6px">${(ws.labels || []).map(l => `<button class="chip ${p.labels.includes(l.id) ? 'on' : ''}" data-cact="tlabel" data-id="${l.id}" ${ed ? '' : 'disabled'}><span class="dot" style="background:${l.color};width:8px;height:8px"></span>${esc(l.name)}</button>`).join('')}${ed ? `<button class="chip" data-cact="newlabel">+ Nova</button>` : ''}</div></div>
      ${this.side === 'ai' && Store.sample ? '' : ''}`;
    this.updateLimits();
    const ta = $('#ctext');
    ta.addEventListener('input', () => {
      if (this.tab === 'all') this.post.text = ta.value; else if (this.post.custom?.[this.tab]?.on) this.post.custom[this.tab].text = ta.value;
      this.updateLimits(); this.renderPreview(); this.renderFoot();
    });
    const fi = $('#c-file'); fi.onchange = async () => { await this.addFiles([...fi.files]); fi.value = ''; };
    const dz = $('#c-drop');
    dz.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dz.classList.add('over'); } });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', async e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); dz.classList.remove('over'); await this.addFiles([...e.dataTransfer.files]); });
    let from = null; const th = $('#c-thumbs');
    th.addEventListener('dragstart', e => { const t = e.target.closest('.mth'); if (t) { from = +t.dataset.mi; e.dataTransfer.setData('text/x-mi', String(from)); e.stopPropagation(); } });
    th.addEventListener('dragover', e => { if (from !== null) e.preventDefault(); });
    th.addEventListener('drop', e => { const t = e.target.closest('.mth'); if (from === null || !t) return; e.preventDefault(); e.stopPropagation(); const to = +t.dataset.mi; const a = this.post.mediaIds; const [x] = a.splice(from, 1); a.splice(to, 0, x); from = null; this.renderEditor(); this.renderPreview(); this.renderFoot(); });
    th.addEventListener('dragend', () => from = null);
  },
  fmtExtra(p, plats, ed) {
    const dis = ed ? '' : 'disabled';
    if (plats.includes('linkedin') && p.format === 'poll') {
      const o = (p.poll && p.poll.opts) || ['', ''];
      return `<div class="fld"><label>Sondagem do LinkedIn <span class="muted" style="font-weight:400">· a pergunta é o texto da publicação</span></label>
        ${o.map((x, i) => `<div style="display:flex;gap:6px"><input class="inp" data-poll="${i}" maxlength="30" value="${esc(x)}" placeholder="Opção ${i + 1}" ${dis}>${o.length > 2 && ed ? `<button class="btn sm" data-cact="pollrm" data-i="${i}" style="height:36px">✕</button>` : ''}</div>`).join('')}
        <div style="display:flex;gap:8px;align-items:center">${o.length < 4 && ed ? '<button class="btn sm" data-cact="polladd">+ Opção</button>' : ''}<span class="muted">Duração</span><select class="inp" data-cch="polldur" style="width:auto" ${dis}>${[[1, '1 dia'], [3, '3 dias'], [7, '1 semana'], [14, '2 semanas']].map(([v, n]) => `<option value="${v}" ${((p.poll && p.poll.dur) || 7) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="muted">Os resultados das sondagens só aparecem nas páginas da empresa.</div></div>`;
    }
    if (plats.includes('linkedin') && p.format === 'document') return `<div class="fld"><label>Título do documento (LinkedIn)</label><input class="inp" data-cin="docTitle" value="${esc(p.docTitle || '')}" placeholder="Por omissão, o nome do PDF" ${ed ? '' : 'readonly'}><div class="muted">Carregue o PDF em “Media”; a pré-visualização mostra a primeira página.</div></div>`;
    let h = '';
    if (plats.includes('instagram') && p.format === 'reel') {
      const t = p.trial || {};
      h += `<div class="fld"><label>Reel de teste (Instagram)</label><span class="tgl ${t.on ? 'on' : ''}" ${ed ? 'data-cact="trial" data-k="on"' : ''}><i></i>Mostrar primeiro só a quem não segue a página</span>
        ${t.on ? `<span class="tgl ${t.auto ? 'on' : ''}" ${ed ? 'data-cact="trial" data-k="auto"' : ''}><i></i>Partilhar com os seguidores ao fim de 72 h se correr bem</span><span class="tgl ${t.grid !== false ? 'on' : ''}" ${ed ? 'data-cact="trial" data-k="grid"' : ''}><i></i>Mostrar na grelha do perfil</span>` : ''}</div>`;
    }
    if ((plats.includes('instagram') && p.format === 'reel') || plats.includes('tiktok')) h += `<div class="fld"><label>Música <span class="muted" style="font-weight:400">· nome da faixa a escolher na app da rede ao publicar</span></label><input class="inp" data-cin="music" value="${esc(p.music || '')}" placeholder="Ex.: som original — EPISJ" ${ed ? '' : 'readonly'}></div>`;
    return h;
  },
  updateLimits() {
    const ws = this.ws(), p = this.post, el = $('#c-lim'); if (!el) return;
    const pages = this.tab === 'all' ? p.pageIds : [this.tab];
    const seen = {};
    el.innerHTML = pages.map(id => pageOf(ws, id)).filter(Boolean).filter(pg => { if (seen[pg.platform]) return false; seen[pg.platform] = 1; return true; }).map(pg => {
      const l = textFor(p, pg.id).length, lim = PLAT[pg.platform].lim; const over = l > lim;
      return lim >= 100000 ? '' : `<span class="lim ${over ? 'over' : ''}" title="${esc(PLAT[pg.platform].n)}">${pfBadge(pg.platform, 'sm')}${over ? '−' + (l - lim) : lim - l}</span>`;
    }).join('');
  },
  renderPreview() {
    const ws = this.ws(), p = this.post, el = $('#c-pv'); if (!el) return;
    if (!p.pageIds.includes(this.pv)) this.pv = p.pageIds[0] || null;
    const hasMedia = p.mediaIds.length > 0;
    el.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;width:100%;align-items:center">${p.pageIds.map(id => { const pg = pageOf(ws, id); return pg ? `<button class="ptab ${this.pv === id ? 'on' : ''}" data-cact="pv" data-id="${id}">${pfBadge(pg.platform, 'sm')}${esc(pg.name)}</button>` : ''; }).join('')}
      ${hasMedia && !Store.readOnly ? `<button class="btn sm ${this.annot ? 'pri' : ''}" data-cact="annot" style="margin-left:8px">${ii('pin')} ${this.annot ? 'A anotar — clique na imagem' : 'Anotar imagem'}</button>` : ''}</div>
      <div class="${this.annot ? 'annot-on' : ''}" id="c-pvbox" style="width:100%;display:flex;justify-content:center">${preview(p, this.pv, { pins: true })}</div>
      <div class="muted" style="text-align:center;max-width:460px">Pré-visualização aproximada. ${Act.problems(p).map(esc).join(' ')}</div>`;
    const box = $('#c-pvbox');
    box.addEventListener('click', e => {
      if (!this.annot) return;
      const md = e.target.closest('[data-annot]'); if (!md || e.target.closest('.pin-dot,.cnav')) return;
      e.preventDefault(); e.stopPropagation();
      const r = md.getBoundingClientRect();
      this.pendingAnnot = { mediaId: md.dataset.annot, x: Math.round((e.clientX - r.left) / r.width * 1000) / 10, y: Math.round((e.clientY - r.top) / r.height * 1000) / 10 };
      this.annot = false; this.side = 'comments'; this.renderPreview(); this.renderSide();
      const ci = $('#c-cin'); if (ci) ci.focus();
    }, true);
  },
  renderSide() {
    const ws = this.ws(), p = this.post, el = $('#c-side'); if (!el) return;
    const hideInternal = role(ws) === 'aprovador';
    const cs = (p.comments || []).filter(c => !(hideInternal && c.internal));
    const annIdx = c => (p.comments || []).filter(x => x.mediaId).indexOf(c) + 1;
    let body = '';
    if (this.side === 'comments') {
      body = `<div class="clist" id="c-clist">${cs.map(c => `<div class="cm ${c.internal ? 'int' : ''} ${c.resolved ? 'res' : ''}" id="cm-${c.id}">${avatar(c.by, 'sm')}<div class="bd"><div class="bx"><div class="who">${esc(Store.name(c.by))}<span class="tm">${ago(c.at)}</span>${c.internal ? '<span class="tm">· ' + ii('lock') + ' interno</span>' : ''}</div><div class="txt">${c.mediaId ? `<span class="pn">${annIdx(c)}</span>` : ''}${esc(c.text).replace(/@([\p{L}][\p{L}\s]{0,30}?)(?=[\s.,!?]|$)/gu, '<span class="mn">@$1</span>')}</div></div>
        <div class="ca">${!Store.readOnly ? `<button data-cact="resolve" data-id="${c.id}">${c.resolved ? 'Reabrir' : 'Resolver'}</button>${c.by === Store.me || canAdmin(ws) ? `<button data-cact="delc" data-id="${c.id}">Eliminar</button>` : ''}` : ''}</div></div></div>`).join('') || `<div class="empty" style="padding:30px 10px">Sem comentários.<br>Deixe feedback, faça perguntas ou anote a imagem.</div>`}</div>
        ${!Store.readOnly ? `<div class="cin">${this.pendingAnnot ? `<div class="muted">${ii('pin')} Comentário na imagem (${this.pendingAnnot.x}%, ${this.pendingAnnot.y}%) <button class="morel" data-cact="cancelannot">cancelar</button></div>` : ''}<textarea id="c-cin" placeholder="Comentar… use @ para mencionar"></textarea><div class="r">${!hideInternal ? `<span class="tgl ${this.internal ? 'on' : ''}" data-cact="internal"><i></i>Interno</span>` : ''}<button class="btn sm ghost" data-cact="mention">@</button><div style="flex:1"></div><button class="btn pri sm" data-cact="send">Comentar</button></div></div>` : ''}`;
    } else if (this.side === 'activity') {
      const st = apState(p, ws);
      body = `<div class="clist">${pubHTML(p) ? `<div class="card" style="padding:10px"><b style="font-size:13px">Publicação nas redes</b><div style="margin-top:6px">${pubHTML(p)}</div></div>` : ''}${st.total ? `<div class="card" style="padding:10px"><b style="font-size:13px">Aprovações (${st.done}/${st.total})</b>${st.ss.map((s, i) => { const a = (p.approvals || []).find(x => x.step === s.id); return `<div class="step" style="margin-top:6px;background:${a ? '#e3f6e3' : 'var(--bg)'}"><span class="n" style="${a ? 'background:var(--ok)' : ''}">${a ? '✓' : i + 1}</span><div style="flex:1"><div style="font-weight:600;font-size:12.5px">${esc(s.name)}</div><div class="muted">${a ? 'por ' + esc(Store.name(a.by)) + ' · ' + ago(a.at) : s.approver ? 'aguarda ' + esc(Store.name(s.approver)) : 'qualquer membro'}</div></div></div>`; }).join('')}</div>` : ''}
        ${[...(p.history || [])].reverse().map(h => `<div class="hist">${avatar(h.by, 'sm')}<div><b>${esc(Store.name(h.by))}</b> ${esc(h.what)}<div class="tm">${fmtDT(h.at)}</div></div></div>`).join('') || '<div class="muted">Sem atividade ainda.</div>'}</div>`;
    } else if (this.side === 'ai') {
      body = `<div class="clist"><div class="aibox"><b style="font-size:13px">${I.spark.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px;color:#6d4fc2"')} Assistente de escrita</b>
        <textarea class="inp" id="ai-q" rows="3" placeholder="Ex.: legenda para o lançamento do nosso novo bolo, tom alegre"></textarea>
        <div class="qa">${[['write', 'Escrever'], ['short', 'Encurtar'], ['long', 'Desenvolver'], ['pro', 'Tom profissional'], ['fun', 'Tom descontraído'], ['emoji', 'Emojis'], ['tags', 'Hashtags'], ['fix', 'Corrigir'], ['en', 'Em inglês'], ['adapt', 'Adaptar a cada rede']].map(([k, n]) => `<button class="chip" data-cact="ai" data-v="${k}" ${this.ai.busy ? 'disabled' : ''}>${n}</button>`).join('')}</div>
        ${this.ai.busy ? `<div class="muted"><span class="spin" style="width:12px;height:12px;vertical-align:-2px"></span> A escrever… <button class="morel" data-cact="aistop">parar</button></div>` : ''}
        ${this.ai.out ? `<div class="aiout" id="ai-out">${esc(this.ai.out)}</div>${!this.ai.busy ? `<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn pri sm" data-cact="aiuse" data-v="replace">Substituir texto</button><button class="btn sm" data-cact="aiuse" data-v="append">Acrescentar</button><button class="btn sm" data-cact="aiuse" data-v="copy">Copiar</button></div>` : ''}` : ''}
        <div class="muted">O texto é gerado pelo Claude e aplica-se ao separador aberto no editor.</div></div></div>`;
    }
    const nC = cs.filter(c => !c.resolved).length;
    el.innerHTML = `<div class="ctabs"><button class="${this.side === 'comments' ? 'on' : ''}" data-cact="side" data-v="comments">Comentários${nC ? ' (' + nC + ')' : ''}</button><button class="${this.side === 'activity' ? 'on' : ''}" data-cact="side" data-v="activity">Atividade</button>${Store.sample && canEdit(ws) ? `<button class="${this.side === 'ai' ? 'on' : ''}" data-cact="side" data-v="ai">${ii('spark')} IA</button>` : ''}</div>${body}`;
    const ci = $('#c-cin'); if (ci) ci.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.sendComment(); } });
    const cl = $('#c-clist'); if (cl) cl.scrollTop = cl.scrollHeight;
  },
  renderFoot() {
    const ws = this.ws(), p = this.post, el = $('#c-foot'); if (!el) return;
    const ed = canEdit(ws); const st = apState(p, ws); const pub = p.status === 'published';
    const L = [];
    if (!this.isNew && ed) L.push(`<button class="btn ghost sm bad" data-cact="delete">Eliminar</button>`, `<button class="btn ghost sm" data-cact="dup">Duplicar</button>`, `<button class="btn ghost sm" data-cact="tpl">Guardar como modelo</button>`);
    if (!this.isNew) L.push(`<button class="btn ghost sm" data-cact="link">${ii('link')} Copiar ligação</button>`);
    const R = [];
    if (pub) R.push(`<span class="muted">Publicada ${p.publishedAt ? ago(p.publishedAt) : ''}${Store.mode === 'sb' ? '' : ' (envio simulado)'}</span>`);
    else if (p.status === 'publishing') R.push('<span class="muted">A publicar… (o servidor trata disto; pode fechar)</span>');
    else if (p.status === 'failed' && ed) { R.push(`<button class="btn" data-cact="markpub">Marcar como publicada</button>`, `<button class="btn" data-cact="save" ${this.dirty() ? '' : 'disabled'}>Guardar</button>`, `<button class="btn pri" data-cact="retry">Tentar outra vez</button>`); }
    else {
      if (ed) R.push(`<button class="btn" data-cact="save" ${this.dirty() || this.isNew ? '' : 'disabled'}>${this.isNew ? 'Guardar rascunho' : 'Guardar'}</button>`);
      if (canApprove(p, ws) && p.status === 'review') R.push(`<button class="btn" data-cact="reject">Pedir alterações</button>`, `<button class="btn ok" data-cact="approve">${I.check} Aprovar${st.total > 1 ? ` · passo ${st.done + 1}/${st.total}` : ''}</button>`);
      else if (canApprove(p, ws) && ['draft', 'changes'].includes(p.status) && !ed) R.push(`<button class="btn ok" data-cact="approve">${I.check} Aprovar</button>`);
      if (ed && ['draft', 'changes'].includes(p.status) && st.total) R.push(`<button class="btn" data-cact="reqap">Pedir aprovação</button>`);
      if (ed && p.status === 'scheduled') R.push(`<button class="btn" data-cact="unsched">Cancelar agendamento</button>`);
      if (ed && p.status !== 'scheduled') {
        const blocked = needsApproval(ws) && !st.full;
        R.push(`<div style="display:flex"><button class="btn pri" data-cact="sched" style="border-radius:8px 0 0 8px">${blocked ? (p.autoSchedule ? 'Agenda ao aprovar ✓' : 'Agendar após aprovação') : 'Agendar'}</button><button class="btn pri" data-cact="schedmenu" style="border-radius:0 8px 8px 0;border-left:1px solid rgba(255,255,255,.35);padding:0 8px">▾</button></div>`);
      }
    }
    el.innerHTML = L.join('') + '<div class="sp"></div>' + R.join('');
  },

  /* ---------- ações ---------- */
  async addFiles(files) {
    const ws = this.ws(); if (!files.length) return;
    const ms = await Media.upload(files, ws);
    ms.forEach(m => this.post.mediaIds.push(m.id));
    this.renderEditor(); this.renderPreview(); this.renderFoot();
  },
  sendComment() {
    const ta = $('#c-cin'); const t = ta.value.trim(); if (!t) return;
    const ws = this.ws();
    if (!S.posts[this.post.id]) this.commit(true);
    const p = Act.comment(S.posts[this.post.id], t, this.internal && role(ws) !== 'aprovador', this.pendingAnnot || {});
    this.post.comments = clone(p.comments); this.pendingAnnot = null;
    this.renderSide(); this.renderPreview(); render();
  },
  async aiRun(kind) {
    const s = Store.sample; if (!s) return;
    const ws = this.ws(), p = this.post;
    const cur = this.tab === 'all' ? p.text : textFor(p, this.tab);
    const q = ($('#ai-q')?.value || '').trim();
    const nets = p.pageIds.map(id => pageOf(ws, id)).filter(Boolean).map(pg => PLAT[pg.platform].n).join(', ') || 'redes sociais';
    const base = `És um gestor de redes sociais experiente. Escreves em português europeu (pt-PT), nunca em português do Brasil. Marca: "${ws.name}". Redes: ${nets}. Formato: ${FMT[p.format] || 'publicação'}. Responde APENAS com o texto final da publicação, sem aspas, sem explicações.`;
    const tasks = {
      write: `Escreva uma legenda nova. Pedido: ${q || 'uma publicação apelativa sobre a marca'}.${cur ? '\nTexto atual para contexto:\n' + cur : ''}`,
      short: `Encurta este texto mantendo a mensagem principal:\n${cur}`,
      long: `Desenvolve este texto com mais detalhe e um apelo à ação:\n${cur}`,
      pro: `Reescreve num tom profissional e confiante:\n${cur}`,
      fun: `Reescreve num tom descontraído e próximo:\n${cur}`,
      emoji: `Acrescenta emojis adequados a este texto, sem exagerar, mantendo as palavras:\n${cur}`,
      tags: `Sugere 6 a 10 hashtags relevantes para este texto. Responde só com as hashtags numa linha:\n${cur}`,
      fix: `Corrige ortografia, pontuação e gramática deste texto sem mudar o estilo:\n${cur}`,
      en: `Traduz para inglês natural, mantendo emojis e hashtags:\n${cur}`
    };
    if (!cur && kind !== 'write') { toast('Escreva primeiro algum texto, ou use “Escrever”.'); return; }
    this.ai.busy = true; this.ai.out = ''; this.ai.ctrl = new AbortController(); this.renderSide();
    try {
      if (kind === 'adapt') {
        const pages = p.pageIds.map(id => pageOf(ws, id)).filter(Boolean);
        const spec = pages.map(pg => `- "${pg.id}": ${PLAT[pg.platform].n} (máx. ${PLAT[pg.platform].lim} caracteres)`).join('\n');
        const res = await s.json(`${base}\nAdapta o texto abaixo a cada rede, respeitando o estilo e o limite de cada uma. Devolve um objeto JSON cujas chaves são os ids indicados e os valores são o texto adaptado.\nRedes:\n${spec}\n\nTexto:\n${cur}`, { signal: this.ai.ctrl.signal });
        let n = 0;
        pages.forEach(pg => { if (res && typeof res[pg.id] === 'string') { p.custom = p.custom || {}; p.custom[pg.id] = { on: true, text: res[pg.id] }; n++; } });
        this.ai.out = n ? `Adaptado para ${n} página${n > 1 ? 's' : ''}. Veja os separadores de cada rede no editor.` : 'Não foi possível adaptar.';
        this.renderEditor(); this.renderPreview(); this.renderFoot();
      } else {
        const r = await s(base + '\n\n' + tasks[kind], { signal: this.ai.ctrl.signal, cache: false, onText: ({ text }) => { this.ai.out = text; const o = $('#ai-out'); if (o) o.textContent = text; else this.renderSide(); } });
        this.ai.out = (r && r.text || this.ai.out || '').trim();
      }
    } catch (e) {
      if (e && e.code === 'not_granted') { Store.sample = null; toast('O assistente de escrita não está disponível aqui.'); this.side = 'comments'; }
      else if (e && e.code === 'rate_limited') toast('Muitos pedidos seguidos — espere um pouco.', 'err');
      else if (e && e.name !== 'AbortError') toast('O assistente não respondeu' + (e && e.message ? ': ' + e.message : '.'), 'err');
    }
    this.ai.busy = false; this.ai.ctrl = null; this.renderSide(); this.renderEditor();
  },
  setText(t, mode) {
    const p = this.post;
    if (this.tab === 'all') p.text = mode === 'append' ? (p.text ? p.text + '\n\n' : '') + t : t;
    else { p.custom = p.custom || {}; const c = p.custom[this.tab] || { on: true, text: p.text }; c.on = true; c.text = mode === 'append' ? (c.text ? c.text + '\n\n' : '') + t : t; p.custom[this.tab] = c; }
    this.renderEditor(); this.renderPreview(); this.renderFoot();
  },
  insertAt(str) {
    const ta = $('#ctext'); if (!ta || ta.readOnly) return;
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    ta.value = ta.value.slice(0, s) + str + ta.value.slice(e); ta.selectionStart = ta.selectionEnd = s + str.length; ta.focus();
    ta.dispatchEvent(new Event('input'));
  }
};

const CA = {
  close: () => Comp.close(),
  toggleside: () => $('#comp').classList.toggle('showc'),
  tpage(el) { const a = Comp.post.pageIds, id = el.dataset.id; const i = a.indexOf(id); if (i >= 0) a.splice(i, 1); else a.push(id); if (!a.includes(Comp.tab)) Comp.tab = 'all'; Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot(); },
  etab(el) { Comp.tab = el.dataset.id; if (Comp.tab !== 'all') Comp.pv = Comp.tab; Comp.renderEditor(); Comp.renderPreview(); },
  custom() {
    const p = Comp.post; p.custom = p.custom || {}; const c = p.custom[Comp.tab];
    if (c?.on) { c.on = false; } else p.custom[Comp.tab] = { on: true, text: c?.text ?? p.text };
    Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot();
  },
  pv(el) { Comp.pv = el.dataset.id; Comp.renderPreview(); },
  emoji(el) { openPop(el, `<div class="emo">${EMOJIS.map(e => `<button data-v="${e}">${e}</button>`).join('')}</div>`, v => { Comp.insertAt(v); return true; }); },
  hashtag(el) {
    const tags = {}; wsPosts(Comp.ws()).forEach(p => ((p.text || '').match(/#[\p{L}\p{N}_]+/gu) || []).forEach(t => tags[t] = (tags[t] || 0) + 1));
    const l = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 14);
    openPop(el, `<div class="ph">Hashtags usadas neste espaço</div>${l.map(([t, n]) => `<button class="pi" data-v="${esc(t)}">${esc(t)} <span class="muted" style="margin-left:auto">${n}</span></button>`).join('') || '<div class="muted" style="padding:8px">Ainda sem hashtags.</div>'}<hr><button class="pi" data-v="#">Escrever #…</button>`, v => { Comp.insertAt((v === '#' ? '#' : ' ' + v)); });
  },
  mentionp(el) { const ws = Comp.ws(); const pg = Comp.post.pageIds.map(id => pageOf(ws, id)).filter(Boolean); openPop(el, `<div class="ph">Mencionar página</div>${ws.pages.map(x => `<button class="pi" data-v="@${esc(x.handle || x.name)}">${pfBadge(x.platform, 'sm')} @${esc(x.handle || x.name)}</button>`).join('')}<hr><button class="pi" data-v="@">Escrever @…</button>`, v => Comp.insertAt(v + (v === '@' ? '' : ' '))); },
  aiopen() { Comp.side = 'ai'; Comp.renderSide(); $('#comp').classList.add('showc'); setTimeout(() => $('#ai-q')?.focus(), 30); },
  ai(el) { Comp.aiRun(el.dataset.v); },
  aistop() { if (Comp.ai.ctrl) Comp.ai.ctrl.abort(); },
  aiuse(el) { const v = el.dataset.v; if (v === 'copy') copyText(Comp.ai.out); else Comp.setText(Comp.ai.out, v); },
  upload() { $('#c-file').click(); },
  library(el) {
    const ws = Comp.ws(); const ms = Store.all('media').filter(m => m.ws === ws.id).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const p = openPop(el, `<div class="ph">Biblioteca de media</div><div style="display:grid;grid-template-columns:repeat(4,80px);gap:6px;padding:4px">${ms.map(m => `<button data-v="${m.id}" style="border:2px solid ${Comp.post.mediaIds.includes(m.id) ? 'var(--acc)' : 'transparent'};padding:0;border-radius:8px;overflow:hidden;width:80px;height:80px;background:var(--bg)">${mTag(m, '', 'style="width:100%;height:100%;object-fit:cover"')}</button>`).join('') || '<div class="muted" style="grid-column:1/-1;padding:10px">A biblioteca está vazia.</div>'}</div>`, v => {
      const a = Comp.post.mediaIds; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v);
      Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot(); return false;
    });
  },
  mrm(el) { Comp.post.mediaIds.splice(+el.dataset.i, 1); Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot(); },
  tlabel(el) { const a = Comp.post.labels, id = el.dataset.id; const i = a.indexOf(id); if (i >= 0) a.splice(i, 1); else a.push(id); Comp.renderEditor(); Comp.renderFoot(); },
  polladd() { const p = Comp.post; p.poll = p.poll || { opts: ['', ''], dur: 7 }; if (p.poll.opts.length < 4) p.poll.opts.push(''); Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot(); },
  pollrm(el) { const p = Comp.post; p.poll.opts.splice(+el.dataset.i, 1); Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot(); },
  trial(el) { const p = Comp.post; p.trial = Object.assign({ on: false, auto: false, grid: true }, p.trial || {}); const k = el.dataset.k; p.trial[k] = k === 'grid' ? p.trial.grid === false : !p.trial[k]; Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot(); },
  newlabel() { labelDialog(Comp.ws(), null, l => { Comp.post.labels.push(l.id); Comp.renderEditor(); Comp.renderFoot(); }); },
  besttime(el) {
    const best = Analytics.bestTimes(Comp.ws());
    openPop(el, `<div class="ph">Melhores horas (pelo histórico)</div>${best.map(b => `<button class="pi" data-v="${b.h}">${b.label}</button>`).join('')}`, v => {
      const d = Comp.post.date ? new Date(Comp.post.date) : new Date(); const [h, m] = v.split(':'); d.setHours(+h, +m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1);
      Comp.post.date = d.toISOString(); Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot();
    });
  },
  nodate() { Comp.post.date = null; Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot(); },
  annot() { Comp.annot = !Comp.annot; Comp.renderPreview(); },
  cancelannot() { Comp.pendingAnnot = null; Comp.renderSide(); },
  side(el) { Comp.side = el.dataset.v; Comp.renderSide(); },
  internal(el) { Comp.internal = !Comp.internal; el.classList.toggle('on', Comp.internal); },
  mention(el) {
    const ws = Comp.ws();
    const ids = [...new Set([...(ws.members || []).map(m => m.id), Store.me])];
    openPop(el, `<div class="ph">Mencionar</div>${ids.map(id => `<button class="pi" data-v="${esc(Store.name(id))}">${avatar(id, 'sm')} ${esc(Store.name(id))}</button>`).join('')}`, v => {
      const ta = $('#c-cin'); ta.value += (ta.value && !ta.value.endsWith(' ') ? ' ' : '') + '@' + v + ' '; ta.focus();
    });
  },
  send() { Comp.sendComment(); },
  resolve(el) { const p = clone(S.posts[Comp.post.id] || Comp.post); const c = p.comments.find(x => x.id === el.dataset.id); if (!c) return; c.resolved = !c.resolved; hist(p, c.resolved ? 'resolveu um comentário' : 'reabriu um comentário'); Store.put('posts', p); Comp.post.comments = clone(p.comments); Comp.post.history = clone(p.history); Comp.renderSide(); Comp.renderPreview(); },
  delc(el) { const p = clone(S.posts[Comp.post.id] || Comp.post); p.comments = p.comments.filter(x => x.id !== el.dataset.id); Store.put('posts', p); Comp.post.comments = clone(p.comments); Comp.renderSide(); Comp.renderPreview(); },
  save() { Comp.commit(); toast('Guardado.'); Comp.renderAll(); try { history.replaceState(null, '', '#post-' + Comp.post.id); } catch (e) {} },
  reqap() { Comp.run(p => Act.requestApproval(p)); },
  approve() { Comp.run(p => Act.approve(p)); },
  reject() { const p = Comp.commit(true); Act.askReject(p, r => { if (r) { Comp.post = clone(r); Comp.orig = Comp.sig(); Comp.renderAll(); } }); },
  sched() { Comp.run(p => { const r = Act.schedule(p); return r; }); if (S.posts[Comp.post.id]?.status === 'scheduled') Comp.close(true); },
  schedmenu(el) {
    const ws = Comp.ws(); const st = apState(Comp.post, ws);
    openPop(el, `<button class="pi" data-v="now" ${needsApproval(ws) && !st.full ? 'disabled style="opacity:.4"' : ''}>${ii('zap')} Publicar agora</button><button class="pi" data-v="sched">${ii('cal')} Agendar para a data escolhida</button><hr><button class="pi" data-v="draft">${ii('save')} Guardar como rascunho</button>`, v => {
      if (v === 'now') { if (needsApproval(ws) && !st.full) { toast('Precisa de aprovação primeiro.', 'err'); return; } Comp.run(p => Act.publishNow(p)); }
      if (v === 'sched') CA.sched();
      if (v === 'draft') CA.save();
    }, { alignRight: true });
  },
  unsched() { Comp.run(p => Act.unschedule(p)); },
  retry() { Comp.run(p => Act.retry(p)); },
  markpub() { Comp.run(p => Act.markPublished(p)); },
  delete() { const p = S.posts[Comp.post.id]; Comp.close(true); if (p) Act.remove(p); },
  dup() { const p = Comp.commit(true); const n = Act.duplicate(p); toast('Duplicada.'); Comp.close(true); Comp.start(n); },
  tpl() {
    const p = Comp.commit(true);
    dialog({ title: 'Guardar como modelo', ok: 'Guardar', body: `<div class="fld"><label>Nome do modelo</label><input class="inp" id="tn" value="${esc((p.text || 'Modelo').split('\n')[0].slice(0, 40))}"></div>`, onOk: ov => { Store.put('templates', { id: uid('t'), ws: p.ws, name: $('#tn', ov).value.trim() || 'Modelo', text: p.text, custom: p.custom, pageIds: p.pageIds, labels: p.labels, mediaIds: p.mediaIds, format: p.format, createdBy: Store.me, createdAt: nowISO() }); toast('Modelo guardado.'); } });
  },
  link() { shareDialog(Comp.post); }
};
document.addEventListener('change', e => {
  const t = e.target; if (!Comp.open || !t.closest('#comp')) return;
  const k = t.dataset.cch; if (!k) return;
  const p = Comp.post;
  if (k === 'format') { p.format = t.value; if (t.value === 'poll' && !p.poll) p.poll = { opts: ['', ''], dur: 7 }; }
  if (k === 'polldur') { p.poll = p.poll || { opts: ['', ''] }; p.poll.dur = +t.value; }
  if (k === 'day' || k === 'time') {
    const day = $('[data-cch="day"]').value, tm = $('[data-cch="time"]').value || '10:00';
    if (day) { const [y, m, d] = day.split('-').map(Number); const [h, mi] = tm.split(':').map(Number); p.date = new Date(y, m - 1, d, h, mi).toISOString(); } else p.date = null;
  }
  Comp.renderEditor(); Comp.renderPreview(); Comp.renderFoot();
});
document.addEventListener('input', e => {
  const t = e.target; if (!Comp.open) return;
  if (t.dataset.poll !== undefined) { const p = Comp.post; p.poll = p.poll || { opts: ['', ''], dur: 7 }; p.poll.opts[+t.dataset.poll] = t.value; Comp.renderPreview(); Comp.renderFoot(); return; }
  if (!t.dataset.cin) return;
  Comp.post[t.dataset.cin] = t.value; Comp.renderPreview(); Comp.renderFoot();
});
