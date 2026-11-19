// EPISJ 360 · Social360 — publicador agendado (Facebook e Instagram pela API oficial da Meta)
// Função do Supabase «s360-publicar», chamada a cada minuto pela tarefa «episj360-s360-publicar» (pg_cron).
// Publica as publicações «Agendado» cuja hora chegou, nas páginas ligadas à Meta. As outras redes ficam «por publicar à mão».
// Nunca apaga nada: só escreve o estado da publicação (status, pub, publishedAt, history) no documento da publicação.
const VER = Deno.env.get("META_GRAPH_VER") || "v23.0";
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!, SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };
let T0 = Date.now(); const ORCAMENTO = 45000; // corre a cada minuto: pára de começar trabalho novo aos 45 s, para as execuções não se sobreporem
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class GErro extends Error { code: number; sub: number; constructor(e: any) { super(e?.error_user_msg || e?.message || "erro do Facebook"); this.code = +e?.code || 0; this.sub = +e?.error_subcode || 0; } }
async function g(path: string, params: Record<string, string>, metodo = "POST") {
  const corpo = new URLSearchParams(params);
  const u = `https://graph.facebook.com/${VER}/${path}`;
  const r = metodo === "GET" ? await fetch(`${u}?${corpo}`) : await fetch(u, { method: "POST", body: corpo });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new GErro(j.error || { message: `Facebook respondeu ${r.status}` });
  return j;
}
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`base de dados ${r.status}: ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function assinado(caminho: string) {
  const r = await fetch(`${URL_}/storage/v1/object/sign/s360/${caminho.split("/").map(encodeURIComponent).join("/")}`, { method: "POST", headers: H, body: JSON.stringify({ expiresIn: 3 * 3600 }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) throw new Error("ficheiro não encontrado no armazenamento");
  return `${URL_}/storage/v1${j.signedURL}`;
}
const textoPara = (p: any, pageId: string) => { const c = p.custom?.[pageId]; return c && c.on !== false && typeof c.text === "string" ? c.text : (p.text || ""); };

type Res = { estado: "ok" | "erro" | "manual" | "aguarda"; id?: string; url?: string; erro?: string; container?: string; desde?: string; em?: string; rede?: string };

async function mediaDe(p: any) {
  const ids: string[] = p.mediaIds || [];
  if (!ids.length) return [];
  const rows = await rest(`s360_docs?col=eq.media&id=in.(${ids.map(i => `"${i}"`).join(",")})&select=id,dados`);
  const m = new Map((rows || []).map((r: any) => [r.id, r.dados]));
  return ids.map(i => m.get(i)).filter(Boolean) as any[];
}
async function urlDe(m: any) {
  if (m.kind === "image" && m.jpg) return assinado(m.jpg);
  if (m.storage) return assinado(m.storage);
  if (typeof m.url === "string" && /^https:\/\//.test(m.url)) return m.url;
  throw new Error(`«${m.name}» não está guardado no armazenamento da EPISJ 360 (carregue-o de novo)`);
}

async function publicarFacebook(p: any, conta: any, pageId: string, media: any[]): Promise<Res> {
  const tk = conta.page_token, fb = conta.fb_page_id, msg = textoPara(p, pageId);
  if (media.some(m => m.kind === "pdf")) throw new Error("O Facebook não aceita PDF como publicação.");
  let id = "";
  const vid = media.find(m => m.kind === "video");
  if (vid) {
    const j = await g(`${fb}/videos`, { file_url: await urlDe(vid), description: msg, access_token: tk });
    id = j.id; return { estado: "ok", id, url: `https://www.facebook.com/${fb}/videos/${id}` };
  }
  const imgs = media.filter(m => m.kind === "image");
  if (imgs.length === 1) {
    const j = await g(`${fb}/photos`, { url: await urlDe(imgs[0]), caption: msg, access_token: tk });
    id = j.post_id || j.id;
  } else if (imgs.length > 1) {
    const fotos: string[] = [];
    for (const m of imgs.slice(0, 10)) { const j = await g(`${fb}/photos`, { url: await urlDe(m), published: "false", access_token: tk }); fotos.push(j.id); }
    const pr: Record<string, string> = { message: msg, access_token: tk };
    fotos.forEach((f, i) => pr[`attached_media[${i}]`] = JSON.stringify({ media_fbid: f }));
    id = (await g(`${fb}/feed`, pr)).id;
  } else {
    if (!msg.trim()) throw new Error("Publicação vazia.");
    id = (await g(`${fb}/feed`, { message: msg, access_token: tk })).id;
  }
  if (p.firstComment) { try { await g(`${id}/comments`, { message: p.firstComment, access_token: tk }); } catch (_) { /* o primeiro comentário não impede a publicação */ } }
  return { estado: "ok", id, url: `https://www.facebook.com/${id}` };
}

async function esperar(container: string, tk: string, ms: number) {
  const fim = Date.now() + ms;
  while (true) {
    const j = await g(container, { fields: "status_code,status", access_token: tk }, "GET");
    if (j.status_code === "FINISHED" || j.status_code === "PUBLISHED") return "ok";
    if (j.status_code === "ERROR" || j.status_code === "EXPIRED") throw new Error(`O Instagram recusou o ficheiro (${j.status || j.status_code}).`);
    if (Date.now() > fim || Date.now() - T0 > ORCAMENTO) return "aguarda";
    await sleep(3000);
  }
}
async function igPublicar(p: any, conta: any, container: string): Promise<Res> {
  const tk = conta.page_token, ig = conta.ig_user_id;
  const j = await g(`${ig}/media_publish`, { creation_id: container, access_token: tk });
  let url = "";
  try { url = (await g(j.id, { fields: "permalink", access_token: tk }, "GET")).permalink || ""; } catch (_) { /* sem ligação permanente */ }
  if (p.firstComment) { try { await g(`${j.id}/comments`, { message: p.firstComment, access_token: tk }); } catch (_) { /* idem */ } }
  return { estado: "ok", id: j.id, url };
}
async function publicarInstagram(p: any, conta: any, pageId: string, media: any[]): Promise<Res> {
  const tk = conta.page_token, ig = conta.ig_user_id, legenda = textoPara(p, pageId);
  if (!ig) throw new Error("Esta página do Facebook não tem conta profissional do Instagram associada.");
  const ms = media.filter(m => m.kind === "image" || m.kind === "video");
  if (!ms.length) throw new Error("O Instagram precisa de uma imagem ou vídeo.");
  let container = "";
  if (p.format === "story") {
    const m = ms[0];
    const sc: Record<string, string> = m.kind === "video" ? { media_type: "STORIES", video_url: await urlDe(m), access_token: tk } : { media_type: "STORIES", image_url: await urlDe(m), access_token: tk };
    container = (await g(`${ig}/media`, sc)).id;
  } else if (ms.length > 1) {
    const filhos: string[] = [];
    for (const m of ms.slice(0, 10)) {
      const c: Record<string, string> = m.kind === "video" ? { media_type: "VIDEO", video_url: await urlDe(m), is_carousel_item: "true", access_token: tk } : { image_url: await urlDe(m), is_carousel_item: "true", access_token: tk };
      const id = (await g(`${ig}/media`, c)).id; filhos.push(id);
      if (m.kind === "video") { const e = await esperar(id, tk, 60000); if (e !== "ok") throw new Error("O vídeo do carrossel demorou demasiado a processar; tente outra vez daqui a pouco."); }
    }
    container = (await g(`${ig}/media`, { media_type: "CAROUSEL", children: filhos.join(","), caption: legenda, access_token: tk })).id;
  } else if (ms[0].kind === "video") {
    const c: Record<string, string> = { media_type: "REELS", video_url: await urlDe(ms[0]), caption: legenda, share_to_feed: "true", access_token: tk };
    if (p.format === "reel" && p.trial?.on) c.trial_params = JSON.stringify({ graduation_strategy: p.trial.auto ? "SS_PERFORMANCE" : "MANUAL" });
    container = (await g(`${ig}/media`, c)).id;
  } else {
    container = (await g(`${ig}/media`, { image_url: await urlDe(ms[0]), caption: legenda, access_token: tk })).id;
  }
  const e = await esperar(container, tk, ms.some(m => m.kind === "video") ? 25000 : 20000);
  if (e === "aguarda") return { estado: "aguarda", container, desde: new Date().toISOString() };
  return igPublicar(p, conta, container);
}

async function contaDe(ws: string, fb: string) {
  const r = await rest(`s360_meta?ws=eq.${encodeURIComponent(ws)}&fb_page_id=eq.${encodeURIComponent(fb)}&select=*`);
  return r && r[0];
}
async function marcarConta(ws: string, fb: string, erro: string) {
  await rest(`s360_meta?ws=eq.${encodeURIComponent(ws)}&fb_page_id=eq.${encodeURIComponent(fb)}`, { method: "PATCH", body: JSON.stringify({ estado: "expirada", erro }) }).catch(() => {});
}

// guarda o progresso depois de cada página: se a execução parar a meio, a seguinte não publica duas vezes
async function parcial(id: string, pub: Record<string, Res>) {
  const r = await rest(`s360_docs?col=eq.posts&id=eq.${encodeURIComponent(id)}&select=dados`).catch(() => null);
  if (!r || !r[0]) return; const d = r[0].dados; d.pub = pub;
  await rest(`s360_docs?col=eq.posts&id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ dados: d, t: Date.now(), por: "servidor#pub" }) }).catch(() => {});
}
async function tratar(p: any, wsDoc: any) {
  const pub: Record<string, Res> = { ...(p.pub || {}) };
  const media = await mediaDe(p);
  for (const pageId of p.pageIds || []) {
    if (pub[pageId]?.estado === "ok" || pub[pageId]?.estado === "manual") continue; // já tratada (nunca publica duas vezes)
    const pg = (wsDoc.pages || []).find((x: any) => x.id === pageId);
    if (!pg) continue;
    const em = new Date().toISOString();
    if (!["facebook", "instagram"].includes(pg.platform) || !pg.meta?.fb) { pub[pageId] = { estado: "manual", em, rede: pg.platform }; continue; }
    const conta = await contaDe(p.ws, pg.meta.fb);
    if (!conta) { pub[pageId] = { estado: "erro", erro: "A página já não está ligada à Meta. Volte a ligar em Definições → Páginas.", em, rede: pg.platform }; continue; }
    try {
      const atual = pub[pageId];
      if (atual?.estado === "aguarda" && atual.container) {
        const e = await esperar(atual.container, conta.page_token, 20000);
        if (e === "aguarda") {
          if (Date.now() - new Date(atual.desde || em).getTime() > 20 * 60000) pub[pageId] = { estado: "erro", erro: "O Instagram demorou mais de 20 minutos a processar o vídeo.", em, rede: pg.platform };
          continue;
        }
        pub[pageId] = { ...(await igPublicar(p, conta, atual.container)), em, rede: pg.platform };
      } else {
        pub[pageId] = { ...(pg.platform === "facebook" ? await publicarFacebook(p, conta, pageId, media) : await publicarInstagram(p, conta, pageId, media)), em, rede: pg.platform };
      }
    } catch (e) {
      const ge = e as GErro;
      if (ge.code === 190 || ge.code === 102 || ge.sub === 463 || ge.sub === 460) await marcarConta(p.ws, pg.meta.fb, ge.message);
      pub[pageId] = { estado: "erro", erro: ge.code === 190 ? "A autorização da Meta expirou ou foi retirada. Volte a ligar em Definições → Páginas." : ge.message, em, rede: pg.platform };
    }
    if (pub[pageId]?.estado === "ok" || pub[pageId]?.estado === "aguarda") await parcial(p.id, pub);
  }
  return pub;
}

async function gravar(id: string, pub: Record<string, Res>) {
  // relê para não apagar comentários ou alterações feitas entretanto
  const [row] = await rest(`s360_docs?col=eq.posts&id=eq.${encodeURIComponent(id)}&select=ws,dados`);
  if (!row) return null;
  const d = row.dados; d.pub = pub;
  const vals = Object.values(pub);
  const quando = new Date().toISOString();
  const nOk = vals.filter(v => v.estado === "ok").length, nErr = vals.filter(v => v.estado === "erro").length, nMan = vals.filter(v => v.estado === "manual").length;
  let txt = "";
  if (vals.some(v => v.estado === "aguarda")) { d.status = "publishing"; }
  else if (nErr) { d.status = "failed"; txt = `falhou a publicação em ${nErr} página(s)`; }
  else { d.status = "published"; d.publishedAt = quando; txt = nOk ? `publicou em ${nOk} página(s)${nMan ? `; ${nMan} por publicar à mão` : ""}` : "marcou como publicada (páginas sem ligação: publicar à mão)"; }
  delete d.pubInicio;
  if (txt) d.history = [...(d.history || []), { at: quando, by: "Social360 (servidor)", what: txt }].slice(-60);
  await rest(`s360_docs?col=eq.posts&id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ dados: d, t: Date.now(), por: "servidor#pub", atualizado: quando }) });
  if (txt) {
    const nid = (d.status === "failed" ? "pubfail-" : "pub-") + id;
    const n = { id: nid, ws: row.ws, text: d.status === "failed" ? `Falhou a publicação: "${String(d.text || "").slice(0, 60)}"` : `Publicada: "${String(d.text || "").slice(0, 60)}"`, postId: id, by: "servidor", to: "*", at: quando, readBy: [] };
    await rest(`s360_docs?on_conflict=col,id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ col: "notifs", id: nid, ws: row.ws, dados: n, t: Date.now(), por: "servidor#pub" }) }).catch(() => {});
  }
  return d.status;
}

Deno.serve(async (req) => {
  T0 = Date.now();
  // chave partilhada com a tarefa agendada (guardada só na base de dados)
  const cfg = await rest(`s360_cfg?k=eq.cron&select=v`).catch(() => []);
  if (!cfg?.[0]?.v || req.headers.get("x-s360-chave") !== cfg[0].v) return json({ ok: false }, 401);
  const feito: Record<string, string> = {};
  const wsCache = new Map<string, any>();
  const wsDe = async (ws: string) => { if (!wsCache.has(ws)) { const r = await rest(`s360_docs?col=eq.workspaces&id=eq.${encodeURIComponent(ws)}&select=dados`); wsCache.set(ws, r?.[0]?.dados || { pages: [] }); } return wsCache.get(ws); };
  // 1) as que ficaram a meio (vídeos do Instagram em processamento, ou uma execução que parou)
  const meio = await rest(`s360_docs?col=eq.posts&dados->>status=eq.publishing&select=id,ws,dados&limit=20`);
  for (const r of meio || []) {
    if (Date.now() - T0 > ORCAMENTO) break;
    const pend = Object.values(r.dados.pub || {}).some((v: any) => v.estado === "aguarda");
    const parada = !pend && Date.now() - new Date(r.dados.pubInicio || r.dados.updatedAt || 0).getTime() > 10 * 60000;
    if (!pend && !parada) continue;
    try { feito[r.id] = await gravar(r.id, await tratar(r.dados, await wsDe(r.ws))) || ""; } catch (e) { feito[r.id] = "erro: " + (e as Error).message; }
  }
  // 2) as novas que chegaram à hora
  while (Date.now() - T0 < ORCAMENTO) {
    const lote = await rest(`rpc/s360_reservar`, { method: "POST", body: JSON.stringify({ p_max: 5 }) });
    if (!lote || !lote.length) break;
    for (const r of lote) {
      try { feito[r.id] = await gravar(r.id, await tratar(r.dados, await wsDe(r.ws))) || ""; }
      catch (e) { feito[r.id] = "erro: " + (e as Error).message; }
    }
  }
  return json({ ok: true, feito });
});
