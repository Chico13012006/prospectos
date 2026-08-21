import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  modoEnsaio: false,
  buscarRemetenteCampanha: vi.fn(),
  lerCredenciaisGmail: vi.fn(),
  enviar: vi.fn(),
}))

vi.mock('@/lib/engine/config', () => ({
  engineConfig: {
    get modoEnsaio() { return mocks.modoEnsaio },
  },
}))

vi.mock('@/lib/engine/email/gmailProvider', () => ({
  lerCredenciaisGmail: mocks.lerCredenciaisGmail,
  GmailProvider: class {
    enviar = mocks.enviar
  },
}))

vi.mock('../opcoesServidor', () => ({
  buscarRemetenteCampanha: mocks.buscarRemetenteCampanha,
}))

import { enviarTesteEmailCampanha } from '../testeEmailServidor'

const admin = {} as SupabaseClient

beforeEach(() => {
  vi.resetAllMocks()
  mocks.modoEnsaio = false
  mocks.buscarRemetenteCampanha.mockResolvedValue({
    conta: 'prospeccao',
    email: 'remetente@empresa.com.br',
  })
  mocks.lerCredenciaisGmail.mockReturnValue({
    user: 'remetente@empresa.com.br',
    appPassword: 'segredo-nao-real',
  })
  mocks.enviar.mockResolvedValue(undefined)
})

describe('envio de teste da campanha', () => {
  it('envia somente para o próprio remetente e sanitiza o HTML da prévia', async () => {
    const resultado = await enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: 'Apresentação',
      corpo: 'Olá, {nome}.',
      html: '<div><script>alert(1)</script><p>Olá, <strong>{nome}</strong>.</p></div>',
      responsavelNome: 'Ana Comercial',
      destinatario: 'outra-pessoa@fora.com',
    } as Record<string, unknown>)

    expect(resultado).toEqual({
      destinatario: 'remetente@empresa.com.br',
      assunto: '[TESTE] Apresentação',
    })
    expect(mocks.buscarRemetenteCampanha).toHaveBeenCalledWith(admin, 'org-a')
    expect(mocks.enviar).toHaveBeenCalledTimes(1)
    const [destinatario, assunto, corpo, html] = mocks.enviar.mock.calls[0]
    expect(destinatario).toBe('remetente@empresa.com.br')
    expect(assunto).toBe('[TESTE] Apresentação')
    expect(corpo).toBe('Olá, {nome}.')
    expect(html).toContain('Ana Comercial')
    expect(html).toContain('<strong>{nome}</strong>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('não contorna o MODO_ENSAIO', async () => {
    mocks.modoEnsaio = true

    await expect(enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: 'Teste',
      corpo: 'Conteúdo',
    })).rejects.toThrow('O motor está em modo ensaio')

    expect(mocks.buscarRemetenteCampanha).not.toHaveBeenCalled()
    expect(mocks.enviar).not.toHaveBeenCalled()
  })

  it('bloqueia quando as credenciais do remetente não estão disponíveis', async () => {
    mocks.lerCredenciaisGmail.mockReturnValue(null)

    await expect(enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: 'Teste',
      corpo: 'Conteúdo',
    })).rejects.toThrow('As credenciais da conta remetente não estão disponíveis')

    expect(mocks.enviar).not.toHaveBeenCalled()
  })

  it('exige assunto e conteúdo sem consultar dados do workspace', async () => {
    await expect(enviarTesteEmailCampanha(admin, 'org-a', {
      assunto: ' ',
      corpo: 'Conteúdo',
    })).rejects.toThrow('Informe o assunto da mensagem')

    expect(mocks.buscarRemetenteCampanha).not.toHaveBeenCalled()
    expect(mocks.enviar).not.toHaveBeenCalled()
  })
})
