'use client'

import { useState } from 'react'
import { Check, Maximize2, Sparkles, Trash2 } from 'lucide-react'
import {
  MODELOS_EMAIL,
  buscarModeloEmail,
  montarModeloEmail,
  textoModeloEmail,
  type CamposModeloEmail,
} from '@/lib/campanhas/modelosEmail'
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'
import PreviaEmailModal from './PreviaEmailModal'

// Escolher um layout pronto e preencher só o conteúdo. O HTML é regerado a cada
// tecla e guardado junto com os CAMPOS que o produziram — por isso reabrir a
// campanha volta para o formulário, e não para o HTML cru.
//
// O caminho de colar HTML próprio continua existindo logo abaixo, para quem já
// tem uma peça pronta. Escolher um modelo aqui sobrescreve aquele HTML, e a tela
// avisa antes.
export default function ModeloEmailPicker({
  modeloId,
  campos,
  temHtmlProprio,
  onAplicar,
  onLimpar,
}: {
  modeloId?: string
  campos?: CamposModeloEmail
  temHtmlProprio: boolean
  onAplicar: (patch: { modeloId: string; modeloCampos: CamposModeloEmail; html: string; texto: string }) => void
  onLimpar: () => void
}) {
  const [previa, setPrevia] = useState(false)
  const [abaPrevia, setAbaPrevia] = useState<'visual' | 'codigo'>('visual')
  const selecionado = buscarModeloEmail(modeloId)
  const atuais: CamposModeloEmail = campos ?? {}

  // HTML colado à mão (sem modelo escolhido) seria perdido ao aplicar um modelo.
  const alertaSobrescrita = temHtmlProprio && !selecionado

  function aplicar(novoModeloId: string, novosCampos: CamposModeloEmail) {
    const html = montarModeloEmail(novoModeloId, novosCampos)
    onAplicar({
      modeloId: novoModeloId,
      modeloCampos: novosCampos,
      html,
      texto: textoModeloEmail(novosCampos),
    })
  }

  function escolher(id: string) {
    const modelo = buscarModeloEmail(id)
    if (!modelo) return
    if (alertaSobrescrita && !confirm('Isto substitui o HTML que você aplicou. Continuar?')) return
    // A etiqueta padrão do modelo entra só se o usuário ainda não escolheu uma.
    aplicar(id, { ...atuais, etiqueta: atuais.etiqueta || modelo.etiquetaPadrao })
  }

  function editar(campo: keyof CamposModeloEmail, valor: string) {
    if (!selecionado) return
    aplicar(selecionado.id, { ...atuais, [campo]: valor })
  }

  const rotuloCampo = 'block text-xs font-medium text-slate-400 mb-1.5'
  const entrada = 'w-full rounded-lg border border-[#30384e] bg-[#11151f] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none'

  return (
    <div className="rounded-xl border border-[#30384e] bg-[#0d111b] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <Sparkles size={15} className="text-indigo-300" /> Modelo pronto
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Escolha um layout e escreva só o conteúdo. O desenho do e-mail já vem pronto e testado —
            você troca o assunto da mensagem, não a diagramação.
          </p>
        </div>
        {selecionado && (
          <button type="button" onClick={onLimpar}
            className="inline-flex items-center gap-2 rounded-lg border border-[#30384e] px-3 py-2 text-xs text-slate-400 hover:text-red-300">
            <Trash2 size={14} /> Descartar modelo
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {MODELOS_EMAIL.map((modelo) => {
          const ativo = selecionado?.id === modelo.id
          return (
            <button
              key={modelo.id}
              type="button"
              onClick={() => escolher(modelo.id)}
              className={`rounded-xl border p-3 text-left transition-colors ${ativo ? 'border-indigo-400 bg-indigo-500/10' : 'border-[#30384e] bg-[#111621] hover:border-[#46506d]'}`}
            >
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: modelo.cor }} />
                <span className="text-sm font-medium text-slate-200">{modelo.nome}</span>
                {ativo && <Check size={14} className="ml-auto shrink-0 text-indigo-300" />}
              </span>
              <span className="mt-1.5 block text-xs leading-5 text-slate-500">{modelo.descricao}</span>
            </button>
          )
        })}
      </div>

      {selecionado && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div>
              <label className={rotuloCampo}>Etiqueta</label>
              <input className={entrada} value={atuais.etiqueta ?? ''} maxLength={24}
                onChange={(e) => editar('etiqueta', e.target.value)} placeholder={selecionado.etiquetaPadrao} />
            </div>
            <div>
              <label className={rotuloCampo}>Título</label>
              <input className={entrada} value={atuais.titulo ?? ''}
                onChange={(e) => editar('titulo', e.target.value)}
                placeholder="Ex.: Chegou o novo coletor de dados" />
            </div>
          </div>

          <div>
            <label className={rotuloCampo}>Mensagem</label>
            <textarea
              className={`${entrada} min-h-40 resize-y leading-6`}
              value={atuais.paragrafos ?? ''}
              onChange={(e) => editar('paragrafos', e.target.value)}
              placeholder={'Conte a novidade em um ou dois parágrafos.\n\nDeixe uma linha em branco para separar parágrafos.'}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={rotuloCampo}>Texto do botão (opcional)</label>
              <input className={entrada} value={atuais.ctaTexto ?? ''}
                onChange={(e) => editar('ctaTexto', e.target.value)} placeholder="Ver novidade" />
            </div>
            <div>
              <label className={rotuloCampo}>Link do botão</label>
              <input className={entrada} type="url" value={atuais.ctaLink ?? ''}
                onChange={(e) => editar('ctaLink', e.target.value)} placeholder="https://..." />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={rotuloCampo}>Imagem no topo (opcional)</label>
              <input className={entrada} type="url" value={atuais.imagemUrl ?? ''}
                onChange={(e) => editar('imagemUrl', e.target.value)} placeholder="https://.../banner.png" />
            </div>
            <div>
              <label className={rotuloCampo}>Encerramento (opcional)</label>
              <input className={entrada} value={atuais.encerramento ?? ''}
                onChange={(e) => editar('encerramento', e.target.value)}
                placeholder="Qualquer dúvida, é só responder." />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => { setAbaPrevia('visual'); setPrevia(true) }}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500">
              <Maximize2 size={14} /> Ver prévia
            </button>
            <span className="text-xs text-slate-600">
              O botão e a imagem só aparecem no e-mail quando o link é http ou https.
            </span>
          </div>
        </div>
      )}

      {selecionado && (
        <PreviaEmailModal
          aberto={previa}
          onFechar={() => setPrevia(false)}
          titulo={`Modelo ${selecionado.nome}`}
          html={montarEmailCampanhaHtml('', {}, montarModeloEmail(selecionado.id, atuais))}
          codigo={montarModeloEmail(selecionado.id, atuais)}
          aba={abaPrevia}
          onAba={setAbaPrevia}
        />
      )}
    </div>
  )
}
