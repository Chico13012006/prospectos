import { describe, it, expect } from 'vitest'
import { ALFABETO_CODIGO, codigoValido, gerarCodigoRef, interpretarComandoGrupo, normalizarCodigo } from '../comandos'
import { interpretarCallbackGrupo } from '../callbackGrupo'
import { interpretarReceivedCallback } from '@/lib/whatsapp/zapiInbound'

describe('código de referência', () => {
  it('gera 6 caracteres do alfabeto sem ambiguidade (sem I/O/0/1), determinístico com sorteio fixo', () => {
    const fixo = () => 0.5
    const c = gerarCodigoRef(fixo)
    expect(c).toHaveLength(6)
    expect(codigoValido(c)).toBe(true)
    expect(gerarCodigoRef(fixo)).toBe(c)
    expect(ALFABETO_CODIGO).not.toMatch(/[IO01]/)
    for (let i = 0; i < 200; i++) expect(codigoValido(gerarCodigoRef())).toBe(true)
  })

  it('normaliza maiúsculas e valida forma', () => {
    expect(normalizarCodigo(' a82f3x ')).toBe('A82F3X')
    expect(codigoValido('ABCDEF')).toBe(true)
    expect(codigoValido('ABCDE')).toBe(false)
    expect(codigoValido('ABC0EF')).toBe(false) // 0 não existe no alfabeto
  })
})

describe('interpretarComandoGrupo', () => {
  it('#CODIGO 1 / #CODIGO 2 com separadores opcionais e caixa livre', () => {
    expect(interpretarComandoGrupo('#A82F3X 1')).toEqual({ tipo: 'comando', codigo: 'A82F3X', comando: '1' })
    expect(interpretarComandoGrupo('#a82f3x 2')).toEqual({ tipo: 'comando', codigo: 'A82F3X', comando: '2' })
    expect(interpretarComandoGrupo('  #A82F3X - 2 ')).toEqual({ tipo: 'comando', codigo: 'A82F3X', comando: '2' })
    expect(interpretarComandoGrupo('#A82F3X: 1')).toEqual({ tipo: 'comando', codigo: 'A82F3X', comando: '1' })
    expect(interpretarComandoGrupo('Bruno: #A82F3X 1 — fechado!')).toEqual({ tipo: 'comando', codigo: 'A82F3X', comando: '1' })
  })

  it('14. comando inválido: referência sem dígito válido, dígito fora de 1/2, texto livre', () => {
    expect(interpretarComandoGrupo('#A82F3X continuar')).toMatchObject({ tipo: 'comando_invalido', codigo: 'A82F3X' })
    expect(interpretarComandoGrupo('#A82F3X 3')).toMatchObject({ tipo: 'comando_invalido', codigo: 'A82F3X' })
    expect(interpretarComandoGrupo('#A82F3X')).toMatchObject({ tipo: 'comando_invalido', codigo: 'A82F3X' })
    expect(interpretarComandoGrupo('1 #A82F3X')).toMatchObject({ tipo: 'comando_invalido', codigo: 'A82F3X' })
  })

  it('texto normal do grupo (sem #referência) → sem_comando (não vira registro)', () => {
    expect(interpretarComandoGrupo('bom dia pessoal, alguém viu o lead da ABC?')).toEqual({ tipo: 'sem_comando' })
    expect(interpretarComandoGrupo('')).toEqual({ tipo: 'sem_comando' })
    expect(interpretarComandoGrupo('1')).toEqual({ tipo: 'sem_comando' })
  })
})

const INSTANCIA = 'inst-1'
const grupo = (over: Record<string, unknown> = {}) => ({
  type: 'ReceivedCallback', instanceId: INSTANCIA, messageId: 'MSG-1', phone: '120363019502650977-group',
  participantPhone: '+55 (11) 99999-8888', senderName: 'Bruno', chatName: 'Comercial iNOVACODE', fromMe: false,
  momment: 1_757_760_000_000, isGroup: true, text: { message: '#A82F3X 1' }, ...over,
})

describe('interpretarCallbackGrupo (Z-API ReceivedCallback de grupo)', () => {
  it('lê grupo (phone), remetente (participantPhone), texto, messageId e horário', () => {
    const r = interpretarCallbackGrupo(grupo(), INSTANCIA)
    expect(r).toEqual({
      tipo: 'evento',
      evento: {
        grupoId: '120363019502650977-group', providerMessageId: 'MSG-1', remetente: '5511999998888',
        remetenteNome: 'Bruno', grupoNome: 'Comercial iNOVACODE', texto: '#A82F3X 1',
        recebidoEm: new Date(1_757_760_000_000).toISOString(),
      },
    })
  })

  it('ignora: não-grupo, fromMe (nossos avisos), sem texto, outra instância, outro tipo', () => {
    expect(interpretarCallbackGrupo(grupo({ isGroup: false }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'nao_e_grupo' })
    expect(interpretarCallbackGrupo(grupo({ fromMe: true }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'from_me' })
    expect(interpretarCallbackGrupo(grupo({ text: undefined }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'sem_texto' })
    expect(interpretarCallbackGrupo(grupo({ instanceId: 'outra' }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'instancia_desconhecida' })
    expect(interpretarCallbackGrupo(grupo({ type: 'DeliveryCallback' }), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'tipo_nao_suportado' })
  })

  it('inválido sem messageId/phone; remetente ausente vira null (ainda processa)', () => {
    expect(interpretarCallbackGrupo(grupo({ messageId: '' }), INSTANCIA)).toMatchObject({ tipo: 'invalido' })
    expect(interpretarCallbackGrupo(grupo({ phone: null }), INSTANCIA)).toMatchObject({ tipo: 'invalido' })
    const r = interpretarCallbackGrupo(grupo({ participantPhone: undefined }), INSTANCIA)
    expect(r.tipo === 'evento' && r.evento.remetente).toBeNull()
  })

  it('24. os dois parsers são exclusivos: grupo continua ignorado pelo inbound individual e individual ignorado pelo de grupo', () => {
    expect(interpretarReceivedCallback(grupo(), INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'grupo' })
    const individual = grupo({ isGroup: false, phone: '5511988887777' })
    expect(interpretarReceivedCallback(individual, INSTANCIA).tipo).toBe('mensagem')
    expect(interpretarCallbackGrupo(individual, INSTANCIA)).toEqual({ tipo: 'ignorar', motivo: 'nao_e_grupo' })
  })
})
