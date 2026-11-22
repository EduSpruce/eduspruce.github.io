// EPISJ 360 — exportação completa da base de dados (Supabase), feita pelo servidor.
// Corre todos os dias (pg_cron, 04:17) mesmo com todos os computadores desligados; a Direção pode também pedir «Exportar agora».
// Guarda no bucket privado «g360-copias» (só a Direção lê):
//   diario/AAAA-MM-DD.json.gz   — todas as tabelas (estado, configuração, perfis, preferências, Social360…), só se algo mudou desde a última
//   historico/<de>-<ate>.json.gz — as versões antigas de g360_historico, só as novas (por id), em partes de ~15 MB; nunca se apagam
//   manifesto.json              — o que já foi exportado
// Ficam todas as cópias diárias dos últimos 30 dias e a primeira de cada mês (o plano gratuito tem 1 GB). Os dados na base nunca são tocados: só se lê.
// Não exporta segredos (códigos da Box, chave da página da Meta, valores de s360_cfg): numa reposição voltam a ligar-se.
// Chamada sem conta (pg_cron ou outra): faz no máximo uma cópia por dia. Chamada por uma conta da Direção: faz sempre.
const BUCKET = "g360-copias";
const DIAS_DIARIOS = 30;
const PARTE_HIST = 15 * 1024 * 1024;
const TEMPO = 110_000;

type Tab = { nome: string; sel: string; ord: string; omitidos?: string[] };
const TABELAS: Tab[] = [
  { nome: "g360_estado", sel: "*", ord: "nome" },
  { nome: "g360_config", sel: "*", ord: "chave" },
  { nome: "g360_config_historico", sel: "*", ord: "id" },
  { nome: "g360_membros", sel: "*", ord: "email" },
  { nome: "g360_prefs", sel: "*", ord: "email" },
  { nome: "g360_box", sel: "email,exp,t,login,nome,bloqueio_ate,morta,erro,renovada,atualizado", ord: "email", omitidos: ["a", "r"] },
  { nome: "g360_trincos", sel: "*", ord: "nome" },
  { nome: "s360_docs", sel: "*", ord: "col,id" },
  { nome: "s360_meta", sel: "ws,fb_page_id,fb_page_name,ig_user_id,ig_username,ligado_por,ligado_em,estado,erro", ord: "ws", omitidos: ["page_token"] },
  { nome: "s360_meta_pedidos", sel: "*", ord: "criado" },
  { nome: "s360_cfg", sel: "k", ord: "k", omitidos: ["v"] },
];

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const diaLx = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Atlantic/Azores" }).format(d); // AAAA-MM-DD

async function gz(txt: string): Promise<Blob> {
  const s = new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(s).blob();
}
async function sha(txt: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const inicio = Date.now();
  const url = Deno.env.get("SUPABASE_URL")!, chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  if (!url || !chave) return json({ ok: false, erro: "configuração em falta" }, 500);
  const H = { apikey: chave, Authorization: `Bearer ${chave}` };

  // quem pede? uma conta da Direção força a cópia; sem conta, só uma por dia
  let por = "servidor", forcar = false;
  const auth = req.headers.get("Authorization") || "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  if (tok && tok !== anon && tok !== chave && tok.split(".").length === 3) {
    const r = await fetch(`${url}/rest/v1/rpc/g360_direcao`, { method: "POST", headers: { apikey: anon, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
    if (r.ok && (await r.json()) === true) {
      forcar = true;
      try { por = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || "Direção"; } catch (_) { por = "Direção"; }
    } else return json({ ok: false, erro: "Só a Direção pode pedir uma exportação." }, 403);
  }

  const st = (p: string) => `${url}/storage/v1/object/${BUCKET}/${p}`;
  const guardar = async (p: string, corpo: Blob | string, tipo: string) => {
    const r = await fetch(st(p), { method: "POST", headers: { ...H, "Content-Type": tipo, "x-upsert": "true" }, body: corpo });
    if (!r.ok) throw new Error(`guardar ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  };
  const listar = async (prefixo: string) => {
    const out: Array<{ name: string }> = [];
    for (let off = 0; ; off += 1000) {
      const r = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: prefixo, limit: 1000, offset: off, sortBy: { column: "name", order: "asc" } }) });
      if (!r.ok) throw new Error(`listar ${r.status}`);
      const a = await r.json(); out.push(...a); if (a.length < 1000) break;
    }
    return out.filter((x) => x.name && !x.name.startsWith("."));
  };
  const ler = async (t: string, sel: string, ord: string, filtro = "", passo = 1000) => {
    const out: unknown[] = [];
    for (let off = 0; ; off += passo) {
      const r = await fetch(`${url}/rest/v1/${t}?select=${sel}&order=${ord}${filtro}&limit=${passo}&offset=${off}`, { headers: H });
      if (!r.ok) throw new Error(`ler ${t}: ${r.status}`);
      const a = await r.json(); out.push(...a); if (a.length < passo) break;
    }
    return out;
  };

  try {
    // manifesto
    let man: Record<string, any> = { hist_id: 0, ultimo_dia: null, hash: null, feitas: [] };
    { const r = await fetch(st("manifesto.json"), { headers: H }); if (r.ok) try { man = { ...man, ...(await r.json()) }; } catch (_) { /* recomeça */ } }
    const dia = diaLx();
    const res: Record<string, unknown> = { ok: true, dia, por };

    // 1) histórico: só as versões novas, por partes (nunca se apagam)
    // no máximo 2 partes por chamada (o plano gratuito limita o processamento); o resto segue na chamada seguinte
    let partes = 0, histFim = false;
    while (partes < 2 && Date.now() - inicio < TEMPO * 0.6) {
      const linhas: any[] = []; let tam = 0, fim = false;
      while (tam < PARTE_HIST) {
        const desde = linhas.length ? linhas[linhas.length - 1].id : man.hist_id;
        const r = await fetch(`${url}/rest/v1/g360_historico?select=*&id=gt.${desde}&order=id&limit=4`, { headers: H });
        if (!r.ok) throw new Error(`ler g360_historico: ${r.status}`);
        const a: any[] = await r.json();
        for (const x of a) { linhas.push(x); tam += (x.dados || "").length + 200; }
        if (a.length < 4) { fim = true; break; }
      }
      if (!linhas.length) { histFim = true; break; }
      const de = linhas[0].id, ate = linhas[linhas.length - 1].id;
      await guardar(`historico/${String(de).padStart(8, "0")}-${String(ate).padStart(8, "0")}.json.gz`,
        await gz(JSON.stringify({ app: "EPISJ 360", tipo: "g360_historico", de, ate, feita: new Date().toISOString(), linhas })), "application/gzip");
      man.hist_id = ate; partes++;
      await guardar("manifesto.json", JSON.stringify(man), "application/json");
      if (fim) { histFim = true; break; }
    }
    res.historico = { partes_novas: partes, ate_id: man.hist_id, completo: histFim };
    if (!histFim) return json({ ...res, diaria: "fica para a chamada seguinte (ainda há histórico por exportar)" });

    // 2) cópia diária de todas as outras tabelas
    if (!forcar && man.ultimo_dia === dia) return json({ ...res, diaria: "já feita hoje" });
    const tabelas: Record<string, unknown[]> = {}, omitidos: Record<string, string[]> = {};
    for (const t of TABELAS) { tabelas[t.nome] = await ler(t.nome, t.sel, t.ord); if (t.omitidos) omitidos[t.nome] = t.omitidos; }
    const corpo = JSON.stringify(tabelas);
    const h = await sha(corpo);
    if (!forcar && h === man.hash) {
      man.ultimo_dia = dia; await guardar("manifesto.json", JSON.stringify(man), "application/json");
      return json({ ...res, diaria: "sem alterações desde " + (man.feitas.at(-1) || "a última cópia") });
    }
    const txt = `{"app":"EPISJ 360","tipo":"exportacao-completa","formato":1,"feita":${JSON.stringify(new Date().toISOString())},"por":${JSON.stringify(por)},` +
      `"historico":${JSON.stringify({ ate_id: man.hist_id, onde: "historico/*.json.gz" })},"omitidos":${JSON.stringify(omitidos)},` +
      `"nota":"Exportação de leitura: os dados de g360_estado/g360_historico estão em texto gzip+base64, como na base de dados.","tabelas":${corpo}}`;
    const nome = `diario/${dia}.json.gz`;
    const bin = await gz(txt);
    await guardar(nome, bin, "application/gzip");
    man.ultimo_dia = dia; man.hash = h; man.feitas = [...(man.feitas || []).filter((x: string) => x !== dia), dia].slice(-400);
    await guardar("manifesto.json", JSON.stringify(man), "application/json");
    res.diaria = { ficheiro: nome, bytes: bin.size, linhas: Object.fromEntries(Object.entries(tabelas).map(([k, v]) => [k, v.length])) };

    // 3) guardar só os últimos 30 dias + a primeira cópia de cada mês (só ficheiros de cópia, nunca dados)
    const fich = (await listar("diario/")).map((x) => x.name).filter((n) => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).sort();
    const limite = diaLx(new Date(Date.now() - DIAS_DIARIOS * 864e5));
    const primeiroMes = new Set<string>(); const visto = new Set<string>();
    for (const n of fich) { const m = n.slice(0, 7); if (!visto.has(m)) { visto.add(m); primeiroMes.add(n); } }
    const sair = fich.filter((n) => n.slice(0, 10) < limite && !primeiroMes.has(n)).map((n) => `diario/${n}`);
    if (sair.length) await fetch(`${url}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: sair }) });
    res.arrumadas = sair.length;
    return json(res);
  } catch (e) {
    return json({ ok: false, erro: String((e as Error).message || e).slice(0, 300) }, 500);
  }
});
