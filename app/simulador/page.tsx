'use client';

import { useMemo, useState, useEffect } from 'react';
import { Calculator, Minus, Plus, Info, Check, Loader2, Search, X } from 'lucide-react';
import {
  PRODUTOS, PRAZO_COMODATO_MESES, calcularCompra, calcularComodato,
  percentualDesconto, totalItens, formatarBRL,
  type ModeloComercial, type ProdutoId, type ItemProposta,
} from '@/lib/simulador';
import { getLeads, registrarNota } from '@/lib/api';
import type { Lead } from '@/lib/supabase';

const MODELOS: { id: ModeloComercial; label: string; sub: string }[] = [
  { id: 'compra', label: 'Compra', sub: 'Venda definitiva' },
  { id: 'comodato', label: 'Comodato', sub: `Entrada + mensalidade · ${PRAZO_COMODATO_MESES} meses` },
];

export default function SimuladorPage() {
  const [modelo, setModelo] = useState<ModeloComercial>('comodato');
  const [qtds, setQtds] = useState<Record<ProdutoId, number>>({
    coletor: 0, impressora: 0, totem: 0, pdv: 0, mesa_rfid: 0,
  });
  // Overrides do valor negociado (null = seguir a sugestão do sistema).
  const [valorNegociado, setValorNegociado] = useState<number | null>(null);
  const [mensalFinal, setMensalFinal] = useState<number | null>(null);
  const [entradaFinal, setEntradaFinal] = useState<number | null>(null);

  const itens: ItemProposta[] = useMemo(
    () => PRODUTOS.map((p) => ({ produto: p.id, qtd: qtds[p.id] })).filter((i) => i.qtd > 0),
    [qtds],
  );
  const qtdTotal = totalItens(itens);

  const compra = useMemo(() => calcularCompra(itens), [itens]);
  const comodato = useMemo(() => calcularComodato(itens), [itens]);

  function setQtd(id: ProdutoId, v: number) {
    setQtds((q) => ({ ...q, [id]: Math.max(0, v) }));
  }

  // Valores efetivos (override do vendedor ou sugestão do sistema).
  const compraFinal = valorNegociado ?? compra.valorSugerido;
  const mensalEfetivo = mensalFinal ?? comodato.mensalSugerido;
  const entradaEfetiva = entradaFinal ?? comodato.entradaSugerida;

  const descontoCompra = percentualDesconto(compra.valorTabela, compraFinal);
  const descontoComodato = percentualDesconto(comodato.mensalTabela, mensalEfetivo);
  const totalContrato = entradaEfetiva + mensalEfetivo * PRAZO_COMODATO_MESES;

  const desconto = modelo === 'compra' ? descontoCompra : descontoComodato;
  const temItens = qtdTotal > 0;

  return (
    <div className="p-6 space-y-5">
      <div className="animate-in stagger-1">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Calculator size={22} className="text-indigo-400" /> Simulador comercial
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Monte o projeto, veja o total e o desconto sobre a tabela. Preço de pacote é negociado — os valores sugeridos são um ponto de partida editável.
        </p>
      </div>

      {/* Modelo */}
      <div className="flex items-center gap-2 animate-in stagger-2">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-in stagger-3">
        {/* Itens */}
        <div className="lg:col-span-2 card p-5">
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
        </div>

        {/* Resumo */}
        <div className="card p-5 flex flex-col gap-4 h-fit">
          <h2 className="font-semibold text-slate-200">Resumo da proposta</h2>

          {!temItens ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              Adicione equipamentos para ver o total.
            </p>
          ) : modelo === 'compra' ? (
            <>
              <LinhaResumo label="Valor de tabela" value={formatarBRL(compra.valorTabela)} />
              <CampoValor
                label="Valor negociado" value={compraFinal}
                sugestao={compra.valorSugerido} onChange={setValorNegociado}
                onReset={() => setValorNegociado(null)} tocado={valorNegociado !== null}
              />
              <BadgeDesconto desconto={descontoCompra} />
            </>
          ) : (
            <>
              <LinhaResumo label="Mensalidade de tabela" value={`${formatarBRL(comodato.mensalTabela)}/mês`} />
              <LinhaResumo label="Desconto de bundle sugerido" value={`${Math.round(comodato.descontoSugerido * 100)}%`} sub />
              <CampoValor
                label="Mensalidade final" sufixo="/mês" value={mensalEfetivo}
                sugestao={comodato.mensalSugerido} onChange={setMensalFinal}
                onReset={() => setMensalFinal(null)} tocado={mensalFinal !== null}
              />
              <CampoValor
                label="Entrada" value={entradaEfetiva}
                sugestao={comodato.entradaSugerida} onChange={setEntradaFinal}
                onReset={() => setEntradaFinal(null)} tocado={entradaFinal !== null}
              />
              <LinhaResumo label={`Total do contrato (${PRAZO_COMODATO_MESES}m)`} value={formatarBRL(totalContrato)} />
              <BadgeDesconto desconto={descontoComodato} />
            </>
          )}

          {temItens && <RegistrarProposta
            resumo={montarResumo(modelo, itens, {
              compraFinal, mensalEfetivo, entradaEfetiva, totalContrato,
              tabelaCompra: compra.valorTabela, mensalTabela: comodato.mensalTabela, desconto,
            })}
          />}
        </div>
      </div>

      {/* Nota de v1 */}
      <div className="flex items-start gap-2 text-xs text-slate-500 bg-[#1a1f2e] border border-[#2a3147] rounded-lg px-4 py-3 max-w-3xl animate-in stagger-4">
        <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
        <p>
          O desconto é apenas <b>calculado e exibido</b> — não há trava de aprovação nesta versão.
          Os valores sugeridos (desconto de bundle e entrada) são uma estimativa inicial editável,
          a ser calibrada. O preço de fato é sempre negociado; ajuste os campos livremente.
        </p>
      </div>
    </div>
  );
}

function LinhaResumo({ label, value, sub }: { label: string; value: string; sub?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${sub ? 'text-slate-500' : 'text-slate-400'}`}>{label}</span>
      <span className={`font-semibold ${sub ? 'text-slate-400 text-sm' : 'text-slate-100'}`}>{value}</span>
    </div>
  );
}

// Campo de valor editável com botão de reset para a sugestão do sistema.
function CampoValor({
  label, value, sugestao, sufixo = '', onChange, onReset, tocado,
}: {
  label: string; value: number; sugestao: number; sufixo?: string;
  onChange: (v: number) => void; onReset: () => void; tocado: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm text-slate-400">{label}</label>
        {tocado && (
          <button onClick={onReset} className="text-[11px] text-indigo-400 hover:underline">
            usar sugestão ({sugestao.toLocaleString('pt-BR')})
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117] focus-within:ring-1 focus-within:ring-indigo-500">
        <span className="text-slate-500 text-sm">R$</span>
        <input
          type="number" min={0} value={value}
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          className="flex-1 bg-transparent text-slate-100 text-sm focus:outline-none tabular-nums"
        />
        {sufixo && <span className="text-slate-500 text-xs">{sufixo}</span>}
      </div>
    </div>
  );
}

function BadgeDesconto({ desconto }: { desconto: number }) {
  const cor = desconto <= 0 ? 'text-slate-300 bg-slate-500/10'
    : desconto < 20 ? 'text-emerald-400 bg-emerald-500/10'
    : desconto < 40 ? 'text-amber-400 bg-amber-500/10'
    : 'text-red-400 bg-red-500/10';
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${cor}`}>
      <span className="text-sm font-medium">Desconto sobre a tabela</span>
      <span className="text-lg font-bold tabular-nums">
        {desconto.toLocaleString('pt-BR')}%
      </span>
    </div>
  );
}

// Monta o texto da proposta registrado no lead (item 6 + ponte pro item 8).
function montarResumo(
  modelo: ModeloComercial,
  itens: ItemProposta[],
  v: {
    compraFinal: number; mensalEfetivo: number; entradaEfetiva: number; totalContrato: number;
    tabelaCompra: number; mensalTabela: number; desconto: number;
  },
): string {
  const nome = (id: ProdutoId) => PRODUTOS.find((p) => p.id === id)?.nome ?? id;
  const lista = itens.map((i) => `${i.qtd}x ${nome(i.produto)}`).join(', ');
  if (modelo === 'compra') {
    return `Proposta comercial (Compra): ${lista}. Valor ${formatarBRL(v.compraFinal)} ` +
      `(tabela ${formatarBRL(v.tabelaCompra)}, desconto ${v.desconto.toLocaleString('pt-BR')}%).`;
  }
  return `Proposta comercial (Comodato): ${lista}. Mensalidade ${formatarBRL(v.mensalEfetivo)}/mês ` +
    `(tabela ${formatarBRL(v.mensalTabela)}/mês, desconto ${v.desconto.toLocaleString('pt-BR')}%) + ` +
    `entrada ${formatarBRL(v.entradaEfetiva)}, ${PRAZO_COMODATO_MESES} meses. Total ${formatarBRL(v.totalContrato)}.`;
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
