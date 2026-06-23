// Demo do motor em MODO_ENSAIO contra o MemoryStore (não toca no Supabase nem
// envia e-mail). Mostra os 4 fluxos em sequência. Rode com: npm run engine:demo
import { MemoryStore } from './store/memoryStore'
import { SimulatedProvider } from './email/simulatedProvider'
import { Queue } from './queue'
import { executarAcao } from './flows/executarAcao'
import { detectarResposta } from './flows/detectarResposta'
import { direcionarCloser } from './flows/direcionarCloser'
import { followUp } from './flows/followUp'
import { log } from './logger'
import type { Lead } from './types'

async function main() {
  const closer = { id: 'u1', nome: 'João Closer', email: 'joao@inovacode.com.br' }

  const novo: Lead = {
    id: 'lead-novo', empresa: 'Acme Log', cidade: 'São Paulo', estado: 'SP',
    segmento: 'Logística', faixa_funcionarios: '50-200', contato_nome: 'Ana Souza',
    contato_cargo: 'Diretora', contato_email: 'ana@acmelog.com.br',
    canal_preferencial: 'email' as const, estagio: 'novos_leads', score: 80,
    responsavel_id: 'u1', origem: 'manual', perdido: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    owner: 'engine' as const, tese_comercial: 'RFID reduz perdas de carga em até 4%',
    dominio: 'acmelog.com.br',
  }
  const esperando: Lead = {
    ...novo, id: 'lead-fu', empresa: 'Beta Transportes', contato_email: 'carlos@beta.com.br',
    estagio: 'primeiro_contato', proxima_acao_data: new Date(Date.now() - 86400000).toISOString(),
    dominio: 'beta.com.br',
  }

  const store = new MemoryStore([novo, esperando], [closer])
  const email = new SimulatedProvider()
  const fila = new Queue()
  fila.registrar('direcionar_closer', (p) =>
    direcionarCloser(store, email, p as { leadId: string; textoResposta: string }),
  )

  log.info('==================  FLUXO 1 — Executar ação  ==================')
  await executarAcao(store, email, { leadId: 'lead-novo' })

  log.info('==================  FLUXO 4 — Follow-up  ======================')
  await followUp(store, email)

  log.info('==================  FLUXO 2 — Detectar resposta  ==============')
  email.injetar(
    { de: 'ferias@acmelog.com.br', assunto: 'Fora do escritório', corpo: 'Retorno dia 30', em: new Date() },
    { de: 'diretor@acmelog.com.br', assunto: 'Re: proposta', corpo: 'A Ana me encaminhou. Topo conversar!', em: new Date() },
  )
  await detectarResposta(store, email, fila)

  log.info('==================  FLUXO 3 — Direcionar ao closer  ===========')
  await fila.processar()

  log.info('==================  RESUMO  ===================================')
  log.info('E-mails simulados enviados', { total: email.enviados.length })
  log.info('Jobs no escaninho de erro', { total: fila.escaninhoErro().length })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
