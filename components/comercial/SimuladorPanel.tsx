'use client';

import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Minus, Plus, Info, Check, Loader2, Search, X, TrendingDown } from 'lucide-react';
import {
  PRODUTOS, PRAZO_COMODATO_MESES, calcularCompra, calcularComodato,
  percentualDesconto, valorComDesconto, totalItens, formatarBRL,
  type ModeloComercial, type ProdutoId, type ItemProposta,
} from '@/lib/simulador';
import { getLeads, registrarNota } from '@/lib/api';
import type { Lead } from '@/lib/supabase';

// Aba "Simulador" do módulo Comercial. Sem H1/padding próprios — a página
// /comercial provê o cabeçalho e as abas. Precisa de um <Suspense> acima
// (useSearchParams), garantido pela página.

const MODELOS: { id: ModeloComercial; label: string; sub: string }[] = [
  { id: 'compra', label: 'Compra', sub: 'Venda definitiva' },
  { id: 'comodato', label: 'Comodato', sub: `Entrada + mensalidade · ${PRAZO_COMODATO_MESES} meses` },
];

// Deep-link do copiloto (item 8): ?modelo=comodato&itens=coletor:1,impressora:2
// pré-preenche o simulador com os equipamentos identificados na reunião.
function lerParamsIniciais(sp: URLSearchParams): {
  modelo: ModeloComercial;
  qtds: Record<ProdutoId, number>;
} {
  const qtds: Record<ProdutoId, number> = { coletor: 0, impressora: 0, totem: 0, pdv: 0, mesa_rfid: 0 };
  const idsValidos = new Set(PRODUTOS.map((p) => p.id));
  for (const par of (sp.get('itens') ?? '').split(',')) {
    const [id, q] = par.split(':');
    if (idsValidos.has(id as ProdutoId)) qtds[id as ProdutoId] = Math.max(0, Math.floor(Number(q) || 0));
  }
  const modelo: ModeloComercial = sp.get('modelo') === 'compra' ? 'compra' : 'comodato';
  return { modelo, qtds };
}

export default function SimuladorPanel() {
  const searchParams = useSearchParams();
  const inicial = useMemo(() => lerParamsIniciais(new URLSearchParams(searchParams.toString())), [searchParams]);
  const [modelo, setModelo] = useState<ModeloComercial>(inicial.modelo);
  const [qtds, setQtds] = useState<Record<ProdutoId, number>>(inicial.qtds);
  // Valores FINAIS negociados são a fonte única de verdade (null = usar a
  // sugestão). O desconto é sempre DERIVADO do final vs. a tabela (imutável), e
  // editar o desconto recalcula o final a partir da tabela — nunca encadeando um
  // final sobre o outro (sem ciclo, sem acúmulo de arredondamento). Item 5.
  const [valorFinalOv, setValorFinalOv] = useState<number | null>(null);
  const [mensalFinalOv, setMensalFinalOv] = useState<number | null>(null);
  const [entradaFinalOv, setEntradaFinalOv] = useState<number | null>(null);

  const itens: ItemProposta[] = useMemo(
    () => PRODUTOS.map((p) => ({ produto: p.id, qtd: qtds[p.id] })).filter((i) => i.qtd > 0),
    [qtds],
  );
  const qtdTotal = totalItens(itens);
  const temItens = qtdTotal > 0;

  const compra = useMemo(() => calcularCompra(itens), [itens]);
  const comodato = useMemo(() => calcularComodato(itens), [itens]);

  function setQtd(id: ProdutoId, v: number) {
    setQtds((q) => ({ ...q, [id]: Math.max(0, v) }));
  }

  // Referências IMUTÁVEIS (tabela oficial). Compra: valor total. Comodato:
  // mensalidade (soma dos avulsos) e entrada de referência (estimativa cheia).
  const refCompra = compra.valorTabela;
  const refMensal = comodato.mensalTabela;
  const refEntrada = comodato.entradaSugerida;

  // Finais efetivos: override do vendedor OU a sugestão do sistema.
  const valorFinal = valorFinalOv ?? compra.valorSugerido;
  const mensalFinal = mensalFinalOv ?? comodato.mensalSugerido;
  const entradaFinal = entradaFinalOv ?? comodato.entradaSugerida;

  const descontoCompra = percentualDesconto(refCompra, valorFinal);
  const descontoMensal = percentualDesconto(refMensal, mensalFinal);
  const descontoEntrada = percentualDesconto(refEntrada, entradaFinal);

  const totalContrato = entradaFinal + mensalFinal * PRAZO_COMODATO_MESES;
  const totalTabelaContrato = refEntrada + refMensal * PRAZO_COMODATO_MESES;
  const economiaCompra = Math.max(0, refCompra - valorFinal);
  const economiaContrato = Math.max(0, totalTabelaContrato - totalContrato);

  const desconto = modelo === 'compra' ? descontoCompra : descontoMensal;

  return (
    <div className="space-y-5">
      {/* Modelo */}
      <div className="flex items-center gap-2">
        {MODELOS.map((m) => (
          <button
            key={m.id}
            onClick={() => setModelo(m.id)}
            className={`flex flex-col items-start px-4 py-2 rounded-lg border text-left transition-colors ${
              modelo === m.id
                ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
                : 'border-[#2a3147] bg-[#1a1f2e] text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="text-sm font-semibold">{m.label}</span>
            <span className="text-[11px] opacity-80">{m.sub}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Equipamentos */}
        <div className="lg:col-span-3 card p-5">
          <h2 className="font-semibold text-slate-200 mb-3">Equipamentos</h2>
          <div className="space-y-1.5">
            {PRODUTOS.map((p) => {
              const preco = modelo === 'compra' ? p.precoCompra : p.mensalComodato;
              const q = qtds[p.id];
              return (
                <div key={p.id} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                  q > 0 ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-[#2a3147]'
                }`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200">{p.nome}</div>
                    <div className="text-xs text-slate-500">
                      {formatarBRL(preco)}{modelo === 'comodato' ? '/mês (avulso)' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => setQtd(p.id, q - 1)} disabled={q === 0}
                      className="w-7 h-7 rounded-md border border-[#2a3147] flex items-center justify-center text-slate-300 hover:bg-[#0f1117] disabled:opacity-40">
                      <Minus size={13} />
                    </button>
                    <input
                      type="number" min={0} value={q}
                      onChange={(e) => setQtd(p.id, Math.floor(Number(e.target.value) || 0))}
                      className="w-12 text-center text-sm bg-transparent border border-[#2a3147] rounded-md py-1 text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button onClick={() => setQtd(p.id, q + 1)}
                      className="w-7 h-7 rounded-md border border-[#2a3147] flex items-center justify-center text-slate-300 hover:bg-[#0f1117]">
                      <Plus size={13} />
                    </button>
                  </div>
                  <div className="w-28 text-right text-sm font-semibold text-slate-200 shrink-0">
                    {q > 0 ? formatarBRL(preco * q) + (modelo === 'comodato' ? '/mês' : '') : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-2 text-xs text-slate-500 mt-4 pt-4 border-t border-[#2a3147]">
            <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
            <p>
              O desconto é apenas <b>calculado e exibido</b> — não há trava de aprovação nesta versão.
              Os valores sugeridos são uma estimativa inicial editável. O preço de fato é sempre
              negociado; ajuste o valor final <b>ou</b> o percentual de desconto.
            </p>
          </div>
        </div>

        {/* Resumo da proposta */}
        <div className="lg:col-span-2 card p-5 flex flex-col gap-4 h-fit lg:sticky lg:top-4">
          <h2 className="font-semibold text-slate-200">Resumo da proposta</h2>

          {!temItens ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              Adicione equipamentos para montar a proposta.
            </p>
          ) : modelo === 'compra' ? (
            <>
              {/* Destaque */}
              <Destaque
                titulo="Valor final"
                valor={formatarBRL(valorFinal)}
                tabela={formatarBRL(refCompra)}
                desconto={descontoCompra}
                economia={economiaCompra}
              />
              <EditorDesconto
                label="Negociação"
                referencia={refCompra}
                final={valorFinal}
                onChange={setValorFinalOv}
              />
            </>
          ) : (
            <>
              {/* Destaque: total do contrato */}
              <Destaque
                titulo={`Total do contrato (${PRAZO_COMODATO_MESES}m)`}
                valor={formatarBRL(totalContrato)}
                tabela={formatarBRL(totalTabelaContrato)}
                economia={economiaContrato}
                linha2={`${formatarBRL(mensalFinal)}/mês · entrada ${formatarBRL(entradaFinal)}`}
              />
              <EditorDesconto
                label="Mensalidade"
                sufixo="/mês"
                referencia={refMensal}
                final={mensalFinal}
                onChange={setMensalFinalOv}
              />
              <EditorDesconto
                label="Entrada"
                referencia={refEntrada}
                final={entradaFinal}
                onChange={setEntradaFinalOv}
              />
            </>
          )}

          {temItens && <RegistrarProposta
            resumo={montarResumo(modelo, itens, {
              valorFinal, mensalFinal, entradaFinal, totalContrato,
              refCompra, refMensal, refEntrada,
              descontoCompra, descontoMensal, descontoEntrada,
            })}
          />}
        </div>
      </div>
    </div>
  );
}

// Bloco de destaque: valor final/total em evidência, com desconto e economia.
function Destaque({ titulo, valor, tabela, desconto, economia, linha2 }: {
  titulo: string; valor: string; tabela: string; desconto?: number; economia: number; linha2?: string;
}) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-indigo-500/15 to-indigo-500/5 border border-indigo-500/30 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{titulo}</span>
        {desconto !== undefined && desconto > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
            −{desconto.toLocaleString('pt-BR')}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-slate-100 mt-1 tabular-nums">{valor}</div>
      {linha2 && <div className="text-xs text-slate-400 mt-0.5">{linha2}</div>}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 text-xs">
        <span className="text-slate-500">Tabela cheia: <span className="line-through">{tabela}</span></span>
        {economia > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
            <TrendingDown size={12} /> economia {formatarBRL(economia)}
          </span>
        )}
      </div>
    </div>
  );
}

// Editor bidirecional: o vendedor ajusta o VALOR FINAL ou o % de DESCONTO; os
// dois espelham o mesmo número (fonte única = final). O % sempre recalcula o
// final a partir da `referencia` imutável (nunca encadeia), evitando ciclo e
// acúmulo de arredondamento. Atalhos 5/10/15% + valor personalizado.
function EditorDesconto({ label, sufixo = '', referencia, final, onChange }: {
  label: string; sufixo?: string; referencia: number; final: number; onChange: (v: number) => void;
}) {
  const desconto = percentualDesconto(referencia, final);
  const aplicarPct = (pct: number) => onChange(valorComDesconto(referencia, pct));
  return (
    <div className="rounded-lg border border-[#2a3147] bg-[#0f1117] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">{label}</span>
        <span className="text-[11px] text-slate-500">tabela {formatarBRL(referencia)}{sufixo}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 block mb-0.5">Valor final</label>
          <div className="flex items-center gap-1 border border-[#2a3147] rounded-md px-2 py-1.5 bg-[#1a1f2e] focus-within:ring-1 focus-within:ring-indigo-500">
            <span className="text-slate-500 text-xs">R$</span>
            <input
              type="number" min={0} value={final}
              onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              className="w-full bg-transparent text-sm text-slate-100 focus:outline-none tabular-nums"
            />
            {sufixo && <span className="text-slate-500 text-[10px]">{sufixo}</span>}
          </div>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 block mb-0.5">Desconto</label>
          <div className="flex items-center gap-1 border border-[#2a3147] rounded-md px-2 py-1.5 bg-[#1a1f2e] focus-within:ring-1 focus-within:ring-indigo-500">
            <input
              type="number" min={0} max={100} step={0.5} value={desconto}
              onChange={(e) => aplicarPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              className="w-full bg-transparent text-sm text-slate-100 focus:outline-none tabular-nums"
            />
            <span className="text-slate-500 text-xs">%</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {[5, 10, 15].map((p) => (
          <button key={p} type="button" onClick={() => aplicarPct(p)}
            className="text-[11px] px-2 py-0.5 rounded-md border border-[#2a3147] text-slate-300 hover:bg-[#1a1f2e] transition-colors">
            {p}%
          </button>
        ))}
        {final !== referencia && (
          <button type="button" onClick={() => onChange(referencia)}
            className="text-[11px] text-indigo-400 hover:underline ml-auto">
            tabela cheia
          </button>
        )}
      </div>
    </div>
  );
}

// Monta o texto da proposta registrado no lead (item 6 + ponte pro item 8).
function montarResumo(
  modelo: ModeloComercial,
  itens: ItemProposta[],
  v: {
    valorFinal: number; mensalFinal: number; entradaFinal: number; totalContrato: number;
    refCompra: number; refMensal: number; refEntrada: number;
    descontoCompra: number; descontoMensal: number; descontoEntrada: number;
  },
): string {
  const nome = (id: ProdutoId) => PRODUTOS.find((p) => p.id === id)?.nome ?? id;
  const lista = itens.map((i) => `${i.qtd}x ${nome(i.produto)}`).join(', ');
  if (modelo === 'compra') {
    return `Proposta comercial (Compra): ${lista}. Valor ${formatarBRL(v.valorFinal)} ` +
      `(tabela ${formatarBRL(v.refCompra)}, desconto ${v.descontoCompra.toLocaleString('pt-BR')}%).`;
  }
  return `Proposta comercial (Comodato): ${lista}. Mensalidade ${formatarBRL(v.mensalFinal)}/mês ` +
    `(tabela ${formatarBRL(v.refMensal)}/mês, desconto ${v.descontoMensal.toLocaleString('pt-BR')}%) + ` +
    `entrada ${formatarBRL(v.entradaFinal)} (desconto ${v.descontoEntrada.toLocaleString('pt-BR')}%), ` +
    `${PRAZO_COMODATO_MESES} meses. Total ${formatarBRL(v.totalContrato)}.`;
}

// Registro da proposta: liga a um lead e grava como interação (nota) na timeline
// do LeadPanel. v1 não tem entidade "proposta" própria — reaproveita interacoes.
function RegistrarProposta({ resumo }: { resumo: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [busca, setBusca] = useState('');
  const [leadSel, setLeadSel] = useState<Lead | null>(null);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(false);

  useEffect(() => { getLeads().then(setLeads).catch(() => setLeads([])); }, []);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return leads.slice(0, 8);
    return leads.filter((l) =>
      l.empresa?.toLowerCase().includes(t) || l.contato_nome?.toLowerCase().includes(t),
    ).slice(0, 8);
  }, [busca, leads]);

  async function registrar() {
    if (!leadSel) return;
    setSalvando(true);
    try {
      await registrarNota(leadSel.id, resumo);
      setFeito(true);
      setTimeout(() => setFeito(false), 4000);
    } catch (e) {
      console.error('Erro ao registrar proposta:', e);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="border-t border-[#2a3147] pt-4 space-y-2">
      <label className="text-sm text-slate-400">Registrar no lead (opcional)</label>
      {leadSel ? (
        <div className="flex items-center gap-2 border border-indigo-500/40 bg-indigo-500/5 rounded-lg px-3 py-2">
          <span className="flex-1 text-sm text-slate-200 truncate">{leadSel.empresa}</span>
          <button onClick={() => { setLeadSel(null); setFeito(false); }} className="text-slate-500 hover:text-slate-300">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="flex items-center gap-1.5 border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117]">
            <Search size={14} className="text-slate-500" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onFocus={() => setAberto(true)}
              placeholder="Buscar empresa ou contato..."
              className="flex-1 bg-transparent text-sm text-slate-100 focus:outline-none"
            />
          </div>
          {aberto && filtrados.length > 0 && (
            <div className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-[#2a3147] bg-[#161b28] shadow-xl">
              {filtrados.map((l) => (
                <button key={l.id}
                  onClick={() => { setLeadSel(l); setAberto(false); setBusca(''); }}
                  className="w-full text-left px-3 py-2 hover:bg-[#0f1117] text-sm text-slate-200 border-b border-[#2a3147] last:border-0">
                  <div className="truncate">{l.empresa}</div>
                  <div className="text-xs text-slate-500 truncate">{l.contato_nome}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button
        onClick={registrar}
        disabled={!leadSel || salvando}
        className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 py-2 rounded-lg transition-colors"
      >
        {salvando ? <Loader2 size={14} className="animate-spin" /> : feito ? <Check size={14} /> : null}
        {feito ? 'Proposta registrada!' : 'Registrar proposta'}
      </button>
    </div>
  );
}
