import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  buscarCampanha: vi.fn(),
  atualizarCampanha: vi.fn(),
  materializarCampanhaGuiada: vi.fn(),
  buscarPreviaPublicoCampanha: vi.fn(),
  buscarWorkflow: vi.fn(),
  publicar: vi.fn(),
  retomar: vi.fn(),
  inscreverLeadManual: vi.fn(),
}))

vi.mock('../repository', () => ({
  buscarCampanha: mocks.buscarCampanha,
  atualizarCampanha: mocks.atualizarCampanha,
}))

vi.mock('../materializarServidor', () => ({
  materializarCampanhaGuiada: mocks.materializarCampanhaGuiada,
}))

vi.mock('../publicoServidor', () => ({
  buscarPreviaPublicoCampanha: mocks.buscarPreviaPublicoCampanha,
}))

vi.mock('@/lib/workflows', () => ({
  SupabaseWorkflowStore: class {
    buscarWorkflow = mocks.buscarWorkflow
  },
  publicar: mocks.publicar,
  retomar: mocks.retomar,
  inscreverLeadManual: mocks.inscreverLeadManual,
}))

import { iniciarCampanhaReal } from '../ativacaoServidor'

const admin = {} as SupabaseClient
const publico = {
  responsavel_id: 'responsavel-1',
  agenda: { diasSemana: ['seg', 'ter', 'qua', 'qui', 'sex'] },
  selecao: { modo: 'manual' as const, leadIds: ['lead-1', 'lead-2'] },
  operacao: {
    remetenteEmail: 'remetente@empresa.com.br',
    mensagemInicial: { assunto: 'Uma conversa rápida', corpo: 'Olá, {nome}.' },
    resposta: {
      notificarResponsavel: true,
      emailAssunto: 'Novo retorno',
      emailCorpo: 'O contato respondeu.',
    },
  },
}

const campanhaRascunho = {
  id: 'campanha-1',
  nome: 'Prospecção agosto',
  tipo: 'prospeccao',
  status: 'rascunho',
  dry_run: true,
  workflow_id: null,
  publico,
}

const campanhaAtiva = {
  ...campanhaRascunho,
  status: 'ativa',
  workflow_id: 'workflow-1',
}

function previa(ids: string[]) {
  return {
    totalSelecionado: ids.length,
    totalEmpresas: ids.length,
    totalEmpresasSelecionadas: ids.length,
    emailsValidos: ids.length,
    emailsAusentesOuInvalidos: 0,
    duplicados: 0,
    bloqueados: 0,
    semResponsavel: 0,
    incompativeis: 0,
    elegiveis: ids.length,
    truncado: false,
    idsElegiveis: ids,
    amostra: [],
    empresas: [],
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.materializarCampanhaGuiada.mockResolvedValue({ publico, workflowId: 'workflow-1' })
  mocks.buscarWorkflow
    .mockResolvedValueOnce({ id: 'workflow-1', status: 'rascunho', rascunho_definicao: { acoes: [] } })
    .mockResolvedValueOnce({ id: 'workflow-1', status: 'publicado', versao_atual_id: 'versao-1' })
  mocks.publicar.mockResolvedValue({})
  mocks.atualizarCampanha.mockResolvedValue(undefined)
})

describe('início real de campanha guiada', () => {
  it('publica o workflow e cria inscrições idempotentes para o público confirmado', async () => {
    mocks.buscarCampanha
      .mockResolvedValueOnce(campanhaRascunho)
      .mockResolvedValueOnce(campanhaAtiva)
    mocks.buscarPreviaPublicoCampanha
      .mockResolvedValueOnce(previa(['lead-1', 'lead-2']))
      .mockResolvedValueOnce(previa(['lead-1', 'lead-2']))
    mocks.inscreverLeadManual
      .mockResolvedValueOnce({ jaInscrito: false })
      .mockResolvedValueOnce({ jaInscrito: true })

    const resultado = await iniciarCampanhaReal(admin, 'org-a', 'campanha-1', 'usuario-1', 2)

    expect(resultado).toMatchObject({
      campanha_id: 'campanha-1',
      workflow_id: 'workflow-1',
      dry_run: false,
      publico: 2,
      inscritos: 1,
      ja_inscritos: 1,
      falhas: 0,
    })
    expect(mocks.publicar).toHaveBeenCalledWith(expect.anything(), 'workflow-1', 'usuario-1')
    expect(mocks.inscreverLeadManual).toHaveBeenNthCalledWith(1, expect.anything(), 'workflow-1', 'lead-1', 'campanha-1')
    expect(mocks.inscreverLeadManual).toHaveBeenNthCalledWith(2, expect.anything(), 'workflow-1', 'lead-2', 'campanha-1')
    expect(mocks.atualizarCampanha).toHaveBeenCalledWith(admin, 'org-a', 'campanha-1', { status: 'ativa' })
    expect(mocks.atualizarCampanha).toHaveBeenCalledWith(admin, 'org-a', 'campanha-1', { dry_run: false })
  })

  it('exige confirmação numérica explícita antes de consultar ou alterar a campanha', async () => {
    await expect(
      iniciarCampanhaReal(admin, 'org-a', 'campanha-1', 'usuario-1'),
    ).rejects.toThrow('Confirme explicitamente a quantidade atual')

    expect(mocks.buscarCampanha).not.toHaveBeenCalled()
    expect(mocks.atualizarCampanha).not.toHaveBeenCalled()
    expect(mocks.inscreverLeadManual).not.toHaveBeenCalled()
  })

  it('interrompe o enrollment se o público mudar depois da confirmação', async () => {
    mocks.buscarCampanha
      .mockResolvedValueOnce(campanhaRascunho)
      .mockResolvedValueOnce(campanhaAtiva)
    mocks.buscarPreviaPublicoCampanha
      .mockResolvedValueOnce(previa(['lead-1', 'lead-2']))
      .mockResolvedValueOnce(previa(['lead-1', 'lead-2', 'lead-3']))

    await expect(
      iniciarCampanhaReal(admin, 'org-a', 'campanha-1', 'usuario-1', 2),
    ).rejects.toThrow('Confirme explicitamente a quantidade atual de 3 contatos')

    expect(mocks.inscreverLeadManual).not.toHaveBeenCalled()
    expect(mocks.atualizarCampanha).not.toHaveBeenCalledWith(
      admin,
      'org-a',
      'campanha-1',
      { dry_run: false },
    )
  })

  it('restaura o dry-run quando nenhuma inscrição pode ser criada', async () => {
    mocks.buscarCampanha
      .mockResolvedValueOnce(campanhaRascunho)
      .mockResolvedValueOnce(campanhaAtiva)
    mocks.buscarPreviaPublicoCampanha
      .mockResolvedValueOnce(previa(['lead-1', 'lead-2']))
      .mockResolvedValueOnce(previa(['lead-1', 'lead-2']))
    mocks.inscreverLeadManual.mockRejectedValue(new Error('falha de persistência'))

    await expect(
      iniciarCampanhaReal(admin, 'org-a', 'campanha-1', 'usuario-1', 2),
    ).rejects.toThrow('Nenhum contato pôde ser inscrito; o modo ensaio foi mantido')

    expect(mocks.atualizarCampanha).toHaveBeenNthCalledWith(2, admin, 'org-a', 'campanha-1', { dry_run: false })
    expect(mocks.atualizarCampanha).toHaveBeenNthCalledWith(3, admin, 'org-a', 'campanha-1', { dry_run: true })
  })
})
