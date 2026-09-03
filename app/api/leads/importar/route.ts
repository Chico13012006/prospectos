import { NextRequest, NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import {
  processarPlanilhaPadrao,
  dedupeInternaPorEmail,
  buscarEmailsExistentes,
  resumirNichosImportacao,
} from '@/lib/leads/importarCsv'
import { resolverResponsavelPorAuthId } from '@/lib/leads/responsavelServer'
import { camposBaseImportacao, montarAvisoImportacao } from '@/lib/leads/importacaoOperacional'

// Importação de leads em LOTE pela tela (2.2). Roda server-side com service role
// (nunca expõe a chave ao client). Dois modos no mesmo endpoint:
//   modo=previa    → só conta (válidos / pulados / duplicados / já existentes)
//   modo=confirmar → resolve o responsável, dedupe e INSERE
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
    const { validos, pulados, totalLinhas } = processarPlanilhaPadrao(texto)
    const { unicos, duplicados } = dedupeInternaPorEmail(validos)

    // Contagem por motivo de pulo (nome/e-mail/empresa/nicho), pro preview.
    const puladosPorMotivo = pulados.reduce<Record<string, number>>((acc, p) => {
      acc[p.motivo] = (acc[p.motivo] ?? 0) + 1
      return acc
    }, {})

    const existentes = await buscarEmailsExistentes(admin, org)
    const novos = unicos.filter((l) => !existentes.has(l.contato_email))
    const jaExistentes = unicos.length - novos.length

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

    const nichos = resumirNichosImportacao(
      novos,
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
    }

    if (modo !== 'confirmar') {
      return NextResponse.json({ resumo })
    }

    // O responsável é sempre o próprio usuário autenticado. O payload do CSV
    // não pode atribuir carteira a outro comercial.
    const vinculo = await resolverResponsavelPorAuthId(admin, org, user.id)
    if (!vinculo.ok) {
      // Bloqueia e avisa (decisão do Chico): não cria lead com responsável errado
      // nem sem CC. Cadastro/desambiguação em `usuarios` resolve.
      const detalhe = vinculo.motivo === 'ambiguo' ? vinculo.detalhe : undefined
      return NextResponse.json(
        {
          erro: 'Sua conta não está vinculada a um usuário comercial ativo.',
          motivo: vinculo.motivo,
          detalhe,
        },
        { status: 400 },
      )
    }

    if (novos.length === 0) {
      return NextResponse.json({ inseridos: 0, resumo, responsavel: { nome: vinculo.usuario.nome } })
    }

    const base = camposBaseImportacao(org)
    const payload = novos.map((l) => ({
      ...base,
      contato_nome: l.contato_nome,
      contato_email: l.contato_email,
      empresa: l.empresa,
      segmento: l.segmento,
      origem: l.origem,
      contato_telefone: l.contato_telefone,
      contato_cargo: l.contato_cargo,
      cidade: l.cidade,
      estado: l.estado,
      responsavel_id: vinculo.usuario.id,
      responsavel_nome: vinculo.usuario.nome,
    }))

    let inseridos = 0
    for (let i = 0; i < payload.length; i += LOTE) {
      const lote = payload.slice(i, i + LOTE)
      const { error } = await admin.from('leads').insert(lote)
      if (error) {
        return NextResponse.json(
          { erro: `Falha ao inserir (após ${inseridos}): ${error.message}`, inseridos, resumo },
          { status: 500 },
        )
      }
      inseridos += lote.length
    }

    // Aviso in-app aos administradores. É best-effort: uma falha de aviso não
    // desfaz nem mascara uma importação que já foi concluída.
    let avisoCriado = false
    try {
      const { data: admins } = await admin
        .from('perfis').select('id').eq('organizacao_id', org).eq('role', 'admin')
      const totalPulados = Object.values(puladosPorMotivo).reduce((soma, n) => soma + n, 0)
      const nomeComercial = vinculo.usuario.nome ?? vinculo.usuario.email ?? 'Comercial'
      const aviso = montarAvisoImportacao(nomeComercial, {
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

    return NextResponse.json({ inseridos, resumo, responsavel: { nome: vinculo.usuario.nome }, avisoCriado })
  } catch (err) {
    console.error('[leads/importar] erro:', err)
    return NextResponse.json({ erro: 'Erro interno ao importar.' }, { status: 500 })
  }
}
