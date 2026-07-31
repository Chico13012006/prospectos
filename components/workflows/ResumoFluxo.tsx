'use client';

// Resumo VISUAL read-only do fluxo de um workflow (Fase 4.5, entrega 4).
// Timeline vertical: gatilho → público/condições → ações em ordem, com esperas,
// ramificação (saltar_se: verdadeiro salta / falso continua) e encerramento.
// Puro: lê a definição em edição; não altera nada. Sem canvas.
import { Zap, Filter, Clock, GitBranch, Flag, PlayCircle, CornerDownRight, ArrowDown } from 'lucide-react';
import type { BlocoConfig, DefinicaoWorkflow } from '@/lib/workflows/types';
import { acharBlocoDef, descreverBloco, type UsuarioRotulo } from '@/lib/workflows/catalogo';

function rotuloPasso(acoes: BlocoConfig[], indice: number): string {
  const b = acoes[indice];
  if (!b) return `passo ${indice + 1} (inexistente)`;
  return `passo ${indice + 1} · ${acharBlocoDef(b.tipo)?.label ?? b.tipo}`;
}

function textoEsperar(cfg: Record<string, unknown>): string {
  const dias = Number(cfg.dias ?? 0);
  const horas = Number(cfg.horas ?? 0);
  const partes: string[] = [];
  if (dias) partes.push(`${dias} dia${dias === 1 ? '' : 's'}`);
  if (horas) partes.push(`${horas} h`);
  return `Esperar ${partes.join(' e ') || '0'}`;
}

const Bolha = ({ Icon, cor }: { Icon: typeof Zap; cor: string }) => (
  <span className={`flex items-center justify-center w-6 h-6 rounded-md shrink-0 ${cor}`}>
    <Icon size={13} />
  </span>
);

function FluxoPasso({ bloco, indice, acoes, usuarios }: { bloco: BlocoConfig; indice: number; acoes: BlocoConfig[]; usuarios?: UsuarioRotulo[] }) {
  const n = <span className="text-[11px] font-mono text-slate-600 w-5 shrink-0 text-right">{indice + 1}</span>;

  if (bloco.tipo === 'esperar') {
    return (
      <li className="flex items-center gap-2">
        {n}
        <Bolha Icon={Clock} cor="bg-slate-500/20 text-slate-300" />
        <span className="text-sm text-slate-300">{textoEsperar(bloco.config ?? {})}</span>
      </li>
    );
  }

  if (bloco.tipo === 'encerrar') {
    return (
      <li className="flex items-center gap-2">
        {n}
        <Bolha Icon={Flag} cor="bg-red-500/20 text-red-300" />
        <span className="text-sm text-red-300/90">Encerrar o fluxo</span>
      </li>
    );
  }

  if (bloco.tipo === 'saltar_se') {
    const cfg = bloco.config ?? {};
    const cond = cfg.condicao as BlocoConfig | undefined;
    const destinoId = String(cfg.destino ?? '');
    const destino = acoes.findIndex((a) => a.id === destinoId); // id → índice atual
    const destinoValido = destino >= 0;
    return (
      <li>
        <div className="flex items-center gap-2">
          {n}
          <Bolha Icon={GitBranch} cor="bg-sky-500/20 text-sky-300" />
          <span className="text-sm text-slate-200">
            Ramificar — se <span className="text-sky-300">{cond ? descreverBloco(cond, usuarios) : 'condição'}</span>
          </span>
        </div>
        <div className="ml-7 mt-1 space-y-0.5 text-xs">
          <div className="flex items-center gap-1.5 text-emerald-300">
            <CornerDownRight size={12} /> verdadeiro → vai para{' '}
            <span className={destinoValido ? 'font-medium' : 'text-red-400'}>
              {destinoValido ? rotuloPasso(acoes, destino) : destinoId ? 'passo removido' : 'destino não escolhido'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <ArrowDown size={12} /> falso → continua para o próximo passo
          </div>
        </div>
      </li>
    );
  }

  // Ação comum.
  return (
    <li className="flex items-center gap-2">
      {n}
      <Bolha Icon={PlayCircle} cor="bg-green-500/20 text-green-300" />
      <span className="text-sm text-slate-300">{descreverBloco(bloco, usuarios)}</span>
    </li>
  );
}

export default function ResumoFluxo({ def, usuarios }: { def: DefinicaoWorkflow; usuarios?: UsuarioRotulo[] }) {
  const acoes = def.acoes ?? [];
  const condicoes = def.condicoes ?? [];
  return (
    <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] p-4">
      <div className="text-sm font-semibold text-slate-200 mb-3">Resumo do fluxo</div>
      <ol className="space-y-2">
        <li className="flex items-center gap-2">
          <span className="w-5 shrink-0" />
          <Bolha Icon={Zap} cor="bg-amber-500/20 text-amber-300" />
          <span className="text-sm text-slate-200">
            Gatilho — <span className="text-amber-200/90">{descreverBloco(def.gatilho, usuarios)}</span>
          </span>
        </li>

        {condicoes.length > 0 && (
          <li className="flex items-start gap-2">
            <span className="w-5 shrink-0" />
            <Bolha Icon={Filter} cor="bg-sky-500/20 text-sky-300" />
            <span className="text-sm text-slate-300">
              Público — {condicoes.map((c) => descreverBloco(c, usuarios)).join(' E ')}
            </span>
          </li>
        )}

        {acoes.length === 0 ? (
          <li className="ml-7 text-xs text-amber-400/80">Sem ações ainda.</li>
        ) : (
          acoes.map((a, i) => <FluxoPasso key={i} bloco={a} indice={i} acoes={acoes} usuarios={usuarios} />)
        )}

        <li className="flex items-center gap-2 pt-1">
          <span className="w-5 shrink-0" />
          <Bolha Icon={Flag} cor="bg-slate-600/30 text-slate-400" />
          <span className="text-xs text-slate-500">Fim do fluxo</span>
        </li>
      </ol>
    </div>
  );
}
