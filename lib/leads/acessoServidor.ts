import 'server-only'
import type { AcessoServidor } from '@/lib/rbac/servidor'
import { resolverResponsavelPorAuthId } from './responsavelServer'

export async function podeAcessarLead(acesso: AcessoServidor, leadId: string): Promise<boolean> {
  const { admin, org, role, user } = acesso
  const { data: lead, error } = await admin
    .from('leads')
    .select('responsavel_id, responsavel_nome')
    .eq('organizacao_id', org)
    .eq('id', leadId)
    .maybeSingle()
  if (error || !lead) return false
  if (role === 'admin') return true

  const vinculo = await resolverResponsavelPorAuthId(admin, org, user.id)
  if (!vinculo.ok) return false
  if (lead.responsavel_id === vinculo.usuario.id) return true
  return !lead.responsavel_id
    && !!vinculo.usuario.nome
    && typeof lead.responsavel_nome === 'string'
    && lead.responsavel_nome.toLocaleLowerCase('pt-BR').startsWith(vinculo.usuario.nome.toLocaleLowerCase('pt-BR'))
}
