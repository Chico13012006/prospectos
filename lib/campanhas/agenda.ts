// Regras client-safe da agenda de campanhas. O processador de produção roda
// diariamente; por isso a agenda operacional da campanha controla os DIAS em
// que execuções já inscritas podem avançar. O horário exato continua sendo o do
// cron da infraestrutura e não é prometido por esta camada.

export const DIAS_CAMPANHA = [
  { id: 'dom', label: 'Dom' },
  { id: 'seg', label: 'Seg' },
  { id: 'ter', label: 'Ter' },
  { id: 'qua', label: 'Qua' },
  { id: 'qui', label: 'Qui' },
  { id: 'sex', label: 'Sex' },
  { id: 'sab', label: 'Sáb' },
] as const

export type DiaCampanha = (typeof DIAS_CAMPANHA)[number]['id']

const DIAS_VALIDOS = new Set<string>(DIAS_CAMPANHA.map((dia) => dia.id))
const DIA_INTL: Record<string, DiaCampanha> = {
  Sun: 'dom',
  Mon: 'seg',
  Tue: 'ter',
  Wed: 'qua',
  Thu: 'qui',
  Fri: 'sex',
  Sat: 'sab',
}

export function normalizarDiasCampanha(valor: unknown): DiaCampanha[] {
  if (!Array.isArray(valor)) return []
  const recebidos = new Set(
    valor.filter((dia): dia is string => typeof dia === 'string' && DIAS_VALIDOS.has(dia)),
  )
  return DIAS_CAMPANHA.map((dia) => dia.id).filter((dia) => recebidos.has(dia))
}

export function validarDiasCampanha(valor: unknown): DiaCampanha[] {
  if (!Array.isArray(valor)) throw new Error('Informe os dias de execução da campanha.')
  const invalidos = valor.filter((dia) => typeof dia !== 'string' || !DIAS_VALIDOS.has(dia))
  if (invalidos.length) throw new Error('A agenda contém um dia inválido.')
  const dias = normalizarDiasCampanha(valor)
  if (!dias.length) throw new Error('Escolha ao menos um dia de execução.')
  return dias
}

export function diaCampanhaEmFuso(
  agoraISO: string,
  fuso = 'America/Sao_Paulo',
): DiaCampanha {
  const data = new Date(agoraISO)
  if (Number.isNaN(data.getTime())) throw new Error('Data inválida para avaliar a agenda da campanha.')
  const sigla = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: fuso }).format(data)
  const dia = DIA_INTL[sigla]
  if (!dia) throw new Error(`Não foi possível identificar o dia da semana no fuso ${fuso}.`)
  return dia
}

export function agendaPermiteProcessar(
  diasSemana: unknown,
  agoraISO: string,
  fuso = 'America/Sao_Paulo',
): boolean {
  // Compatibilidade aditiva: campanhas legadas, criadas antes de a agenda ser
  // persistida, mantêm o comportamento anterior (sem gate de dia). Uma agenda
  // explicitamente presente, porém vazia/inválida, não libera o processamento.
  if (diasSemana == null) return true
  const dias = normalizarDiasCampanha(diasSemana)
  if (!dias.length) return false
  return dias.includes(diaCampanhaEmFuso(agoraISO, fuso))
}

export function publicoComDiasAtualizados(
  publicoAtual: unknown,
  diasSemana: unknown,
): Record<string, unknown> {
  const dias = validarDiasCampanha(diasSemana)
  const publico = publicoAtual && typeof publicoAtual === 'object' && !Array.isArray(publicoAtual)
    ? publicoAtual as Record<string, unknown>
    : {}
  const agenda = publico.agenda && typeof publico.agenda === 'object' && !Array.isArray(publico.agenda)
    ? publico.agenda as Record<string, unknown>
    : {}
  return {
    ...publico,
    agenda: {
      ...agenda,
      diasSemana: dias,
    },
  }
}
