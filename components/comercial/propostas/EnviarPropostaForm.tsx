'use client';

import { useState } from 'react';
import { Loader2, Mail, MessageCircle, Send } from 'lucide-react';
import { enviarPropostaAoCliente, type RespostaEnvioProposta } from '@/lib/api';
import {
  LIMITE_MENSAGEM_ENVIO, ROTULO_CANAL, assuntoPadraoProposta, mensagemPadraoProposta,
  type CanalEnvioProposta, type LeadDaProposta,
} from '@/lib/propostas/tipos';

// "Enviar ao cliente" — usado no Simulador (proposta recém-montada) e nas abas
// Propostas (proposta já salva). O servidor (/api/propostas/[id]/enviar) refaz
// TODAS as travas: opt-out, bounce, perdido, MODO_ENSAIO e envio simultâneo.
// Aqui só se bloqueia cedo o que já dá para saber (lead sem e-mail/telefone) e
// se exige confirmação explícita antes de sair qualquer coisa.

type Retorno = { tipo: 'ok' | 'atencao' | 'erro'; texto: string };

const COR_RETORNO: Record<Retorno['tipo'], string> = {
  ok: 'text-emerald-400',
  atencao: 'text-amber-400',
  erro: 'text-rose-400',
};

export default function EnviarPropostaForm({ lead, obterPropostaId, onEnviada, onCancelar, aviso }: {
  lead: LeadDaProposta;
  // Id da proposta a enviar. No Simulador salva antes (se preciso); na lista já existe.
  obterPropostaId: () => Promise<string>;
  onEnviada?: (resposta: RespostaEnvioProposta) => void;
  onCancelar?: () => void;
  aviso?: string | null;
}) {
  const temEmail = !!lead.contato_email?.trim();
  // DDD + número; a normalização definitiva (DDI 55) é feita no servidor.
  const temTelefone = (lead.contato_telefone?.replace(/\D/g, '').length ?? 0) >= 10;
  const disponivel: Record<CanalEnvioProposta, boolean> = { email: temEmail, whatsapp: temTelefone };

  const [canal, setCanal] = useState<CanalEnvioProposta>(!temEmail && temTelefone ? 'whatsapp' : 'email');
  const [assunto, setAssunto] = useState(() => assuntoPadraoProposta(lead.empresa));
  const [mensagens, setMensagens] = useState<Record<CanalEnvioProposta, string>>(() => ({
    email: mensagemPadraoProposta('email', lead),
    whatsapp: mensagemPadraoProposta('whatsapp', lead),
  }));
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [retorno, setRetorno] = useState<Retorno | null>(null);

  const destino = canal === 'email' ? lead.contato_email?.trim() : lead.contato_telefone?.trim();
  const mensagem = mensagens[canal];
  const podeEnviar = disponivel[canal]
    && !!mensagem.trim()
    && mensagem.length <= LIMITE_MENSAGEM_ENVIO
    && (canal !== 'email' || !!assunto.trim())
    && !enviando;

  function trocarCanal(c: CanalEnvioProposta) {
    setCanal(c);
    setConfirmando(false);
    setRetorno(null);
  }

  async function enviar() {
    setEnviando(true);
    setRetorno(null);
    try {
      const propostaId = await obterPropostaId();
      const r = await enviarPropostaAoCliente(propostaId, {
        canal,
        mensagem,
        ...(canal === 'email' ? { assunto } : {}),
      });
      if (r.simulado) {
        setRetorno({ tipo: 'atencao', texto: 'Motor de e-mail em MODO_ENSAIO: envio simulado — nada foi enviado nem registrado.' });
      } else if (!r.registrada) {
        setRetorno({ tipo: 'atencao', texto: `Proposta enviada por ${ROTULO_CANAL[r.canal]}, mas o registro no histórico falhou. Não reenvie.` });
      } else {
        setRetorno({ tipo: 'ok', texto: `Proposta enviada por ${ROTULO_CANAL[r.canal]} para ${r.destino}.` });
      }
      onEnviada?.(r);
    } catch (e) {
      setRetorno({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível enviar a proposta.' });
    } finally {
      setEnviando(false);
      setConfirmando(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        {(['email', 'whatsapp'] as const).map((c) => {
          const Icone = c === 'email' ? Mail : MessageCircle;
          return (
            <button
              key={c}
              type="button"
              onClick={() => trocarCanal(c)}
              disabled={enviando}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                canal === c
                  ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
                  : 'border-[#2a3147] text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icone size={13} /> {c === 'email' ? 'E-mail' : 'WhatsApp'}
            </button>
          );
        })}
      </div>

      {disponivel[canal] ? (
        <p className="text-xs text-slate-400 truncate">
          Para: <span className="text-slate-200">{destino}</span>
        </p>
      ) : (
        <p className="text-xs text-amber-400">
          {canal === 'email' ? 'O lead não tem e-mail cadastrado.' : 'O lead não tem telefone de WhatsApp cadastrado.'}{' '}
          Atualize os dados do lead para enviar por aqui.
        </p>
      )}

      {canal === 'email' && (
        <input
          value={assunto}
          onChange={(e) => { setAssunto(e.target.value); setConfirmando(false); }}
          disabled={!disponivel.email || enviando}
          placeholder="Assunto"
          className="w-full text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117] text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
      )}
      <textarea
        value={mensagem}
        onChange={(e) => {
          const valor = e.target.value;
          setMensagens((m) => ({ ...m, [canal]: valor }));
          setConfirmando(false);
        }}
        disabled={!disponivel[canal] || enviando}
        rows={canal === 'email' ? 5 : 3}
        className="w-full text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117] text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y disabled:opacity-50"
      />
      <div className="flex items-start justify-between gap-2 text-[11px] text-slate-500">
        <span>
          {canal === 'email'
            ? 'O PDF vai anexado; a assinatura do responsável pelo lead entra automaticamente.'
            : 'O PDF vai como documento, com esta mensagem de legenda.'}
        </span>
        <span className={`shrink-0 tabular-nums ${mensagem.length > LIMITE_MENSAGEM_ENVIO ? 'text-rose-400' : ''}`}>
          {mensagem.length}/{LIMITE_MENSAGEM_ENVIO}
        </span>
      </div>
      {aviso && <p className="text-[11px] text-slate-500">{aviso}</p>}

      {confirmando ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2">
          <p className="text-xs text-amber-200">
            Enviar a proposta por {ROTULO_CANAL[canal]} para <b className="break-all">{destino}</b>?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={enviar}
              disabled={enviando}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 py-1.5 rounded-lg transition-colors"
            >
              {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {enviando ? 'Enviando...' : 'Confirmar envio'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={enviando}
              className="text-sm text-slate-300 px-3 py-1.5 rounded-lg border border-[#2a3147] hover:bg-[#252b3b] disabled:opacity-40 transition-colors"
            >
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setRetorno(null); setConfirmando(true); }}
            disabled={!podeEnviar}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 py-2 rounded-lg transition-colors"
          >
            <Send size={14} /> Enviar proposta
          </button>
          {onCancelar && (
            <button
              type="button"
              onClick={onCancelar}
              className="text-sm text-slate-300 px-3 py-2 rounded-lg border border-[#2a3147] hover:bg-[#252b3b] transition-colors"
            >
              Fechar
            </button>
          )}
        </div>
      )}

      {retorno && <p className={`text-xs ${COR_RETORNO[retorno.tipo]}`}>{retorno.texto}</p>}
    </div>
  );
}
