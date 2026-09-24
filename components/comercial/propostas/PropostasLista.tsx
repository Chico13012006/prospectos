'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { listarPropostas } from '@/lib/api';
import type { PropostaRegistro } from '@/lib/propostas/tipos';
import PropostaCard from '@/components/comercial/propostas/PropostaCard';

// Lista paginada de propostas salvas — da organização (Comercial > Propostas)
// ou de um lead (aba Propostas da ficha). Leitura direta sob RLS: o comercial
// só vê propostas dos leads da própria carteira. Buscas concorrentes: só a
// resposta da requisição mais recente é aplicada.

const POR_PAGINA = 20;

export default function PropostasLista({ leadId, busca = '', mostrarEmpresa = false, grade = false }: {
  leadId?: string;
  busca?: string;
  mostrarEmpresa?: boolean;
  grade?: boolean;
}) {
  const [propostas, setPropostas] = useState<PropostaRegistro[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ultimaRequisicao = useRef(0);

  const carregar = useCallback(async (offset: number) => {
    const requisicao = ++ultimaRequisicao.current;
    if (offset === 0) setCarregando(true);
    else setCarregandoMais(true);
    setErro(null);
    try {
      const r = await listarPropostas({ leadId, busca, offset, limite: POR_PAGINA });
      if (requisicao !== ultimaRequisicao.current) return;
      setPropostas((atuais) => {
        if (offset === 0) return r.propostas;
        const vistas = new Set(atuais.map((p) => p.id));
        return [...atuais, ...r.propostas.filter((p) => !vistas.has(p.id))];
      });
      setTemMais(r.temMais);
    } catch (e) {
      if (requisicao !== ultimaRequisicao.current) return;
      console.error('Erro ao carregar propostas:', e);
      setErro('Não foi possível carregar as propostas.');
    } finally {
      if (requisicao === ultimaRequisicao.current) {
        setCarregando(false);
        setCarregandoMais(false);
      }
    }
  }, [leadId, busca]);

  useEffect(() => {
    void carregar(0);
  }, [carregar]);

  const atualizar = (atualizada: PropostaRegistro) =>
    setPropostas((lista) => lista.map((p) => (p.id === atualizada.id ? atualizada : p)));

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 text-slate-500 py-6">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">Carregando propostas...</span>
      </div>
    );
  }

  if (erro && propostas.length === 0) {
    return (
      <div className="py-6 text-center space-y-2">
        <p className="text-xs text-rose-400">{erro}</p>
        <button type="button" onClick={() => carregar(0)} className="text-xs text-indigo-400 hover:underline">
          Tentar de novo
        </button>
      </div>
    );
  }

  if (propostas.length === 0) {
    return (
      <div className="py-8 text-center space-y-1.5">
        <p className="text-sm text-slate-400">
          {busca
            ? `Nenhuma proposta encontrada para “${busca}”.`
            : leadId ? 'Nenhuma proposta salva para este lead.' : 'Nenhuma proposta salva ainda.'}
        </p>
        {!busca && (
          <Link href="/comercial?tab=simulador" className="text-xs text-indigo-400 hover:underline">
            Montar uma proposta no Simulador
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={grade ? 'grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-3' : 'space-y-2'}>
        {propostas.map((p) => (
          <PropostaCard key={p.id} proposta={p} mostrarEmpresa={mostrarEmpresa} onAtualizada={atualizar} />
        ))}
      </div>
      {erro && <p className="text-xs text-rose-400">{erro}</p>}
      {temMais && (
        <button
          type="button"
          onClick={() => carregar(propostas.length)}
          disabled={carregandoMais}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-slate-300 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-input)] disabled:opacity-40 transition-colors"
        >
          {carregandoMais && <Loader2 size={12} className="animate-spin" />} Carregar mais
        </button>
      )}
    </div>
  );
}
