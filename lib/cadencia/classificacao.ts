export const TIPOS_INTERACAO_ENVIO = ['abordagem', 'follow_up', 'nota']

export const ESTAGIOS_RESPONDEU_CADENCIA = ['interessado', 'respondeu', 'com_closer']

export type EtapaCadencia =
  | 'a_iniciar'
  | 'contato1'
  | 'followup1'
  | 'followup2'
  | 'followup3'
  | 'followup4'
  | 'respondeu'

const ETAPAS_ATIVAS = new Set<EtapaCadencia>([
  'contato1',
  'followup1',
  'followup2',
  'followup3',
  'followup4',
])

export function etapaPorEnvios(envios: number): EtapaCadencia {
  if (envios <= 0) return 'a_iniciar'
  if (envios === 1) return 'contato1'
  if (envios === 2) return 'followup1'
  if (envios === 3) return 'followup2'
  if (envios === 4) return 'followup3'
  return 'followup4'
}

export function etapaAtualDaCadencia(envios: number, estagio?: string | null): EtapaCadencia {
  return ESTAGIOS_RESPONDEU_CADENCIA.includes(estagio ?? '')
    ? 'respondeu'
    : etapaPorEnvios(envios)
}

export function etapaAtivaDaCadencia(etapa: EtapaCadencia): boolean {
  return ETAPAS_ATIVAS.has(etapa)
}
