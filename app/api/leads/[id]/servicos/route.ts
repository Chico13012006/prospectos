// Serviços recorrentes (laudos) da EMPRESA de um lead (Fase 4.5). GET lista,
// POST cadastra. Auth por sessão + escopo de org. vencimento_em é calculado pelo
// trigger no banco (não é enviado pelo cliente).
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { leituraEntidadesLigada } from '@/lib/empresas/flag'
import { podeAcessarLead } from '@/lib/leads/acessoServidor'

export const runtime = 'nodejs'

async function empresaDoLead(admin: SupabaseClient, org: string, leadId: string): Promise<string | null> {
  const { data } = await admin.from('leads').select('empresa_id').eq('id', leadId).eq('organizacao_id', org).maybeSingle()
  return (data?.empresa_id as string | null) ?? null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  if (!(await podeAcessarLead(acc.acesso, id))) return NextResponse.json({ erro: 'Lead não encontrado' }, { status: 404 })

  // Escopo: a UI de laudos segue o mesmo flag org-scoped do LeadPanel.
  if (!(await leituraEntidadesLigada(admin, org))) return NextResponse.json({ empresaId: null, servicos: [] })

  const empresaId = await empresaDoLead(admin, org, id)
  if (!empresaId) return NextResponse.json({ empresaId: null, servicos: [] })

  const { data, error } = await admin
    .from('servicos_recorrentes')
    .select('id, tipo, realizado_em, periodicidade_valor, periodicidade_unidade, vencimento_em, status, responsavel_id, observacoes, arquivado')
    .eq('organizacao_id', org).eq('empresa_id', empresaId)
    .order('vencimento_em', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ empresaId, servicos: data ?? [] })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  if (!(await podeAcessarLead(acc.acesso, id))) return NextResponse.json({ erro: 'Lead não encontrado' }, { status: 404 })

  if (!(await leituraEntidadesLigada(admin, org))) return NextResponse.json({ erro: 'Recurso não habilitado para esta organização' }, { status: 403 })

  const empresaId = await empresaDoLead(admin, org, id)
  if (!empresaId) return NextResponse.json({ erro: 'Lead sem empresa vinculada' }, { status: 400 })

  const b = await req.json()
  const unidade = ['dias', 'meses', 'anos'].includes(b.periodicidade_unidade) ? b.periodicidade_unidade : null
  const { data, error } = await admin.from('servicos_recorrentes').insert({
    organizacao_id: org,
    empresa_id: empresaId,
    tipo: typeof b.tipo === 'string' && b.tipo.trim() ? b.tipo.trim() : null,
    realizado_em: b.realizado_em || null,
    periodicidade_valor: Number.isFinite(b.periodicidade_valor) ? b.periodicidade_valor : null,
    periodicidade_unidade: unidade,
    status: ['vigente', 'vencido', 'renovado', 'cancelado'].includes(b.status) ? b.status : 'vigente',
    responsavel_id: b.responsavel_id || null,
    observacoes: typeof b.observacoes === 'string' ? b.observacoes : null,
    origem: 'manual',
  }).select('id').single()
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data.id })
}
