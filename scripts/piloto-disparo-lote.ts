/**
 * Disparo em lote do 1º contato para os leads do PILOTO, com espaçamento entre
 * envios (protege a reputação do domínio — sem rajada de e-mails idênticos).
 *
 * Dois modos de seleção do lote:
 *
 *   1) IDs explícitos (modo original):
 *        npm run engine:piloto-lote <lead_id_1> <lead_id_2> ... <lead_id_N>
 *
 *   2) Seleção determinística do backlog n8n (execução manual, sob demanda):
 *        npm run engine:piloto-lote -- --novos-n8n [N]              → DRY-RUN: só lista
 *        npm run engine:piloto-lote -- --novos-n8n [N] --confirmar  → migra + dispara
 *      Critério (ordenação estável, revisável antes de confirmar):
 *        estagio='novos_leads' AND owner='n8n' AND contato_email preenchido,
 *        ORDER BY created_at ASC, LIMIT N (padrão 40).
 *      Com --confirmar, cada lead é migrado owner n8n → engine com a MESMA nota
 *      de auditoria do botão "Liberar para o motor" (LeadPanel), e só então o
 *      1º contato é disparado via executarAcao() (mesmo contrato do endpoint
 *      /api/engine/executar-acao).
 *
 * - Usa o motor real (Supabase real + GmailProvider quando há credenciais).
 * - O ENVIO é gated por MODO_ENSAIO (dentro do GmailProvider): em ensaio, só
 *   loga; em MODO_ENSAIO=false, envia de verdade. As escritas no Supabase
 *   (interação + avanço de estágio) acontecem sempre — é assim que o motor
 *   já roda em produção (mesmo contrato do scheduler).
 * - Espera INTERVALO_ENVIO_MIN minutos (do .env.local) entre cada ENVIO real
 *   (recusas/pulos não gastam espera). Ex.: 10 → 1 disparo a cada 10 minutos.
 * - Idempotente por construção: executarAcao() já recusa reenviar o mesmo
 *   estágio ao mesmo lead (motivo 'ja_enviado'), então rodar o script duas
 *   vezes com o mesmo lote não duplica envio.
 */
import fs from 'node:fs'
import path from 'node:path'

function carregarEnvLocal() {
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) throw new Error('.env.local não encontrado em ' + p)
  for (const linha of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const i = linha.indexOf('=')
    if (i <= 0) continue
    const k = linha.slice(0, i).trim()
    const v = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
}
carregarEnvLocal()

const args = process.argv.slice(2)
const idxSelecao = args.indexOf('--novos-n8n')
const modoSelecao = idxSelecao !== -1
const confirmar = args.includes('--confirmar')

let limiteSelecao = 40
if (modoSelecao) {
  const n = args[idxSelecao + 1]
  if (n && /^\d+$/.test(n)) limiteSelecao = Number(n)
}

const idsExplicitos = modoSelecao ? [] : args.filter((a) => !a.startsWith('--'))
if (!modoSelecao && idsExplicitos.length === 0) {
  console.error('Uso: npm run engine:piloto-lote <lead_id_1> ... <lead_id_N>')
  console.error('     npm run engine:piloto-lote -- --novos-n8n [N] [--confirmar]')
  process.exit(1)
}

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', yel: '\x1b[33m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const linha = () => console.log(C.dim + '─'.repeat(70) + C.r)
const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Subconjunto do lead necessário para listar/migrar/disparar o lote.
interface LeadDoLote {
  id: string
  empresa: string
  contato_nome: string | null
  contato_email: string | null
  owner: string | null
  created_at: string | null
}

// Seleção determinística do backlog n8n (mesma query no dry-run e no --confirmar;
// a ordenação por created_at ASC garante o mesmo lote nas duas passadas).
async function selecionarNovosN8n(limite: number): Promise<LeadDoLote[]> {
  const { createSupabaseAdminClient } = await import('../lib/supabase-admin')
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('leads')
    .select('id, empresa, contato_nome, contato_email, owner, created_at')
    .eq('estagio', 'novos_leads')
    .eq('owner', 'n8n')
    .not('contato_email', 'is', null)
    .neq('contato_email', '')
    .order('created_at', { ascending: true })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as LeadDoLote[]
}

function listarLote(leads: LeadDoLote[]) {
  for (const [i, l] of leads.entries()) {
    const criado = l.created_at ? l.created_at.slice(0, 10) : '—'
    console.log(
      `${C.dim}${String(i + 1).padStart(2)}.${C.r} ${C.b}${l.empresa}${C.r}` +
        ` — ${l.contato_nome ?? '(sem contato)'} <${C.cyan}${l.contato_email}${C.r}>` +
        ` ${C.dim}(criado ${criado}, id ${l.id})${C.r}`,
    )
  }
}

async function main() {
  const { criarMotorReal } = await import('../lib/engine/scheduler')
  const { executarAcao } = await import('../lib/engine/flows/executarAcao')
  const { engineConfig, getEngineConfig } = await import('../lib/engine/config')

  const ensaio = engineConfig.modoEnsaio
  const cfg = await getEngineConfig()
  const intervaloMin = cfg.intervaloEntreEnviosMin
  const intervaloMs = intervaloMin * 60_000

  const motor = criarMotorReal()

  let lote: LeadDoLote[]
  if (modoSelecao) {
    lote = await selecionarNovosN8n(limiteSelecao)
    console.log(`\n${C.b}📋 Seleção — backlog n8n para 1º contato${C.r}`)
    console.log(
      `${C.dim}Critério: estagio=novos_leads, owner=n8n, contato_email preenchido, created_at ASC, limite ${limiteSelecao}.${C.r}`,
    )
    console.log(`${C.dim}Encontrados: ${lote.length} lead(s). Envios hoje: ${await motor.store.enviosHoje()}/${cfg.maxEnviosDia}.${C.r}`)
    linha()
    listarLote(lote)
    linha()
    if (!confirmar) {
      console.log(`${C.yel}DRY-RUN: nada foi alterado.${C.r} Revise a lista acima e rode de novo com ${C.b}--confirmar${C.r} para migrar e disparar.\n`)
      return
    }
    if (lote.length === 0) {
      console.log('Nada a fazer.\n')
      return
    }
  } else {
    // Modo original por IDs: sem migração de owner — a trava owner='engine'
    // do executarAcao() continua valendo para cada lead.
    lote = idsExplicitos.map((id) => ({ id, empresa: id, contato_nome: null, contato_email: null, owner: null, created_at: null }))
  }

  console.log(`\n${C.b}🚀 PILOTO — Disparo em lote (Fluxo 1: Executar Ação)${C.r}`)
  console.log(`${C.dim}Leads: ${lote.length} | Espaçamento: ${intervaloMin}min | MODO_ENSAIO=${ensaio}${C.r}`)
  console.log(
    ensaio
      ? `${C.yel}Modo ENSAIO: nada será enviado de verdade (só logado).${C.r}`
      : `${C.red}${C.b}Modo REAL: e-mails SERÃO enviados de verdade.${C.r}`,
  )
  if (intervaloMin > 0) {
    const totalMin = (lote.length - 1) * intervaloMin
    console.log(`${C.dim}Tempo total estimado do lote: ~${totalMin}min.${C.r}`)
  }
  linha()

  // Migração owner n8n → engine, com a mesma nota de auditoria do botão
  // "Liberar para o motor" do LeadPanel. Só no modo de seleção confirmado.
  const migrados: LeadDoLote[] = []
  if (modoSelecao) {
    for (const lead of lote) {
      try {
        await motor.store.atualizarLead(lead.id, { owner: 'engine' })
        await motor.store.registrarInteracao({
          lead_id: lead.id,
          tipo: 'nota',
          canal: 'plataforma',
          descricao: `Lead liberado para o motor (owner: ${lead.owner ?? 'n8n'} → engine) manualmente (lote piloto de 1º contato).`,
          origem_acao: 'humano',
        })
        migrados.push(lead)
        console.log(`${C.grn}✓ migrado${C.r} ${lead.empresa} ${C.dim}(${lead.id})${C.r}`)
      } catch (e) {
        console.log(`${C.red}✗ falha ao migrar${C.r} ${lead.empresa} ${C.dim}(${lead.id})${C.r}: ${e instanceof Error ? e.message : e}`)
      }
    }
    linha()
    console.log(`${C.b}Migração:${C.r} ${migrados.length}/${lote.length} liberados para o motor.`)
    linha()
  } else {
    migrados.push(...lote)
  }

  let enviados = 0
  let pulados = 0 // idempotência: 1º contato já tinha sido enviado antes
  let recusados = 0 // outras recusas do motor (limite diário, owner, perdido...)
  let falhas = 0 // exceções (rede, SMTP...) — não abortam o resto do lote
  let precisaEsperar = false // só espaça depois de um ENVIO real

  for (const [indice, lead] of migrados.entries()) {
    if (precisaEsperar && intervaloMs > 0) {
      console.log(`${C.dim}⏳ Aguardando ${intervaloMin}min antes do próximo disparo...${C.r}`)
      await esperar(intervaloMs)
    }
    precisaEsperar = false

    const rotulo = lead.contato_email ? `${lead.empresa} <${lead.contato_email}>` : lead.id
    try {
      const r = await executarAcao(motor.store, motor.email, { leadId: lead.id })
      if (r.ok) {
        enviados++
        precisaEsperar = true
        console.log(`${C.grn}✓ [${indice + 1}/${migrados.length}] ${rotulo} → ${r.estagio}${C.r}`)
      } else if (r.motivo === 'ja_enviado') {
        pulados++
        console.log(`${C.yel}• [${indice + 1}/${migrados.length}] ${rotulo} → pulado (1º contato já enviado antes)${C.r}`)
      } else {
        recusados++
        console.log(`${C.yel}• [${indice + 1}/${migrados.length}] ${rotulo} → recusado (${r.motivo})${C.r}`)
      }
    } catch (e) {
      falhas++
      console.log(`${C.red}✗ [${indice + 1}/${migrados.length}] ${rotulo} → erro: ${e instanceof Error ? e.message : e}${C.r}`)
    }
  }

  linha()
  console.log(
    `${C.b}Resumo:${C.r} ${enviados} enviados, ${pulados} pulados (já contatados), ${recusados} recusados, ${falhas} falhas, ${migrados.length} no lote.`,
  )
  console.log()
}

main().catch((e) => {
  console.error('Erro no disparo em lote:', e)
  process.exit(1)
})
