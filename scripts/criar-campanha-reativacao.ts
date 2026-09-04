/**
 * Cria a campanha "Reativação de clientes" para a org Laudos Técnicos.
 * Idempotente: pode ser re-executado sem duplicar nada.
 *
 * O que faz:
 *   1. Semeia 3 templates de reativação (reativacao_1/2/3) na org
 *   2. Cria e publica o workflow "Reativação de clientes (Laudos)" com gatilho manual
 *   3. Cria o registro de campanha com dry_run=true (nenhum e-mail sai)
 *   4. Ativa a campanha
 *   5. Inscreve todos os leads elegíveis (com e-mail, não perdidos) na execução
 *
 * Após o enrollment, o motor (cron /api/workflows/processar) avança as execuções.
 * Os envios são bloqueados pelo campanhas.dry_run=true. Para liberar:
 *   UPDATE campanhas SET dry_run=false WHERE id='<id>';
 * Ou via PATCH /api/campanhas/<id> { dry_run: false } com campanhas.manage.
 *
 * Usage:
 *   npx tsx scripts/criar-campanha-reativacao.ts              (ensaio: só mostra)
 *   npx tsx scripts/criar-campanha-reativacao.ts --confirmar  (executa)
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { exigirConfirmacao } from './_guarda'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG = '03097614-9fd5-4491-a91c-589f84461683' // LAUDO DE BRINQUEDOS

const TEMPLATES = [
  {
    tipo: 'reativacao_1',
    nome: 'E-mail · Reativação · 1ª mensagem',
    assunto: '{empresa} — retomando contato',
    corpo: `Olá {nome},

Meu nome é {responsavel_comercial} e faço parte da equipe de laudos técnicos. A {empresa} já trabalhou conosco anteriormente e queria retomar o contato para ver se há brinquedos aguardando certificação ou laudos próximos do vencimento este ano.

Se fizer sentido conversar, é só responder este e-mail. Posso passar uma proposta atualizada sem compromisso.

Atenciosamente,
{responsavel_comercial}`,
  },
  {
    tipo: 'reativacao_2',
    nome: 'E-mail · Reativação · 2ª mensagem',
    assunto: 'Re: {empresa} — retomando contato',
    corpo: `Oi {nome},

Deixando uma segunda mensagem caso a anterior tenha passado despercebida.

Se a {empresa} tiver novos produtos para laudar ou laudos vencendo em breve, adoraria ajudar. Responda este e-mail e organizamos uma proposta.

Abraços,
{responsavel_comercial}`,
  },
  {
    tipo: 'reativacao_3',
    nome: 'E-mail · Reativação · 3ª mensagem (última)',
    assunto: 'Re: {empresa} — última mensagem',
    corpo: `Oi {nome},

Prometo que esta é a última mensagem desta sequência.

Se surgir alguma necessidade de laudo técnico para brinquedos no futuro, pode nos chamar a qualquer momento.

Até breve,
{responsavel_comercial}`,
  },
]

const WORKFLOW_NOME = 'Reativação de clientes (Laudos)'
const CAMPANHA_NOME = 'Reativação de clientes'

const DEFINICAO_WORKFLOW = {
  gatilho: { id: 'g1', tipo: 'manual', config: {} },
  condicoes: [],
  acoes: [
    { id: 'a1', tipo: 'enviar_email', config: { template: 'reativacao_1' } },
    { id: 'a2', tipo: 'esperar', config: { dias: 4 } },
    {
      id: 'a3', tipo: 'saltar_se', config: {
        condicao: { tipo: 'lead_respondeu', config: { respondeu: true } },
        destino: 'fim',
      },
    },
    { id: 'a4', tipo: 'enviar_email', config: { template: 'reativacao_2' } },
    { id: 'a5', tipo: 'esperar', config: { dias: 5 } },
    {
      id: 'a6', tipo: 'saltar_se', config: {
        condicao: { tipo: 'lead_respondeu', config: { respondeu: true } },
        destino: 'fim',
      },
    },
    { id: 'a7', tipo: 'enviar_email', config: { template: 'reativacao_3' } },
    { id: 'fim', tipo: 'encerrar', config: {} },
  ],
}

async function main() {
  exigirConfirmacao({
    nome: 'CRIAR CAMPANHA — ' + CAMPANHA_NOME,
    alvo: 'org Laudos ' + ORG,
    efeitos: [
      'semeia 3 templates de reativação na org',
      'cria e publica o workflow "' + WORKFLOW_NOME + '"',
      'cria a campanha com dry_run=true e a ativa',
      'inscreve todos os leads elegíveis nas execuções do workflow',
    ],
  })

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    console.log('=== Criação da Campanha de Reativação de Clientes ===')
    console.log(`Org: ${ORG}`)

    // 1. Semear templates
    console.log('\n[1/5] Templates...')
    const templateIds: Record<string, string> = {}
    for (const t of TEMPLATES) {
      const ex = await c.query(
        `SELECT id FROM templates WHERE organizacao_id=$1 AND canal='email' AND tipo=$2`,
        [ORG, t.tipo]
      )
      if (ex.rowCount && ex.rowCount > 0) {
        templateIds[t.tipo] = ex.rows[0].id
        console.log(`  ✔ ${t.tipo} já existe (id=${ex.rows[0].id})`)
      } else {
        const ins = await c.query(
          `INSERT INTO templates (organizacao_id, canal, nicho, tipo, nome, assunto, corpo, ativo, taxa_resposta)
           VALUES ($1,'email',NULL,$2,$3,$4,$5,true,0) RETURNING id`,
          [ORG, t.tipo, t.nome, t.assunto, t.corpo]
        )
        templateIds[t.tipo] = ins.rows[0].id
        console.log(`  ✔ ${t.tipo} criado (id=${ins.rows[0].id})`)
      }
    }

    // 2. Criar/verificar workflow
    console.log('\n[2/5] Workflow...')
    const exWf = await c.query(
      `SELECT id, status, versao_atual_id FROM workflows WHERE organizacao_id=$1 AND nome=$2`,
      [ORG, WORKFLOW_NOME]
    )
    let workflowId: string
    let versaoId: string

    if (exWf.rowCount && exWf.rowCount > 0) {
      workflowId = exWf.rows[0].id
      versaoId = exWf.rows[0].versao_atual_id
      console.log(`  ✔ Workflow já existe (id=${workflowId}, status=${exWf.rows[0].status})`)
    } else {
      // Criar workflow
      const insWf = await c.query(
        `INSERT INTO workflows (organizacao_id, nome, status, rascunho_definicao)
         VALUES ($1,$2,'rascunho',$3) RETURNING id`,
        [ORG, WORKFLOW_NOME, JSON.stringify(DEFINICAO_WORKFLOW)]
      )
      workflowId = insWf.rows[0].id
      console.log(`  ✔ Workflow criado (id=${workflowId})`)

      // Criar versão 1 (publicar)
      const insVer = await c.query(
        `INSERT INTO workflow_versoes (organizacao_id, workflow_id, numero, definicao, publicado_por)
         VALUES ($1,$2,1,$3,NULL) RETURNING id`,
        [ORG, workflowId, JSON.stringify(DEFINICAO_WORKFLOW)]
      )
      versaoId = insVer.rows[0].id
      console.log(`  ✔ Versão 1 publicada (id=${versaoId})`)

      // Publicar workflow
      await c.query(
        `UPDATE workflows SET status='publicado', versao_atual_id=$2, rascunho_definicao=NULL WHERE id=$1`,
        [workflowId, versaoId]
      )
      console.log(`  ✔ Workflow publicado`)
    }

    if (!versaoId) throw new Error('Workflow sem versao_atual_id — não foi publicado corretamente.')

    // 3. Criar/verificar campanha
    console.log('\n[3/5] Campanha...')
    const exCamp = await c.query(
      `SELECT id, status, dry_run FROM campanhas WHERE organizacao_id=$1 AND nome=$2`,
      [ORG, CAMPANHA_NOME]
    )
    let campanhaId: string

    if (exCamp.rowCount && exCamp.rowCount > 0) {
      campanhaId = exCamp.rows[0].id
      console.log(`  ✔ Campanha já existe (id=${campanhaId}, status=${exCamp.rows[0].status}, dry_run=${exCamp.rows[0].dry_run})`)
    } else {
      const insCamp = await c.query(
        `INSERT INTO campanhas (organizacao_id, nome, descricao, tipo, status, workflow_id, publico, dry_run, iniciada_em)
         VALUES ($1,$2,$3,'reativacao','ativa',$4,$5,true,now()) RETURNING id`,
        [
          ORG,
          CAMPANHA_NOME,
          'Reativação de clientes que trabalharam com a empresa anteriormente. Cadência de 3 toques em 9 dias.',
          workflowId,
          JSON.stringify({ empresas: { fonte: 'base_existente' }, decisores: {} }),
        ]
      )
      campanhaId = insCamp.rows[0].id
      console.log(`  ✔ Campanha criada (id=${campanhaId}, dry_run=true, status=ativa)`)
    }

    // 4. Buscar leads elegíveis
    console.log('\n[4/5] Leads elegíveis...')
    const { rows: leads } = await c.query(
      `SELECT id, empresa FROM leads
       WHERE organizacao_id=$1
         AND contato_email IS NOT NULL
         AND contato_email != ''
         AND (perdido IS NULL OR perdido = false)
         AND (optout IS NULL OR optout = false)
       ORDER BY created_at`,
      [ORG]
    )
    console.log(`  → ${leads.length} leads encontrados`)

    // 5. Enrollment: inserir workflow_execucoes (idempotente)
    console.log('\n[5/5] Enrollment...')
    let inscritos = 0
    let jaInscritos = 0
    let erros = 0

    for (const lead of leads) {
      try {
        // Verifica se já existe execução para este workflow+lead
        const ex = await c.query(
          `SELECT id FROM workflow_execucoes WHERE workflow_id=$1 AND lead_id=$2 LIMIT 1`,
          [workflowId, lead.id]
        )
        if (ex.rowCount && ex.rowCount > 0) {
          jaInscritos++
          continue
        }

        // Insere execução com campanha_id
        const insEx = await c.query(
          `INSERT INTO workflow_execucoes
             (organizacao_id, workflow_id, versao_id, lead_id, campanha_id, passo_atual, status)
           VALUES ($1,$2,$3,$4,$5,0,'em_andamento')
           RETURNING id`,
          [ORG, workflowId, versaoId, lead.id, campanhaId]
        )
        const execId = insEx.rows[0].id

        // Log do evento
        await c.query(
          `INSERT INTO workflow_execucao_eventos (organizacao_id, execucao_id, tipo, detalhe)
           VALUES ($1,$2,'execucao_iniciada',$3)`,
          [ORG, execId, JSON.stringify({
            versao_id: versaoId,
            lead_id: lead.id,
            via: 'campanha',
            campanha_id: campanhaId,
          })]
        )
        inscritos++
      } catch (e) {
        console.error(`  ✗ ${lead.empresa ?? lead.id}: ${e instanceof Error ? e.message : e}`)
        erros++
      }
    }

    console.log(`\n${'─'.repeat(60)}`)
    console.log(`RESULTADO:`)
    console.log(`  Leads elegíveis : ${leads.length}`)
    console.log(`  Inscritos agora : ${inscritos}`)
    console.log(`  Já inscritos    : ${jaInscritos}`)
    console.log(`  Erros           : ${erros}`)
    console.log(`  Campanha ID     : ${campanhaId}`)
    console.log(`  Workflow ID     : ${workflowId}`)
    console.log(`  dry_run         : TRUE (nenhum e-mail sai até flip explícito)`)
    console.log(`\nPara liberar envio real:`)
    console.log(`  UPDATE campanhas SET dry_run=false WHERE id='${campanhaId}';`)
    console.log(`  (ou PATCH /api/campanhas/${campanhaId} { "dry_run": false })`)
    console.log(`${'─'.repeat(60)}`)
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
