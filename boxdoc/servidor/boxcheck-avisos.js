/*
 * BoxCheck — serviço de avisos (Cloudflare Worker)
 * Envia os avisos dos prazos mesmo com o computador desligado.
 *
 * Como funciona:
 *  - A app BoxCheck envia para aqui o "plano" (prazos, avisos, formadores, documentos exigidos e
 *    os ficheiros que já estavam na Box na última análise).
 *  - De hora a hora (Cron Trigger), este serviço pergunta à Box o que mudou desde então
 *    (registo de alterações da Box: poucos pedidos), atualiza quem já entregou e envia pelo
 *    Office 365 os avisos que estiverem na hora — nunca duas vezes o mesmo.
 *  - Na Box, só LÊ (a aplicação da Box só tem permissão de leitura). Não altera nada.
 *
 * Variáveis e segredos (Settings › Variables and Secrets):
 *   BOX_CLIENT_ID, BOX_CLIENT_SECRET   — da aplicação da Box (a mesma do serviço de login)
 *   MS_TENANT, MS_CLIENT_ID, MS_CLIENT_SECRET — da aplicação "BoxCheck" no Entra (Office 365)
 *   APP_ORIGINS (opcional) — endereços da app separados por vírgulas
 * Ligação KV (Bindings): nome da variável  KV  → espaço "boxcheck"
 * Cron Trigger: 0 * * * *   (de hora a hora)
 */

const P = "avisos:";                       // prefixo das chaves no KV (não mexe no que o serviço de login lá guarda)
const ORIGENS_OMISSAO = "https://eduspruce.github.io,https://boxcheck.episj.pt";
const LIMITE_PEDIDOS = 45;                 // o plano gratuito da Cloudflare permite 50 pedidos por execução
const DIA = 864e5;

export default {
  async fetch(req, env) {
    const url = new URL(req.url), o = req.headers.get("Origin") || "";
    const okOrigens = (env.APP_ORIGINS || ORIGENS_OMISSAO).split(",").map(s => s.trim()).filter(Boolean);
    const cors = { "Access-Control-Allow-Origin": okOrigens.includes(o) ? o : okOrigens[0], "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" };
    const json = (obj, st = 200) => new Response(JSON.stringify(obj), { status: st, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    try {
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });
      if (url.pathname === "/" || url.pathname === "") return pagina("Serviço de avisos da BoxCheck", `<p>Este serviço envia os avisos dos prazos da BoxCheck.</p><p><a href="/ligar">Ligar a Box a este serviço</a></p>`);
      if (url.pathname === "/ligar") {
        if (!env.BOX_CLIENT_ID) return pagina("Falta configurar", "<p>Falta o segredo BOX_CLIENT_ID.</p>");
        const st = crypto.randomUUID();
        await env.KV.put(P + "oauth_state", st, { expirationTtl: 900 });
        const u = new URL("https://account.box.com/api/oauth2/authorize");
        u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", env.BOX_CLIENT_ID);
        u.searchParams.set("redirect_uri", url.origin + "/callback"); u.searchParams.set("state", st);
        return Response.redirect(u.toString(), 302);
      }
      if (url.pathname === "/callback") {
        const st = await env.KV.get(P + "oauth_state");
        if (!st || st !== url.searchParams.get("state")) return pagina("Erro", "<p>Pedido expirado. <a href='/ligar'>Tente outra vez</a>.</p>");
        if (url.searchParams.get("error")) return pagina("Erro", `<p>A Box recusou: ${esc(url.searchParams.get("error_description") || url.searchParams.get("error"))}</p>`);
        const tok = await boxToken(env, { grant_type: "authorization_code", code: url.searchParams.get("code"), redirect_uri: url.origin + "/callback" });
        const me = await (await fetch("https://api.box.com/2.0/users/me?fields=id,name,login", { headers: { Authorization: "Bearer " + tok.access_token } })).json();
        const box = (await env.KV.get(P + "box", "json")) || {};
        if (box.userId && box.userId !== me.id) await env.KV.delete(P + "plano");  // outra conta: o plano antigo deixa de valer
        await env.KV.put(P + "box", JSON.stringify({ refresh: tok.refresh_token, userId: me.id, nome: me.name, login: me.login, t: Date.now() }));
        await env.KV.delete(P + "oauth_state");
        return pagina("Ligado", `<p>✅ O serviço de avisos está ligado à Box como <b>${esc(me.name)}</b> (${esc(me.login)}).</p><p>Pode fechar esta janela e voltar à BoxCheck.</p>`);
      }
      // a partir daqui: pedidos da app, com o acesso à Box de quem está na app
      const quem = await quemE(req, env);
      if (!quem.ok) return json({ erro: quem.erro }, quem.st);
      if (url.pathname === "/plano" && req.method === "POST") {
        const plano = await req.json();
        if (!plano || plano.v !== 1 || !Array.isArray(plano.prazos)) return json({ erro: "Plano inválido." }, 400);
        plano.recebido = Date.now();
        await env.KV.put(P + "plano", JSON.stringify(plano));
        // ficheiros: o plano traz o estado da última análise da app; as alterações seguintes vêm do registo da Box
        const fich = {};
        for (const [k, it] of Object.entries(plano.itens || {})) for (const f of it.files || []) {
          const x = fich[f.id] || (fich[f.id] = { ca: f.ca, nm: f.nm || "", its: [], pids: f.pids || [] }); if (!x.its.includes(k)) x.its.push(k);
        }
        await env.KV.put(P + "ficheiros", JSON.stringify(fich));
        const est = (await env.KV.get(P + "estado", "json")) || {};
        if (plano.pos) est.pos = plano.pos;
        est.planoT = plano.recebido;
        await env.KV.put(P + "estado", JSON.stringify(est));
        // junta ao registo os envios feitos pela própria app (para não repetir)
        if (Array.isArray(plano.log) && plano.log.length) { const log = await lerLog(env); juntar(log, plano.log); await env.KV.put(P + "log", JSON.stringify(log.slice(-4000))); }
        return json({ ok: true, ...(await resumoEstado(env)) });
      }
      if (url.pathname === "/estado") return json({ ok: true, ...(await resumoEstado(env)) });
      if (url.pathname === "/correr" && req.method === "POST") { const r = await correr(env, Date.now()); return json({ ok: true, r, ...(await resumoEstado(env)) }); }
      return json({ erro: "Não encontrado" }, 404);
    } catch (e) { return json({ erro: String(e && e.message || e) }, 500); }
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(correr(env, Date.now()).catch(async e => { await anotar(env, { erro: String(e && e.message || e) }) })) }
};

/* ---------- autenticação ---------- */
async function quemE(req, env) {
  const a = req.headers.get("Authorization") || "";
  if (!a.startsWith("Bearer ")) return { ok: false, st: 401, erro: "Sem acesso." };
  const r = await fetch("https://api.box.com/2.0/users/me?fields=id,name,login", { headers: { Authorization: a } });
  if (!r.ok) return { ok: false, st: 401, erro: "O acesso à Box não foi aceite." };
  const me = await r.json(), box = await env.KV.get(P + "box", "json");
  if (!box) return { ok: false, st: 409, erro: "O serviço de avisos ainda não está ligado à Box. Abra " + new URL(req.url).origin + "/ligar" };
  if (box.userId !== me.id) return { ok: false, st: 403, erro: `O serviço de avisos está ligado a outra conta da Box (${box.login}).` };
  return { ok: true, me };
}
async function boxToken(env, params) {
  const r = await fetch("https://api.box.com/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: env.BOX_CLIENT_ID, client_secret: env.BOX_CLIENT_SECRET }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("A Box recusou o acesso (" + (j.error_description || j.error || r.status) + "). Volte a ligar em /ligar.");
  return j;
}
async function msToken(env) {
  const r = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("O Office 365 recusou o acesso do serviço (" + (j.error_description || j.error || r.status) + ").");
  return j.access_token;
}

/* ---------- execução de hora a hora ---------- */
async function correr(env, agora) {
  const plano = await env.KV.get(P + "plano", "json"), box = await env.KV.get(P + "box", "json");
  if (!plano || !box) return { nada: "sem plano ou sem ligação à Box" };
  if (!plano.servidor) return { nada: "envio pelo servidor desligado na app" };
  const ctx = { n: 0, env };
  const pedido = async (u, o) => { ctx.n++; return fetch(u, o) };
  // 1) acesso à Box (o código de renovação muda a cada uso: guarda-se logo o novo)
  ctx.n++; const tok = await boxToken(env, { grant_type: "refresh_token", refresh_token: box.refresh });
  box.refresh = tok.refresh_token; box.tRen = agora; await env.KV.put(P + "box", JSON.stringify(box));
  const H = { Authorization: "Bearer " + tok.access_token };
  // 2) alterações na Box desde a última vez
  const est = (await env.KV.get(P + "estado", "json")) || {}, fich = (await env.KV.get(P + "ficheiros", "json")) || {};
  const R = await atualizar(plano, est, fich, H, pedido, ctx);
  await env.KV.put(P + "ficheiros", JSON.stringify(fich));
  // 3) quem entregou e o que está na hora de enviar
  const log = await lerLog(env), feitos = new Set(log.filter(x => x.ok || x.err === "sem email").map(x => x.k));
  const devidos = calcularDevidos(plano, fich, agora, feitos);
  let enviados = 0, falhas = 0, msTok = null;
  for (const x of devidos) {
    if (ctx.n >= LIMITE_PEDIDOS - 1) break;            // o resto sai na próxima hora
    const base = { k: x.k, t: Date.now(), prazo: x.p.id, aviso: x.resumo ? "resumo" : x.a.id, prof: x.resumo ? "" : x.g.p.id, nome: x.resumo ? "(resumo para " + x.para + ")" : x.g.p.nome, n: x.resumo ? 0 : x.g.alvo.length, servidor: true };
    if (!x.resumo && !x.g.p.email) { log.push({ ...base, ok: false, err: "sem email" }); continue }
    try {
      if (!msTok) { ctx.n++; msTok = await msToken(env) }
      const m = x.resumo ? { to: x.para, cc: "", subject: `Prazo “${x.p.nome}” (${x.p.prazoPT}) — quem não cumpriu`, body: resumoTexto(plano, x.p, fich, agora) + "\n\n— Enviado pela BoxCheck (serviço de avisos)" }
        : { to: x.g.p.email, cc: plano.cc || "", subject: preencher(plano, x.a.subj, x.p, x.a, x.g, agora), body: preencher(plano, x.a.body, x.p, x.a, x.g, agora) };
      await enviarEmail(plano.from, m, msTok, pedido);
      log.push({ ...base, ok: true }); enviados++;
    } catch (e) { log.push({ ...base, ok: false, err: String(e.message || e) }); falhas++ }
  }
  await env.KV.put(P + "log", JSON.stringify(log.slice(-4000)));
  est.ultimo = agora; est.pedidos = ctx.n; est.enviados = enviados; est.falhas = falhas; est.porEnviar = Math.max(0, devidos.filter(x => x.resumo || x.g.p.email).length - enviados - falhas); est.erro = R.erro || "";
  await env.KV.put(P + "estado", JSON.stringify(est));
  return { enviados, falhas, porEnviar: est.porEnviar, alteracoes: R.n, pedidos: ctx.n };
}

// lê o registo de alterações da Box e atualiza os ficheiros que contam para cada documento exigido
async function atualizar(plano, est, fich, H, pedido, ctx) {
  if (!est.pos) { const r = await pedido("https://api.box.com/2.0/events?stream_position=now", { headers: H }); est.pos = (await r.json()).next_stream_position; return { n: 0 } }
  const itens = plano.itens || {}, raizes = new Map();      // id de pasta → documentos exigidos que a usam
  for (const [k, it] of Object.entries(itens)) for (const id of it.roots || []) { if (!raizes.has(id)) raizes.set(id, []); raizes.get(id).push(k) }
  const pend = est.pend || [];                                // ficheiros a confirmar (quando a Box não manda o caminho)
  let n = 0;
  const aplicar = f => {                                      // f: ficheiro com path_collection
    const ids = (f.path_collection && f.path_collection.entries || []).map(e => e.id);
    if (f.parent && f.parent.id && !ids.includes(f.parent.id)) ids.push(f.parent.id);
    const its = new Set();
    if (f.item_status && f.item_status !== "active") { delete fich[f.id]; return }
    for (const id of ids) for (const k of raizes.get(id) || []) if (nomeServe(itens[k], f.name)) its.add(k);
    if (its.size) fich[f.id] = { ca: f.created_at || (fich[f.id] && fich[f.id].ca) || new Date().toISOString(), nm: f.name, its: [...its], pids: ids };
    else delete fich[f.id];
  };
  for (let pag = 0; pag < 6 && ctx.n < LIMITE_PEDIDOS - 12; pag++) {
    const r = await pedido(`https://api.box.com/2.0/events?stream_type=changes&limit=500&stream_position=${encodeURIComponent(est.pos)}`, { headers: H });
    if (!r.ok) return { n, erro: "A Box não deu o registo de alterações (" + r.status + ")." };
    const j = await r.json(), evs = j.entries || [];
    for (const e of evs) {
      const s = e.source; if (!s || !s.id) continue; n++;
      const tipo = e.event_type;
      if (s.type === "file") {
        if (tipo === "ITEM_TRASH" || tipo === "ITEM_DELETE") { delete fich[s.id]; continue }
        if (["ITEM_CREATE", "ITEM_UPLOAD", "ITEM_COPY", "ITEM_MOVE", "ITEM_RENAME", "ITEM_UNDELETE_VIA_TRASH"].includes(tipo)) {
          if (s.path_collection && s.name) aplicar(s); else if (!pend.includes(s.id)) pend.push(s.id);
        }
      } else if (s.type === "folder" && (tipo === "ITEM_TRASH" || tipo === "ITEM_DELETE")) {
        for (const id in fich) if ((fich[id].pids || []).includes(s.id)) delete fich[id];
      }
    }
    if (j.next_stream_position) est.pos = j.next_stream_position;
    if (!evs.length || evs.length < 500) break;
  }
  // ficheiros cujo caminho a Box não mandou: pergunta um a um (dentro do limite de pedidos)
  while (pend.length && ctx.n < LIMITE_PEDIDOS - 10) {
    const id = pend.shift();
    const r = await pedido(`https://api.box.com/2.0/files/${id}?fields=id,name,created_at,path_collection,parent,item_status`, { headers: H });
    if (r.status === 404) { delete fich[id]; continue }
    if (r.ok) aplicar(await r.json());
  }
  est.pend = pend;
  return { n };
}
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
function nomeServe(it, nome) {
  if (!it) return false; const n = norm(nome);
  if (it.kws && it.kws.length && !it.kws.some(k => n.includes(k))) return false;
  if (it.exts && it.exts.length) { const e = (n.match(/\.([a-z0-9]+)$/) || [])[1] || ""; if (!it.exts.includes(e)) return false }
  return true;
}

/* ---------- prazos: o mesmo cálculo da app ---------- */
function estadoItens(plano, p, fich, agora) {
  const porItem = new Map();
  for (const [id, f] of Object.entries(fich)) for (const k of f.its || []) { if (!porItem.has(k)) porItem.set(k, []); porItem.get(k).push({ id, ca: Date.parse(f.ca) }) }
  return p.itens.map(k => {
    const it = plano.itens[k]; if (!it) return null;
    const bad = new Set(it.bad || []), good = (porItem.get(k) || []).filter(f => !bad.has(f.id) && !isNaN(f.ca)).sort((a, b) => a.ca - b.ca);
    const tem = (porItem.get(k) || []).length > 0, need = Math.max(1, it.need || 1);
    let est, ent = null;
    if (good.length >= need) { ent = good[need - 1].ca; est = ent > p.fim ? "atraso" : "prazo" }
    else est = agora > p.fim ? "falta" : "pendente";
    const atraso = ent && ent > p.fim ? dias(plano, p.fim, ent) : (est === "falta" ? dias(plano, p.fim, agora) : 0);
    return { k, it, est, ent, atraso, naoConta: !good.length && tem };
  }).filter(Boolean);
}
function porProf(plano, L) {
  const M = new Map(); for (const x of L) { const pid = x.it.prof || "_"; if (!M.has(pid)) M.set(pid, []); M.get(pid).push(x) }
  return [...M.entries()].map(([pid, it]) => { const p = plano.profs.find(q => q.id === pid) || { id: "_", nome: "(sem formador atribuído)", email: "" };
    const c = { prazo: 0, atraso: 0, falta: 0, pendente: 0 }; for (const x of it) c[x.est]++; return { p, it, c } });
}
function calcularDevidos(plano, fich, agora, feitos) {
  const out = [];
  for (const p of plano.prazos) {
    let G = null;
    for (const a of p.avisos || []) {
      if (!a.ativo) continue;
      let k = -1; (a.occ || []).forEach((t, i) => { if (t <= agora) k = i });
      if (k < 0 || (a.quando !== "depois" && agora > p.fim)) continue;
      if (agora - a.occ[k] > 7 * DIA) continue;                       // não envia avisos com mais de uma semana de atraso
      G = G || porProf(plano, estadoItens(plano, p, fich, agora)).filter(g => g.p.id !== "_");
      for (const g of G) {
        const alvo = g.it.filter(x => a.dest === "incumpriu" ? (x.est === "falta" || x.est === "atraso") : (x.est === "falta" || x.est === "pendente"));
        if (!alvo.length) continue;
        const key = p.id + "|" + a.id + "|" + g.p.id + "|" + k; if (feitos.has(key)) continue;
        out.push({ p, a, g: { ...g, alvo }, k: key });
      }
    }
    if (p.resumo && p.para && p.resumoT && agora >= p.resumoT && agora - p.fim < 30 * DIA) { const key = p.id + "|resumo"; if (!feitos.has(key)) out.push({ p, resumo: true, para: p.para, k: key }) }
  }
  return out;
}
function linha(plano, x) {
  let r = x.it.linha;
  if (x.est === "atraso") return r + ` — entregue a ${dataPT(plano, x.ent)}, ${x.atraso} dia(s) depois do prazo`;
  return r + (x.naoConta ? " — o ficheiro entregue não conta (vazio ou repetido)" : x.it.loc ? ` (${x.it.loc})` : "");
}
function preencher(plano, tpl, p, a, g, agora) {
  const d = a.quando === "depois" ? Math.max(0, dias(plano, p.fim, agora)) : Math.max(0, dias(plano, agora, p.fim));
  const first = String(g.p.nome || "").trim().split(/\s+/)[0] || "";
  return String(tpl || "").replace(/\{primeiro_nome\}/g, first).replace(/\{nome\}/g, g.p.nome).replace(/\{prazo_nome\}/g, p.nome || "")
    .replace(/\{prazo\}/g, p.prazoPT).replace(/\{dias\}/g, d).replace(/\{documentos\}/g, p.documentos || "a documentação pedida")
    .replace(/\{total\}/g, g.alvo.length).replace(/\{ano\}/g, plano.ano || "").replace(/\{lista\}/g, g.alvo.map(x => linha(plano, x)).join("\n"));
}
function resumoTexto(plano, p, fich, agora) {
  const L = estadoItens(plano, p, fich, agora), c = { prazo: 0, atraso: 0, falta: 0, pendente: 0 }; for (const x of L) c[x.est]++;
  const G = porProf(plano, L).filter(g => g.c.falta || g.c.atraso);
  let s = `${p.nome} — prazo: ${p.prazoPT}\nSituação a ${dataPT(plano, agora)}\n\nEntregues no prazo: ${c.prazo}\nEntregues fora do prazo: ${c.atraso}\nNão entregues: ${c.falta + c.pendente}\nTotal de documentos: ${L.length}\n\n`;
  if (!G.length) return s + "Todos os formadores cumpriram o prazo.";
  s += `Formadores que não cumpriram (${G.length}):\n`;
  for (const g of G) { s += `\n${g.p.nome}${g.p.email ? " <" + g.p.email + ">" : ""} — ${g.c.falta} não entregue(s), ${g.c.atraso} fora do prazo\n`;
    for (const x of g.it.filter(x => x.est === "falta" || x.est === "atraso")) s += "   " + linha(plano, x) + "\n" }
  return s;
}
// datas no fuso horário da escola (o mesmo da app)
const ymd = (plano, t) => new Intl.DateTimeFormat("en-CA", { timeZone: plano.tz || "Atlantic/Azores", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const dias = (plano, a, b) => Math.round((Date.parse(ymd(plano, b) + "T00:00:00Z") - Date.parse(ymd(plano, a) + "T00:00:00Z")) / DIA);
const dataPT = (plano, t) => { const [y, m, d] = ymd(plano, t).split("-"); return `${d}/${m}/${y}` };

/* ---------- email pelo Office 365 (permissão de aplicação Mail.Send) ---------- */
async function enviarEmail(from, m, tok, pedido) {
  if (!from) throw new Error("Falta o remetente (email da escola) no plano.");
  const rec = s => String(s || "").split(/[;,]/).map(x => x.trim()).filter(Boolean).map(address => ({ emailAddress: { address } }));
  const message = { subject: m.subject, body: { contentType: "Text", content: m.body }, toRecipients: rec(m.to) };
  if (rec(m.cc).length) message.ccRecipients = rec(m.cc);
  const r = await pedido(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ message, saveToSentItems: true }) });
  if (r.status !== 202) { let t = ""; try { t = (await r.json()).error.message } catch (e) { } throw new Error(`Office 365 recusou (${r.status})${t ? ": " + t : ""}`) }
}

/* ---------- registo ---------- */
async function lerLog(env) { return (await env.KV.get(P + "log", "json")) || [] }
function juntar(log, novos) { const K = new Set(log.map(x => x.k + "|" + x.t)); for (const x of novos) if (x && x.k && !K.has(x.k + "|" + x.t)) log.push(x); log.sort((a, b) => a.t - b.t) }
async function anotar(env, o) { const est = (await env.KV.get(P + "estado", "json")) || {}; Object.assign(est, o, { ultimo: Date.now() }); await env.KV.put(P + "estado", JSON.stringify(est)) }
async function resumoEstado(env) {
  const est = (await env.KV.get(P + "estado", "json")) || {}, box = (await env.KV.get(P + "box", "json")) || {};
  return { box: box.login || "", estado: { ultimo: est.ultimo || 0, planoT: est.planoT || 0, enviados: est.enviados || 0, falhas: est.falhas || 0, porEnviar: est.porEnviar || 0, erro: est.erro || "" }, log: (await lerLog(env)).slice(-400) };
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pagina = (t, h) => new Response(`<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(t)}</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#1d2433"><h2>${esc(t)}</h2>${h}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
