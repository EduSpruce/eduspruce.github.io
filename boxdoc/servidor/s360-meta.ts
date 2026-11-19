// EPISJ 360 · Social360 — ligação às páginas do Facebook e contas do Instagram (API oficial da Meta)
// Função do Supabase «s360-meta» (verify_jwt desligado: a volta do Facebook chega sem sessão; a ida verifica a sessão à mão).
//  POST {acao:"inicio", ws}  (com a sessão do Office 365)  → endereço de autorização do Facebook
//  GET  ?code=…&state=…      (volta do Facebook)           → guarda as páginas e as contas do Instagram e fecha a janela
// Segredos: META_APP_ID, META_APP_SECRET (obrigatórios); META_CONFIG_ID (opcional, Facebook Login for Business); META_GRAPH_VER (opcional).
const VER = Deno.env.get("META_GRAPH_VER") || "v23.0";
const SCOPES = "pages_show_list,pages_read_engagement,pages_manage_posts,business_management,instagram_basic,instagram_content_publish,instagram_manage_comments";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
// As páginas HTML vindas do domínio supabase.co são mostradas como texto: a volta reencaminha para uma página do site da EPISJ 360
const VOLTA = Deno.env.get("S360_VOLTA") || "https://eduspruce.github.io/boxdoc/social360/meta-volta.html";
function pagina(titulo: string, texto: string, ok: boolean, n = 0, itens: string[] = []) {
  const p = new URLSearchParams({ ok: ok ? "1" : "0", t: titulo, m: texto, n: String(n) });
  itens.slice(0, 20).forEach(i => p.append("i", i));
  return new Response(null, { status: 302, headers: { Location: `${VOLTA}?${p}` } });
}
async function graph(path: string, params: Record<string, string>) {
  const u = `https://graph.facebook.com/${VER}/${path}?${new URLSearchParams(params)}`;
  const r = await fetch(u); const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `Facebook respondeu ${r.status}`);
  return j;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, anon = Deno.env.get("SUPABASE_ANON_KEY") || svc;
  const appId = Deno.env.get("META_APP_ID"), segredo = Deno.env.get("META_APP_SECRET"), cfgId = Deno.env.get("META_CONFIG_ID");
  const volta = `${url}/functions/v1/s360-meta`;
  const H = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

  if (req.method === "POST") {
    const corpo = await req.json().catch(() => ({}));
    if (corpo.acao !== "inicio") return json({ erro: "ação desconhecida" }, 400);
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ erro: "sem_sessao" }, 401);
    const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${jwt}` } });
    if (!u.ok) return json({ erro: "sem_sessao" }, 401);
    const eu = await u.json();
    const ws = String(corpo.ws || "");
    const papel = await fetch(`${url}/rest/v1/rpc/s360_papel`, { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_ws: ws }) });
    if ((await papel.json().catch(() => null)) !== "admin") return json({ erro: "sem_permissao" }, 403);
    if (!appId || !segredo) return json({ erro: "sem_app" });
    const estado = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await fetch(`${url}/rest/v1/s360_meta_pedidos?criado=lt.${new Date(Date.now() - 864e5).toISOString()}`, { method: "DELETE", headers: H });
    const g = await fetch(`${url}/rest/v1/s360_meta_pedidos`, { method: "POST", headers: H, body: JSON.stringify({ estado, ws, email: String(eu.email || "").toLowerCase() }) });
    if (!g.ok) return json({ erro: "não foi possível começar a ligação" }, 500);
    const p: Record<string, string> = { client_id: appId, redirect_uri: volta, state: estado, response_type: "code" };
    if (cfgId) p.config_id = cfgId; else p.scope = SCOPES;
    return json({ url: `https://www.facebook.com/${VER}/dialog/oauth?${new URLSearchParams(p)}` });
  }

  // volta do Facebook
  const q = new URL(req.url).searchParams;
  if (q.get("error")) return pagina("Ligação cancelada", q.get("error_description") || "A autorização não foi dada.", false);
  const code = q.get("code"), estado = q.get("state");
  if (!code || !estado) return pagina("Pedido inválido", "Falta o código de autorização. Volte a carregar em «Ligar ao Facebook e Instagram».", false);
  if (!appId || !segredo) return pagina("Ligação à Meta por configurar", "Falta a aplicação da Meta no servidor.", false);
  const r = await fetch(`${url}/rest/v1/s360_meta_pedidos?estado=eq.${encodeURIComponent(estado)}&select=ws,email,criado`, { headers: H });
  const [ped] = r.ok ? await r.json() : [];
  await fetch(`${url}/rest/v1/s360_meta_pedidos?estado=eq.${encodeURIComponent(estado)}`, { method: "DELETE", headers: H });
  if (!ped || Date.now() - new Date(ped.criado).getTime() > 15 * 60000) return pagina("O pedido expirou", "Passaram mais de 15 minutos. Volte a carregar em «Ligar ao Facebook e Instagram».", false);
  try {
    const curto = await graph("oauth/access_token", { client_id: appId, client_secret: segredo, redirect_uri: volta, code });
    const longo = await graph("oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: segredo, fb_exchange_token: curto.access_token });
    const paginas: Array<Record<string, any>> = [];
    let prox: string | null = `https://graph.facebook.com/${VER}/me/accounts?${new URLSearchParams({ fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100", access_token: longo.access_token })}`;
    while (prox && paginas.length < 500) { const x: Response = await fetch(prox); const j: any = await x.json(); if (j.error) throw new Error(j.error.message); paginas.push(...(j.data || [])); prox = j.paging?.next || null; }
    if (!paginas.length) return pagina("Nenhuma página encontrada", "A conta usada não gere nenhuma página do Facebook, ou não deu acesso às páginas. Entre com uma conta que seja administradora da página da escola e escolha a página quando o Facebook perguntar.", false);
    const linhas = paginas.map(p => ({ ws: ped.ws, fb_page_id: String(p.id), fb_page_name: String(p.name || ""), page_token: String(p.access_token), ig_user_id: p.instagram_business_account?.id || null, ig_username: p.instagram_business_account?.username || null, ligado_por: ped.email, ligado_em: new Date().toISOString(), estado: "ok", erro: "" }));
    const up = await fetch(`${url}/rest/v1/s360_meta?on_conflict=ws,fb_page_id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(linhas) });
    if (!up.ok) throw new Error(`não foi possível guardar (${up.status})`);
    const itens = linhas.map(l => `${l.fb_page_name} (Facebook)${l.ig_username ? ` e @${l.ig_username} (Instagram)` : ""}`);
    const semIg = linhas.every(l => !l.ig_user_id) ? "Nenhuma conta do Instagram veio ligada: a conta do Instagram tem de ser profissional e estar associada à página do Facebook." : "";
    return pagina("Ligado com sucesso", semIg, true, linhas.length, itens);
  } catch (e) {
    return pagina("Não foi possível ligar", (e as Error).message, false);
  }
});
