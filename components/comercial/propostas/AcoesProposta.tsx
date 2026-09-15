'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Save, Search, Send, X } from 'lucide-react';
import { buscarLeadsParaProposta, criarProposta } from '@/lib/api';
import type { EntradaProposta, LeadDaProposta, PropostaRegistro } from '@/lib/propostas/tipos';
import EnviarPropostaForm from '@/components/comercial/propostas/EnviarPropostaForm';

// Ações do card "Resumo da proposta" (Comercial > Simulador): escolher o lead e,
// em abas, SALVAR a proposta (ela passa a aparecer nas abas Propostas) ou
// ENVIAR AO CLIENTE com o PDF anexado — enviar salva antes, se ainda não salvou.
// Enquanto lead, modelo, itens e valores não mudarem, salvar/enviar reaproveita
// o mesmo registro: clicar de novo não duplica a proposta.

type Aba = 'salvar' | 'enviar';

export default function AcoesProposta({ proposta, leadSel, onLeadSel, bloqueio }: {
  proposta: Omit<EntradaProposta, 'leadId'>;
  leadSel: LeadDaProposta | null;
  onLeadSel: (lead: LeadDaProposta | null) => void;
  // Motivo para não permitir salvar/enviar (ex.: acima do limite do PDF).
  bloqueio?: string | null;
}) {
  const [aba, setAba] = useState<Aba>('salvar');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salva, setSalva] = useState<{ chave: string; proposta: PropostaRegistro } | null>(null);
  const emAndamento = useRef<{ chave: string; promessa: Promise<PropostaRegistro> } | null>(null);

  // "Assinatura" do que está na tela: muda quando qualquer escolha muda.
  const chave = leadSel ? JSON.stringify({ leadId: leadSel.id, ...proposta }) : '';
  const jaSalva = !!salva && salva.chave === chave;

  async function garantirSalva(): Promise<PropostaRegistro> {
    if (!leadSel) throw new Error('Selecione o lead da proposta.');
    if (salva && salva.chave === chave) return salva.proposta;
    if (emAndamento.current?.chave === chave) return emAndamento.current.promessa;
    const chaveAtual = chave;
    const promessa = criarProposta({ leadId: leadSel.id, ...proposta });
    emAndamento.current = { chave: chaveAtual, promessa };
    try {
      const registro = await promessa;
      setSalva({ chave: chaveAtual, proposta: registro });
      return registro;
    } finally {
      if (emAndamento.current?.promessa === promessa) emAndamento.current = null;
    }
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await garantirSalva();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar a proposta.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="border-t border-[#2a3147] pt-4 space-y-3">
      <SeletorLead leadSel={leadSel} onLeadSel={(l) => { onLeadSel(l); setErro(null); }} />

      <div className="grid grid-cols-2 rounded-lg border border-[#2a3147] bg-[#0f1117] p-0.5">
        {([
          { id: 'salvar', label: 'Salvar', Icone: Save },
          { id: 'enviar', label: 'Enviar ao cliente', Icone: Send },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAba(t.id)}
            className={`flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              aba === t.id ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <t.Icone size={13} /> {t.label}
          </button>
        ))}
      </div>

      {!leadSel ? (
        <p className="text-xs text-slate-500">Selecione o lead para salvar ou enviar a proposta.</p>
      ) : bloqueio ? (
        <p className="text-xs text-amber-400">{bloqueio}</p>
      ) : aba === 'salvar' ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || jaSalva}
            className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 py-2 rounded-lg transition-colors"
          >
            {salvando ? <Loader2 size={14} className="animate-spin" /> : jaSalva ? <Check size={14} /> : <Save size={14} />}
            {salvando ? 'Salvando...' : jaSalva ? 'Proposta salva' : 'Salvar proposta'}
          </button>
          {jaSalva ? (
            <p className="text-xs text-slate-400">
              Salva nas propostas de {leadSel.empresa}.{' '}
              <Link href="/comercial?tab=propostas" className="text-indigo-400 hover:underline">Ver propostas</Link>
            </p>
          ) : salva && salva.proposta.lead_id === leadSel.id ? (
            <p className="text-[11px] text-slate-500">
              Os valores mudaram desde o último salvamento: salvar de novo cria outra proposta.
            </p>
          ) : null}
          {erro && <p className="text-xs text-rose-400">{erro}</p>}
        </div>
      ) : (
        <EnviarPropostaForm
          key={leadSel.id}
          lead={leadSel}
          obterPropostaId={async () => (await garantirSalva()).id}
          aviso={jaSalva ? null : 'Ao enviar, a proposta é salva automaticamente nas Propostas do lead.'}
        />
      )}
    </div>
  );
}

// Busca de lead no servidor (máx. 8 resultados), com debounce e descarte de
// resposta antiga — não carrega a base inteira no browser.
function SeletorLead({ leadSel, onLeadSel }: {
  leadSel: LeadDaProposta | null;
  onLeadSel: (lead: LeadDaProposta | null) => void;
}) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState<LeadDaProposta[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState(false);
  const ultimaBusca = useRef(0);

  useEffect(() => {
    if (!aberto || leadSel) return;
    const requisicao = ++ultimaBusca.current;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const encontrados = await buscarLeadsParaProposta(busca);
        if (requisicao === ultimaBusca.current) { setOpcoes(encontrados); setErro(false); }
      } catch {
        if (requisicao === ultimaBusca.current) { setOpcoes([]); setErro(true); }
      } finally {
        if (requisicao === ultimaBusca.current) setBuscando(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [busca, aberto, leadSel]);

  if (leadSel) {
    return (
      <div className="space-y-1">
        <label className="text-sm text-slate-400">Lead da proposta</label>
        <div className="flex items-center gap-2 border border-indigo-500/40 bg-indigo-500/5 rounded-lg px-3 py-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-200 truncate">{leadSel.empresa}</div>
            {leadSel.contato_nome && <div className="text-xs text-slate-500 truncate">{leadSel.contato_nome}</div>}
          </div>
          <button type="button" onClick={() => onLeadSel(null)} className="text-slate-500 hover:text-slate-300" title="Trocar lead">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  const semResultado = aberto && !buscando && !erro && opcoes.length === 0 && !!busca.trim();

  return (
    <div className="space-y-1">
      <label className="text-sm text-slate-400">Lead da proposta</label>
      <div className="relative">
        <div className="flex items-center gap-1.5 border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117]">
          {buscando
            ? <Loader2 size={14} className="text-slate-500 animate-spin" />
            : <Search size={14} className="text-slate-500" />}
          <input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
            onFocus={() => setAberto(true)}
            onBlur={() => setAberto(false)}
            placeholder="Buscar empresa ou contato..."
            className="flex-1 bg-transparent text-sm text-slate-100 focus:outline-none"
          />
        </div>
        {aberto && (opcoes.length > 0 || erro || semResultado) && (
          <div className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-[#2a3147] bg-[#161b28] shadow-xl">
            {erro ? (
              <p className="px-3 py-2 text-xs text-rose-400">Não foi possível buscar leads.</p>
            ) : semResultado ? (
              <p className="px-3 py-2 text-xs text-slate-500">Nenhum lead encontrado.</p>
            ) : opcoes.map((l) => (
              <button
                key={l.id}
                type="button"
                // onMouseDown dispara antes do blur do input: a seleção não se perde.
                onMouseDown={(e) => { e.preventDefault(); onLeadSel(l); setAberto(false); setBusca(''); }}
                className="w-full text-left px-3 py-2 hover:bg-[#0f1117] text-sm text-slate-200 border-b border-[#2a3147] last:border-0"
              >
                <div className="truncate">{l.empresa}</div>
                <div className="text-xs text-slate-500 truncate">{l.contato_nome}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
