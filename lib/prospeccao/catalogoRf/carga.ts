// Orquestra a carga do catálogo: lê os arquivos da RF por uma `FonteRf`,
// junta Estabelecimentos + Empresas + Simples + Municipios e entrega os
// registros a um `DestinoCatalogo`. Sem destino é ensaio: só conta.
//
// Fonte e destino são injetados — os testes rodam sem rede e sem banco.

import {
  parseEmpresa,
  parseEstabelecimento,
  parseLinhaCsv,
  parseMunicipio,
  parseSimples,
  type Empresa,
  type Estabelecimento,
} from './layout'

export const TOTAL_SHARDS = 10

export interface FonteRf {
  /** Linhas decodificadas de um arquivo do mês (ex.: 'Empresas3.zip'). */
  linhas(arquivo: string): AsyncIterable<string>
}

export interface RegistroCatalogo extends Estabelecimento, Empresa {
  mei: boolean | null
  municipio: string | null
  mes_rf: string
}

export interface DestinoCatalogo {
  gravar(lote: RegistroCatalogo[]): Promise<void>
  /** Remove linhas do escopo desta carga que o mês atual não viu. */
  removerNaoVistos(mesRf: string, cnaes: string[], cnaesSecundarios: string[]): Promise<number>
}

export interface OpcoesCarga {
  fonte: FonteRf
  mesRf: string
  /** Casam pelo CNAE principal. */
  cnaes: string[]
  /** Casam também pelo secundário (opt-in de algum perfil). */
  cnaesSecundarios?: string[]
  /** Shards de Estabelecimentos (0..9). Menos que 10 = carga parcial, sem limpeza. */
  shards?: number[]
  destino?: DestinoCatalogo
  tamanhoLote?: number
  /** Trava contra CNAE amplo demais estourar memória e banco. */
  maxEstabelecimentos?: number
  aoProgredir?: (msg: string) => void
}

export interface ResumoCarga {
  mesRf: string
  completa: boolean
  linhasLidas: number
  estabelecimentos: number
  semEmpresa: number
  comEmail: number
  comTelefone: number
  mei: number
  porUf: Record<string, number>
  porCnaePrincipal: Record<string, number>
  gravados: number
  removidos: number
  amostra: RegistroCatalogo[]
}

export class LimiteCatalogoExcedido extends Error {}

const TAMANHO_LOTE = 1000
const MAX_ESTABELECIMENTOS = 300_000
const TAMANHO_AMOSTRA = 5

function todosShards(): number[] {
  return Array.from({ length: TOTAL_SHARDS }, (_, i) => i)
}

export async function carregarCatalogo(opcoes: OpcoesCarga): Promise<ResumoCarga> {
  const {
    fonte, mesRf, destino,
    tamanhoLote = TAMANHO_LOTE,
    maxEstabelecimentos = MAX_ESTABELECIMENTOS,
    aoProgredir = () => {},
  } = opcoes
  const cnaes = [...new Set(opcoes.cnaes)].sort()
  if (cnaes.length === 0) throw new Error('Informe ao menos um CNAE para a carga.')
  const shards = [...new Set(opcoes.shards ?? todosShards())].sort((a, b) => a - b)
  if (shards.some((s) => !Number.isInteger(s) || s < 0 || s >= TOTAL_SHARDS)) {
    throw new Error(`Shards válidos são 0..${TOTAL_SHARDS - 1}.`)
  }
  const completa = shards.length === TOTAL_SHARDS
  const cnaesSecundarios = [...new Set(opcoes.cnaesSecundarios ?? [])].sort()
  const alvoPrincipal = new Set(cnaes)
  const alvoSecundario = new Set(cnaesSecundarios)
  let linhasLidas = 0

  // 1. Estabelecimentos — o filtro pesado; define quais empresas importam.
  const estabelecimentos = new Map<string, Estabelecimento>()
  for (const shard of shards) {
    const arquivo = `Estabelecimentos${shard}.zip`
    aoProgredir(`lendo ${arquivo}`)
    for await (const linha of fonte.linhas(arquivo)) {
      linhasLidas++
      const est = parseEstabelecimento(parseLinhaCsv(linha), alvoPrincipal, alvoSecundario)
      if (!est || estabelecimentos.has(est.cnpj)) continue
      estabelecimentos.set(est.cnpj, est)
      if (estabelecimentos.size > maxEstabelecimentos) {
        throw new LimiteCatalogoExcedido(
          `Mais de ${maxEstabelecimentos} estabelecimentos para os CNAEs ${cnaes.join(', ')}. ` +
            'Restrinja os CNAEs ou ajuste o limite conscientemente.'
        )
      }
    }
    aoProgredir(`${arquivo}: ${estabelecimentos.size} estabelecimentos acumulados`)
  }

  // Zero resultado numa carga completa quase sempre é layout mudado ou download
  // truncado — seguir até a limpeza apagaria o catálogo desses CNAEs.
  if (completa && estabelecimentos.size === 0 && destino) {
    throw new Error(`Carga completa sem nenhum estabelecimento para ${cnaes.join(', ')} — abortada antes de gravar.`)
  }

  const basicos = new Set([...estabelecimentos.values()].map((e) => e.cnpj_basico))

  // 2. Empresas — sempre os 10 shards: o shard da empresa não acompanha o do estabelecimento.
  const empresas = new Map<string, Empresa>()
  if (basicos.size > 0) {
    for (const shard of todosShards()) {
      const arquivo = `Empresas${shard}.zip`
      aoProgredir(`lendo ${arquivo}`)
      for await (const linha of fonte.linhas(arquivo)) {
        linhasLidas++
        // Pré-filtro barato: o CNPJ básico abre a linha.
        if (!basicos.has(linha.slice(1, 9))) continue
        const emp = parseEmpresa(parseLinhaCsv(linha))
        if (emp) empresas.set(emp.cnpj_basico, emp.empresa)
      }
    }
  }

  // 3. Simples — só para marcar MEI.
  const mei = new Map<string, boolean>()
  if (basicos.size > 0) {
    aoProgredir('lendo Simples.zip')
    for await (const linha of fonte.linhas('Simples.zip')) {
      linhasLidas++
      if (!basicos.has(linha.slice(1, 9))) continue
      const s = parseSimples(parseLinhaCsv(linha))
      if (s) mei.set(s.cnpj_basico, s.mei)
    }
  }

  // 4. Municipios — tabela pequena de código → nome.
  const municipios = new Map<string, string>()
  if (basicos.size > 0) {
    for await (const linha of fonte.linhas('Municipios.zip')) {
      const m = parseMunicipio(parseLinhaCsv(linha))
      if (m) municipios.set(m.codigo, m.nome)
    }
  }

  const resumo: ResumoCarga = {
    mesRf, completa, linhasLidas,
    estabelecimentos: estabelecimentos.size,
    semEmpresa: 0, comEmail: 0, comTelefone: 0, mei: 0,
    porUf: {}, porCnaePrincipal: {},
    gravados: 0, removidos: 0, amostra: [],
  }

  let lote: RegistroCatalogo[] = []
  const descarregar = async () => {
    if (lote.length === 0) return
    if (destino) {
      await destino.gravar(lote)
      resumo.gravados += lote.length
      aoProgredir(`${resumo.gravados}/${estabelecimentos.size} gravados`)
    }
    lote = []
  }

  for (const est of estabelecimentos.values()) {
    const emp = empresas.get(est.cnpj_basico)
    if (!emp) resumo.semEmpresa++
    const registro: RegistroCatalogo = {
      ...est,
      razao_social: emp?.razao_social ?? null,
      natureza_juridica: emp?.natureza_juridica ?? null,
      capital_social: emp?.capital_social ?? null,
      porte: emp?.porte ?? null,
      mei: mei.get(est.cnpj_basico) ?? null,
      municipio: est.municipio_codigo ? municipios.get(est.municipio_codigo) ?? null : null,
      mes_rf: mesRf,
    }
    if (registro.email) resumo.comEmail++
    if (registro.telefone) resumo.comTelefone++
    if (registro.mei) resumo.mei++
    const uf = registro.uf ?? '??'
    resumo.porUf[uf] = (resumo.porUf[uf] ?? 0) + 1
    resumo.porCnaePrincipal[registro.cnae_principal] = (resumo.porCnaePrincipal[registro.cnae_principal] ?? 0) + 1
    if (resumo.amostra.length < TAMANHO_AMOSTRA) resumo.amostra.push(registro)

    lote.push(registro)
    if (lote.length >= tamanhoLote) await descarregar()
  }
  await descarregar()

  // Limpeza só com a visão completa do mês: numa carga parcial, "não visto"
  // não significa "saiu da RF".
  if (destino && completa) {
    resumo.removidos = await destino.removerNaoVistos(mesRf, cnaes, cnaesSecundarios)
  }

  return resumo
}
