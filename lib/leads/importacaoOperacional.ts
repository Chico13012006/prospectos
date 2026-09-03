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

export function montarAvisoImportacao(
  comercial: string,
  resumo: ResumoImportacaoNotificavel,
) {
  return {
    titulo: `Nova importação de leads — ${comercial}`,
    mensagem: `${comercial} importou ${resumo.novos} lead${resumo.novos === 1 ? '' : 's'}: ${resumo.jaExistentes} já existente${resumo.jaExistentes === 1 ? '' : 's'}, ${resumo.duplicadosNoArquivo} duplicado${resumo.duplicadosNoArquivo === 1 ? '' : 's'} no arquivo e ${resumo.totalPulados} inválido${resumo.totalPulados === 1 ? '' : 's'}. Nenhum envio foi iniciado.`,
  }
}
