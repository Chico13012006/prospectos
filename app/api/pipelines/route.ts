// Pipelines + estágios da organização (Fase 9, leitura). Tabelas reais da
// migration 0014. Org-scoped. Usado pela tela Configurações > Processo comercial.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const { data: pipelines } = await admin
    .from('pipelines').select('id, nome, tipo, ativo, ordem').eq('organizacao_id', org).order('ordem')
  const { data: estagios } = await admin
    .from('pipeline_estagios').select('id, pipeline_id, chave, nome, ordem, cor, papel, ativo')
    .eq('organizacao_id', org).order('ordem')
  return NextResponse.json({
    pipelines: (pipelines ?? []).map((p) => ({ ...p, estagios: (estagios ?? []).filter((e) => e.pipeline_id === p.id) })),
  })
}
