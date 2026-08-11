// Modelos (templates) de workflow prontos — Fase 11. São PONTOS DE PARTIDA que o
// builder oferece; usam apenas blocos JÁ registrados (blocos.ts). Catálogo
// estático (não polui o banco): materializar como rascunho numa org é opcional,
// via scripts/seed-workflow-modelos.ts. Não toca no motor de cadência.
import type { DefinicaoWorkflow } from './types'

export interface ModeloWorkflow {
  chave: string
  nome: string
  descricao: string
  definicao: DefinicaoWorkflow
}

export const MODELOS: ModeloWorkflow[] = [
  {
    chave: 'prospeccao_0_3_7',
    nome: 'Prospecção 0/3/7',
    descricao: 'Abordagem no dia 0, follow-up no dia 3 e no dia 7. Inscrição manual ou por gatilho.',
    definicao: {
      gatilho: { tipo: 'manual', config: {} },
      condicoes: [],
      acoes: [
        { tipo: 'enviar_email', config: { template: 'primeiro_contato' } },
        { tipo: 'esperar', config: { dias: 3, horas: 0 } },
        { tipo: 'enviar_email', config: { template: 'follow_up_1' } },
        { tipo: 'esperar', config: { dias: 4, horas: 0 } },
        { tipo: 'enviar_email', config: { template: 'follow_up_1' } },
      ],
    },
  },
  {
    chave: 'renovacao_45d',
    nome: 'Renovação 45 dias',
    descricao: 'Quando uma data do lead vence em até 45 dias: cria a tarefa de renovação e envia a 1ª mensagem.',
    definicao: {
      gatilho: { tipo: 'campo_data_vence', config: { campo: 'proxima_acao_data', dias: 45 } },
      condicoes: [],
      acoes: [
        { tipo: 'criar_tarefa', config: { titulo: 'Iniciar renovação' } },
        { tipo: 'enviar_email', config: { template: 'renovacao_1' } },
      ],
    },
  },
]

export function modeloPorChave(chave: string): ModeloWorkflow | undefined {
  return MODELOS.find((m) => m.chave === chave)
}
