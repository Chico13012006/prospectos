import { describe, expect, it } from 'vitest'
import {
  mensagemCampanhaVazia,
  type FollowupCampanha,
  type MensagemCampanha,
} from '@/components/automacao/tiposCampanha'

describe('seleção de template da campanha', () => {
  it('limpa todo o conteúdo do template ao voltar para escrever do zero', () => {
    const atual: MensagemCampanha = {
      assunto: 'Assunto do template',
      corpo: 'Corpo do template',
      html: '<strong>Template</strong>',
      link: 'https://empresa.com/material',
      templateOrigemId: 'template-origem',
      templateId: 'template-materializado',
      templateTipo: 'campanha_teste_m1',
    }

    expect({ ...atual, ...mensagemCampanhaVazia() }).toEqual({
      assunto: '',
      corpo: '',
      html: undefined,
      link: '',
      templateOrigemId: undefined,
      templateId: undefined,
      templateTipo: undefined,
    })
  })

  it('preserva o agendamento estrutural do follow-up', () => {
    const followup: FollowupCampanha = {
      diasApos: 3,
      assunto: 'Follow-up do template',
      corpo: 'Conteúdo anterior',
      templateOrigemId: 'template-origem',
    }

    expect({ ...followup, ...mensagemCampanhaVazia() }).toMatchObject({
      diasApos: 3,
      assunto: '',
      corpo: '',
      templateOrigemId: undefined,
    })
  })
})
