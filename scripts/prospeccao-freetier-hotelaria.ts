/**
 * Prospecção free-tier — Piloto Hotelaria (spec-prospeccao-freetier-hotelaria.md).
 *
 *   npm run prospeccao:hotelaria -- [--dry] [--max=40] [--uf=SP] [--shard=0]
 *
 * Pipeline (nada de e-mail é disparado — só popula a base pra revisão manual):
 *   1. DESCOBERTA — dados abertos da Receita Federal (Estabelecimentos*.zip via
 *      WebDAV público oficial), filtrando CNAE 5510-8/01 (Hotéis) e 5510-8/02
 *      (Apart-hotéis), situação ATIVA, matriz. Resultado fica em cache local
 *      (data/prospeccao/) — o download pesado (~2 GB/shard, streaming) roda 1x
 *      e alimenta muitos meses. [A API da OpenCNPJ não tem busca por CNAE —
 *      só consulta individual; o filtro por CNAE deles é só via BigQuery.]
 *   2. ENRIQUECIMENTO — OpenCNPJ por CNPJ (situação fresca, QSA → sócio-
 *      administrador como decisor, e-mail cadastral, porte; MEI é excluído).
 *   3. E-MAIL — Hunter.io tier grátis: verifica o e-mail cadastral; sem ele,
 *      domain-search no domínio do hotel. Cap de 40 chamadas/execução (folga
 *      sobre as 50 verificações/mês do plano grátis).
 *   4. TESE COMERCIAL — Tavily tier grátis (include_answer) gera 2-3 frases
 *      sobre sinais públicos do hotel; também descobre o site oficial.
 *   5. INSERT em `leads` com owner='engine', segmento='hotelaria',
 *      origem='freetier_opencnpj', estagio='novos_leads'.
 *
 * Idempotência (rodar 2x não duplica):
 *   - CNPJ fica gravado em `hubspot_id` como "cnpj:XXXXXXXXXXXXXX" (coluna
 *     livre p/ id externo, não exibida na UI; a tabela não tem coluna cnpj e
 *     não há como aplicar migration por aqui) — checado antes de cada insert.
 *   - Domínio/e-mail: reusa buscarLeadPorDominio/buscarLeadPorEmail do
 *     SupabaseStore (mesma lógica do motor).
 *   - Registro local data/prospeccao/status-cnpj.json evita re-gastar cota do
 *     Hunter com CNPJs já processados (inclusive os pulados por falta de e-mail).
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'
import { Readable, Transform } from 'node:stream'
import { bootstrapEnv } from './_bootstrap'

bootstrapEnv()

// ---------------------------------------------------------------------------
// Constantes / configuração
// ---------------------------------------------------------------------------
const CNAES_HOTELARIA = new Set(['5510801', '5510802']) // 5510-8/01 Hotéis, /02 Apart-hotéis
const RF_SHARE_TOKEN = process.env.PROSPECCAO_RF_SHARE || 'YggdBLfdninEJX9' // share público oficial da RF
const RF_BASE = 'https://arquivos.receitafederal.gov.br/public.php/webdav'
const RF_AUTH = 'Basic ' + Buffer.from(`${RF_SHARE_TOKEN}:`).toString('base64')

const DIR_DADOS = path.join(process.cwd(), 'data', 'prospeccao')
const ARQ_CANDIDATOS = path.join(DIR_DADOS, 'candidatos-hotelaria.json')
const ARQ_STATUS = path.join(DIR_DADOS, 'status-cnpj.json')

// Cap de leads inseridos e de chamadas Hunter por execução (spec §3: folga
// sobre o limite grátis de 50 verificações/mês do Hunter).
const MAX_LEADS_PADRAO = 40
const MAX_CHAMADAS_HUNTER = 40
const MAX_CHAMADAS_TAVILY = 80
// Descoberta para de baixar o shard quando junta este nº de candidatos (o
// arquivo tem ~2 GB; normalmente nem precisa ler até o fim).
const MIN_CANDIDATOS = Number(process.env.PROSPECCAO_MIN_CANDIDATOS || 1500)

// Sites que nunca são o site oficial do hotel (OTAs, redes sociais, fichas CNPJ).
const HOSTS_BLOQUEADOS = [
  'booking.com', 'tripadvisor', 'expedia', 'hoteis.com', 'hotels.com', 'decolar',
  'despegar', 'airbnb', 'trivago', 'kayak', 'hurb', 'hotelurbano', 'agoda',
  'instagram', 'facebook', 'youtube', 'linkedin', 'twitter', 'x.com', 'wikipedia',
  'google', 'waze', 'apontador', 'telelistas', 'guiamais', 'solutudo',
  'cnpj', 'econodata', 'casadosdados', 'serasa', 'escavador', 'jusbrasil',
  'consultasocio', 'empresascnpj', 'informecadastral', 'b2bhint',
]
const PROVEDORES_PESSOAIS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br',
  'icloud.com', 'live.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
])

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', yel: '\x1b[33m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const linha = () => console.log(C.dim + '─'.repeat(72) + C.r)
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const MAX_LEADS = Number(args.find((a) => a.startsWith('--max='))?.slice(6) || MAX_LEADS_PADRAO)
const UF_FILTRO = args.find((a) => a.startsWith('--uf='))?.slice(5)?.toUpperCase() || null
const SHARD = Number(args.find((a) => a.startsWith('--shard='))?.slice(8) || 0)

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface Candidato {
  cnpj: string // 14 dígitos
  nome_fantasia: string
  cnae: string
  uf: string
  email_rf: string
  telefone: string
}

interface CacheCandidatos {
  gerado_em: string
  mes_rf: string
  shard: number
  total: number
  candidatos: Candidato[]
}

type StatusCnpj = { status: 'inserido' | 'ja_existia' | 'descartado' | 'sem_email' | 'sem_socio' | 'erro'; quando: string; detalhe?: string }
type Registro = Record<string, StatusCnpj>

// ---------------------------------------------------------------------------
// Descoberta — dados abertos da RF (streaming do zip, sem tocar o disco)
// ---------------------------------------------------------------------------
async function mesMaisRecenteRF(): Promise<string> {
  if (process.env.PROSPECCAO_RF_MES) return process.env.PROSPECCAO_RF_MES
  const res = await fetch(`${RF_BASE}/`, {
    method: 'PROPFIND',
    headers: { Authorization: RF_AUTH, Depth: '1' },
  })
  if (!res.ok) throw new Error(`PROPFIND na RF falhou: HTTP ${res.status}`)
  const xml = await res.text()
  const meses = [...xml.matchAll(/webdav\/(\d{4}-\d{2})/g)].map((m) => m[1])
  if (meses.length === 0) throw new Error('Nenhuma pasta de mês encontrada no share da RF')
  return meses.sort().at(-1)!
}

// Remove o local file header do zip (assinatura + nome + extra) e repassa o
// deflate cru. Os zips da RF têm UMA entrada, então basta pular o cabeçalho.
function criarStripZipHeader(): Transform {
  let cabecalho: Buffer = Buffer.alloc(0)
  let pularRestante = -1 // -1 = ainda lendo o cabeçalho fixo
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (pularRestante === -1) {
        cabecalho = Buffer.concat([cabecalho, chunk])
        if (cabecalho.length < 30) return cb()
        if (cabecalho.readUInt32LE(0) !== 0x04034b50) {
          return cb(new Error('Arquivo baixado não é um zip (assinatura inválida)'))
        }
        const nameLen = cabecalho.readUInt16LE(26)
        const extraLen = cabecalho.readUInt16LE(28)
        pularRestante = 30 + nameLen + extraLen
        chunk = cabecalho
        cabecalho = Buffer.alloc(0)
      }
      if (pularRestante > 0) {
        const corta = Math.min(pularRestante, chunk.length)
        pularRestante -= corta
        chunk = chunk.subarray(corta)
      }
      if (chunk.length > 0) this.push(chunk)
      cb()
    },
  })
}

// Baixa o shard em streaming e filtra as linhas de hotelaria. Aborta o download
// assim que juntar `MIN_CANDIDATOS` (os hotéis se espalham pelo arquivo inteiro,
// então um prefixo do arquivo já é uma amostra válida).
async function descobrirCandidatos(mesRF: string, shard: number): Promise<Candidato[]> {
  const url = `${RF_BASE}/${mesRF}/Estabelecimentos${shard}.zip`
  console.log(`${C.cyan}▸ Baixando (streaming) ${url}${C.r}`)
  console.log(`${C.dim}  Para no ${MIN_CANDIDATOS}º candidato ou no fim do arquivo — pode levar vários minutos.${C.r}`)

  const abortar = new AbortController()
  const res = await fetch(url, { headers: { Authorization: RF_AUTH }, signal: abortar.signal })
  if (!res.ok || !res.body) throw new Error(`Download da RF falhou: HTTP ${res.status}`)
  const tamanhoTotal = Number(res.headers.get('content-length') || 0)

  let bytes = 0
  const contador = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length
      this.push(chunk)
      cb()
    },
  })

  const inflate = zlib.createInflateRaw()
  inflate.setEncoding('latin1')
  const fonte = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
  const strip = criarStripZipHeader()
  fonte.pipe(contador).pipe(strip).pipe(inflate)
  // O abort proposital (candidatos suficientes) emite 'error' nos streams — engole.
  const ignorarAbort = (e: Error) => {
    if (!abortar.signal.aborted) throw e
  }
  for (const s of [fonte, contador, strip, inflate]) s.on('error', ignorarAbort)

  const candidatos: Candidato[] = []
  const vistos = new Set<string>()
  let linhas = 0
  const rl = readline.createInterface({ input: inflate })
  const progresso = setInterval(() => {
    const pct = tamanhoTotal ? ((bytes / tamanhoTotal) * 100).toFixed(1) + '%' : '?'
    console.log(`${C.dim}  ... ${(bytes / 1048576).toFixed(0)} MB (${pct}), ${linhas.toLocaleString()} linhas, ${candidatos.length} hotéis${C.r}`)
  }, 15_000)

  try {
    for await (const linhaCsv of rl) {
      linhas++
      // Pré-filtro barato antes do parse (a linha inteira raramente contém o CNAE).
      if (!linhaCsv.includes('5510801') && !linhaCsv.includes('5510802')) continue
      const f = linhaCsv.replace(/^"|"$/g, '').split('";"')
      if (f.length < 28) continue
      // f[3]=matriz/filial, f[5]=situação (02=ATIVA), f[11]=CNAE principal
      if (f[3] !== '1' || f[5] !== '02' || !CNAES_HOTELARIA.has(f[11])) continue
      const cnpj = `${f[0]}${f[1]}${f[2]}`
      if (cnpj.length !== 14 || vistos.has(cnpj)) continue
      vistos.add(cnpj)
      candidatos.push({
        cnpj,
        nome_fantasia: f[4]?.trim() ?? '',
        cnae: f[11],
        uf: f[19]?.trim() ?? '',
        email_rf: (f[27] ?? '').trim().toLowerCase(),
        telefone: f[21] && f[22] ? `(${f[21].trim()}) ${f[22].trim()}` : '',
      })
      if (candidatos.length >= MIN_CANDIDATOS) {
        abortar.abort()
        break
      }
    }
  } catch (e) {
    // Abort proposital do download não é erro.
    if (!abortar.signal.aborted) throw e
  } finally {
    clearInterval(progresso)
    rl.close()
    fonte.destroy()
  }
  console.log(`${C.grn}✓ Descoberta: ${candidatos.length} hotéis ativos (matriz) em ${linhas.toLocaleString()} linhas lidas (${(bytes / 1048576).toFixed(0)} MB).${C.r}`)
  return candidatos
}

async function carregarOuGerarCandidatos(): Promise<CacheCandidatos> {
  if (fs.existsSync(ARQ_CANDIDATOS)) {
    const cache = JSON.parse(fs.readFileSync(ARQ_CANDIDATOS, 'utf-8')) as CacheCandidatos
    console.log(`${C.dim}▸ Cache de candidatos: ${cache.total} hotéis (RF ${cache.mes_rf}, shard ${cache.shard}, gerado em ${cache.gerado_em.slice(0, 10)}).${C.r}`)
    console.log(`${C.dim}  (apague ${path.relative(process.cwd(), ARQ_CANDIDATOS)} para re-baixar da RF)${C.r}`)
    return cache
  }
  const mesRF = await mesMaisRecenteRF()
  console.log(`${C.cyan}▸ Mês mais recente na RF: ${mesRF}${C.r}`)
  const candidatos = await descobrirCandidatos(mesRF, SHARD)
  if (candidatos.length === 0) throw new Error('Descoberta não encontrou nenhum hotel — verifique o layout do arquivo da RF.')
  const cache: CacheCandidatos = {
    gerado_em: new Date().toISOString(),
    mes_rf: mesRF,
    shard: SHARD,
    total: candidatos.length,
    candidatos,
  }
  fs.mkdirSync(DIR_DADOS, { recursive: true })
  fs.writeFileSync(ARQ_CANDIDATOS, JSON.stringify(cache, null, 1))
  return cache
}

// ---------------------------------------------------------------------------
// OpenCNPJ — enriquecimento por CNPJ (grátis, sem chave; limite 50 req/s)
// ---------------------------------------------------------------------------
interface DadosOpenCnpj {
  razao_social: string
  nome_fantasia: string
  situacao_cadastral: string
  cnae_principal: string
  municipio: string
  uf: string
  email: string | null
  telefones: { ddd: string; numero: string; is_fax: boolean }[]
  porte_empresa: string
  opcao_mei: string
  QSA: { nome_socio: string; qualificacao_socio: string }[]
}

async function consultarOpenCnpj(cnpj: string): Promise<DadosOpenCnpj | null> {
  const res = await fetch(`https://api.opencnpj.org/${cnpj}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`OpenCNPJ HTTP ${res.status} para ${cnpj}`)
  return (await res.json()) as DadosOpenCnpj
}

// Sócio-administrador do QSA (decisor de compra em hotel pequeno/médio — spec §2).
function socioAdministrador(qsa: DadosOpenCnpj['QSA']): { nome: string; cargo: string } | null {
  if (!qsa?.length) return null
  const admin = qsa.find((s) => /adminis/i.test(s.qualificacao_socio ?? ''))
  const escolhido = admin ?? qsa.find((s) => /s[óo]cio|titular|empres/i.test(s.qualificacao_socio ?? '')) ?? qsa[0]
  if (!escolhido?.nome_socio) return null
  return { nome: titulo(escolhido.nome_socio), cargo: escolhido.qualificacao_socio || 'Sócio' }
}

// ---------------------------------------------------------------------------
// Tavily — site oficial + tese comercial (tier grátis: 1.000 créditos/mês)
// ---------------------------------------------------------------------------
interface ResultadoTavily {
  answer?: string
  results: { title: string; url: string; content: string }[]
}

async function pesquisarTavily(query: string): Promise<ResultadoTavily> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, search_depth: 'basic', include_answer: true, max_results: 5 }),
  })
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as ResultadoTavily
}

function hostDe(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

// Site oficial: host que não é OTA/rede social/ficha de CNPJ E contém algum
// token (>=4 letras) do nome do hotel — conservador de propósito, é melhor
// ficar sem site do que apontar pro site errado.
function acharSiteOficial(nome: string, resultados: ResultadoTavily['results']): string | null {
  const tokens = nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !['hotel', 'apart', 'pousada', 'ltda', 'eireli'].includes(t))
  for (const r of resultados) {
    const host = hostDe(r.url)
    if (!host || HOSTS_BLOQUEADOS.some((b) => host.includes(b))) continue
    if (tokens.some((t) => host.replace(/[^a-z0-9]/g, '').includes(t))) return `https://${host}`
  }
  return null
}

// Tese comercial: 2-3 frases a partir do answer do Tavily (sinais públicos do
// hotel). Sem answer, cai numa tese honesta de baixo sinal — nunca inventa.
function montarTese(d: DadosOpenCnpj, pesquisa: ResultadoTavily | null, site: string | null): string {
  const cidade = `${titulo(d.municipio)}/${d.uf}`
  const frases: string[] = []
  const answer = pesquisa?.answer?.trim()
  if (answer) {
    const partes = answer.split(/(?<=[.!?])\s+/).filter((s) => s.length > 15)
    frases.push(partes.slice(0, 3).join(' ').slice(0, 420))
  } else {
    frases.push(`Hotel em ${cidade} (${d.cnae_principal === '5510802' ? 'apart-hotel' : 'hotel'}, porte "${d.porte_empresa}"). Poucos sinais públicos encontrados — vale validar a operação antes do contato.`)
  }
  if (site) frases.push(`Site: ${site}.`)
  const fontes = (pesquisa?.results ?? []).map((r) => hostDe(r.url)).filter(Boolean).slice(0, 2)
  if (fontes.length) frases.push(`(fontes: ${fontes.join(', ')})`)
  return frases.join(' ')
}

// ---------------------------------------------------------------------------
// Hunter.io — e-mail validado (tier grátis: 50 verificações/mês)
// ---------------------------------------------------------------------------
let chamadasHunter = 0

async function hunterVerificar(email: string): Promise<{ ok: boolean; detalhe: string }> {
  chamadasHunter++
  const res = await fetch(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${process.env.HUNTER_API_KEY}`)
  const corpo = (await res.json()) as { data?: { result?: string; score?: number }; errors?: { details?: string }[] }
  if (!res.ok) throw new Error(`Hunter verifier HTTP ${res.status}: ${corpo.errors?.[0]?.details ?? ''}`)
  const r = corpo.data?.result ?? 'unknown'
  return { ok: r === 'deliverable' || r === 'risky', detalhe: `${r} (score ${corpo.data?.score ?? '?'})` }
}

async function hunterBuscarNoDominio(dominio: string): Promise<{ email: string; detalhe: string } | null> {
  chamadasHunter++
  const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(dominio)}&limit=10&api_key=${process.env.HUNTER_API_KEY}`)
  const corpo = (await res.json()) as { data?: { emails?: { value: string; type: string; confidence: number }[] }; errors?: { details?: string }[] }
  if (!res.ok) throw new Error(`Hunter domain-search HTTP ${res.status}: ${corpo.errors?.[0]?.details ?? ''}`)
  const emails = (corpo.data?.emails ?? []).filter((e) => e.confidence >= 40)
  if (emails.length === 0) return null
  // Prefere caixas que um hotel realmente lê (reservas/contato/...), senão a de maior confiança.
  const preferido = emails.find((e) => /^(reservas?|contato|comercial|adm|administra|recepcao|gerencia|financeiro)/i.test(e.value)) ?? emails.sort((a, b) => b.confidence - a.confidence)[0]
  return { email: preferido.value.toLowerCase(), detalhe: `domain-search (confiança ${preferido.confidence})` }
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
// "HOTEL FAZENDA DAS FLORES LTDA" → "Hotel Fazenda das Flores Ltda"
function titulo(s: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em'])
  return (s ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
    .trim()
}

function dominioDoEmail(email: string | null | undefined): string | null {
  const d = email?.split('@')[1]?.toLowerCase()
  return d && !PROVEDORES_PESSOAIS.has(d) ? d : null
}

function carregarRegistro(): Registro {
  if (!fs.existsSync(ARQ_STATUS)) return {}
  return JSON.parse(fs.readFileSync(ARQ_STATUS, 'utf-8')) as Registro
}

function salvarRegistro(reg: Registro) {
  fs.mkdirSync(DIR_DADOS, { recursive: true })
  fs.writeFileSync(ARQ_STATUS, JSON.stringify(reg, null, 1))
}

// ---------------------------------------------------------------------------
// Pipeline principal
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n${C.b}🏨 Prospecção free-tier — Hotelaria (CNAE 5510-8/01 e /02)${C.r}`)
  console.log(`${C.dim}max=${MAX_LEADS} | uf=${UF_FILTRO ?? 'todas'} | shard=${SHARD} | ${DRY ? 'DRY-RUN (não insere, não gasta Hunter/Tavily)' : 'REAL (insere na base)'}${C.r}`)
  linha()

  if (!DRY) {
    const faltando = ['HUNTER_API_KEY', 'TAVILY_API_KEY'].filter((k) => !process.env[k])
    if (faltando.length) {
      console.error(`${C.red}✗ Falta configurar no .env.local: ${faltando.join(', ')}.${C.r}`)
      console.error(`${C.dim}  Hunter: https://hunter.io (Settings > API) | Tavily: https://tavily.com — contas grátis, sem cartão.`)
      console.error(`  Enquanto isso dá pra testar a descoberta e a deduplicação com --dry.${C.r}`)
      process.exit(1)
    }
  }

  // Imports tardios (depois do bootstrapEnv), como nos demais scripts do motor.
  const { SupabaseStore } = await import('../lib/engine/store/supabaseStore')
  const { createSupabaseAdminClient } = await import('../lib/supabase-admin')
  const store = new SupabaseStore()
  const db = createSupabaseAdminClient()

  const cache = await carregarOuGerarCandidatos()
  const registro = carregarRegistro()

  let candidatos = cache.candidatos
  if (UF_FILTRO) candidatos = candidatos.filter((c) => c.uf === UF_FILTRO)

  let inseridos = 0
  let jaExistiam = 0
  let pulados = 0
  let chamadasTavily = 0
  const resumoDry: string[] = []

  for (const cand of candidatos) {
    if (inseridos >= MAX_LEADS) break
    if (chamadasHunter >= MAX_CHAMADAS_HUNTER) {
      console.log(`${C.yel}• Cap de ${MAX_CHAMADAS_HUNTER} chamadas Hunter atingido — parando por esta execução.${C.r}`)
      break
    }

    // Já processado numa execução anterior? (não re-gasta cota)
    const st = registro[cand.cnpj]
    if (st && st.status !== 'erro') {
      pulados++
      continue
    }

    const marcar = (status: StatusCnpj['status'], detalhe?: string) => {
      if (!DRY) {
        registro[cand.cnpj] = { status, quando: new Date().toISOString(), detalhe }
        salvarRegistro(registro)
      }
    }

    // 1) Idempotência por CNPJ direto no banco.
    const dupCnpj = await db.from('leads').select('id').eq('hubspot_id', `cnpj:${cand.cnpj}`).limit(1)
    if (dupCnpj.error) throw dupCnpj.error
    if (dupCnpj.data?.length) {
      jaExistiam++
      marcar('ja_existia', 'cnpj já na base')
      console.log(`${C.dim}• ${cand.cnpj} já está na base (cnpj) — pulando.${C.r}`)
      continue
    }

    // 2) Situação fresca + QSA + porte via OpenCNPJ.
    await esperar(150)
    let dados: DadosOpenCnpj | null
    try {
      dados = await consultarOpenCnpj(cand.cnpj)
    } catch (e) {
      console.log(`${C.yel}• ${cand.cnpj} erro na OpenCNPJ (${(e as Error).message}) — fica pra próxima execução.${C.r}`)
      marcar('erro', String((e as Error).message))
      continue
    }
    if (!dados || dados.situacao_cadastral !== 'Ativa' || !CNAES_HOTELARIA.has(dados.cnae_principal)) {
      marcar('descartado', 'inativo ou CNAE mudou')
      continue
    }
    if (dados.opcao_mei === 'S') {
      marcar('descartado', 'MEI (dificilmente é o decisor certo)')
      continue
    }

    const nomeExibicao = titulo(dados.nome_fantasia || cand.nome_fantasia || dados.razao_social)
    const socio = socioAdministrador(dados.QSA)
    if (!socio) {
      marcar('sem_socio', 'QSA vazio — decisor precisa de pesquisa manual')
      console.log(`${C.yel}• ${nomeExibicao} (${cand.cnpj}) sem QSA — pulando (pesquisa manual).${C.r}`)
      continue
    }

    const emailRF = (dados.email || cand.email_rf || '').toLowerCase() || null

    if (DRY) {
      resumoDry.push(`${nomeExibicao} — ${titulo(dados.municipio)}/${dados.uf} — sócio: ${socio.nome} — email RF: ${emailRF ?? '(nenhum)'}`)
      console.log(`${C.cyan}○ [dry] ${nomeExibicao} (${cand.cnpj}) passaria pro enriquecimento Hunter/Tavily.${C.r}`)
      if (resumoDry.length >= MAX_LEADS) break
      continue
    }

    // 3) Tavily: site oficial + matéria-prima da tese.
    let pesquisa: ResultadoTavily | null = null
    if (chamadasTavily < MAX_CHAMADAS_TAVILY) {
      try {
        chamadasTavily++
        pesquisa = await pesquisarTavily(`hotel "${nomeExibicao}" ${titulo(dados.municipio)} ${dados.uf}`)
        await esperar(300)
      } catch (e) {
        console.log(`${C.yel}  Tavily falhou pra ${nomeExibicao}: ${(e as Error).message}${C.r}`)
      }
    }
    const site = pesquisa ? acharSiteOficial(nomeExibicao, pesquisa.results) : null
    const dominio = (site ? hostDe(site) : null) ?? dominioDoEmail(emailRF)

    // 4) Dedup por domínio (mesma lógica do motor) antes de gastar Hunter.
    if (dominio) {
      const dupDominio = await store.buscarLeadPorDominio(dominio)
      if (dupDominio) {
        jaExistiam++
        marcar('ja_existia', `domínio ${dominio} já na base (lead ${dupDominio.id})`)
        console.log(`${C.dim}• ${nomeExibicao}: domínio ${dominio} já está na base — pulando.${C.r}`)
        continue
      }
    }

    // 5) E-mail validado via Hunter: verifica o cadastral; sem ele, procura no domínio.
    let email: string | null = null
    let emailDetalhe = ''
    try {
      if (emailRF) {
        const v = await hunterVerificar(emailRF)
        if (v.ok) {
          email = emailRF
          emailDetalhe = `verificado: ${v.detalhe}`
        }
      }
      if (!email && dominio && chamadasHunter < MAX_CHAMADAS_HUNTER) {
        const achado = await hunterBuscarNoDominio(dominio)
        if (achado) {
          email = achado.email
          emailDetalhe = achado.detalhe
        }
      }
      await esperar(1200) // gentileza com o rate-limit do tier grátis
    } catch (e) {
      const msg = (e as Error).message
      // Cota mensal estourada → não adianta continuar o lote.
      if (/limit|quota|429/i.test(msg)) {
        console.log(`${C.red}✗ Hunter sem cota (${msg}) — parando por esta execução.${C.r}`)
        break
      }
      marcar('erro', `hunter: ${msg}`)
      console.log(`${C.yel}• ${nomeExibicao}: erro no Hunter (${msg}) — fica pra próxima execução.${C.r}`)
      continue
    }
    if (!email) {
      marcar('sem_email', 'Hunter não achou/validou e-mail — pesquisa manual')
      console.log(`${C.yel}• ${nomeExibicao}: sem e-mail validado — pulando (pesquisa manual).${C.r}`)
      pulados++
      continue
    }

    // Dedup final por e-mail exato (cobre hotel com e-mail de provedor pessoal).
    const dupEmail = await store.buscarLeadPorEmail(email)
    if (dupEmail) {
      jaExistiam++
      marcar('ja_existia', `e-mail ${email} já na base (lead ${dupEmail.id})`)
      continue
    }

    // 6) Insert — nenhum e-mail é disparado; primeiro contato continua manual.
    const tese = montarTese(dados, pesquisa, site)
    const telefone = dados.telefones?.find((t) => !t.is_fax)
    const novo = {
      empresa: nomeExibicao,
      cidade: titulo(dados.municipio),
      estado: dados.uf,
      segmento: 'hotelaria',
      site: site ?? undefined,
      contato_nome: socio.nome,
      contato_cargo: socio.cargo,
      contato_email: email,
      contato_telefone: telefone ? `(${telefone.ddd}) ${telefone.numero}` : cand.telefone || undefined,
      canal_preferencial: 'email',
      estagio: 'novos_leads',
      score: 50,
      origem: 'freetier_opencnpj',
      hubspot_id: `cnpj:${cand.cnpj}`,
      owner: 'engine',
      tese_comercial: tese,
      dominio: dominio ?? undefined,
      perdido: false,
    }
    const ins = await db.from('leads').insert(novo).select('id').single()
    if (ins.error) {
      marcar('erro', `insert: ${ins.error.message}`)
      console.log(`${C.red}✗ ${nomeExibicao}: insert falhou (${ins.error.message}).${C.r}`)
      continue
    }
    inseridos++
    marcar('inserido', `lead ${ins.data.id} — ${email} (${emailDetalhe})`)
    console.log(`${C.grn}✓ [${inseridos}/${MAX_LEADS}] ${nomeExibicao} — ${titulo(dados.municipio)}/${dados.uf} — ${socio.nome} <${email}>${C.r}`)
  }

  linha()
  if (DRY) {
    console.log(`${C.b}DRY-RUN:${C.r} ${resumoDry.length} candidatos passariam pro enriquecimento; ${jaExistiam} já existiam na base; ${pulados} pulados por execuções anteriores.`)
    for (const l of resumoDry) console.log(`${C.dim}  · ${l}${C.r}`)
  } else {
    console.log(`${C.b}Resumo:${C.r} ${inseridos} leads inseridos | ${jaExistiam} já existiam | ${pulados} pulados | Hunter: ${chamadasHunter} chamadas | Tavily: ${chamadasTavily}.`)
    console.log(`${C.dim}Nenhum e-mail foi disparado. Revise os leads na Base de Leads (segmento "hotelaria") antes do primeiro contato.${C.r}`)
  }
  console.log()
}

main().catch((e) => {
  console.error(`${C.red}Erro na prospecção:${C.r}`, e)
  process.exit(1)
})
