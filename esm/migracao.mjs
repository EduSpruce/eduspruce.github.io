// Migração repetível (idempotente) de uma cópia de segurança .json da EduSpruce para o formato «partes» (o mesmo da sincronização).
// Uso no navegador, com a app aberta: const m=await import('./esm/migracao.mjs'); const rel=await m.validar(objetoDaCopia);
export function validar(S){const rel={ok:true,avisos:[],contagens:{}};const ids=new Set();const dup=[];
  const conta=(k,n)=>rel.contagens[k]=(rel.contagens[k]||0)+n;
  if(!S||!Array.isArray(S.anos)){rel.ok=false;rel.avisos.push('A cópia não tem anos letivos.');return rel}
  S.anos.forEach(a=>{conta('anos',1);(a.turmas||[]).forEach(t=>{conta('turmas',1);if(ids.has(t.id))dup.push('turma '+t.id);ids.add(t.id);
    conta('alunos',(t.alunos||[]).length);conta('instrumentos',(t.instrumentos||[]).length);(t.alunos||[]).forEach(x=>{if(ids.has(x.id))dup.push('aluno '+x.id);ids.add(x.id)});
    (t.instrumentos||[]).forEach(i=>conta('classificacoes',Object.values(i.notas||{}).reduce((s,o)=>s+Object.keys(o||{}).length,0)))})});
  if(dup.length){rel.avisos.push(dup.length+' identificador(es) repetido(s): '+dup.slice(0,5).join(', '));}
  return rel}
/* a mesma divisão em partes que a sincronização usa (nvPartes), para que os ecrãs mostrem exatamente os mesmos dados */
export function partes(){if(typeof nvPartes!=='function')throw new Error('Abra a app antes de migrar.');return nvPartes()}
