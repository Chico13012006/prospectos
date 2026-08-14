/**
 * Atualiza a campanha "Reativação de clientes" com o fluxo e copy final.
 *
 * O que faz (idempotente):
 *   1. Upserta 5 templates de e-mail (reativacao_1/3/3b/5/6) com o copy final
 *   2. Deleta as execuções v1 da campanha (passo_atual=0, dry_run=true, sem e-mail)
 *   3. Publica a versão 2 do workflow com o fluxo completo de 6 toques + ramificação
 *   4. Re-inscreve os 283 leads na v2
 *
 * Fluxo v2 (com esperas):
 *   T1 e-mail → 2 dias → T2 WhatsApp (tarefa manual) → 2 dias
 *   → ramificar por data_validade: T3 (com data) ou T3B (sem data)
 *   → 3 dias → T4 WhatsApp (tarefa manual) → 2 dias
 *   → se respondeu: criar tarefa "Resposta recebida" + encerrar
 *   → senão: T5 encerramento → 90 dias → T6 reativação → encerrar
 *
 * dry_run permanece TRUE. Envio real só quando o usuário autorizar via UI.
 *
 * Usage:
 *   npx tsx scripts/atualizar-workflow-reativacao.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG        = '03097614-9fd5-4491-a91c-589f84461683'
const CAMPANHA_ID = 'cd82b32a-ccf2-4cda-8190-60a802b37041'
const WORKFLOW_ID = '11593652-03c4-4091-b802-35d75ec30b8b'

// Variáveis: {nome}=primeiro nome, {empresa}=empresa, {responsavel_comercial}=consultor,
// {data_validade}=data formatada. {{duplas}} do doc convertidas para {simples}.
const TEMPLATES_EMAIL = [
  {
    tipo: 'reativacao_1',
    nome: 'E-mail · Reativação · T1 — Retomada',
    assunto: 'Podemos retomar os laudos da {empresa}?',
    corpo: `Olá, {nome}. Tudo bem?

Aqui é {responsavel_comercial}, da {nome_servico}.

Já tivemos contato anteriormente sobre os laudos dos brinquedos da {empresa}, mas não conseguimos concluir o alinhamento.

Estou retomando para entender se essa necessidade ainda está em aberto ou se vocês já resolveram internamente.

Se ainda precisarem, posso verificar o histórico e orientar os próximos passos para atualização dos laudos.

Posso dar continuidade por aqui?

Abraço,
{responsavel_comercial}
{nome_servico}`,
  },
  {
    tipo: 'reativacao_3',
    nome: 'E-mail · Reativação · T3 — Validade dos laudos (com data)',
    assunto: 'Validade dos laudos da {empresa}',
    corpo: `Olá, {nome}.

Consta em nosso histórico que os laudos da {empresa} tinham validade prevista até {data_validade}.

Como pode ter ocorrido alguma atualização desde o nosso último contato, gostaria apenas de confirmar se os laudos já foram renovados.

Caso ainda esteja pendente, posso verificar o histórico do atendimento e organizar uma orientação inicial para a renovação.

Você consegue me confirmar a situação atual?

Atenciosamente,
{responsavel_comercial}
{nome_servico}`,
  },
  {
    tipo: 'reativacao_3b',
    nome: 'E-mail · Reativação · T3B — Situação dos laudos (sem data)',
    assunto: 'Como está a situação dos laudos da {empresa}?',
    corpo: `Olá, {nome}.

Estou revisando o histórico de atendimento da {empresa} e não localizei uma confirmação recente sobre a situação dos laudos dos brinquedos.

Para evitar insistir em um assunto que talvez já tenha sido resolvido, você consegue me confirmar se:

1. Os laudos ainda precisam ser atualizados;
2. A renovação ficou para outro momento;
3. Vocês já resolveram com outro fornecedor.

Pode responder apenas com o número da opção. Assim, atualizo nosso acompanhamento corretamente.

Obrigado,
{responsavel_comercial}
{nome_servico}`,
  },
  {
    tipo: 'reativacao_5',
    nome: 'E-mail · Reativação · T5 — Encerramento',
    assunto: 'Encerrando o acompanhamento da {empresa}',
    corpo: `Olá, {nome}.

Como não tive retorno nas últimas tentativas, vou encerrar este acompanhamento para não continuar insistindo.

Se os laudos ainda estiverem pendentes, basta responder "retomar" que verifico o histórico e seguimos de onde paramos.

Caso outra pessoa seja responsável atualmente, você também pode me indicar o contato correto.

Obrigado e fico à disposição.

{responsavel_comercial}
{nome_servico}`,
  },
  {
    tipo: 'reativacao_6',
    nome: 'E-mail · Reativação · T6 — Reativação 90 dias',
    assunto: 'Ainda faz sentido revisar os laudos da {empresa}?',
    corpo: `Olá, {nome}. Tudo bem?

Há algum tempo conversamos sobre os laudos dos brinquedos da {empresa}, mas o atendimento não avançou.

Estou retomando porque podemos verificar a situação atual dos equipamentos e identificar se existe alguma renovação ou atualização pendente.

Ainda faz sentido conversarmos sobre isso?

Se preferir, posso fazer algumas perguntas rápidas por aqui e indicar o próximo passo.

Abraço,
{responsavel_comercial}
{nome_servico}`,
  },
]

// Fluxo v2: 6 toques (2 e-mail + 2 WhatsApp tarefa manual + 1 encerramento + 1 reativação 90d)
// com ramificação por data_validade e saída antecipada se respondeu.
// Esperas: T1→2d→T2→2d→T3/3B→3d→T4→2d→(respondeu?)→T5→90d→T6
const DEFINICAO_V2 = {
  gatilho: { id: 'g1', tipo: 'manual', config: {} },
  condicoes: [],
  acoes: [
    // T1 — E-mail de retomada
    { id: 'a1', tipo: 'enviar_email', config: { template: 'reativacao_1' } },
    { id: 'a2', tipo: 'esperar', config: { dias: 2 } },

    // T2 — WhatsApp manual (tarefa para o responsável)
    { id: 'a3', tipo: 'criar_tarefa', config: { titulo: '[WhatsApp] T2 — confirmar contato com {empresa}' } },
    { id: 'a4', tipo: 'esperar', config: { dias: 2 } },

    // T3 / T3B — ramificação por data_validade
    {
      id: 'a5',
      tipo: 'ramificar',
      config: {
        condicao: { tipo: 'campo', config: { campo: 'data_validade', operador: 'nao_vazio' } },
        entao: [{ tipo: 'enviar_email', config: { template: 'reativacao_3' } }],
        senao: [{ tipo: 'enviar_email', config: { template: 'reativacao_3b' } }],
      },
    },
    { id: 'a6', tipo: 'esperar', config: { dias: 3 } },

    // T4 — WhatsApp manual (opções numeradas)
    { id: 'a7', tipo: 'criar_tarefa', config: { titulo: '[WhatsApp] T4 — opções numeradas para {empresa}' } },
    { id: 'a8', tipo: 'esperar', config: { dias: 2 } },

    // Verificar resposta: se respondeu → tarefa + encerrar; senão → T5 encerramento
    {
      id: 'a9',
      tipo: 'saltar_se',
      config: {
        condicao: { tipo: 'lead_respondeu', config: { respondeu: true } },
        destino: 'a11',
      },
    },

    // T5 — E-mail de encerramento (sem resposta)
    { id: 'a10', tipo: 'enviar_email', config: { template: 'reativacao_5' } },
    { id: 'a10b', tipo: 'esperar', config: { dias: 90 } },

    // T6 — Reativação após 90 dias
    { id: 'a10c', tipo: 'enviar_email', config: { template: 'reativacao_6' } },
    { id: 'fim', tipo: 'encerrar', config: {} },

    // Ramo de resposta recebida (salvo de a9)
    { id: 'a11', tipo: 'criar_tarefa', config: { titulo: 'Resposta recebida — retomar conversa com {empresa}' } },
    { id: 'fim2', tipo: 'encerrar', config: {} },
  ],
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    console.log('=== Atualização do Workflow de Reativação (v2) ===')

    // 0. Gravar nomenclaturas.nome_servico no blob de config da org.
    console.log('\n[0/5] Configurando nomenclaturas.nome_servico...')
    const cfgRes = await c.query(`SELECT configuracoes FROM organizacoes WHERE id=$1`, [ORG])
    const cfgBlob = (cfgRes.rows[0]?.configuracoes as Record<string, unknown>) ?? {}
    const nomenclaturasAtuais = (cfgBlob.nomenclaturas as Record<string, string> | undefined) ?? {}
    const novoCfg = {
      ...cfgBlob,
      nomenclaturas: {
        ...nomenclaturasAtuais,
        nome_servico: 'Laudo de Brinquedos',
        email_conta_key: 'LAUDO',
      },
    }
    await c.query(`UPDATE organizacoes SET configuracoes=$1 WHERE id=$2`, [JSON.stringify(novoCfg), ORG])
    console.log(`  ✔ nomenclaturas.nome_servico  = "Laudo de Brinquedos"`)
    console.log(`  ✔ nomenclaturas.email_conta_key = "LAUDO" (usa GMAIL_USER_LAUDO / GMAIL_APP_PASSWORD_LAUDO)`)

    // 1. Upsert templates de e-mail
    console.log('\n[1/5] Templates de e-mail...')
    for (const t of TEMPLATES_EMAIL) {
      const ex = await c.query(
        `SELECT id FROM templates WHERE organizacao_id=$1 AND canal='email' AND tipo=$2`,
        [ORG, t.tipo]
      )
      if (ex.rowCount && ex.rowCount > 0) {
        await c.query(
          `UPDATE templates SET nome=$1, assunto=$2, corpo=$3 WHERE organizacao_id=$4 AND canal='email' AND tipo=$5`,
          [t.nome, t.assunto, t.corpo, ORG, t.tipo]
        )
        console.log(`  ✔ ${t.tipo} atualizado (id=${ex.rows[0].id})`)
      } else {
        const ins = await c.query(
          `INSERT INTO templates (organizacao_id, canal, nicho, tipo, nome, assunto, corpo, ativo, taxa_resposta)
           VALUES ($1,'email',NULL,$2,$3,$4,$5,true,0) RETURNING id`,
          [ORG, t.tipo, t.nome, t.assunto, t.corpo]
        )
        console.log(`  ✔ ${t.tipo} criado (id=${ins.rows[0].id})`)
      }
    }

    // 2. Deletar execuções v1 (todas no passo 0, dry_run=true, sem e-mail enviado)
    console.log('\n[2/5] Limpando execuções v1...')
    const exIds = await c.query(
      `SELECT id FROM workflow_execucoes WHERE campanha_id=$1`,
      [CAMPANHA_ID]
    )
    if (exIds.rowCount && exIds.rowCount > 0) {
      const ids = exIds.rows.map((r: { id: string }) => r.id)
      // Deletar eventos primeiro (FK sem cascade)
      await c.query(
        `DELETE FROM workflow_execucao_eventos WHERE execucao_id = ANY($1::uuid[])`,
        [ids]
      )
      await c.query(
        `DELETE FROM workflow_execucoes WHERE campanha_id=$1`,
        [CAMPANHA_ID]
      )
      console.log(`  ✔ ${exIds.rowCount} execuções v1 deletadas (+ eventos)`)
    } else {
      console.log(`  ✔ Nenhuma execução v1 encontrada`)
    }

    // 3. Publicar versão 2 do workflow
    console.log('\n[3/5] Publicando workflow v2...')
    const versaoAtual = await c.query(
      `SELECT versao_atual_id FROM workflows WHERE id=$1`,
      [WORKFLOW_ID]
    )
    const maxNum = await c.query(
      `SELECT COALESCE(MAX(numero), 0) AS n FROM workflow_versoes WHERE workflow_id=$1`,
      [WORKFLOW_ID]
    )
    const nextNum = (maxNum.rows[0].n as number) + 1

    const insVer = await c.query(
      `INSERT INTO workflow_versoes (organizacao_id, workflow_id, numero, definicao, publicado_por)
       VALUES ($1,$2,$3,$4,NULL) RETURNING id`,
      [ORG, WORKFLOW_ID, nextNum, JSON.stringify(DEFINICAO_V2)]
    )
    const versaoV2Id = insVer.rows[0].id as string
    console.log(`  ✔ Versão ${nextNum} publicada (id=${versaoV2Id})`)
    console.log(`  ✔ Versão anterior: ${versaoAtual.rows[0].versao_atual_id ?? 'nenhuma'}`)

    await c.query(
      `UPDATE workflows SET versao_atual_id=$2, rascunho_definicao=NULL WHERE id=$1`,
      [WORKFLOW_ID, versaoV2Id]
    )
    console.log(`  ✔ workflows.versao_atual_id atualizado para v${nextNum}`)

    // 4. Re-enrollar leads (agora que execuções v1 foram deletadas)
    console.log('\n[4/5] Re-enrollment na v2...')
    const leads = await c.query(
      `SELECT id, empresa FROM leads
       WHERE organizacao_id=$1
         AND contato_email IS NOT NULL AND contato_email != ''
         AND (perdido IS NULL OR perdido = false)
         AND (optout IS NULL OR optout = false)
       ORDER BY created_at`,
      [ORG]
    )
    console.log(`  → ${leads.rowCount} leads elegíveis`)

    // Bulk INSERT das execuções (evita loop de 283 round-trips que mata o pooler).
    const execRows = await c.query(
      `INSERT INTO workflow_execucoes
         (organizacao_id, workflow_id, versao_id, lead_id, campanha_id, passo_atual, status)
       SELECT $1, $2, $3, id, $4, 0, 'em_andamento'
       FROM leads
       WHERE organizacao_id=$1
         AND contato_email IS NOT NULL AND contato_email != ''
         AND (perdido IS NULL OR perdido = false)
         AND (optout IS NULL OR optout = false)
       RETURNING id`,
      [ORG, WORKFLOW_ID, versaoV2Id, CAMPANHA_ID]
    )
    const inscritos = execRows.rowCount ?? 0

    // Bulk INSERT dos eventos de inicio
    if (execRows.rows.length > 0) {
      const vals = execRows.rows
        .map((_: { id: string }, i: number) => `($1, $${i + 2}, 'execucao_iniciada', $${execRows.rows.length + i + 2})`)
        .join(',')
      const params: unknown[] = [ORG,
        ...execRows.rows.map((r: { id: string }) => r.id),
        ...execRows.rows.map((r: { id: string }) => JSON.stringify({
          versao_id: versaoV2Id, via: 'campanha', campanha_id: CAMPANHA_ID,
        })),
      ]
      await c.query(
        `INSERT INTO workflow_execucao_eventos (organizacao_id, execucao_id, tipo, detalhe) VALUES ${vals}`,
        params
      )
    }

    console.log(`\n${'─'.repeat(60)}`)
    console.log('RESULTADO:')
    console.log(`  Leads inscritos na v2 : ${inscritos}`)
    console.log(`  dry_run               : TRUE (nenhum e-mail sai)`)
    console.log(`  Campanha ID           : ${CAMPANHA_ID}`)
    console.log(`  Workflow v2 ID        : ${versaoV2Id}`)
    console.log(`\nFluxo v2:`)
    console.log(`  T1 e-mail (reativacao_1)`)
    console.log(`  → esperar 2 dias`)
    console.log(`  T2 WhatsApp [tarefa manual] → esperar 2 dias`)
    console.log(`  T3/T3B e-mail [ramificado por data_validade] → esperar 3 dias`)
    console.log(`  T4 WhatsApp [tarefa manual] → esperar 2 dias`)
    console.log(`  → se respondeu: tarefa "Resposta recebida" + encerrar`)
    console.log(`  → senão: T5 encerramento → 90 dias → T6 reativação → encerrar`)
    console.log(`\nConfirme com o usuário antes de liberar dry_run.`)
    console.log(`${'─'.repeat(60)}`)

    // Preview: renderiza os 5 e-mails com dados reais de leads da campanha.
    console.log(`\n${'═'.repeat(60)}`)
    console.log('PREVIEW DOS 5 E-MAILS (dados reais)')
    console.log(`${'═'.repeat(60)}`)

    // Busca nome do serviço: nomenclaturas.nome_servico tem prioridade sobre organizacoes.nome.
    const orgRow = await c.query(`SELECT nome, configuracoes FROM organizacoes WHERE id=$1`, [ORG])
    const orgCfg = (orgRow.rows[0]?.configuracoes as Record<string, unknown> | undefined) ?? {}
    const orgNomenclaturas = (orgCfg['nomenclaturas'] as Record<string, string> | undefined) ?? {}
    const nomeServico = orgNomenclaturas['nome_servico'] ?? (orgRow.rows[0]?.nome as string | undefined) ?? 'Laudo de Brinquedos'

    // Lead qualquer (fallback para T1/T5/T6 quando nenhum tem data_validade).
    const leadQualquer = await c.query(
      `SELECT l.contato_nome, l.empresa, l.responsavel_nome, u.nome AS responsavel_usuario_nome,
              to_char(l.data_validade, 'DD/MM/YYYY') AS data_validade_fmt
       FROM leads l
       LEFT JOIN usuarios u ON u.id = l.responsavel_id
       WHERE l.organizacao_id=$1 AND l.contato_email IS NOT NULL
       ORDER BY l.created_at LIMIT 1`,
      [ORG]
    )
    // Lead COM data_validade (para T3).
    const leadComData = await c.query(
      `SELECT l.contato_nome, l.empresa, l.responsavel_nome, u.nome AS responsavel_usuario_nome,
              to_char(l.data_validade, 'DD/MM/YYYY') AS data_validade_fmt
       FROM leads l
       LEFT JOIN usuarios u ON u.id = l.responsavel_id
       WHERE l.organizacao_id=$1 AND l.contato_email IS NOT NULL AND l.data_validade IS NOT NULL
       LIMIT 1`,
      [ORG]
    )
    // Lead SEM data_validade (para T3B).
    const leadSemData = await c.query(
      `SELECT l.contato_nome, l.empresa, l.responsavel_nome, u.nome AS responsavel_usuario_nome,
              to_char(l.data_validade, 'DD/MM/YYYY') AS data_validade_fmt
       FROM leads l
       LEFT JOIN usuarios u ON u.id = l.responsavel_id
       WHERE l.organizacao_id=$1 AND l.contato_email IS NOT NULL AND l.data_validade IS NULL
       LIMIT 1`,
      [ORG]
    )

    type DadosLead = {
      contato_nome: string; empresa: string; responsavel_nome: string | null;
      responsavel_usuario_nome: string | null; data_validade_fmt: string | null
    }
    const dadosQualquer = leadQualquer.rows[0] as DadosLead | undefined
    const dadosCom = (leadComData.rows[0] as DadosLead | undefined) ?? dadosQualquer
    const dadosSem = leadSemData.rows[0] as DadosLead | undefined

    function render(texto: string, vars: Record<string, string>): string {
      return texto.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? `{${k}}`)
    }
    function vars(d: DadosLead | undefined): Record<string, string> {
      return {
        nome: (d?.contato_nome ?? '').trim().split(/\s+/)[0] || '(contato)',
        empresa: d?.empresa?.trim() || 'sua empresa',
        responsavel_comercial: d?.responsavel_usuario_nome ?? d?.responsavel_nome ?? 'Francisco',
        data_validade: d?.data_validade_fmt ?? '(sem data)',
        nome_servico: nomeServico,
      }
    }

    const LINHA = '─'.repeat(60)
    for (const t of TEMPLATES_EMAIL) {
      const d = t.tipo === 'reativacao_3b' ? dadosSem : dadosCom
      const v = vars(d)
      const leadRef = d ? `${v.nome} / ${v.empresa}` : '(sem lead)'
      console.log(`\n${LINHA}`)
      console.log(`TEMPLATE: ${t.nome}  [lead: ${leadRef}]`)
      console.log(`ASSUNTO : ${render(t.assunto, v)}`)
      console.log(`${LINHA}`)
      console.log(render(t.corpo, v))
    }
    console.log(`\n${'═'.repeat(60)}`)
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
