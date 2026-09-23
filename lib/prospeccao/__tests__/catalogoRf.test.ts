import { describe, expect, it, vi } from 'vitest'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import {
  normalizarCnae,
  parseData,
  parseDecimal,
  parseEmpresa,
  parseEstabelecimento,
  parseLinhaCsv,
  parseSimples,
} from '@/lib/prospeccao/catalogoRf/layout'
import {
  carregarCatalogo,
  LimiteCatalogoExcedido,
  type DestinoCatalogo,
  type FonteRf,
  type RegistroCatalogo,
} from '@/lib/prospeccao/catalogoRf/carga'
import { dividirLinhas, linhasDeZip } from '@/lib/prospeccao/catalogoRf/fonteRf'
import { escopoDosPerfis } from '@/lib/prospeccao/catalogoRf/escopo'

const HOTEL = '5510801'
const APART = '5510802'
const RESTAURANTE = '5611201'

function csv(campos: string[]): string {
  return `"${campos.join('";"')}"`
}

function estabelecimento(o: {
  basico: string
  ordem?: string
  matriz?: '1' | '2'
  situacao?: string
  cnae?: string
  secundarios?: string
  uf?: string
  municipio?: string
  email?: string
}): string {
  const f = Array.from({ length: 30 }, () => '')
  f[0] = o.basico
  f[1] = o.ordem ?? '0001'
  f[2] = '00'
  f[3] = o.matriz ?? '1'
  f[4] = `FANTASIA ${o.basico}`
  f[5] = o.situacao ?? '02'
  f[10] = '20150301'
  f[11] = o.cnae ?? HOTEL
  f[12] = o.secundarios ?? ''
  f[13] = 'RUA'
  f[14] = 'DAS FLORES'
  f[15] = '10'
  f[17] = 'CENTRO'
  f[18] = '01001000'
  f[19] = o.uf ?? 'SP'
  f[20] = o.municipio ?? '7107'
  f[21] = '11'
  f[22] = '33334444'
  f[27] = o.email ?? 'CONTATO@HOTEL.COM.BR'
  return csv(f)
}

function fonteDe(arquivos: Record<string, string[]>): FonteRf & { lidos: string[] } {
  const lidos: string[] = []
  return {
    lidos,
    async *linhas(arquivo: string) {
      lidos.push(arquivo)
      for (const l of arquivos[arquivo] ?? []) yield l
    },
  }
}

function destinoFake(): DestinoCatalogo & { gravados: RegistroCatalogo[]; limpezas: unknown[] } {
  const gravados: RegistroCatalogo[] = []
  const limpezas: unknown[] = []
  return {
    gravados,
    limpezas,
    async gravar(lote) {
      gravados.push(...lote)
    },
    async removerNaoVistos(mesRf, cnaes, cnaesSecundarios) {
      limpezas.push({ mesRf, cnaes, cnaesSecundarios })
      return 3
    },
  }
}

describe('layout RF', () => {
  it('parseia linha CSV entre aspas', () => {
    expect(parseLinhaCsv('"a";"b c";""')).toEqual(['a', 'b c', ''])
    expect(parseLinhaCsv('   ')).toEqual([])
  })

  it('converte data AAAAMMDD e rejeita data vazia ou impossível', () => {
    expect(parseData('20150301')).toBe('2015-03-01')
    expect(parseData('00000000')).toBeNull()
    expect(parseData('20150231')).toBeNull()
    expect(parseData('')).toBeNull()
  })

  it('converte decimal com vírgula', () => {
    expect(parseDecimal('150000,00')).toBe(150000)
    expect(parseDecimal('1.234,56')).toBe(1234.56)
    expect(parseDecimal('')).toBeNull()
  })

  it('normaliza CNAE em qualquer formatação', () => {
    expect(normalizarCnae('5510-8/01')).toBe(HOTEL)
    expect(normalizarCnae('5510801')).toBe(HOTEL)
    expect(normalizarCnae('5510')).toBeNull()
  })

  it('aceita só matriz ativa com CNAE alvo', () => {
    const alvo = new Set([HOTEL])
    const ok = parseEstabelecimento(parseLinhaCsv(estabelecimento({ basico: '11111111' })), alvo)
    expect(ok).toMatchObject({
      cnpj: '11111111000100',
      cnae_principal: HOTEL,
      logradouro: 'RUA DAS FLORES',
      telefone: '(11) 33334444',
      email: 'contato@hotel.com.br',
      data_inicio_atividade: '2015-03-01',
    })
    const campos = (o: Parameters<typeof estabelecimento>[0]) => parseLinhaCsv(estabelecimento(o))
    expect(parseEstabelecimento(campos({ basico: '11111111', matriz: '2' }), alvo)).toBeNull()
    expect(parseEstabelecimento(campos({ basico: '11111111', situacao: '08' }), alvo)).toBeNull()
    expect(parseEstabelecimento(campos({ basico: '11111111', cnae: RESTAURANTE }), alvo)).toBeNull()
  })

  it('secundário só casa quando pedido, e os secundários são guardados', () => {
    const campos = parseLinhaCsv(estabelecimento({ basico: '22222222', cnae: RESTAURANTE, secundarios: `${HOTEL},9999999` }))
    expect(parseEstabelecimento(campos, new Set([HOTEL]))).toBeNull()
    const r = parseEstabelecimento(campos, new Set([HOTEL]), new Set([HOTEL]))
    expect(r?.cnae_principal).toBe(RESTAURANTE)
    expect(r?.cnaes_secundarios).toEqual([HOTEL, '9999999'])
  })

  it('descarta e-mail malformado em vez de gravar lixo', () => {
    const r = parseEstabelecimento(
      parseLinhaCsv(estabelecimento({ basico: '11111111', email: 'sem-arroba' })),
      new Set([HOTEL])
    )
    expect(r?.email).toBeNull()
  })

  it('parseia empresa e MEI', () => {
    expect(parseEmpresa(parseLinhaCsv(csv(['11111111', 'HOTEL LTDA', '2062', '49', '50000,00', '03', ''])))).toEqual({
      cnpj_basico: '11111111',
      empresa: { razao_social: 'HOTEL LTDA', natureza_juridica: '2062', capital_social: 50000, porte: 'pequeno' },
    })
    expect(parseSimples(parseLinhaCsv(csv(['11111111', 'S', '', '', 'S', '', ''])))).toEqual({
      cnpj_basico: '11111111',
      mei: true,
    })
  })
})

describe('carregarCatalogo', () => {
  const arquivosBase = () => ({
    'Estabelecimentos0.zip': [
      estabelecimento({ basico: '11111111', cnae: HOTEL }),
      estabelecimento({ basico: '11111111', ordem: '0002', matriz: '2' }), // filial
      estabelecimento({ basico: '33333333', cnae: RESTAURANTE }), // fora do alvo
    ],
    'Estabelecimentos7.zip': [
      estabelecimento({ basico: '22222222', cnae: APART, uf: 'RJ', municipio: '6001', email: '' }),
      estabelecimento({ basico: '11111111', cnae: HOTEL }), // repetido
    ],
    'Empresas4.zip': [
      csv(['11111111', 'HOTEL SOL LTDA', '2062', '49', '100000,00', '01', '']),
      csv(['33333333', 'RESTAURANTE', '2062', '49', '1,00', '01', '']),
    ],
    'Empresas9.zip': [csv(['22222222', 'APART MAR SA', '2046', '10', '0,00', '05', ''])],
    'Simples.zip': [csv(['11111111', 'S', '', '', 'N', '', '']), csv(['22222222', 'N', '', '', 'S', '', ''])],
    'Municipios.zip': [csv(['7107', 'SAO PAULO']), csv(['6001', 'RIO DE JANEIRO'])],
  })

  it('junta estabelecimento, empresa, MEI e município numa carga completa', async () => {
    const destino = destinoFake()
    const resumo = await carregarCatalogo({
      fonte: fonteDe(arquivosBase()),
      mesRf: '2026-09',
      cnaes: [HOTEL, APART],
      destino,
    })

    expect(resumo).toMatchObject({ completa: true, estabelecimentos: 2, comEmail: 1, mei: 1, gravados: 2, removidos: 3 })
    expect(resumo.porUf).toEqual({ SP: 1, RJ: 1 })
    const porCnpj = Object.fromEntries(destino.gravados.map((r) => [r.cnpj, r]))
    expect(porCnpj['11111111000100']).toMatchObject({
      razao_social: 'HOTEL SOL LTDA', porte: 'micro', mei: false, municipio: 'SAO PAULO', mes_rf: '2026-09',
    })
    expect(porCnpj['22222222000100']).toMatchObject({
      razao_social: 'APART MAR SA', porte: 'demais', mei: true, municipio: 'RIO DE JANEIRO', email: null,
    })
    expect(destino.limpezas).toEqual([{ mesRf: '2026-09', cnaes: [HOTEL, APART], cnaesSecundarios: [] }])
  })

  it('ensaio (sem destino) conta tudo e não grava nem limpa', async () => {
    const resumo = await carregarCatalogo({ fonte: fonteDe(arquivosBase()), mesRf: '2026-09', cnaes: [HOTEL, APART] })
    expect(resumo).toMatchObject({ estabelecimentos: 2, gravados: 0, removidos: 0 })
    expect(resumo.amostra).toHaveLength(2)
  })

  it('secundário entra só para os CNAEs marcados e entra no escopo da limpeza', async () => {
    const arquivos = {
      ...arquivosBase(),
      'Estabelecimentos3.zip': [estabelecimento({ basico: '44444444', cnae: RESTAURANTE, secundarios: HOTEL })],
    }
    const semSecundario = await carregarCatalogo({ fonte: fonteDe(arquivos), mesRf: '2026-09', cnaes: [HOTEL, APART] })
    expect(semSecundario.estabelecimentos).toBe(2)

    const destino = destinoFake()
    const comSecundario = await carregarCatalogo({
      fonte: fonteDe(arquivos), mesRf: '2026-09', cnaes: [HOTEL, APART], cnaesSecundarios: [HOTEL], destino,
    })
    expect(comSecundario.estabelecimentos).toBe(3)
    expect(comSecundario.porCnaePrincipal).toEqual({ [HOTEL]: 1, [APART]: 1, [RESTAURANTE]: 1 })
    expect(destino.limpezas).toEqual([{ mesRf: '2026-09', cnaes: [HOTEL, APART], cnaesSecundarios: [HOTEL] }])
  })

  it('carga parcial grava mas NÃO remove linhas antigas', async () => {
    const destino = destinoFake()
    const fonte = fonteDe(arquivosBase())
    const resumo = await carregarCatalogo({ fonte, mesRf: '2026-09', cnaes: [HOTEL, APART], shards: [0], destino })
    expect(resumo).toMatchObject({ completa: false, estabelecimentos: 1, gravados: 1, removidos: 0 })
    expect(destino.limpezas).toEqual([])
    expect(fonte.lidos.filter((a) => a.startsWith('Estabelecimentos'))).toEqual(['Estabelecimentos0.zip'])
    // Empresas sempre inteiras: o shard da empresa não acompanha o do estabelecimento.
    expect(fonte.lidos.filter((a) => a.startsWith('Empresas'))).toHaveLength(10)
  })

  it('grava em lotes do tamanho pedido', async () => {
    const destino = destinoFake()
    const gravar = vi.spyOn(destino, 'gravar')
    await carregarCatalogo({ fonte: fonteDe(arquivosBase()), mesRf: '2026-09', cnaes: [HOTEL, APART], destino, tamanhoLote: 1 })
    expect(gravar).toHaveBeenCalledTimes(2)
  })

  it('aborta antes de gravar quando os CNAEs trazem volume acima do limite', async () => {
    const destino = destinoFake()
    await expect(
      carregarCatalogo({ fonte: fonteDe(arquivosBase()), mesRf: '2026-09', cnaes: [HOTEL, APART], destino, maxEstabelecimentos: 1 })
    ).rejects.toBeInstanceOf(LimiteCatalogoExcedido)
    expect(destino.gravados).toEqual([])
    expect(destino.limpezas).toEqual([])
  })

  it('carga completa sem nenhum resultado aborta em vez de limpar o catálogo', async () => {
    const destino = destinoFake()
    await expect(
      carregarCatalogo({ fonte: fonteDe({}), mesRf: '2026-09', cnaes: [HOTEL], destino })
    ).rejects.toThrow(/sem nenhum estabelecimento/)
    expect(destino.limpezas).toEqual([])
  })

  it('rejeita lista de CNAEs vazia e shard fora do intervalo', async () => {
    await expect(carregarCatalogo({ fonte: fonteDe({}), mesRf: '2026-09', cnaes: [] })).rejects.toThrow(/CNAE/)
    await expect(carregarCatalogo({ fonte: fonteDe({}), mesRf: '2026-09', cnaes: [HOTEL], shards: [10] })).rejects.toThrow(/Shards/)
  })
})

describe('leitura do zip da RF', () => {
  function zipDe(conteudo: string): Buffer {
    const nome = Buffer.from('K3241.K03200Y0.D50913.ESTABELE')
    const cabecalho = Buffer.alloc(30)
    cabecalho.writeUInt32LE(0x04034b50, 0)
    cabecalho.writeUInt16LE(20, 4)
    cabecalho.writeUInt16LE(8, 8) // deflate
    cabecalho.writeUInt16LE(nome.length, 26)
    cabecalho.writeUInt16LE(0, 28)
    const dados = zlib.deflateRawSync(Buffer.from(conteudo, 'latin1'))
    const centralDirectory = Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02]), Buffer.alloc(60, 7)])
    return Buffer.concat([cabecalho, nome, dados, centralDirectory])
  }

  function emPedacos(buf: Buffer, tamanho: number): Readable {
    const pedacos: Buffer[] = []
    for (let i = 0; i < buf.length; i += tamanho) pedacos.push(buf.subarray(i, i + tamanho))
    return Readable.from(pedacos)
  }

  async function coletar(it: AsyncIterable<string>): Promise<string[]> {
    const out: string[] = []
    for await (const l of it) out.push(l)
    return out
  }

  it('lê as linhas em latin1 ignorando o central directory no fim', async () => {
    const texto = '"1";"SÃO JOÃO"\r\n"2";"AÇAÍ"\n"3";"FIM"'
    expect(await coletar(linhasDeZip(emPedacos(zipDe(texto), 7)))).toEqual(['"1";"SÃO JOÃO"', '"2";"AÇAÍ"', '"3";"FIM"'])
  })

  it('falha em download truncado em vez de terminar calado', async () => {
    const zip = zipDe('x'.repeat(5000) + Array.from({ length: 2000 }, (_, i) => `linha ${i}`).join('\n'))
    await expect(coletar(linhasDeZip(emPedacos(zip.subarray(0, 60), 16)))).rejects.toThrow()
  })

  it('falha quando o arquivo não é zip', async () => {
    await expect(coletar(linhasDeZip(Readable.from([Buffer.from('<html>erro</html>'.padEnd(64, ' '))])))).rejects.toThrow(/zip/)
  })

  it('divide linhas que atravessam pedaços', async () => {
    async function* pedacos() {
      yield 'ab'
      yield 'c\nde'
      yield 'f\n'
    }
    expect(await coletar(dividirLinhas(pedacos()))).toEqual(['abc', 'def'])
  })
})

describe('escopoDosPerfis', () => {
  it('une os CNAEs dos perfis e só marca secundário onde a org pediu', () => {
    expect(
      escopoDosPerfis([
        { prospeccao: { cnaes: [HOTEL, APART] } },
        { prospeccao: { cnaes: [RESTAURANTE, HOTEL], incluirCnaesSecundarios: true } },
        { prospeccao: { ufs: ['SP'] } }, // perfil sem CNAE não conta
        {},
        null,
      ])
    ).toEqual({ cnaes: [HOTEL, APART, RESTAURANTE], cnaesSecundarios: [HOTEL, RESTAURANTE], organizacoes: 2 })
  })
})
