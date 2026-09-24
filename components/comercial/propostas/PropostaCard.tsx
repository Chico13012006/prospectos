'use client';

import { useState } from 'react';
import { FileDown, Loader2, Send } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { baixarPropostaPdf } from '@/lib/proposta/baixarPdfNavegador';
import {
  ROTULO_CANAL, descontoProposta, resumoItens, valoresProposta, type PropostaRegistro,
} from '@/lib/propostas/tipos';
import EnviarPropostaForm from '@/components/comercial/propostas/EnviarPropostaForm';

// Card de uma proposta salva (aba Propostas do lead e do Comercial): valores
// negociados e desconto (uso interno), rastro de envio e as ações reais —
// baixar o PDF do snapshot salvo e enviar/reenviar ao cliente.
export default function PropostaCard({ proposta, mostrarEmpresa = false, onAtualizada }: {
  proposta: PropostaRegistro;
  mostrarEmpresa?: boolean;
  onAtualizada?: (proposta: PropostaRegistro) => void;
}) {
  const [baixando, setBaixando] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const [enviarAberto, setEnviarAberto] = useState(false);

  const lead = proposta.leads;
  const valores = valoresProposta(proposta);
  const desconto = descontoProposta(proposta);
  const enviada = proposta.status === 'enviada';

  async function baixar() {
    setBaixando(true);
    setErroPdf(null);
    try {
      await baixarPropostaPdf(proposta.dados_pdf, lead?.empresa, new Date(proposta.criado_em));
    } catch (e) {
      console.error('Erro ao gerar PDF da proposta:', e);
      setErroPdf('Não foi possível gerar o PDF. Tente novamente.');
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {mostrarEmpresa && (
            <div className="text-sm font-semibold text-slate-200 truncate">{lead?.empresa ?? 'Lead indisponível'}</div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">
              {proposta.modelo === 'compra' ? 'Compra' : 'Comodato'}
            </span>
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
              enviada ? 'bg-emerald-500/15 text-emerald-300' : 'bg-[var(--bg-input)] text-slate-300'
            }`}>
              {enviada ? 'Enviada' : 'Salva'}
            </span>
            <span className="text-[11px] text-slate-500">
              {formatDateTime(proposta.criado_em)}{proposta.criado_por_nome ? ` · ${proposta.criado_por_nome}` : ''}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-slate-100 tabular-nums">{valores.principal}</div>
          {desconto > 0 && (
            <div className="text-[11px] text-emerald-400">−{desconto.toLocaleString('pt-BR')}% da tabela</div>
          )}
        </div>
      </div>

      <div className="text-xs text-slate-300">{resumoItens(proposta.itens)}</div>
      {valores.detalhe && <div className="text-xs text-slate-500">{valores.detalhe}</div>}
      {enviada && proposta.enviada_em && proposta.enviada_canal && (
        <div className="text-[11px] text-slate-400">
          Enviada por {ROTULO_CANAL[proposta.enviada_canal]}
          {proposta.enviada_para ? ` para ${proposta.enviada_para}` : ''} em {formatDateTime(proposta.enviada_em)}
          {proposta.envios > 1 ? ` · ${proposta.envios} envios` : ''}
        </div>
      )}

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={baixar}
          disabled={baixando}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 px-2.5 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-input)] disabled:opacity-40 transition-colors"
        >
          {baixando ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />} Baixar PDF
        </button>
        {lead && (
          <button
            type="button"
            onClick={() => setEnviarAberto((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
              enviarAberto
                ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
            }`}
          >
            <Send size={12} /> {enviada ? 'Reenviar' : 'Enviar ao cliente'}
          </button>
        )}
      </div>
      {erroPdf && <p className="text-xs text-rose-400">{erroPdf}</p>}

      {enviarAberto && lead && (
        <div className="pt-2 border-t border-[var(--border)]">
          <EnviarPropostaForm
            lead={lead}
            obterPropostaId={async () => proposta.id}
            onEnviada={(r) => {
              if (!r.simulado && r.proposta) onAtualizada?.({ ...r.proposta, leads: proposta.leads });
            }}
            onCancelar={() => setEnviarAberto(false)}
          />
        </div>
      )}
    </div>
  );
}
