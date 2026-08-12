// Enrollment em massa de uma campanha: inscreve todos os leads da organização
// no workflow vinculado à campanha, com campanha_id gravado na execução.
// O gate de envio (campanhas.dry_run) fica no ambiente — aqui só inscreve.
// Requer campaigns.manage. Idempotente: leads já inscritos são pulados.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarCampanha } from '@/lib/campanhas/repository'
import { SupabaseWorkflowStore } from '@/lib/workflows/store/supabaseStore'
import { inscreverLeadManual } from '@/lib/workflows'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.manage')) {
    return NextResponse.json({ erro: 'Sem permissão (campaigns.manage).' }, { status: 403 })
  }
  const { admin, org } = acc.acesso

  const campanha = await buscarCampanha(admin, org, id)
  if (!campanha) return NextResponse.json({ erro: 'Campanha não encontrada.' }, { status: 404 })
  if (!campanha.workflow_id)
    return NextResponse.json({ erro: 'Campanha sem workflow vinculado.' }, { status: 400 })

  // Leads elegíveis: têm e-mail, não estão perdidos, não optaram por saída.
  const { data: leads, error: eLead } = await createSupabaseAdminClient()
    .from('leads')
    .select('id')
    .eq('organizacao_id', org)
    .not('contato_email', 'is', null)
    .neq('contato_email', '')
    .or('perdido.is.null,perdido.eq.false')
    .or('optout.is.null,optout.eq.false')
    .limit(2000)
  if (eLead) return NextResponse.json({ erro: eLead.message }, { status: 500 })

  const store = new SupabaseWorkflowStore(org, admin)
  let inscritos = 0
  let jaInscritos = 0
  const erros: string[] = []

  for (const lead of leads ?? []) {
    try {
      const r = await inscreverLeadManual(store, campanha.workflow_id, lead.id, id)
      if (r.jaInscrito) jaInscritos++
      else inscritos++
    } catch (e) {
      erros.push(`${lead.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({
    ok: true,
    campanha_id: id,
    workflow_id: campanha.workflow_id,
    dry_run: campanha.dry_run ?? true,
    inscritos,
    ja_inscritos: jaInscritos,
    total: (leads?.length ?? 0),
    erros: erros.length > 0 ? erros : undefined,
  })
}
