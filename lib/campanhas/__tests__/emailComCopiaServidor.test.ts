import { describe, expect, it, vi } from 'vitest'
import type { EmailProvider } from '@/lib/engine/email/provider'
import { enviarEmailCampanhaComCopia } from '../emailComCopiaServidor'

function provider() {
  return {
    enviar: vi.fn().mockResolvedValue(undefined),
    lerCaixaEntrada: vi.fn().mockResolvedValue([]),
  } satisfies EmailProvider
}

describe('e-mail de campanha com cópia comercial', () => {
  it('coloca em cópia o responsável escolhido na campanha', async () => {
    const email = provider()
    await enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
      html: '<p>Mensagem</p>',
      responsavelCampanha: { id: 'perfil-1', nome: 'Aline', email: 'aline@empresa.com' },
      responsavelLead: { id: 'usuario-1', nome: 'Francisco', email: 'francisco@empresa.com' },
    })

    expect(email.enviar).toHaveBeenCalledWith(
      'lead@empresa.com',
      'Assunto',
      'Mensagem',
      '<p>Mensagem</p>',
      'aline@empresa.com',
    )
  })

  it('usa o responsável real do lead como fallback', async () => {
    const email = provider()
    await enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
      responsavelLead: { id: 'usuario-1', nome: 'Francisco', email: 'francisco@empresa.com' },
    })

    expect(email.enviar).toHaveBeenCalledWith(
      'lead@empresa.com',
      'Assunto',
      'Mensagem',
      undefined,
      'francisco@empresa.com',
    )
  })

  it('bloqueia o envio se nenhum responsável tiver e-mail real', async () => {
    const email = provider()
    await expect(enviarEmailCampanhaComCopia(email, {
      para: 'lead@empresa.com',
      assunto: 'Assunto',
      corpo: 'Mensagem',
    })).rejects.toThrow('responsável comercial não possui e-mail')
    expect(email.enviar).not.toHaveBeenCalled()
  })
})
