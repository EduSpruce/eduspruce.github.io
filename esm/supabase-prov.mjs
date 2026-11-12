// Fornecedor «Base de dados EduSpruce» (Supabase): a conta (entra-se com Google) e os dados de cada professor.
//   sessao() · guardada() · entrarGoogle() · sair() · autorizado() · tempoReal()
//   lista() → {nome: tamanho} · lerDados() → {nome: texto} · ler(nome) → texto|null · escrever(nome, texto) · criar(nome, texto) · apagar(nome)
// O texto dos dados chega já cifrado pela app (AES-256-GCM); a chave fica guardada na conta, na linha «conta-chave».
const CHAVE_SESSAO='eduspruce.sb';
const eRede=e=>{const m=(e&&e.message)||String(e||'');return /Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout|aborted/i.test(m)||(e&&(e.name==='AuthRetryableFetchError'||e.status===0||e.status>=500))};
const msg=e=>{const c=e&&e.code,m=(e&&e.message)||String(e);let x;
  if(c==='42501'||/row-level security|permission denied/i.test(m)){x=new Error('A base de dados recusou a operação ('+String(m).slice(0,160)+').');x.semAcesso=true;x.recusa=true}
  else if(c==='PGRST205'||/does not exist|schema cache/i.test(m))x=new Error('A base de dados ainda não foi preparada (falta correr o script SQL).');
  else if(eRede(e)){x=new Error('Sem ligação à base de dados. Verifique a internet ou se a rede da escola a bloqueia.');x.rede=true}
  else if(c==='PGRST301'||/JWT|401|invalid.*token|not authenticated/i.test(m)){x=new Error('A sessão terminou. Entre de novo com a sua conta Google.');x.semSessao=true}
  else x=new Error('Base de dados: '+m);
  x.code=c;return x};
const perfil=u=>{const m=(u&&u.user_metadata)||{};return {id:u.id,email:String(u.email||'').toLowerCase(),nome:m.full_name||m.name||'',foto:m.avatar_url||m.picture||''}};
export async function criarProvSupabase({url,anonKey,tabela='eduspruce_partes'}){
  const {createClient}=await import('./supabase-2.117.3.min.js');
  /* versão da app em cada pedido: a base de dados só aceita gravações de versões seguras (cópias antigas guardadas noutros aparelhos não escrevem por cima) */
  let ver='0.940';try{const v=new URL(import.meta.url).searchParams.get('v');if(v&&/^\d+\.\d+/.test(v))ver=v.replace(/[^0-9.]/g,'')}catch(_){}
  const sb=createClient(url,anonKey,{global:{headers:{'x-es-ver':ver}},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce',storageKey:CHAVE_SESSAO}});
  const uid=async()=>{const {data,error}=await sb.auth.getSession();if(data&&data.session)return data.session.user.id;if(error&&eRede(error))throw msg(error);const e=new Error('A sessão terminou. Entre de novo com a sua conta Google.');e.semSessao=true;throw e};
  const ok=r=>{if(r.error)throw msg(r.error);return r.data};
  return {n:'Base de dados EduSpruce',cliente:sb,
    /* conta com sessão neste aparelho (confirma e renova a sessão); null = sem sessão; lança erro .rede se não houver internet para a renovar */
    async sessao(){const {data,error}=await sb.auth.getSession();if(data&&data.session)return perfil(data.session.user);if(error&&eRede(error))throw msg(error);return null},
    aoMudar(cb){try{sb.auth.onAuthStateChange((ev,ses)=>{setTimeout(()=>{try{cb(ev,ses?perfil(ses.user):null)}catch(_){}},0)})}catch(_){}},
    async entrarGoogle(email){const qp=email?{login_hint:email}:{prompt:'select_account'};const {error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname,queryParams:qp}});if(error)throw msg(error)},
    /* entrada alternativa: e-mail e palavra-passe da mesma conta (definida pelo próprio em Definições) */
    async entrarSenha(email,senha){const {error}=await sb.auth.signInWithPassword({email:String(email||'').trim().toLowerCase(),password:String(senha||'')});if(!error)return;const m=error.message||'';
      if(/invalid login credentials/i.test(m))throw new Error('E-mail ou palavra-passe errados (ou esta conta ainda não tem palavra-passe definida).');
      if(/email logins are disabled|provider is not enabled|signups not allowed/i.test(m))throw new Error('A entrada por e-mail está desligada na base de dados (Supabase › Authentication › Sign In / Providers › Email).');
      if(/email not confirmed/i.test(m))throw new Error('O e-mail desta conta ainda não foi confirmado.');if(/rate limit|too many/i.test(m))throw new Error('Demasiadas tentativas. Espere um pouco e tente de novo.');throw msg(error)},
    async definirSenha(senha){const {error}=await sb.auth.updateUser({password:String(senha||'')});if(!error)return;const m=error.message||'';
      if(/reauth|recent/i.test(m))throw new Error('Por segurança, termine a sessão, entre de novo com Google e defina logo a palavra-passe.');
      if(/weak|at least|should be|characters|pwned/i.test(m))throw new Error('Palavra-passe fraca: '+m);if(/same.*password|different from the old/i.test(m))throw new Error('Essa já é a palavra-passe atual.');throw msg(error)},
    async autorizado(){
      /* pede a verificação com o testemunho da sessão posto explicitamente no pedido (não depende do cliente) */
      const tok=async()=>{const {data}=await sb.auth.getSession();return data&&data.session&&data.session.access_token};
      const pedir=async t=>{const h={apikey:anonKey,'Content-Type':'application/json','x-es-ver':ver};if(t)h.Authorization='Bearer '+t;
        const r=await fetch(url+'/rest/v1/rpc/eduspruce_autorizado',{method:'POST',headers:h,body:'{}',cache:'no-store'});const tx=await r.text();return {st:r.status,tx}};
      let t=await tok(),r=await pedir(t);
      if(r.st!==200||r.tx.trim()!=='true'){try{await sb.auth.refreshSession()}catch(_){}t=await tok();r=await pedir(t)}
      if(r.st===200&&r.tx.trim()==='true')return true;
      let info='';try{if(!t)info='sem sessão';else{const j=JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        const u=await fetch(url+'/auth/v1/user',{headers:{apikey:anonKey,Authorization:'Bearer '+t}});
        info='papel '+j.role+', e-mail no testemunho '+(j.email||'(nenhum)')+', servidor de contas '+u.status+', alg '+(JSON.parse(atob(t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'))).alg||'?')}}catch(_){}
      if(r.st===200&&r.tx.trim()==='false'){
        /* sessão válida no servidor de contas mas a base de dados não a vê: algo no aparelho (bloqueador como o AdGuard) está a mexer nos pedidos */
        try{if(t){const u=await fetch(url+'/auth/v1/user',{headers:{apikey:anonKey,Authorization:'Bearer '+t}});if(u.ok){const e=new Error('Um bloqueador de anúncios ou de privacidade neste aparelho (por exemplo o AdGuard) está a alterar os pedidos à base de dados. Acrescente eduspruce.pt e supabase.co às exceções do bloqueador (ou desligue a «filtragem HTTPS» para supabase.co) e entre de novo.');e.detalhe=true;e.bloqueador=true;throw e}}}catch(e){if(e&&e.bloqueador)throw e}
        return false}
      const e=new Error('A verificação da conta falhou na base de dados ('+r.st+': '+r.tx.slice(0,140)+(info?' · '+info:'')+').');e.detalhe=true;throw e},
    async diagAut(){const {data}=await sb.auth.getSession();const t=data&&data.session&&data.session.access_token;if(!t)return 'sem sessão';
      const j=JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));const u=await fetch(url+'/auth/v1/user',{headers:{apikey:anonKey,Authorization:'Bearer '+t}});
      const hd=JSON.parse(atob(t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));let q='';try{const r=await fetch(url+'/rest/v1/rpc/eduspruce_quem',{method:'POST',headers:{apikey:anonKey,'Content-Type':'application/json',Authorization:'Bearer '+t},body:'{}',cache:'no-store'});q=' · bd '+r.status+' '+(await r.text()).slice(0,220)}catch(e){q=' · bd erro '+e.message}
      return 'papel '+j.role+' · e-mail '+(j.email||'(nenhum)')+' · uid '+String(j.sub||'').slice(0,8)+' · contas '+u.status+' · alg '+(hd.alg||'?')+' · kid '+String(hd.kid||'-').slice(0,8)+' · iss '+String(j.iss||'').replace(/^https?:\/\//,'').slice(0,40)+q},
    tempoReal(uid,cb){try{const c=sb.channel('es-'+uid).on('postgres_changes',{event:'*',schema:'public',table:'eduspruce_sinal',filter:'user_id=eq.'+uid},()=>cb()).subscribe();return c}catch(e){console.warn('[EduSpruce] tempo real indisponível',e);return null}},
    async sair(){try{await sb.auth.signOut({scope:'local'})}catch(_){}},
    async lista(){await uid();const o={};let de=0;for(;;){const d=ok(await sb.from(tabela).select('nome,tamanho').order('nome').range(de,de+999));d.forEach(r=>o[r.nome]=r.tamanho);if(d.length<1000)break;de+=1000}return o},
    /* tudo o que é preciso para abrir, num só pedido: todas as linhas da conta menos as fotografias e anexos (ef-f-…), que chegam depois */
    async lerDados(){await uid();const o={};let de=0;for(;;){const d=ok(await sb.from(tabela).select('nome,conteudo').not('nome','like','ef-f-%').order('nome').range(de,de+199));d.forEach(r=>o[r.nome]=r.conteudo);if(d.length<200)break;de+=200}return o},
    async ler(nome){await uid();const d=ok(await sb.from(tabela).select('conteudo').eq('nome',nome).maybeSingle());return d?d.conteudo:null},
    async escrever(nome,texto){const u=await uid();ok(await sb.from(tabela).upsert({user_id:u,nome,conteudo:texto,tamanho:texto.length,atualizado:new Date().toISOString()},{onConflict:'user_id,nome'}))},
    /* cria só se ainda não existir (nunca escreve por cima): devolve true se criou */
    async criar(nome,texto){const u=await uid();const r=await sb.from(tabela).insert({user_id:u,nome,conteudo:texto,tamanho:texto.length,atualizado:new Date().toISOString()});if(r.error){if(r.error.code==='23505'||/duplicate key/i.test(r.error.message||''))return false;throw msg(r.error)}return true},
    async apagar(nome){await uid();ok(await sb.from(tabela).delete().eq('nome',nome))}}}
