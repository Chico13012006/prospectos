import type { LeadPadrao } from './importarCsv'
import type { UsuarioRef } from './responsavel'
import { estagioInicialLead } from './estagioInicial'

export interface ResumoImportacaoNotificavel {
  novos: number
  jaExistentes: number
  duplicadosNoArquivo: number
  totalPulados: number
}

// Um CSV apenas abastece a carteira do comercial. `owner='n8n'` mantém os
// leads fora do motor até um gestor criar e ativar deliberadamente a campanha.
export function camposBaseImportacao(organizacaoId: string) {
  return {
    organizacao_id: organizacaoId,
    owner: 'n8n' as const,
    estagio: 'novos_leads',
    followups_enviados: 0,
    canal_preferencial: 'email',
    perdido: false,
    score: 50,
  }
}

// Linhas prontas para inserir em `leads`. O estágio sai da regra única de
// lib/leads/estagioInicial.ts: com a regra da organização ligada, quem chega
// com validade do laudo nasce em `renovacao`; os demais seguem `novos_leads`.
//
// O responsável vem de CADA LINHA da planilha, já resolvido pela rota para uma
// linha real de `usuarios`. Linha cujo responsável não resolveu não chega aqui:
// a rota a separa antes, para nenhum lead nascer com dono errado.
export function montarLeadsImportacao(
  leads: LeadPadrao[],
  opts: {
    organizacaoId: string
    resolverResponsavel: (lead: LeadPadrao) => Pick<UsuarioRef, 'id' | 'nome'>
    estagioRenovacaoPorValidade: boolean
  },
) {
  const base = camposBaseImportacao(opts.organizacaoId)
  return leads.map((l) => {
    const responsavel = opts.resolverResponsavel(l)
    return {
      ...base,
      estagio: estagioInicialLead(l.data_validade, opts.estagioRenovacaoPorValidade),
      contato_nome: l.contato_nome,
      contato_email: l.contato_email,
      empresa: l.empresa,
      segmento: l.segmento,
      origem: l.origem,
      contato_telefone: l.contato_telefone,
      contato_cargo: l.contato_cargo,
      cidade: l.cidade,
      estado: l.estado,
      data_validade: l.data_validade,
      responsavel_id: responsavel.id,
      responsavel_nome: responsavel.nome,
    }
  })
}

export function montarAvisoImportacao(
  comercial: string,
  resumo: ResumoImportacaoNotificavel,
) {
  return {
    titulo: `Nova importação de leads — ${comercial}`,
    mensagem: `${comercial} importou ${resumo.novos} lead${resumo.novos === 1 ? '' : 's'}: ${resumo.jaExistentes} já existente${resumo.jaExistentes === 1 ? '' : 's'}, ${resumo.duplicadosNoArquivo} duplicado${resumo.duplicadosNoArquivo === 1 ? '' : 's'} no arquivo e ${resumo.totalPulados} inválido${resumo.totalPulados === 1 ? '' : 's'}. Nenhum envio foi iniciado.`,
  }
}
