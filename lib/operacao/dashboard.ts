import { diasAteVencimento, formatarDataIsoSemFuso } from '@/lib/servicos/vencimento'

export interface RegistroControleVencimento {
  id: string
  fonte: 'servico' | 'lead_legado'
  leadId: string | null
  empresaId: string | null
  empresa: string
  tipo: string
  vencimentoEm: string
}

export interface ClienteControleVencimento {
  chave: string
  leadId: string | null
  empresaId: string | null
  empresa: string
  vencimentoMaisProximo: string
  diasRestantes: number
  status: 'vencido' | 'critico' | 'atencao' | 'no_prazo'
  motivos: { id: string; tipo: string; vencimentoEm: string; diasRestantes: number }[]
}

export interface ResumoEmpresasVencimento {
  vencidas: number
  proximos30: number
  entre31e60: number
  proximos60: number
  totalMonitoradas: number
}

export function statusVencimento(dias: number): ClienteControleVencimento['status'] {
  if (dias < 0) return 'vencido'
  if (dias <= 7) return 'critico'
  if (dias <= 30) return 'atencao'
  return 'no_prazo'
}

// A unidade visual é o cliente, não o laudo. Todos os motivos conhecidos são
// agrupados e ordenados pelo prazo mais urgente, para uma campanha poder gerar
// uma única conversa mesmo quando há mais de um documento a renovar.
export function agruparVencimentosPorCliente(
  registros: RegistroControleVencimento[],
  hoje = new Date(),
  limite = 6,
): ClienteControleVencimento[] {
  const grupos = new Map<string, ClienteControleVencimento>()

  const validos = registros.flatMap((registro) => {
    const dias = diasAteVencimento(registro.vencimentoEm, hoje)
    if (dias === null || !formatarDataIsoSemFuso(registro.vencimentoEm)) return []
    return [{ registro, dias }]
  }).sort((a, b) => a.dias - b.dias || a.registro.id.localeCompare(b.registro.id))

  for (const { registro, dias } of validos) {
    const chave = registro.empresaId
      ? `empresa:${registro.empresaId}`
      : registro.leadId
        ? `lead:${registro.leadId}`
        : `registro:${registro.fonte}:${registro.id}`
    const atual = grupos.get(chave)
    const motivo = { id: registro.id, tipo: registro.tipo, vencimentoEm: registro.vencimentoEm, diasRestantes: dias }
    if (atual) {
      atual.motivos.push(motivo)
      continue
    }
    grupos.set(chave, {
      chave,
      leadId: registro.leadId,
      empresaId: registro.empresaId,
      empresa: registro.empresa || 'Cliente sem nome',
      vencimentoMaisProximo: registro.vencimentoEm,
      diasRestantes: dias,
      status: statusVencimento(dias),
      motivos: [motivo],
    })
  }

  return [...grupos.values()].slice(0, Math.max(0, limite))
}

// As faixas são exclusivas e usam a validade mais urgente de cada empresa.
// Assim, uma empresa com vários laudos aparece uma única vez no resumo e nunca
// infla simultaneamente os cartões de 30 e 60 dias.
export function resumirEmpresasVencimento(
  registros: RegistroControleVencimento[],
  hoje = new Date(),
): ResumoEmpresasVencimento {
  const clientes = agruparVencimentosPorCliente(registros, hoje, Number.MAX_SAFE_INTEGER)
  const resumo: ResumoEmpresasVencimento = {
    vencidas: 0,
    proximos30: 0,
    entre31e60: 0,
    proximos60: 0,
    totalMonitoradas: clientes.length,
  }

  for (const cliente of clientes) {
    const dias = cliente.diasRestantes
    if (dias < 0) resumo.vencidas += 1
    else if (dias <= 30) resumo.proximos30 += 1
    else if (dias <= 60) resumo.entre31e60 += 1
  }
  resumo.proximos60 = resumo.proximos30 + resumo.entre31e60
  return resumo
}
