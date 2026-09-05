// Traduz a definição de workflow de uma campanha para uma sequência legível.
//
// A campanha materializa a cadência num workflow (ver materializarServidor), e
// até aqui a única forma de saber o que ela faz era abrir o builder. Isto lê a
// mesma definição e devolve "Dia 0 — E-mail 1 · assunto · espera 3 dias · Dia 3
// — E-mail 2", sem o usuário precisar entender blocos.
//
// Puro: sem I/O. As esperas viram deslocamento em dias acumulado; os assuntos
// vêm de `publico.operacao`, que é onde o wizard guarda o texto digitado (a
// definição carrega só a CHAVE do template materializado).
import type { BlocoConfig, DefinicaoWorkflow } from '@/lib/workflows/types'
import type { PublicoResumoOperacional } from './resumoOperacional'

export interface PassoCadencia {
  // Posição na sequência visível (1-based).
  ordem: number
  // Dias acumulados desde a entrada do lead na cadência.
  dia: number
  tipo: string
  // "E-mail 1", "WhatsApp 2", "Tarefa"…
  rotulo: string
  // Assunto da mensagem quando a campanha o registrou; null quando o passo não
  // tem texto próprio. NUNCA inventa: sem assunto configurado, fica null.
  detalhe: string | null
  // Dias esperados imediatamente antes deste passo (0 quando é logo em seguida).
  esperaAntes: number
}

const ROTULOS: Record<string, string> = {
  enviar_email: 'E-mail',
  enviar_whatsapp: 'WhatsApp',
  criar_tarefa: 'Tarefa',
  criar_tarefa_ligacao: 'Tarefa de ligação',
  criar_oportunidade: 'Criar oportunidade',
  notificar: 'Notificar responsável',
  atualizar_status: 'Atualizar status',
  mover_pipeline: 'Mover no pipeline',
  atribuir_responsavel: 'Atribuir responsável',
  adicionar_campanha: 'Adicionar a campanha',
  saltar_se: 'Condição',
  encerrar: 'Encerrar',
  continuar: 'Continuar',
}

// Tipos que recebem numeração própria — são os que o usuário conta ("o segundo
// e-mail"). Os demais aparecem sem número.
const NUMERADOS = new Set(['enviar_email', 'enviar_whatsapp'])

function num(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

// Uma espera pode vir em dias e/ou horas. Horas viram fração de dia e só sobem
// para o dia seguinte quando fecham 24h — assim "espera 12h" não vira "Dia 1".
function diasDaEspera(config: BlocoConfig['config']): number {
  const c = (config ?? {}) as { dias?: unknown; horas?: unknown }
  return num(c.dias) + num(c.horas) / 24
}

function assuntoDoEmail(indice: number, operacao: PublicoResumoOperacional['operacao']): string | null {
  if (indice === 1) return texto(operacao?.mensagemInicial?.assunto)
  return texto(operacao?.followups?.[indice - 2]?.assunto)
}

/**
 * Devolve a sequência da cadência em ordem. Lista vazia quando não há definição
 * ou ações — o chamador decide o que mostrar nesse caso.
 */
export function descreverCadencia(
  definicao: DefinicaoWorkflow | null | undefined,
  operacao?: PublicoResumoOperacional['operacao'],
): PassoCadencia[] {
  const acoes = definicao?.acoes
  if (!Array.isArray(acoes) || acoes.length === 0) return []

  const passos: PassoCadencia[] = []
  const contagem: Record<string, number> = {}
  let dia = 0
  let esperaPendente = 0

  for (const acao of acoes) {
    const tipo = typeof acao?.tipo === 'string' ? acao.tipo : ''
    if (!tipo) continue

    if (tipo === 'esperar') {
      const espera = diasDaEspera(acao.config)
      dia += espera
      esperaPendente += espera
      continue
    }

    const base = ROTULOS[tipo] ?? tipo
    let rotulo = base
    let detalhe: string | null = null
    if (NUMERADOS.has(tipo)) {
      contagem[tipo] = (contagem[tipo] ?? 0) + 1
      rotulo = `${base} ${contagem[tipo]}`
      if (tipo === 'enviar_email') detalhe = assuntoDoEmail(contagem[tipo], operacao)
    }

    passos.push({
      ordem: passos.length + 1,
      dia: Math.round(dia * 100) / 100,
      tipo,
      rotulo,
      detalhe,
      esperaAntes: Math.round(esperaPendente * 100) / 100,
    })
    esperaPendente = 0
  }

  return passos
}

/** "Dia 0" / "Dia 3" / "12h depois" — rótulo curto do momento do passo. */
export function rotuloDoDia(dia: number): string {
  if (dia <= 0) return 'Dia 0'
  if (dia < 1) return `${Math.round(dia * 24)}h depois`
  const inteiro = Math.floor(dia)
  const horas = Math.round((dia - inteiro) * 24)
  return horas ? `Dia ${inteiro} + ${horas}h` : `Dia ${inteiro}`
}

/** "espera 3 dias" / "espera 12h" — usado entre um passo e o seguinte. */
export function rotuloDaEspera(dias: number): string | null {
  if (dias <= 0) return null
  if (dias < 1) return `espera ${Math.round(dias * 24)}h`
  const inteiro = Math.floor(dias)
  const horas = Math.round((dias - inteiro) * 24)
  const base = `espera ${inteiro} ${inteiro === 1 ? 'dia' : 'dias'}`
  return horas ? `${base} e ${horas}h` : base
}
