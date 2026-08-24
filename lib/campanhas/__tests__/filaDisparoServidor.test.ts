import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkflowStore } from '@/lib/workflows'
import type { WorkflowStore } from '@/lib/workflows'
import {
  agendarExecucoesCampanha,
  INTERVALO_ENVIO_CAMPANHA_SEGUNDOS,
  montarAgendaDisparoCampanha,
  RETENCAO_FILA_CAMPANHA_SEGUNDOS,
  TOPICO_FILA_CAMPANHA,
  validarMensagemFilaCampanha,
} from '../filaDisparoServidor'

afterEach(() => {
  vi.useRealTimers()
})

describe('fila espaçada de campanhas', () => {
  it('agenda uma execução a cada dois minutos, sem duplicar ids', () => {
    const agenda = montarAgendaDisparoCampanha(
      'org-1',
      'campanha-1',
      ['exec-1', 'exec-2', 'exec-2', 'exec-3'],
      new Date('2026-08-24T14:00:00.000Z'),
    )

    expect(agenda.map((item) => item.delaySeconds)).toEqual([0, 120, 240])
    expect(agenda.map((item) => item.agendadoPara)).toEqual([
      '2026-08-24T14:00:00.000Z',
      '2026-08-24T14:02:00.000Z',
      '2026-08-24T14:04:00.000Z',
    ])
    expect(agenda[0].idempotencyKey).toBe('campanha:campanha-1:execucao:exec-1')
    expect(INTERVALO_ENVIO_CAMPANHA_SEGUNDOS).toBe(120)
  })

  it('persiste o horário e publica mensagens idempotentes na fila oficial', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T14:00:00.000Z'))
    const store = new MemoryWorkflowStore()
    const primeira = await store.criarExecucao({
      workflow_id: 'workflow-1',
      versao_id: 'versao-1',
      lead_id: 'lead-1',
      campanha_id: 'campanha-1',
    })
    const segunda = await store.criarExecucao({
      workflow_id: 'workflow-1',
      versao_id: 'versao-1',
      lead_id: 'lead-2',
      campanha_id: 'campanha-1',
    })
    const enfileirar = vi.fn().mockResolvedValue({ messageId: 'msg-1' })

    const resultado = await agendarExecucoesCampanha(
      store,
      'org-1',
      'campanha-1',
      [primeira.id, segunda.id],
      { agora: new Date(), enfileirar },
    )

    expect(resultado).toMatchObject({
      agendadas: 2,
      ignoradas: 0,
      primeiraExecucaoEm: '2026-08-24T14:00:00.000Z',
      ultimaExecucaoEm: '2026-08-24T14:02:00.000Z',
    })
    expect((await store.buscarExecucao(primeira.id))?.status).toBe('aguardando')
    expect((await store.buscarExecucao(segunda.id))?.proxima_verificacao_em).toBe('2026-08-24T14:02:00.000Z')
    expect(enfileirar).toHaveBeenNthCalledWith(
      1,
      TOPICO_FILA_CAMPANHA,
      { organizacaoId: 'org-1', campanhaId: 'campanha-1', execucaoId: primeira.id },
      {
        delaySeconds: 0,
        retentionSeconds: RETENCAO_FILA_CAMPANHA_SEGUNDOS,
        idempotencyKey: `campanha:campanha-1:execucao:${primeira.id}`,
      },
    )
    expect(enfileirar).toHaveBeenNthCalledWith(
      2,
      TOPICO_FILA_CAMPANHA,
      { organizacaoId: 'org-1', campanhaId: 'campanha-1', execucaoId: segunda.id },
      expect.objectContaining({ delaySeconds: 120 }),
    )
  })

  it('não agenda uma execução de outra campanha', async () => {
    const store = new MemoryWorkflowStore()
    const execucao = await store.criarExecucao({
      workflow_id: 'workflow-1',
      versao_id: 'versao-1',
      lead_id: 'lead-1',
      campanha_id: 'campanha-2',
    })
    const enfileirar = vi.fn()

    await expect(agendarExecucoesCampanha(
      store,
      'org-1',
      'campanha-1',
      [execucao.id],
      { enfileirar },
    )).resolves.toMatchObject({ agendadas: 0, ignoradas: 1 })
    expect(enfileirar).not.toHaveBeenCalled()
  })

  it('recusa um store preso a outra organização antes de ler execuções', async () => {
    const store = { organizacaoId: 'org-2' } as WorkflowStore
    await expect(agendarExecucoesCampanha(
      store,
      'org-1',
      'campanha-1',
      ['exec-1'],
    )).rejects.toThrow('organizações diferentes')
  })

  it('rejeita payload sem organização, campanha ou execução', () => {
    expect(() => validarMensagemFilaCampanha({ campanhaId: 'c', execucaoId: 'e' }))
      .toThrow('incompleta')
  })
})
