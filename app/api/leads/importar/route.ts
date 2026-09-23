import { NextRequest, NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import {
  processarPlanilhaPadrao,
  dedupeInternaPorEmail,
  buscarEmailsExistentes,
  resumirNichosImportacao,
} from '@/lib/leads/importarCsv'
import { chaveResponsavelPlanilha, resolverColunaResponsavel } from '@/lib/leads/responsavel'
import { montarAvisoImportacao, montarLeadsImportacao } from '@/lib/leads/importacaoOperacional'
import { ESTAGIO_RENOVACAO, estagioInicialLead, regraRenovacaoPorValidadeAtiva } from '@/lib/leads/estagioInicial'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { criarCiclosIniciais } from '@/lib/laudos/ciclos'

// Importação de leads em LOTE pela tela (2.2). Roda server-side com service role
// (nunca expõe a chave ao client). Dois modos no mesmo endpoint:
//   modo=previa    → só conta (válidos / pulados / duplicados / já existentes /
//                    responsáveis não reconhecidos)
//   modo=confirmar → resolve o responsável de CADA LINHA, dedupe e INSERE
// Parsing/validação/dedupe vêm do módulo compartilhado (mesma lógica do script).

const LOTE = 50

// Excel BR salva "CSV" em Windows-1252 (Latin-1) com frequência — decodificar
// como UTF-8 viraria mojibake nos acentos (Gonçalves, São Paulo…). Tenta UTF-8
// estrito; se os bytes não forem UTF-8 válido, cai para windows-1252.
async function lerTextoCsv(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

export async function POST(req: NextRequest) {
  try {
    const acc = await resolverAcesso()
    if ('erro' in acc) return acc.erro
    const { admin, org, user } = acc.acesso

    const form = await req.formData()
    const file = form.get('file')
    const modo = String(form.get('modo') ?? 'previa')
    if (!(file instanceof File)) {
      return NextResponse.json({ erro: 'Envie um arquivo CSV.' }, { status: 400 })
    }

    const texto = await lerTextoCsv(file)
    const { validos, pulados, totalLinhas, validadeInvalida } = processarPlanilhaPadrao(texto)
    const { unicos, duplicados } = dedupeInternaPorEmail(validos)

    // Contagem por motivo de pulo (nome/e-mail/empresa/nicho), pro preview.
    const puladosPorMotivo = pulados.reduce<Record<string, number>>((acc, p) => {
      acc[p.motivo] = (acc[p.motivo] ?? 0) + 1
      return acc
    }, {})

    const existentes = await buscarEmailsExistentes(admin, org)
    const novos = unicos.filter((l) => !existentes.has(l.contato_email))
    const jaExistentes = unicos.length - novos.length

    // Regra da organização, resolvida no servidor a partir do blob tipado: com
    // features.estagioRenovacaoPorValidade, lead com validade do laudo nasce em
    // `renovacao` (lib/leads/estagioInicial.ts). Sem a flag, tudo em novos_leads.
    const { data: orgRow, error: orgError } = await admin
      .from('organizacoes')
      .select('configuracoes')
      .eq('id', org)
      .maybeSingle()
    if (orgError) throw orgError
    const renovacaoPorValidade = regraRenovacaoPorValidadeAtiva(parseWorkspaceConfig(orgRow?.configuracoes))

    // A prévia deixa explícito se cada nicho do arquivo já tem uma mensagem de
    // primeiro contato ativa. Importar continua permitido; o motor bloqueia o
    // primeiro envio daquele nicho até o template existir, sem usar um texto
    // genérico silenciosamente.
    const { data: templatesNicho, error: templatesError } = await admin
      .from('templates')
      .select('nicho')
      .eq('organizacao_id', org)
      .eq('canal', 'email')
      .eq('tipo', 'primeiro_contato')
      .eq('ativo', true)
      .not('nicho', 'is', null)
    if (templatesError) throw templatesError

    // Responsável por LINHA. A coluna é obrigatória (o parser já pulou quem veio
    // com a célula vazia); aqui conferimos que o valor corresponde a um comercial
    // ATIVO desta organização. Valor que não resolve não vira lead: importar com
    // dono errado é pior que não importar, e a prévia mostra o que corrigir.
    const { data: usuariosOrg, error: usuariosErro } = await admin
      .from('usuarios')
      .select('id, nome, email')
      .eq('organizacao_id', org)
      .eq('ativo', true)
    if (usuariosErro) throw usuariosErro
    const usuarios = (usuariosOrg ?? []).map((u) => ({
      id: u.id as string,
      nome: (u.nome as string | null) ?? null,
      email: (u.email as string | null) ?? null,
    }))
    const { porValor: responsavelPorValor, naoResolvidos } = resolverColunaResponsavel(
      novos.map((lead) => lead.responsavel),
      usuarios,
    )
    const responsavelDe = (lead: { responsavel: string }) =>
      responsavelPorValor.get(chaveResponsavelPlanilha(lead.responsavel)) ?? null
    const importaveis = novos.filter((lead) => !!responsavelDe(lead))
    const semResponsavelValido = novos.length - importaveis.length

    const nichos = resumirNichosImportacao(
      importaveis,
      (templatesNicho ?? []).map((template) => template.nicho).filter((nicho): nicho is string => typeof nicho === 'string'),
    )

    const resumo = {
      totalLinhas,
      validas: validos.length,
      pulados: puladosPorMotivo,
      duplicadosNoArquivo: duplicados,
      jaExistentes,
      novos: novos.length,
      nichos,
      // Quantos REALMENTE entram: novos menos os que têm responsável que não
      // corresponde a nenhum comercial ativo da organização.
      importaveis: importaveis.length,
      semResponsavelValido,
      // Valores da coluna Responsável que não foram reconhecidos, com quantas
      // linhas cada um afeta — é a lista do que corrigir na planilha.
      responsaveisNaoReconhecidos: naoResolvidos,
      // Contados sobre os que REALMENTE entram, não sobre o arquivo inteiro:
      // é esse o número que descreve o estado da base depois da importação.
      // Segmento é opcional aqui, mas sem ele o motor não escolhe template e o
      // lead fica parado — a prévia diz isso em voz alta.
      semSegmento: importaveis.filter((lead) => !lead.segmento).length,
      // Validade do laudo é opcional. `comValidade` conta sobre os que entram (o
      // que a renovação vai ter para trabalhar); `validadeInvalida` é sobre o
      // arquivo — célula preenchida que não virou data. Nenhum dos dois
      // bloqueia a importação.
      comValidade: importaveis.filter((lead) => !!lead.data_validade).length,
      // Quantos dos que entram nascem em `renovacao` pela regra da organização
      // (fora da prospecção). Sem a flag, é sempre 0.
      emRenovacao: importaveis.filter((lead) => estagioInicialLead(lead.data_validade, renovacaoPorValidade) === ESTAGIO_RENOVACAO).length,
      validadeInvalida,
    }

    if (modo !== 'confirmar') {
      return NextResponse.json({ resumo })
    }

    // Nenhuma linha com responsável reconhecido: não há o que importar. Devolve
    // a lista do que corrigir em vez de um "0 inseridos" mudo.
    if (importaveis.length === 0) {
      return NextResponse.json(
        {
          erro: novos.length === 0
            ? 'Nenhum contato novo para importar.'
            : 'Nenhuma linha tem um responsável que corresponda a um comercial ativo desta organização.',
          resumo,
        },
        { status: novos.length === 0 ? 200 : 400 },
      )
    }

    const payload = montarLeadsImportacao(importaveis, {
      organizacaoId: org,
      // Já filtramos `importaveis` por este mesmo mapa: aqui o responsável existe.
      resolverResponsavel: (lead) => responsavelDe(lead)!,
      estagioRenovacaoPorValidade: renovacaoPorValidade,
    })

    let inseridos = 0
    for (let i = 0; i < payload.length; i += LOTE) {
      const lote = payload.slice(i, i + LOTE)
      const { data: criados, error } = await admin.from('leads').insert(lote).select('id, data_validade')
      if (error) {
        return NextResponse.json(
          { erro: `Falha ao inserir (após ${inseridos}): ${error.message}`, inseridos, resumo },
          { status: 500 },
        )
      }
      inseridos += lote.length
      // Lead importado com validade nasce com o seu ciclo atual do laudo
      // (histórico começa aqui; não é renovação).
      await criarCiclosIniciais(admin, org, (criados ?? []) as Array<{ id: string; data_validade: string | null }>)
    }

    // Aviso in-app aos administradores. É best-effort: uma falha de aviso não
    // desfaz nem mascara uma importação que já foi concluída.
    let avisoCriado = false
    try {
      const { data: admins } = await admin
        .from('perfis').select('id').eq('organizacao_id', org).eq('role', 'admin')
      const totalPulados = Object.values(puladosPorMotivo).reduce((soma, n) => soma + n, 0)
      // Quem IMPORTOU (o usuário logado) — não confundir com os responsáveis
      // dos leads, que agora vêm da planilha e podem ser vários.
      const { data: perfilAutor } = await admin
        .from('perfis').select('nome').eq('organizacao_id', org).eq('id', user.id).maybeSingle()
      const nomeAutor = (perfilAutor as { nome?: string | null } | null)?.nome?.trim()
        || user.email
        || 'Comercial'
      const aviso = montarAvisoImportacao(nomeAutor, {
        novos: inseridos,
        jaExistentes,
        duplicadosNoArquivo: duplicados,
        totalPulados,
      })
      if (admins?.length) {
        const { error: erroAviso } = await admin.from('notificacoes').insert(
          admins.map((perfil) => ({
            organizacao_id: org,
            perfil_id: perfil.id,
            canal: 'app',
            titulo: aviso.titulo,
            mensagem: aviso.mensagem,
            origem: 'importacao_csv',
            motivo: 'lote_importado',
            link: '/base-leads',
          })),
        )
        if (erroAviso) throw erroAviso
        avisoCriado = true
      }
    } catch (erroAviso) {
      console.error('[leads/importar] importação concluída, mas aviso ao gestor falhou:', erroAviso)
    }

    // Quantos leads cada comercial recebeu — é o que a tela mostra no lugar do
    // antigo "Responsável: <usuário logado>", que agora seria mentira.
    const porResponsavel = new Map<string, { nome: string; leads: number }>()
    for (const lead of importaveis) {
      const u = responsavelDe(lead)!
      const atual = porResponsavel.get(u.id) ?? { nome: u.nome ?? 'Sem nome', leads: 0 }
      atual.leads += 1
      porResponsavel.set(u.id, atual)
    }
    const responsaveis = [...porResponsavel.values()].sort((a, b) => b.leads - a.leads)

    return NextResponse.json({ inseridos, resumo, responsaveis, avisoCriado })
  } catch (err) {
    console.error('[leads/importar] erro:', err)
    return NextResponse.json({ erro: 'Erro interno ao importar.' }, { status: 500 })
  }
}
