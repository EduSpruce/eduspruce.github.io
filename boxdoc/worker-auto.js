/* BoxCheck — serviço de envios automáticos e página do formador (Cloudflare Worker)
 *
 * O que faz:
 *   • guarda o último relatório publicado pela app BoxCheck (POST /publicar);
 *   • mostra a cada formador a sua página só de leitura, com o que lhe falta (GET /f/<código>);
 *   • nos dias e à hora escolhidos na app, envia os emails aos formadores (com o PDF em anexo)
 *     e o relatório geral, pelo Office 365 da escola (Cron Trigger).
 *
 * Não tem acesso à Box: só recebe da app o relatório já feito. Não lê nem altera nada na Box.
 *
 * Configuração (Cloudflare › Workers › boxcheck-auto › Settings):
 *   KV namespace binding:  BOXCHECK  → o espaço KV "boxcheck" (ou outro)
 *   Variables:
 *     ADMINS        emails da conta Box de quem pode publicar (separados por vírgulas), ex.: joel.cunha@episj.com
 *     MS_TENANT     ID do diretório (inquilino) do Office 365, ex.: episj.com
 *     MS_CLIENT_ID  ID da aplicação (cliente) registada no Entra, com a permissão de APLICAÇÃO Mail.Send
 *     MS_SECRET     segredo da aplicação (guarde-o como "Secret", encriptado)
 *     MS_FROM       caixa de correio de onde saem os emails, ex.: direcao@episj.com
 *     ORIGIN        (opcional) endereço da app, ex.: https://eduspruce.github.io
 *   Triggers › Cron Triggers:  0,15,30,45 * * * *   (de 15 em 15 minutos; o serviço só envia nos dias/hora escolhidos)
 */
const VERSAO = "1.0";
const LOTE = 30; // emails por execução (o plano gratuito da Cloudflare permite 50 pedidos por execução)

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": env.ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type,Content-Encoding",
      "Access-Control-Max-Age": "86400",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    try {
      if (!env.BOXCHECK) return json({ erro: "Falta ligar o espaço KV (binding BOXCHECK) a este serviço." }, 501);
      const p = url.pathname.replace(/\/+$/, "") || "/";

      if (req.method === "GET" && p.startsWith("/f/")) return pagina(env, decodeURIComponent(p.slice(3)));
      if (req.method === "GET" && p === "/") return new Response("BoxCheck — serviço de envios automáticos v" + VERSAO, { headers: cors });

      // tudo o resto exige a sessão da Box de um administrador
      const quem = await admin(req, env);
      if (!quem) return json({ erro: "Sem autorização: entre na BoxCheck com uma conta Box indicada em ADMINS." }, 401);

      if (req.method === "POST" && p === "/publicar") {
        let txt;
        if ((req.headers.get("Content-Encoding") || "").includes("gzip") || req.headers.get("Content-Type") === "application/gzip")
          txt = await new Response(req.body.pipeThrough(new DecompressionStream("gzip"))).text();
        else txt = await req.text();
        const snap = JSON.parse(txt);
        if (!snap || !Array.isArray(snap.formadores)) return json({ erro: "Relatório inválido." }, 400);
        snap.recebido = Date.now(); snap.por = quem;
        await env.BOXCHECK.put("auto:snap", JSON.stringify(snap));
        return json({ ok: true, t: snap.t, formadores: snap.formadores.length });
      }
      // PDF de cada formador (e "geral"), guardados à parte em base64, para o relatório ficar leve
      if (req.method === "POST" && p.startsWith("/pdf/")) {
        const k = decodeURIComponent(p.slice(5));
        if (!/^[A-Za-z0-9_-]{4,64}$/.test(k)) return json({ erro: "nome inválido" }, 400);
        const b64 = await req.text();
        if (!/^[A-Za-z0-9+/=]*$/.test(b64.slice(0, 200))) return json({ erro: "PDF inválido" }, 400);
        await env.BOXCHECK.put("auto:pdf:" + k, b64, { expirationTtl: 60 * 86400 });
        return json({ ok: true });
      }
      if (req.method === "GET" && p === "/estado") {
        const snap = await lerSnap(env);
        const runs = JSON.parse((await env.BOXCHECK.get("auto:runs")) || "[]");
        const job = JSON.parse((await env.BOXCHECK.get("auto:job")) || "null");
        return json({ versao: VERSAO, quem, snapT: snap && snap.t, recebido: snap && snap.recebido, agenda: snap && snap.agenda, runs, job: job && { inicio: job.inicio, feitos: job.feitos.length, total: job.fila.length + job.feitos.length },
          ms: !!(env.MS_TENANT && env.MS_CLIENT_ID && env.MS_SECRET && env.MS_FROM), from: env.MS_FROM || "" });
      }
      if (req.method === "POST" && p === "/testar") {
        await enviarMail(env, { to: quem, subject: "BoxCheck — teste dos envios automáticos", body: "Este é um email de teste do serviço de envios automáticos da BoxCheck.\n\nSe o recebeu, a ligação ao Office 365 está a funcionar." });
        return json({ ok: true, para: quem });
      }
      if (req.method === "POST" && p === "/enviar-agora") {
        const snap = await lerSnap(env);
        if (!snap) return json({ erro: "Ainda não foi publicado nenhum relatório." }, 400);
        const job = await criarJob(env, snap, "Envio automático (pedido na app)");
        ctx.waitUntil(processar(env));
        return json({ ok: true, total: job.fila.length });
      }
      return json({ erro: "Não encontrado." }, 404);
    } catch (e) {
      return json({ erro: String(e && e.message || e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(env));
  },
};

/* ---------- autorização: a sessão Box da app (só lê o nome e o email da conta) ---------- */
async function admin(req, env) {
  const h = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/.test(h)) return null;
  const r = await fetch("https://api.box.com/2.0/users/me?fields=login", { headers: { Authorization: h } });
  if (!r.ok) return null;
  const login = String((await r.json()).login || "").toLowerCase();
  const ok = String(env.ADMINS || "").toLowerCase().split(/[,;\s]+/).filter(Boolean);
  return ok.includes(login) ? login : null;
}
const lerSnap = async env => JSON.parse((await env.BOXCHECK.get("auto:snap")) || "null");

/* ---------- agenda: corre de 15 em 15 minutos e só envia no dia e à hora escolhidos ---------- */
function agora(tz) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Atlantic/Azores", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const o = {}; for (const x of f.formatToParts(new Date())) o[x.type] = x.value;
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday];
  return { dia: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour === "24" ? "00" : o.hour}:${o.minute}`, dow };
}
async function cron(env) {
  if (!env.BOXCHECK) return;
  // primeiro, continua um envio que tenha ficado a meio
  if (await env.BOXCHECK.get("auto:job")) return processar(env);
  const snap = await lerSnap(env); if (!snap || !snap.agenda || !snap.agenda.ativo) return;
  const A = snap.agenda, n = agora(A.tz);
  if (!(A.dias || []).includes(n.dow) || n.hm < (A.hora || "08:30")) return;
  if (A.inicio && n.dia < A.inicio) return;
  if (A.fim && n.dia > A.fim) return;
  const k = "auto:feito:" + n.dia;
  if (await env.BOXCHECK.get(k)) return; // já enviou hoje
  await env.BOXCHECK.put(k, "1", { expirationTtl: 3 * 86400 });
  // relatório antigo: não envia lembretes com dados desatualizados; avisa só quem administra
  const idade = (Date.now() - (snap.t || 0)) / 864e5;
  if (idade > (A.maxIdade || 7)) {
    const para = (A.avisar || snap.por || "").trim();
    if (para) await enviarMail(env, { to: para, subject: "BoxCheck — os lembretes automáticos não foram enviados",
      body: `Os lembretes de hoje não foram enviados porque o último relatório publicado é de ${dataPT(snap.t)} (há ${Math.floor(idade)} dias).\n\nAbra a BoxCheck, faça a análise da Box e o relatório é publicado sozinho. Os lembretes seguintes saem no próximo dia marcado.` }).catch(() => {});
    await registar(env, { t: Date.now(), tipo: "adiado", motivo: `relatório com ${Math.floor(idade)} dias`, snapT: snap.t });
    return;
  }
  await criarJob(env, snap, "Envio automático");
  return processar(env);
}
async function criarJob(env, snap, label) {
  const A = snap.agenda || {};
  const fila = [];
  if (A.formadores !== false) for (const f of snap.formadores) if (f.email && f.miss > 0) fila.push({ k: "f", tok: f.tok });
  if (A.geral && snap.geral && snap.geral.para) fila.push({ k: "g" });
  const job = { inicio: Date.now(), label, snapT: snap.t, fila, feitos: [], falhas: [] };
  await env.BOXCHECK.put("auto:job", JSON.stringify(job));
  return job;
}
async function processar(env) {
  const job = JSON.parse((await env.BOXCHECK.get("auto:job")) || "null"); if (!job) return;
  const snap = await lerSnap(env);
  const cc = snap && snap.agenda && snap.agenda.cc || "";
  let n = 0;
  while (job.fila.length && n < LOTE) {
    const it = job.fila.shift(); n++;
    try {
      if (it.k === "g") {
        const g = snap.geral;
        await enviarMail(env, { to: g.para, cc, subject: g.assunto, body: g.corpo, anexo: { name: g.pdfNome, b64: await env.BOXCHECK.get("auto:pdf:geral") } });
        job.feitos.push("geral");
      } else {
        const f = snap.formadores.find(x => x.tok === it.tok);
        if (!f) continue;
        await enviarMail(env, { to: f.email, cc, subject: f.assunto, body: f.corpo, anexo: { name: f.pdfNome, b64: await env.BOXCHECK.get("auto:pdf:" + f.tok) } });
        job.feitos.push(f.tok);
      }
    } catch (e) { job.falhas.push({ it, erro: String(e.message || e).slice(0, 300) }); }
  }
  if (job.fila.length) { await env.BOXCHECK.put("auto:job", JSON.stringify(job)); return; } // continua na próxima execução
  await env.BOXCHECK.delete("auto:job");
  await registar(env, { t: Date.now(), tipo: "enviado", label: job.label, snapT: job.snapT, inicio: job.inicio, enviados: job.feitos, falhas: job.falhas });
}
async function registar(env, r) {
  const runs = JSON.parse((await env.BOXCHECK.get("auto:runs")) || "[]");
  runs.unshift(r);
  await env.BOXCHECK.put("auto:runs", JSON.stringify(runs.slice(0, 40)));
}

/* ---------- Office 365: permissão de aplicação Mail.Send (client credentials) ---------- */
let TOK = null;
async function tokenMS(env) {
  if (TOK && TOK.exp > Date.now() + 60e3) return TOK.a;
  if (!env.MS_TENANT || !env.MS_CLIENT_ID || !env.MS_SECRET || !env.MS_FROM) throw new Error("Falta configurar MS_TENANT, MS_CLIENT_ID, MS_SECRET e MS_FROM no serviço.");
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("O Office 365 recusou o acesso: " + (j.error_description || j.error || r.status));
  TOK = { a: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return TOK.a;
}
async function enviarMail(env, { to, cc, subject, body, anexo }) {
  const rec = s => String(s || "").split(/[;,]/).map(x => x.trim()).filter(Boolean).map(address => ({ emailAddress: { address } }));
  if (!rec(to).length) throw new Error("sem endereço");
  const message = { subject, body: { contentType: "Text", content: body }, toRecipients: rec(to) };
  if (rec(cc).length) message.ccRecipients = rec(cc);
  if (anexo && anexo.b64) message.attachments = [{ "@odata.type": "#microsoft.graph.fileAttachment", name: anexo.name || "relatorio.pdf", contentType: "application/pdf", contentBytes: anexo.b64 }];
  for (let t = 0; t < 3; t++) {
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MS_FROM)}/sendMail`, {
      method: "POST", headers: { Authorization: "Bearer " + await tokenMS(env), "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (r.status === 202) return;
    if (r.status === 429 || r.status >= 500) { await new Promise(ok => setTimeout(ok, (+r.headers.get("Retry-After") || 3) * 1000)); continue; }
    let m = ""; try { m = (await r.json()).error.message; } catch (e) {}
    throw new Error(`Office 365 ${r.status}${m ? ": " + m : ""}`);
  }
  throw new Error("Office 365 ocupado");
}

/* ---------- página do formador (só leitura) ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dataPT = t => new Date(t).toLocaleDateString("pt-PT", { timeZone: "Atlantic/Azores" });
async function pagina(env, tok) {
  const H = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'none'" };
  const snap = await lerSnap(env);
  const f = snap && tok && tok.length >= 16 && snap.formadores.find(x => x.tok === tok);
  if (!f) return new Response(html("Página não encontrada", `<div class="card"><h1>Página não encontrada</h1><p>Este endereço não existe ou deixou de estar disponível. Peça à Direção o endereço atualizado.</p></div>`), { status: 404, headers: H });
  const e = snap.escola || "Escola Profissional da Ilha de São Jorge";
  const pct = f.tot ? Math.round(f.ok / f.tot * 100) : 100;
  const linhas = (f.itens || []).map(i => `<tr><td>${esc(i.turma)}</td><td>${esc(i.disc)}</td><td>${esc(i.mod)}</td><td class="f">${esc(i.falta)}</td><td>${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.loc || "abrir pasta")} ↗</a>` : esc(i.loc)}</td><td class="o">${esc(i.obs || "")}</td></tr>`).join("");
  const body = `<header><div><div class="esc">${esc(e)}</div><h1>Documentação em falta na Box</h1><p class="sub">${esc(f.nome)} · Ano letivo ${esc(snap.ano || "")} · verificado a ${dataPT(snap.t)}</p></div></header>
  <div class="tiles"><div class="tile"><b>${pct}%</b><span>entregue</span></div><div class="tile"><b class="${f.miss ? "bad" : "ok"}">${f.miss}</b><span>documento(s) em falta</span></div><div class="tile"><b>${f.ok}/${f.tot}</b><span>entregues</span></div>${snap.prazo ? `<div class="tile"><b>${esc(snap.prazo)}</b><span>prazo geral</span></div>` : ""}</div>
  <div class="bar"><i style="width:${pct}%"></i></div>
  ${f.miss ? `<div class="card"><table><thead><tr><th>Turma</th><th>Disciplina</th><th>Módulo/UFCD</th><th>Em falta</th><th>Onde colocar na Box</th><th>Observações</th></tr></thead><tbody>${linhas}</tbody></table></div>`
    : `<div class="card ok"><h2>Está tudo entregue. Obrigado!</h2></div>`}
  <p class="nota">Esta página é atualizada sempre que a Direção verifica a Box. Os documentos que colocar a partir de agora só desaparecem desta lista na próxima verificação. Clique na localização para abrir a pasta certa na Box.</p>`;
  return new Response(html("Documentação em falta — " + f.nome, body), { headers: H });
}
function html(t, b) {
  return `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(t)}</title><style>
  :root{--b:#0061d5;--ink:#0a0f1a;--mut:#64708a;--line:#e3e7ee;--bad:#dc2626;--ok:#15803d}
  *{box-sizing:border-box}body{margin:0;background:#f8f9fb;color:var(--ink);font:14.5px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px}
  main{max-width:1100px;margin:0 auto}header{margin-bottom:16px}.esc{font-size:12.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
  h1{margin:4px 0 2px;font-size:24px;letter-spacing:-.02em}.sub{margin:0;color:var(--mut)}
  .tiles{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 10px}.tile{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:150px}
  .tile b{display:block;font-size:22px}.tile span{color:var(--mut);font-size:13px}.bad{color:var(--bad)}.ok{color:var(--ok)}
  .bar{height:8px;background:#e9edf3;border-radius:9px;overflow:hidden;margin-bottom:16px}.bar i{display:block;height:100%;background:var(--b)}
  .card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:6px;overflow-x:auto}.card.ok,.card h1{padding:16px}
  table{border-collapse:collapse;width:100%;font-size:13.5px}th{text-align:left;color:var(--mut);font-weight:600;font-size:12.5px;padding:9px 8px;border-bottom:1px solid var(--line)}
  td{padding:9px 8px;border-bottom:1px solid #eef1f5;vertical-align:top}td.f{font-weight:600;color:var(--bad)}td.o{color:var(--mut);font-size:13px}
  a{color:var(--b);text-decoration:none}a:hover{text-decoration:underline}.nota{color:var(--mut);font-size:13px;margin-top:14px}
  @media(max-width:700px){thead{display:none}tr{display:block;border-bottom:1px solid var(--line);padding:8px}td{display:block;border:0;padding:2px 4px}}
  </style></head><body><main>${b}</main></body></html>`;
}
