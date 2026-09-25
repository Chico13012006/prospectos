import type { CodigoErroMover } from './moverLeadServidor'

// Erro de negócio do mover/prévia → status HTTP. Compartilhado pelas duas rotas.
export const STATUS_ERRO_MOVER: Record<CodigoErroMover, number> = {
  etapa_invalida: 400,
  reuniao_invalida: 400,
  canal_invalido: 400,
  lead_nao_encontrado: 404,
  ja_na_etapa: 409,
  etapa_mudou: 409,
  optout: 422,
  perdido: 422,
  bounced: 422,
  sem_email: 422,
  sem_telefone: 422,
  sem_template: 422,
  variaveis_pendentes: 422,
  credencial_ausente: 503,
  config_ausente: 503,
  whatsapp_indisponivel: 503,
  falha_envio: 502,
}
