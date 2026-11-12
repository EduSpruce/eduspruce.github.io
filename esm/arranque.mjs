// EduSpruce · ligação à base de dados (ES Modules). A configuração vem embutida na página (window.__ES_SB);
// se não vier, lê-se o supabase-config.json. Sem configuração ativa, a app funciona sem base de dados.
window.EduSpruceModerno={ativo:false,pronto:false};
const v=new URL(import.meta.url).searchParams.get('v')||'';const q=v?'?v='+encodeURIComponent(v):'';
let cfg=window.__ES_SB||null;
if(!cfg)cfg=await fetch('supabase-config.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
if(cfg&&cfg.ativo&&cfg.url&&cfg.anonKey){
  let erro='';
  for(let i=0;i<3;i++){ /* uma falha de rede ao carregar não deixa a app sem base de dados: tenta de novo */
    try{const {criarProvSupabase}=await import('./supabase-prov.mjs'+q+(i?(q?'&':'?')+'t='+i:''));window.EduSpruceModerno={ativo:true,pronto:true,supabase:await criarProvSupabase(cfg)};erro='';break}
    catch(e){erro=e.message;await new Promise(r=>setTimeout(r,600*(i+1)))}}
  if(erro){window.EduSpruceModerno={ativo:true,pronto:true,erro:'Não foi possível ligar à base de dados. Verifique a internet.'};console.warn('[EduSpruce] base de dados indisponível:',erro)}
  else console.info('[EduSpruce] base de dados disponível')}
else window.EduSpruceModerno={ativo:false,pronto:true,erro:'A base de dados não está configurada.'};
try{window.dispatchEvent(new Event('es-bd'))}catch(_){}
