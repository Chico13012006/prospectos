import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  processarPlanilhaPadrao,
  dedupeInternaPorEmail,
  buscarEmailsExistentes,
} from '@/lib/leads/importarCsv'
import { resolverResponsavelPorAuthId } from '@/lib/leads/responsavelServer'

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

// Defaults de persistência dos leads criados por esta tela. owner='engine' (o
// motor só trabalha esse owner) para entrarem na cadência e receberem follow-up
// automático — com o CC do responsável (2.4). followups_enviados/owner são
// NOT NULL sem default no banco, então vão explícitos.
function camposBase(organizacaoId: string) {
  return {
    organizacao_id: organizacaoId,
    owner: 'engine' as const,
    estagio: 'novos_leads',
    followups_enviados: 0,
    canal_preferencial: 'email',
    perdido: false,
    score: 50,
  }
}

export async function POST(req: NextRequest) {
  try {
    const server = await createSupabaseServerClient()
    const { data: { user } } = await server.auth.getUser()
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

    const admin = createSupabaseAdminClient()
    const { data: perfil } = await admin
      .from('perfis').select('organizacao_id').eq('id', user.id).maybeSingle()
    const org = perfil?.organizacao_id as string | undefined
    if (!org) return NextResponse.json({ erro: 'Usuário sem organização' }, { status: 400 })

    const form = await req.formData()
    const file = form.get('file')
    const modo = String(form.get('modo') ?? 'previa')
    if (!(file instanceof File)) {
      return NextResponse.json({ erro: 'Envie um arquivo CSV.' }, { status: 400 })
    }

    const texto = await lerTextoCsv(file)
    const { validos, pulados, totalLinhas } = processarPlanilhaPadrao(texto)
    const { unicos, duplicados } = dedupeInternaPorEmail(validos)

    // Contagem por motivo de pulo (nome/e-mail/empresa), pro preview.
    const puladosPorMotivo = pulados.reduce<Record<string, number>>((acc, p) => {
      acc[p.motivo] = (acc[p.motivo] ?? 0) + 1
      return acc
    }, {})

    const existentes = await buscarEmailsExistentes(admin, org)
    const novos = unicos.filter((l) => !existentes.has(l.contato_email))
    const jaExistentes = unicos.length - novos.length

    const resumo = {
      totalLinhas,
      validas: validos.length,
      pulados: puladosPorMotivo,
      duplicadosNoArquivo: duplicados,
      jaExistentes,
      novos: novos.length,
    }

    if (modo !== 'confirmar') {
      return NextResponse.json({ resumo })
    }

    // --- CONFIRMAR: resolve responsável, insere ---
    const responsavelAuthId = String(form.get('responsavelAuthId') ?? '')
    if (!responsavelAuthId) {
      return NextResponse.json({ erro: 'Escolha um comercial responsável.' }, { status: 400 })
    }

    const vinculo = await resolverResponsavelPorAuthId(admin, org, responsavelAuthId)
    if (!vinculo.ok) {
      // Bloqueia e avisa (decisão do Chico): não cria lead com responsável errado
      // nem sem CC. Cadastro/desambiguação em `usuarios` resolve.
      const detalhe = vinculo.motivo === 'ambiguo' ? vinculo.detalhe : undefined
      return NextResponse.json(
        {
          erro: 'Não foi possível vincular o comercial escolhido a um usuário real (usuarios).',
          motivo: vinculo.motivo,
          detalhe,
        },
        { status: 400 },
      )
    }

    if (novos.length === 0) {
      return NextResponse.json({ inseridos: 0, resumo, responsavel: { nome: vinculo.usuario.nome } })
    }

    const base = camposBase(org)
    const payload = novos.map((l) => ({
      ...base,
      contato_nome: l.contato_nome,
      contato_email: l.contato_email,
      empresa: l.empresa,
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

    return NextResponse.json({ inseridos, resumo, responsavel: { nome: vinculo.usuario.nome } })
  } catch (err) {
    console.error('[leads/importar] erro:', err)
    return NextResponse.json({ erro: 'Erro interno ao importar.' }, { status: 500 })
  }
}
