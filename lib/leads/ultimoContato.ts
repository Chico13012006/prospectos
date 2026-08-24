type InteracaoContato = {
  canal?: string | null
  created_at?: string | null
}

function timestampValido(valor: string | null | undefined): number | null {
  if (!valor) return null
  const timestamp = new Date(valor).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

// `leads.ultimo_contato` continua sendo o campo persistido e usado nos filtros.
// O histórico de e-mail é o fallback auditável para registros antigos criados
// antes de todos os caminhos de mensagem passarem a atualizar esse campo.
export function ultimoContatoEfetivo(
  ultimoContatoLead: string | null | undefined,
  interacoes: InteracaoContato[],
): string | null {
  const candidatas = [
    ultimoContatoLead,
    ...interacoes
      .filter((interacao) => interacao.canal === 'email')
      .map((interacao) => interacao.created_at),
  ].flatMap((valor) => {
    const timestamp = timestampValido(valor)
    return timestamp === null || !valor ? [] : [{ valor, timestamp }]
  })

  return candidatas.sort((a, b) => b.timestamp - a.timestamp)[0]?.valor ?? null
}
