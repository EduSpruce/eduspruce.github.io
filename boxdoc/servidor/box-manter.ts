// DESLIGADA na EPISJ 360 0.9.70 (tarefa episj360-box-manter em pausa): a Box passa a ser renovada só no navegador de quem
// usa o Box360, uma vez por código, sem pedidos de madrugada a partir de servidores. Fica aqui só como registo.
// EPISJ 360 — função box-manter do Supabase (publicada pelo Claude; guardada aqui para referência).
// Mantém viva a ligação à Box guardada no cofre (tabela g360_box): corre uma vez por dia (pg_cron, 03:41 UTC) e renova
// as ligações com mais de 4 dias, para nunca caducarem por falta de uso (a Box deita fora o código ao fim de 60 dias sem uso).
// Prudente: se a Box recusar, tenta outra vez passados uns segundos; só dá a ligação por perdida à segunda recusa, noutro dia.
// Não devolve nem regista códigos: só conta quantas renovou.
const SERVICO_LOGIN = "https://boxdoc-login.joel-cunha83.workers.dev";
const DIAS = 4;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function renovar(r: string): Promise<{ estado: number; j: Record<string, unknown> }> {
  try {
    const res = await fetch(`${SERVICO_LOGIN}/refresh`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://eduspruce.github.io" }, body: JSON.stringify({ refresh_token: r }) });
    return { estado: res.status, j: await res.json().catch(() => ({})) };
  } catch (_) { return { estado: 0, j: {} }; }
}
const recusa = (estado: number, j: Record<string, unknown>) => estado === 400 || estado === 401 || /invalid_grant|invalid_token|expired|revoked|refresh token/i.test(JSON.stringify(j || {}));
Deno.serve(async () => {
  const url = Deno.env.get("SUPABASE_URL"), chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chave) return json({ ok: false, erro: "configuração em falta" }, 500);
  const H = { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" };
  const agora = Date.now(), limite = agora - DIAS * 864e5;
  const q = await fetch(`${url}/rest/v1/g360_box?select=email,r,t,bloqueio_ate,erro,atualizado&morta=eq.false&t=lt.${limite}`, { headers: H });
  if (!q.ok) return json({ ok: false, erro: `leitura ${q.status}` }, 500);
  const linhas: Array<{ email: string; r: string; t: number; bloqueio_ate: number; erro: string | null; atualizado: string }> = await q.json();
  let renovadas = 0, falhas = 0, recusadas = 0, mortas = 0;
  for (const x of linhas) {
    if (!x.r || x.r === "-" || (x.bloqueio_ate || 0) > agora) continue;
    const em = encodeURIComponent(x.email);
    const vez = await fetch(`${url}/rest/v1/g360_box?email=eq.${em}&t=eq.${x.t}&bloqueio_ate=lt.${agora}`, { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ bloqueio_ate: agora + 45000 }) });
    const tem = vez.ok ? await vez.json() : [];
    if (!Array.isArray(tem) || !tem.length) continue;
    let { estado, j } = await renovar(x.r);
    // 0.9.70: um código recusado nunca volta a ser enviado (cada código de renovação só serve uma vez)
    const agoraIso = new Date().toISOString();
    if (estado >= 200 && estado < 300 && typeof j.access_token === "string") {
      await fetch(`${url}/rest/v1/g360_box?email=eq.${em}`, { method: "PATCH", headers: H, body: JSON.stringify({ a: j.access_token, r: (j.refresh_token as string) || x.r, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 120000, t: Date.now(), bloqueio_ate: 0, erro: null, renovada: agoraIso, atualizado: agoraIso }) });
      renovadas++; continue;
    }
    const msg = String(j.erro || j.error_description || j.error || `estado ${estado}`).slice(0, 250);
    if (recusa(estado, j)) {
      const antes = (x.erro || "").startsWith("recusada:") && (agora - Date.parse(x.atualizado || "")) > 12 * 3600e3;
      await fetch(`${url}/rest/v1/g360_box?email=eq.${em}`, { method: "PATCH", headers: H, body: JSON.stringify(antes ? { bloqueio_ate: 0, morta: true, erro: msg, atualizado: agoraIso } : { bloqueio_ate: 0, erro: "recusada: " + msg, atualizado: agoraIso }) });
      if (antes) mortas++; else recusadas++;
    } else {
      await fetch(`${url}/rest/v1/g360_box?email=eq.${em}`, { method: "PATCH", headers: H, body: JSON.stringify({ bloqueio_ate: 0, erro: "falha passageira: " + msg, atualizado: agoraIso }) });
      falhas++;
    }
  }
  return json({ ok: true, vistas: linhas.length, renovadas, falhas, recusadas, mortas });
});
