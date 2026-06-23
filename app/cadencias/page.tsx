'use client';

import { useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { getCanalBadgeClasses } from '@/lib/utils';
import { GitBranch, CheckCircle, Bot, User, ChevronDown, ChevronUp, Zap, Users } from 'lucide-react';

export default function CadenciasPage() {
  const { cadencias, empresas, templates } = useApp();
  const [expanded, setExpanded] = useState<string | null>(cadencias[0]?.id || null);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Cadências</h1>
          <p className="text-slate-400 text-sm mt-0.5">{cadencias.length} cadências configuradas</p>
        </div>
        <button className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
          style={{ backgroundColor: '#1e3a5f' }}>
          <GitBranch size={15} /> Nova Cadência
        </button>
      </div>

      <div className="space-y-4">
        {cadencias.map(cad => {
          const leadsAtivos = empresas.filter(e => e.cadencia_id === cad.id && e.em_cadencia);
          const isOpen = expanded === cad.id;

          // Calculate avg response rate from templates used
          const tplIds = cad.etapas.map(e => e.template_id);
          const tplList = templates.filter(t => tplIds.includes(t.id));
          const avgRate = tplList.length > 0
            ? Math.round(tplList.reduce((sum, t) => sum + t.taxa_resposta, 0) / tplList.length)
            : 0;

          return (
            <div key={cad.id} className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none overflow-hidden">
              {/* Header */}
              <div
                className="flex items-center justify-between p-5 cursor-pointer hover:bg-[#0f1117] transition-colors"
                onClick={() => setExpanded(isOpen ? null : cad.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                    <GitBranch size={18} className="text-indigo-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-100">{cad.nome}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${cad.ativa ? 'bg-green-500/20 text-green-400' : 'bg-[#252b3b] text-slate-400'}`}>
                        {cad.ativa ? 'Ativa' : 'Inativa'}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400 mt-0.5">{cad.descricao}</div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="flex items-center gap-1 text-sm font-bold text-indigo-400">
                      <Users size={14} /> {leadsAtivos.length}
                    </div>
                    <div className="text-xs text-slate-500">leads ativos</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold text-green-400">{avgRate}%</div>
                    <div className="text-xs text-slate-500">taxa média</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold text-slate-300">{cad.etapas.length}</div>
                    <div className="text-xs text-slate-500">etapas</div>
                  </div>
                  {isOpen ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                </div>
              </div>

              {/* Expanded: Steps Timeline */}
              {isOpen && (
                <div className="border-t border-[#2a3147] px-5 py-4">
                  <div className="flex gap-0 items-start overflow-x-auto pb-2">
                    {cad.etapas.map((etapa, i) => {
                      const tpl = templates.find(t => t.id === etapa.template_id);
                      const isLast = i === cad.etapas.length - 1;
                      return (
                        <div key={etapa.numero} className="flex items-start">
                          <div className="flex flex-col items-center min-w-40 max-w-44 px-2">
                            {/* Step number + connector */}
                            <div className="flex items-center w-full">
                              <div className="w-9 h-9 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm font-bold shrink-0">
                                {etapa.numero}
                              </div>
                              {!isLast && <div className="flex-1 h-0.5 bg-indigo-500/20 mx-1" />}
                            </div>
                            {/* Content */}
                            <div className="mt-2 w-full">
                              <div className="text-xs font-semibold text-slate-300">D+{etapa.dia_offset}</div>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${getCanalBadgeClasses(etapa.canal)} block w-fit mt-1`}>
                                {etapa.canal}
                              </span>
                              <div className={`text-xs mt-1 flex items-center gap-1 ${etapa.executado_por === 'automatico' ? 'text-blue-400' : 'text-green-400'}`}>
                                {etapa.executado_por === 'automatico' ? <Bot size={11} /> : <User size={11} />}
                                {etapa.executado_por === 'automatico' ? 'Auto' : 'Manual'}
                              </div>
                              {tpl && (
                                <div className="text-xs text-slate-500 mt-1 leading-tight truncate">{tpl.nome}</div>
                              )}
                              {tpl && (
                                <div className="text-xs text-green-400 mt-0.5">{tpl.taxa_resposta}% resp.</div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Active leads in this cadência */}
                  {leadsAtivos.length > 0 && (
                    <div className="mt-4 border-t border-[#2a3147] pt-4">
                      <div className="text-xs font-semibold text-slate-400 mb-2">Leads nesta cadência</div>
                      <div className="flex flex-wrap gap-2">
                        {leadsAtivos.map(e => (
                          <a key={e.id} href={`/leads/${e.id}`}
                            className="text-xs bg-indigo-500/10 text-indigo-400 px-2.5 py-1 rounded-full hover:bg-indigo-500/20 transition-colors">
                            {e.nome} — Etapa {e.etapa_atual_cadencia}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Automation rules documentation */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Zap size={16} className="text-amber-500" />
          Regras de Automação (n8n)
        </h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3147]">
                <th className="text-left py-2 px-3 text-slate-400 font-medium">Gatilho</th>
                <th className="text-left py-2 px-3 text-slate-400 font-medium">Condição</th>
                <th className="text-left py-2 px-3 text-slate-400 font-medium">Ação Automática</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {[
                { gatilho: 'lead.criado', cond: 'Lead entra com status "novo"', acao: 'Inicia cadência padrão do segmento' },
                { gatilho: 'abordagem.sem_resposta', cond: 'X dias sem resposta após envio', acao: 'Dispara próxima etapa da cadência' },
                { gatilho: 'resposta.detectada', cond: 'Qualquer resposta recebida', acao: 'Para cadência, notifica responsável, atualiza status' },
                { gatilho: 'resposta.positiva', cond: 'Tipo: interesse_positivo', acao: 'Para cadência, cria follow-up urgente, sinaliza no dashboard' },
                { gatilho: 'resposta.opt_out', cond: 'Tipo: opt_out ou negativa_definitiva', acao: 'Adiciona à blacklist, para toda automação' },
                { gatilho: 'cadencia.finalizada', cond: 'Última etapa sem resposta', acao: 'Status → reativar_futuramente, define data futura' },
                { gatilho: 'followup.atrasado', cond: 'Data prevista < hoje e status "pendente"', acao: 'Alerta responsável, aparece no dashboard em destaque' },
                { gatilho: 'lead.inativo', cond: 'Sem interação há 14+ dias sem cadência', acao: 'Alerta para retomada manual' },
              ].map((row, i) => (
                <tr key={i} className="border-b border-[#2a3147] hover:bg-[#0f1117]">
                  <td className="py-2 px-3">
                    <code className="bg-[#252b3b] text-slate-300 px-1.5 py-0.5 rounded text-xs">{row.gatilho}</code>
                  </td>
                  <td className="py-2 px-3 text-slate-300">{row.cond}</td>
                  <td className="py-2 px-3 text-slate-300">{row.acao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
