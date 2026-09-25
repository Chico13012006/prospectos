'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Info, Minus, Monitor, Nfc, Package, Plus, Printer, Receipt, ScanBarcode, TabletSmartphone, TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import {
  PRODUTOS, PRAZO_COMODATO_MESES, calcularCompra, calcularComodato,
  percentualDesconto, valorComDesconto, totalItens, formatarBRL,
  type ModeloComercial, type ProdutoId, type ItemProposta,
} from '@/lib/simulador';
import { PROPOSTA_LIMITE_ITENS } from '@/lib/proposta/config';
import { excedeLimiteItens, montarDadosProposta } from '@/lib/proposta/dados';
import type { LeadDaProposta } from '@/lib/propostas/tipos';
import GerarProposta from '@/components/comercial/GerarProposta';
import AcoesProposta from '@/components/comercial/propostas/AcoesProposta';
import { estilosModulo as m, TituloSecao } from '@/components/tema/Modulo';
import s from './Comercial.module.css';

// Aba "Simulador" do módulo Comercial. Sem H1/padding próprios — a página
// /comercial provê o cabeçalho e as abas. Precisa de um <Suspense> acima
// (useSearchParams), garantido pela página.

const ICONE_PRODUTO: Record<ProdutoId, LucideIcon> = {
  coletor: ScanBarcode, impressora: Printer, totem: TabletSmartphone, pdv: Monitor, mesa_rfid: Nfc,
};

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
  // Lead da proposta: vive aqui porque também nomeia o arquivo do PDF
  // (proposta-{empresa}-{data}.pdf). Selecionar não salva nada.
  const [leadSel, setLeadSel] = useState<LeadDaProposta | null>(null);

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

  const totalContrato = entradaFinal + mensalFinal * PRAZO_COMODATO_MESES;
  const totalTabelaContrato = refEntrada + refMensal * PRAZO_COMODATO_MESES;
  const economiaCompra = Math.max(0, refCompra - valorFinal);
  const economiaContrato = Math.max(0, totalTabelaContrato - totalContrato);

  // O que se salva/envia é exatamente o que o card mostra. Tabela, desconto e
  // total são recalculados no servidor a partir destas escolhas.
  const escolhas = useMemo(
    () => ({ modelo, itens, valorFinal, mensalFinal, entradaFinal }),
    [modelo, itens, valorFinal, mensalFinal, entradaFinal],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      {/* Equipamentos */}
      <section className={`${m.painel} lg:col-span-3`}>
        <div className={`${m.painelBarra} flex-wrap`}>
          <TituloSecao icone={Package} titulo="Equipamentos" subtitulo="Escolha o modelo comercial e as quantidades." />
          <div className={s.segmentado} role="group" aria-label="Modelo comercial">
            {MODELOS.map((mod) => (
              <button
                key={mod.id}
                type="button"
                aria-pressed={modelo === mod.id}
                onClick={() => setModelo(mod.id)}
                className={`${modelo === mod.id ? s.segmentoAtivo : ''} focus-ring`}
              >
                <strong>{mod.label}</strong>
                <small>{mod.sub}</small>
              </button>
            ))}
          </div>
        </div>

        <div className={s.equipamentos}>
          {PRODUTOS.map((p) => {
            const preco = modelo === 'compra' ? p.precoCompra : p.mensalComodato;
            const q = qtds[p.id];
            const Icone = ICONE_PRODUTO[p.id];
            return (
              <div key={p.id} className={`${s.equipamento} ${q > 0 ? s.equipamentoAtivo : ''}`}>
                <span className={s.equipamentoIcone}><Icone size={18} aria-hidden="true" /></span>
                <div className="min-w-0">
                  <div className={`${s.equipamentoNome} truncate`}>{p.nome}</div>
                  <div className={s.equipamentoPreco}>
                    {formatarBRL(preco)}{modelo === 'comodato' ? '/mês (avulso)' : ' por unidade'}
                  </div>
                </div>
                <div className={s.stepper}>
                  <button type="button" onClick={() => setQtd(p.id, q - 1)} disabled={q === 0} aria-label={`Diminuir ${p.nome}`}>
                    <Minus size={14} />
                  </button>
                  <input
                    type="number" min={0} value={q}
                    onChange={(e) => setQtd(p.id, Math.floor(Number(e.target.value) || 0))}
                    aria-label={`Quantidade de ${p.nome}`}
                  />
                  <button type="button" onClick={() => setQtd(p.id, q + 1)} aria-label={`Aumentar ${p.nome}`}>
                    <Plus size={14} />
                  </button>
                </div>
                <div className={`${s.subtotal} ${q > 0 ? '' : s.subtotalVazio}`}>
                  {q > 0 ? (
                    <>
                      {formatarBRL(preco * q)}
                      <small>{modelo === 'comodato' ? 'por mês' : 'subtotal'}</small>
                    </>
                  ) : '—'}
                </div>
              </div>
            );
          })}
        </div>

        <div className={s.rodapePainel}>
          <Info size={14} className="text-sky-300 shrink-0 mt-0.5" />
          <p>
            O desconto é apenas <b>calculado e exibido</b> — não há trava de aprovação nesta versão.
            Os valores sugeridos são uma estimativa inicial editável. O preço de fato é sempre
            negociado; ajuste o valor final <b>ou</b> o percentual de desconto.
          </p>
        </div>
      </section>

      {/* Resumo da proposta */}
      <section className={`${m.painel} lg:col-span-2 lg:sticky lg:top-4`}>
        <div className={m.painelBarra}>
          <TituloSecao
            icone={Receipt}
            titulo="Resumo da proposta"
            subtitulo={temItens ? `${qtdTotal} ${qtdTotal === 1 ? 'equipamento' : 'equipamentos'} · ${modelo === 'compra' ? 'compra' : 'comodato'}` : 'Monte a proposta ao lado.'}
          />
        </div>

        {!temItens ? (
          <div className={s.vazio}>
            <span className={s.vazioIcone}><Package size={20} aria-hidden="true" /></span>
            <strong>Nenhum equipamento ainda</strong>
            <p>Use o + nos equipamentos para montar a proposta. O valor e o desconto aparecem aqui.</p>
          </div>
        ) : (
          <div className={s.resumoCorpo}>
            {modelo === 'compra' ? (
              <>
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

            {/* PDF para o cliente: só os valores FINAIS (override ou sugestão);
                tabela e descontos ficam internos. */}
            <GerarProposta
              dados={montarDadosProposta({
                modelo, itens, valorFinal, mensalFinal, entradaFinal, prazoMeses: comodato.prazoMeses,
              })}
              empresa={leadSel?.empresa}
            />

            {/* Salvar nas Propostas do lead ou enviar ao cliente com o PDF. */}
            <AcoesProposta
              proposta={escolhas}
              leadSel={leadSel}
              onLeadSel={setLeadSel}
              bloqueio={excedeLimiteItens(itens)
                ? `A proposta comporta até ${PROPOSTA_LIMITE_ITENS} tipos de equipamento. Reduza a seleção para salvar ou enviar.`
                : null}
            />
          </div>
        )}
      </section>
    </div>
  );
}

// Bloco de destaque: valor final/total em evidência, com desconto e economia.
function Destaque({ titulo, valor, tabela, desconto, economia, linha2 }: {
  titulo: string; valor: string; tabela: string; desconto?: number; economia: number; linha2?: string;
}) {
  return (
    <div className={s.destaque}>
      <div className={s.destaqueTopo}>
        <span>{titulo}</span>
        {desconto !== undefined && desconto > 0 && (
          <span className={s.selo}>−{desconto.toLocaleString('pt-BR')}%</span>
        )}
      </div>
      <div className={s.destaqueValor}>{valor}</div>
      {linha2 && <div className={s.destaqueLinha2}>{linha2}</div>}
      <div className={s.destaqueRodape}>
        <span>Tabela cheia: <span className="line-through">{tabela}</span></span>
        {economia > 0 && (
          <span className={s.economia}>
            <TrendingDown size={13} /> economia {formatarBRL(economia)}
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
    <div className={s.editor}>
      <div className={s.editorTopo}>
        <strong>{label}</strong>
        <span>tabela {formatarBRL(referencia)}{sufixo}</span>
      </div>
      <div className={s.editorCampos}>
        <label className={s.rotulo}>
          <span>Valor final</span>
          <div className={s.campoValor}>
            <span>R$</span>
            <input
              type="number" min={0} value={final}
              onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            />
            {sufixo && <span>{sufixo}</span>}
          </div>
        </label>
        <label className={s.rotulo}>
          <span>Desconto</span>
          <div className={s.campoValor}>
            <input
              type="number" min={0} max={100} step={0.5} value={desconto}
              onChange={(e) => aplicarPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
            />
            <span>%</span>
          </div>
        </label>
      </div>
      <div className={s.atalhosDesconto}>
        {[5, 10, 15].map((p) => (
          <button key={p} type="button" onClick={() => aplicarPct(p)} className={`${desconto === p ? s.atalhoAtivo : ''} focus-ring`}>
            {p}%
          </button>
        ))}
        {final !== referencia && (
          <button type="button" onClick={() => onChange(referencia)} className={s.linkTabela}>
            voltar à tabela cheia
          </button>
        )}
      </div>
    </div>
  );
}
