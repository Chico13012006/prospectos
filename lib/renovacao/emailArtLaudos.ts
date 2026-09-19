import type { Publico } from '@/components/automacao/tiposCampanha'
import type { UsuarioBasico } from '@/lib/engine/types'
import { diasAteVencimento } from '@/lib/servicos/vencimento'

export const ASSUNTO_RENOVACAO_ART_LAUDOS = 'Renovação do seu laudo — validade em {data_validade}'
export const ASSUNTO_FOLLOWUP_RENOVACAO_ART_LAUDOS = 'Sobre a renovação do seu laudo'

export const CORPO_RENOVACAO_ART_LAUDOS = `{saudacao_renovacao}

Aqui é da ART Laudos.

Estamos entrando em contato porque o laudo da {empresa} {frase_validade}:

{data_validade}

Para evitar qualquer período com a documentação desatualizada, podemos já organizar a próxima renovação com vocês.

Responda este e-mail e seguimos com os próximos passos.

Atenciosamente,
Equipe ART Laudos`

export const CORPO_FOLLOWUP_RENOVACAO_ART_LAUDOS = `{saudacao_renovacao}

Passando para confirmar se conseguiu ver nosso contato sobre a renovação do laudo da {empresa}, com validade em {data_validade}.

Podemos já organizar a próxima renovação com vocês.

Responda este e-mail e seguimos com os próximos passos.

Atenciosamente,
Equipe ART Laudos`

function htmlMensagem(paragrafos: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td style="padding:0 0 22px 0;border-bottom:1px solid #e5e7eb;">
      <div style="margin:0;color:#0f172a;font-size:20px;line-height:1.25;font-weight:700;letter-spacing:0.3px;">ART LAUDOS</div>
      <div style="margin-top:5px;color:#64748b;font-size:13px;line-height:1.4;">Renovação de laudo</div>
    </td>
  </tr>
  <tr>
    <td style="padding:24px 0 0 0;color:#334155;font-size:15px;line-height:1.65;">
      ${paragrafos}
      <p style="margin:24px 0 0 0;color:#334155;">Atenciosamente,<br><strong style="color:#0f172a;">Equipe ART Laudos</strong></p>
    </td>
  </tr>
</table>`
}

const BLOCO_VALIDADE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0 22px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
  <tr><td style="padding:16px 18px;">
    <div style="color:#64748b;font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:0.6px;">Data de validade</div>
    <div style="margin-top:4px;color:#0f172a;font-size:20px;line-height:1.3;font-weight:700;">{data_validade}</div>
  </td></tr>
</table>`

export const HTML_RENOVACAO_ART_LAUDOS = htmlMensagem(`<p style="margin:0 0 18px 0;">{saudacao_renovacao}</p>
<p style="margin:0 0 18px 0;">Aqui é da ART Laudos.</p>
<p style="margin:0;">Estamos entrando em contato porque o laudo da <strong style="color:#0f172a;">{empresa}</strong> {frase_validade}:</p>
${BLOCO_VALIDADE}
<p style="margin:0 0 18px 0;">Para evitar qualquer período com a documentação desatualizada, podemos já organizar a próxima renovação com vocês.</p>
<p style="margin:0;">Responda este e-mail e seguimos com os próximos passos.</p>`)

export const HTML_FOLLOWUP_RENOVACAO_ART_LAUDOS = htmlMensagem(`<p style="margin:0 0 18px 0;">{saudacao_renovacao}</p>
<p style="margin:0 0 18px 0;">Passando para confirmar se conseguiu ver nosso contato sobre a renovação do laudo da <strong style="color:#0f172a;">{empresa}</strong>, com validade em <strong style="color:#0f172a;">{data_validade}</strong>.</p>
<p style="margin:0 0 18px 0;">Podemos já organizar a próxima renovação com vocês.</p>
<p style="margin:0;">Responda este e-mail e seguimos com os próximos passos.</p>`)

export function fraseValidadeRenovacao(
  dataValidade: string | null | undefined,
  hoje = new Date(),
): 'venceu em' | 'está com vencimento previsto para' {
  const dias = diasAteVencimento(dataValidade, hoje)
  return dias !== null && dias < 0 ? 'venceu em' : 'está com vencimento previsto para'
}

export function saudacaoRenovacao(nomeCompleto: string | null | undefined): string {
  const primeiroNome = (nomeCompleto ?? '').trim().split(/\s+/)[0]
  return primeiroNome ? `Olá, ${primeiroNome}, tudo bem?` : 'Olá, tudo bem?'
}

function emailValido(valor: string | null | undefined): valor is string {
  return typeof valor === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim())
}

export function resolverCcResponsavelRenovacao(dados: {
  para: string
  remetenteEmail?: string | null
  responsavelLead?: UsuarioBasico | null
}): string | undefined {
  const email = dados.responsavelLead?.email?.trim()
  if (!emailValido(email)) return undefined
  const normalizado = email.toLowerCase()
  if (normalizado === dados.para.trim().toLowerCase()) return undefined
  if (normalizado === dados.remetenteEmail?.trim().toLowerCase()) return undefined
  return email
}

export function configurarMensagensRenovacaoArtLaudos(publicoAtual: Publico): Publico {
  return {
    ...publicoAtual,
    selecao: {
      ...publicoAtual.selecao,
      modo: 'filtros',
      criterio: 'renovacao',
      leadIds: undefined,
      estagios: undefined,
    },
    operacao: {
      ...publicoAtual.operacao,
      modoEnvio: 'cadencia',
      mensagemInicial: {
        assunto: ASSUNTO_RENOVACAO_ART_LAUDOS,
        corpo: CORPO_RENOVACAO_ART_LAUDOS,
        html: HTML_RENOVACAO_ART_LAUDOS,
        acaoId: publicoAtual.operacao?.mensagemInicial?.acaoId,
        templateId: publicoAtual.operacao?.mensagemInicial?.templateId,
        templateTipo: publicoAtual.operacao?.mensagemInicial?.templateTipo,
      },
      followups: [{
        assunto: ASSUNTO_FOLLOWUP_RENOVACAO_ART_LAUDOS,
        corpo: CORPO_FOLLOWUP_RENOVACAO_ART_LAUDOS,
        html: HTML_FOLLOWUP_RENOVACAO_ART_LAUDOS,
        diasApos: 7,
        acaoId: publicoAtual.operacao?.followups?.[0]?.acaoId,
        templateId: publicoAtual.operacao?.followups?.[0]?.templateId,
        templateTipo: publicoAtual.operacao?.followups?.[0]?.templateTipo,
      }],
    },
  }
}
