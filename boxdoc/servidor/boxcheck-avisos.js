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
 *   GUIDE_ADMINS (opcional) — emails dos administradores da EPISJ 360, separados por vírgulas
 *                             (se faltar, é administrador quem ligou a Box a este serviço)
 * Ligação KV (Bindings): nome da variável  KV  → espaço "boxcheck"
 *
 * EPISJ 360 (a partir da EPISJ 360 0.9): toda a gente entra na EPISJ 360 com a conta do Office 365 da escola.
 * Este serviço confirma a conta junto da Microsoft e diz qual é o perfil (Direção Executiva,
 * Direção Pedagógica, Formador ou Formando) e o que esse perfil pode ver. Rotas em /guide/…
 * Nuvem da EPISJ 360 (0.9.37): /guide/sync — o estado da app fica guardado aqui com a conta do Office 365 da Direção.
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
    const cors = { "Access-Control-Allow-Origin": okOrigens.includes(o) ? o : okOrigens[0], "Access-Control-Allow-Headers": "Authorization, Content-Type, X-T", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Vary": "Origin" };
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
      // EPISJ 360: entrada com a conta do Office 365 e perfis de utilizador
      if (url.pathname.startsWith("/guide/")) return await guide(req, env, url, json, cors);
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

/* ---------- EPISJ 360: perfis de utilizador (conta do Office 365) ---------- */
const G = "guide:";
const PERFIS = { dexec: "Direção Executiva", dped: "Direção Pedagógica", prof: "Formador", form: "Formando" };
// separadores da EPISJ 360 (os mesmos ids da app). "uti" (Utilizadores e perfis) é só para administradores.
const SEPARADORES = ["esc", "anos", "cal", "cur", "tur", "pc", "prof", "dsd", "for", "box", "alt", "pas", "config", "rel", "est", "env", "pra", "cop", "meu", "esch", "mh", "rcMapa", "rcLista", "rcEsp", "crPs", "crCron", "crCump", "crHist", "crDef", "def"];
// EPISJ 360 0.9.19: separadores de cada módulo — um módulo desligado pelo administrador some para todos os outros
const MOD_TABS = { escola: ["esc", "anos", "cal", "cur", "tur", "pc", "prof", "dsd", "for"], boxcheck: ["box", "alt", "pas", "config", "rel", "est", "env", "pra", "cop", "meu"], eduschedule: ["esch", "mh"], roomcheck: ["rcMapa", "rcLista", "rcEsp"], crono: ["crPs", "crCron", "crCump", "crHist", "crDef"] };
const VIS_OMISSAO = {
  dexec: SEPARADORES.slice(),
  dped: ["esc", "anos", "cal", "cur", "tur", "pc", "prof", "dsd", "for", "box", "alt", "pas", "config", "rel", "est", "env", "pra", "meu", "esch", "mh", "rcMapa", "rcLista", "rcEsp", "crPs", "crCron", "crCump", "crHist", "crDef"],
  prof: ["meu", "mh", "dsd", "cal", "crPs", "crCron", "crHist"],
  form: ["mh", "cal"]
};
const PODE_PUBLICAR = new Set(["dexec", "dped"]);
const lst = v => Array.isArray(v) ? v : [];
const em = s => String(s || "").trim().toLowerCase();

async function guide(req, env, url, json, cors) {
  const p = url.pathname.replace(/\/+$/, "");
  // pública: o que a app precisa para abrir o login da Microsoft (o ID da aplicação e do diretório não são segredos)
  if (p === "/guide/config") return json({ ok: !!(env.MS_CLIENT_ID && env.MS_TENANT), clientId: env.MS_CLIENT_ID || "", tenant: env.MS_TENANT || "" });
  const quem = await msQuem(req, env);
  if (!quem.ok) return json({ erro: quem.erro }, quem.st);
  const loja = await lerPerfis(env), plano = (await env.KV.get(P + "plano", "json")) || null;
  const profsPub = (await env.KV.get(G + "profs", "json")) || [];
  const eu = await perfilDe(quem, loja, plano, env, profsPub);
  if (p === "/guide/eu") {
    if (!eu.perfil) return json({ erro: `A conta ${quem.email} ainda não tem perfil na EPISJ 360. Peça à Direção que lho atribua.`, semPerfil: true, email: quem.email, nome: quem.nome }, 403);
    return json({ ok: true, ...eu, perfis: PERFIS, separadores: SEPARADORES });
  }
  if (!eu.perfil) return json({ erro: "Sem perfil na EPISJ 360." }, 403);
  if (p === "/guide/perfis") {
    if (!eu.admin) return json({ erro: "Só os administradores da EPISJ 360 gerem os perfis." }, 403);
    if (req.method === "GET") return json({ ok: true, loja, perfis: PERFIS, separadores: SEPARADORES, visOmissao: VIS_OMISSAO, adminsServico: adminsDoServico(env), adminAuto: (await env.KV.get(P + "box", "json") || {}).login || "",
      professores: lst(profsPub).concat(lst(plano && plano.profs)).filter(x => x.email).map(x => ({ nome: x.nome, email: em(x.email) })) });
    if (req.method === "POST" || req.method === "PUT") {
      const b = await req.json().catch(() => null);
      if (!b || typeof b !== "object") return json({ erro: "Pedido inválido." }, 400);
      const nova = limparPerfis(b);
      // não deixa um administrador tirar-se a si próprio (ficava sem forma de voltar)
      const adm = new Set([...nova.admins, ...adminsDoServico(env)]);
      if (!adm.has(quem.email) && !adm.has(quem.upn) && !(await adminAutomatico(env, nova, quem))) nova.admins.push(quem.email);
      nova.t = Date.now(); nova.por = quem.email;
      await env.KV.put(G + "perfis", JSON.stringify(nova));
      return json({ ok: true, loja: nova });
    }
  }
  // As minhas entregas: o que falta a cada professor, prazo a prazo (o mesmo cálculo dos avisos)
  if (p === "/guide/entregas") {
    let alvo = quem;
    const pedido = em(url.searchParams.get("email"));
    if (pedido && pedido !== quem.email && pedido !== quem.upn) {
      if (!(eu.admin || eu.perfil === "dexec" || eu.perfil === "dped")) return json({ erro: "Só a Direção vê as entregas de outros professores." }, 403);
      alvo = { email: pedido, upn: pedido };
    }
    if (!plano) return json({ ok: true, semPlano: true, prazos: [], professores: [] });
    const prof = lst(plano.profs).find(x => x.email && [alvo.email, alvo.upn].includes(em(x.email)));
    const lista = (eu.admin || eu.perfil === "dexec" || eu.perfil === "dped") ? lst(plano.profs).filter(x => x.email).map(x => ({ nome: x.nome, email: em(x.email) })) : [];
    if (!prof) return json({ ok: true, semProf: true, professores: lista, planoT: plano.recebido || 0 });
    const fich = (await env.KV.get(P + "ficheiros", "json")) || {}, est = (await env.KV.get(P + "estado", "json")) || {}, agora = Date.now();
    const prazos = lst(plano.prazos).map(pz => {
      const its = estadoItens(plano, pz, fich, agora).filter(x => x.it.prof === prof.id);
      if (!its.length) return null;
      const c = { prazo: 0, atraso: 0, falta: 0, pendente: 0 }; for (const x of its) c[x.est]++;
      return { id: pz.id, nome: pz.nome || "", prazoPT: pz.prazoPT || "", fim: pz.fim, c,
        itens: its.map(x => ({ linha: x.it.linha || x.k, loc: x.it.loc || "", est: x.est, ent: x.ent, atraso: x.atraso, naoConta: !!x.naoConta })) };
    }).filter(Boolean);
    return json({ ok: true, prof: { nome: prof.nome, email: em(prof.email) }, prazos, professores: lista, planoT: plano.recebido || 0, verificado: est.ultimo || 0, ano: plano.ano || "" });
  }
  // EPISJ 360 0.9.37: nuvem da EPISJ 360 com a conta do Office 365 (já não depende de a Box estar ligada).
  // Guarda o estado da app (configuração, escola, planos, reservas, horários, análises…) no KV, com o momento (t) de cada peça.
  // Só a Direção (e os administradores) leem e gravam aqui; os outros perfis veem o que a Direção publica (/guide/publico).
  if (p === "/guide/sync" || p.startsWith("/guide/sync/")) {
    if (!(eu.admin || PODE_PUBLICAR.has(eu.perfil))) return json({ erro: "Só a Direção guarda dados na nuvem da EPISJ 360." }, 403);
    const S = "g360sync:";
    if (p === "/guide/sync") {
      const itens = {}; let cur;
      do { const l = await env.KV.list({ prefix: S, cursor: cur }); for (const k of l.keys) itens[k.name.slice(S.length)] = { t: (k.metadata && k.metadata.t) || 0 }; cur = l.list_complete ? null : l.cursor } while (cur);
      return json({ ok: true, itens });
    }
    const nome = decodeURIComponent(p.slice("/guide/sync/".length));
    if (!/^[\w.-]{1,200}$/.test(nome)) return json({ erro: "Nome inválido." }, 400);
    if (req.method === "GET") {
      const v = await env.KV.get(S + nome, "arrayBuffer");
      if (v == null) return json({ erro: "Não existe." }, 404);
      return new Response(v, { headers: { ...(cors || {}), "Content-Type": "application/octet-stream" } });
    }
    if (req.method === "PUT" || req.method === "POST") {
      const b = await req.arrayBuffer();
      if (b.byteLength > 24e6) return json({ erro: "Dados demasiado grandes." }, 413);
      const t = +req.headers.get("X-T") || Date.now();
      await env.KV.put(S + nome, b, { metadata: { t, por: quem.email } });
      return json({ ok: true, t });
    }
    return json({ erro: "Método não suportado." }, 405);
  }
  // dados da escola publicados pela Direção (turmas, professores, horários) — só leitura para os outros perfis
  if (p === "/guide/publico") {
    if (req.method === "GET") {
      const d = (await env.KV.get(G + "publico", "json")) || {};
      if (eu.perfil === "form" && !eu.admin && Array.isArray(d.profs)) d.profs = d.profs.map(x => ({ ...x, email: "" }));  // os formandos não precisam dos emails
      return json(d);
    }
    if (!(eu.admin || PODE_PUBLICAR.has(eu.perfil))) return json({ erro: "Só a Direção publica os dados da escola." }, 403);
    const txt = await req.text();
    if (txt.length > 20e6) return json({ erro: "Dados demasiado grandes." }, 413);
    let o; try { o = JSON.parse(txt); if (!o || typeof o !== "object") throw 0 } catch (e) { return json({ erro: "Pedido inválido." }, 400) }
    await env.KV.put(G + "publico", txt);
    // os professores publicados (com email) entram como Professor, mesmo sem prazos no serviço
    await env.KV.put(G + "profs", JSON.stringify(lst(o.profs).filter(x => x && x.email).map(x => ({ id: x.id, nome: x.nome, email: em(x.email) }))));
    return json({ ok: true, t: Date.now() });
  }
  return json({ erro: "Não encontrado" }, 404);
}

// confirma a conta junto da Microsoft (Graph /me) e que pertence ao Office 365 da escola
async function msQuem(req, env) {
  const a = req.headers.get("Authorization") || "";
  if (!a.startsWith("Bearer ")) return { ok: false, st: 401, erro: "Sem sessão Microsoft." };
  if (!env.MS_TENANT) return { ok: false, st: 500, erro: "Falta o segredo MS_TENANT no serviço." };
  let tid = "";
  try { let b = a.slice(7).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); while (b.length % 4) b += "="; tid = JSON.parse(atob(b)).tid || "" } catch (e) {}
  const escola = await tenantId(env);
  if (!tid || !escola || tid.toLowerCase() !== escola) return { ok: false, st: 403, erro: "Esta conta não pertence ao Office 365 da escola." };
  const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", { headers: { Authorization: a } });
  if (!r.ok) return { ok: false, st: 401, erro: "A sessão Microsoft não foi aceite. Entre outra vez." };
  const me = await r.json();
  const upn = em(me.userPrincipalName), email = em(me.mail) || upn;
  return { ok: true, email, upn, nome: me.displayName || email, id: me.id };
}
async function tenantId(env) {
  const t = em(env.MS_TENANT);
  if (/^[0-9a-f-]{36}$/.test(t)) return t;
  const c = await env.KV.get(G + "tid:" + t); if (c) return c;
  try {
    const j = await (await fetch(`https://login.microsoftonline.com/${encodeURIComponent(t)}/v2.0/.well-known/openid-configuration`)).json();
    const m = String(j.issuer || "").match(/[0-9a-f-]{36}/i);
    if (m) { await env.KV.put(G + "tid:" + t, m[0].toLowerCase(), { expirationTtl: 86400 * 30 }); return m[0].toLowerCase() }
  } catch (e) {}
  return "";
}
const adminsDoServico = env => String(env.GUIDE_ADMINS || "").split(/[,;\s]+/).map(em).filter(Boolean);
async function adminAutomatico(env, loja, quem) {
  // sem administradores definidos, é administrador quem ligou a Box ao serviço de avisos (o diretor)
  if (adminsDoServico(env).length || lst(loja.admins).length) return false;
  const box = (await env.KV.get(P + "box", "json")) || {};
  return !!box.login && [quem.email, quem.upn].includes(em(box.login));
}
async function lerPerfis(env) { return limparPerfis((await env.KV.get(G + "perfis", "json")) || {}) }
function limparPerfis(b) {
  const out = { v: 1, admins: [], utilizadores: {}, formandos: { dominios: [], padrao: "" }, vis: {}, modsOff: [], t: b.t || 0, por: b.por || "" };
  out.admins = [...new Set(lst(b.admins).map(em).filter(x => x.includes("@")))];
  for (const [k, v] of Object.entries(b.utilizadores || {})) {
    const e = em(k); if (!e.includes("@") || !v || !PERFIS[v.perfil]) continue;
    out.utilizadores[e] = { perfil: v.perfil, turma: String(v.turma || "").slice(0, 40), nome: String(v.nome || "").slice(0, 120) };
  }
  const f = b.formandos || {};
  out.formandos.dominios = [...new Set(lst(f.dominios).map(x => em(x).replace(/^@/, "")).filter(Boolean))];
  out.formandos.padrao = String(f.padrao || "").slice(0, 200);
  for (const k of Object.keys(PERFIS)) if (Array.isArray((b.vis || {})[k])) out.vis[k] = b.vis[k].filter(x => SEPARADORES.includes(x));
  out.modsOff = [...new Set(lst(b.modsOff).filter(m => MOD_TABS[m]))];
  return out;
}
async function perfilDe(quem, loja, plano, env, profsPub) {
  const ids = [quem.email, quem.upn].filter(Boolean);
  const adm = new Set([...adminsDoServico(env), ...loja.admins]);
  const admin = ids.some(x => adm.has(x)) || await adminAutomatico(env, loja, quem);
  const u = ids.map(x => loja.utilizadores[x]).find(Boolean);
  let perfil = u ? u.perfil : null, origem = u ? "atribuído" : "";
  if (!perfil && admin) { perfil = "dexec"; origem = "administrador" }
  if (!perfil && (lst(plano && plano.profs).concat(lst(profsPub))).some(x => x.email && ids.includes(em(x.email)))) { perfil = "prof"; origem = "professor da EPISJ 360" }
  if (!perfil) {
    const dom = quem.email.split("@")[1] || "", f = loja.formandos;
    let re = null; try { re = f.padrao ? new RegExp(f.padrao, "i") : null } catch (e) {}
    if (f.dominios.includes(dom) || (re && ids.some(x => re.test(x)))) { perfil = "form"; origem = "regra dos formandos" }
  }
  const off = new Set(lst(loja.modsOff).flatMap(m => MOD_TABS[m] || []));
  const vis = !perfil ? [] : admin ? SEPARADORES.concat("uti") : (loja.vis[perfil] || VIS_OMISSAO[perfil]).filter(t => !off.has(t));
  return { email: quem.email, nome: quem.nome, perfil, perfilNome: PERFIS[perfil] || "", origem, admin, vis, modsOff: lst(loja.modsOff), turma: u && u.turma || "" };
}

/* ---------- autenticação ---------- */
async function quemE(req, env) {
  const a = req.headers.get("Authorization") || "";
  if (!a.startsWith("Bearer ")) return { ok: false, st: 401, erro: "Sem acesso." };
  // EPISJ 360 0.9.113: a resposta da Box fica guardada 50 minutos por acesso (só a impressão digital do acesso, nunca o acesso)
  const hk = P + "quem:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(a)))].map(b => b.toString(16).padStart(2, "0")).join("");
  let me = await env.KV.get(hk, "json");
  if (!me) {
    const r = await fetch("https://api.box.com/2.0/users/me?fields=id,name,login", { headers: { Authorization: a } });
    if (!r.ok) return { ok: false, st: 401, erro: "O acesso à Box não foi aceite." };
    me = await r.json(); try { await env.KV.put(hk, JSON.stringify({ id: me.id, name: me.name, login: me.login }), { expirationTtl: 3000 }) } catch (e) { }
  }
  const box = await env.KV.get(P + "box", "json");
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
  // 0) EPISJ 360 0.9.113: se não há nenhum aviso na hora (nem com o que já se sabe), não se pergunta nada à Box nesta hora.
  //    Os dados só ficam mais desatualizados no sentido de mostrar MAIS gente em falta, por isso nada se perde.
  //    De 6 em 6 dias renova-se o acesso, para o código da Box não caducar (caduca ao fim de 60 dias sem uso).
  {
    const log0 = await lerLog(env), feitos0 = new Set(log0.filter(x => x.ok || x.err === "sem email").map(x => x.k));
    const fich0 = (await env.KV.get(P + "ficheiros", "json")) || {};
    if (!calcularDevidos(plano, fich0, agora, feitos0).length && agora - (box.tRen || box.t || 0) < 6 * DIA) {
      await anotar(env, { pedidos: 0, enviados: 0, falhas: 0, porEnviar: 0, erro: "", semAvisos: agora });
      return { nada: "sem avisos na hora", pedidos: 0 };
    }
  }
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
