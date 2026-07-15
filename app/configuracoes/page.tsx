'use client';

import { useEffect, useState } from 'react';
import { Settings, Sliders, Save } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

// --- Parâmetros: config dinâmica do motor de cadência ---------------------
// Lê/grava a tabela `configuracoes_motor` via /api/configuracoes/motor.
// MODO_ENSAIO e INTERNAL_SECRET ficam de fora de propósito (só .env + redeploy).

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const PARAMS_PADRAO = {
  maxEnviosDia: 40,
  horasEntreFollowups: 48,
  maxFollowups: 3,
  intervaloEntreEnviosMin: 0,
  diasSemanaAtivos: [1, 2, 3, 4, 5],
  closerEmailFallback: '',
};

type ParamsMotor = typeof PARAMS_PADRAO;

const CAMPOS_NUMERICOS: { key: keyof Omit<ParamsMotor, 'diasSemanaAtivos' | 'closerEmailFallback'>; label: string; desc: string; min: number; max: number }[] = [
  { key: 'maxEnviosDia', label: 'Limite diário de envios', desc: 'Número máximo de e-mails que o motor envia por dia (protege a reputação do domínio).', min: 1, max: 500 },
  { key: 'horasEntreFollowups', label: 'Horas entre follow-ups', desc: 'Espera mínima entre um envio e o próximo follow-up do mesmo lead.', min: 1, max: 720 },
  { key: 'maxFollowups', label: 'Máximo de follow-ups', desc: 'Quantos follow-ups antes de encerrar o lead como "sem resposta".', min: 1, max: 10 },
  { key: 'intervaloEntreEnviosMin', label: 'Intervalo entre envios em lote (minutos)', desc: 'Espaçamento entre e-mails num mesmo lote (0 = sem espera). Usado pelo disparo em lote do piloto.', min: 0, max: 240 },
];

function ParametrosMotor() {
  const [form, setForm] = useState<ParamsMotor>(PARAMS_PADRAO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'erro'; msg: string } | null>(null);
  const [ultimaAlteracao, setUltimaAlteracao] = useState<{ por: string; em: string } | null>(null);

  useEffect(() => {
    fetch('/api/configuracoes/motor')
      .then(r => r.json())
      .then(data => {
        if (data?.erro) throw new Error(data.erro);
        setForm({
          maxEnviosDia: data.maxEnviosDia ?? PARAMS_PADRAO.maxEnviosDia,
          horasEntreFollowups: data.horasEntreFollowups ?? PARAMS_PADRAO.horasEntreFollowups,
          maxFollowups: data.maxFollowups ?? PARAMS_PADRAO.maxFollowups,
          intervaloEntreEnviosMin: data.intervaloEntreEnviosMin ?? PARAMS_PADRAO.intervaloEntreEnviosMin,
          diasSemanaAtivos: Array.isArray(data.diasSemanaAtivos) && data.diasSemanaAtivos.length > 0
            ? data.diasSemanaAtivos
            : PARAMS_PADRAO.diasSemanaAtivos,
          closerEmailFallback: data.closerEmailFallback ?? '',
        });
        if (data.atualizadoEm) {
          setUltimaAlteracao({ por: data.atualizadoPor ?? '—', em: data.atualizadoEm });
        }
      })
      .catch(() => setFeedback({ tipo: 'erro', msg: 'Falha ao carregar os parâmetros. Exibindo valores padrão.' }))
      .finally(() => setCarregando(false));
  }, []);

  function toggleDia(dia: number) {
    setForm(f => ({
      ...f,
      diasSemanaAtivos: f.diasSemanaAtivos.includes(dia)
        ? f.diasSemanaAtivos.filter(d => d !== dia)
        : [...f.diasSemanaAtivos, dia].sort(),
    }));
  }

  async function salvar() {
    setSalvando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/configuracoes/motor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || data?.erro) throw new Error(data?.erro || 'Erro ao salvar.');
      setUltimaAlteracao({ por: data.atualizadoPor ?? '—', em: data.atualizadoEm });
      setFeedback({ tipo: 'ok', msg: 'Parâmetros salvos. O motor usa os novos valores no próximo envio.' });
    } catch (e) {
      setFeedback({ tipo: 'erro', msg: e instanceof Error ? e.message : 'Erro ao salvar.' });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
      <h2 className="font-semibold text-slate-200 mb-1 flex items-center gap-2">
        <Sliders size={16} className="text-indigo-500" />
        Parâmetros de Cadência do Motor
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Alterações valem para os próximos envios, sem precisar de deploy. Modo ensaio/real continua só no ambiente.
      </p>

      {carregando ? (
        <p className="text-sm text-slate-400 py-6">Carregando parâmetros…</p>
      ) : (
        <div className="space-y-1">
          {CAMPOS_NUMERICOS.map(campo => (
            <div key={campo.key} className="grid grid-cols-3 gap-4 items-start py-3 border-b border-[#2a3147]">
              <div className="col-span-2">
                <label className="text-sm font-semibold text-slate-300">{campo.label}</label>
                <p className="text-xs text-slate-500 mt-0.5">{campo.desc}</p>
              </div>
              <input
                type="number"
                min={campo.min}
                max={campo.max}
                value={form[campo.key]}
                onChange={e => setForm(f => ({ ...f, [campo.key]: Number(e.target.value) }))}
                className="border border-[#2a3147] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 bg-[#1a1f2e]"
              />
            </div>
          ))}

          <div className="grid grid-cols-3 gap-4 items-start py-3 border-b border-[#2a3147]">
            <div className="col-span-2">
              <label className="text-sm font-semibold text-slate-300">Dias da semana ativos</label>
              <p className="text-xs text-slate-500 mt-0.5">A cadência diária só roda nos dias marcados.</p>
            </div>
            <div className="flex gap-1 flex-wrap">
              {DIAS_SEMANA.map((nome, dia) => {
                const ativo = form.diasSemanaAtivos.includes(dia);
                return (
                  <button
                    key={dia}
                    type="button"
                    onClick={() => toggleDia(dia)}
                    className={`text-xs font-medium px-2 py-1.5 rounded-lg border transition-colors ${
                      ativo
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                        : 'bg-[#0f1117] text-slate-500 border-[#2a3147] hover:text-slate-300'
                    }`}
                  >
                    {nome}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 items-start py-3">
            <div className="col-span-2">
              <label className="text-sm font-semibold text-slate-300">E-mail de fallback do closer</label>
              <p className="text-xs text-slate-500 mt-0.5">Recebe os avisos de lead interessado quando o lead não tem responsável definido.</p>
            </div>
            <input
              type="email"
              placeholder="closer@empresa.com.br"
              value={form.closerEmailFallback}
              onChange={e => setForm(f => ({ ...f, closerEmailFallback: e.target.value }))}
              className="border border-[#2a3147] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 bg-[#1a1f2e]"
            />
          </div>
        </div>
      )}

      {feedback && (
        <p className={`text-sm mt-4 ${feedback.tipo === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
          {feedback.msg}
        </p>
      )}
      {ultimaAlteracao && (
        <p className="text-xs text-slate-500 mt-2">
          Última alteração por {ultimaAlteracao.por} em {formatDateTime(ultimaAlteracao.em)}.
        </p>
      )}

      <div className="flex gap-3 mt-5">
        <button
          onClick={salvar}
          disabled={carregando || salvando}
          className="flex items-center gap-2 text-sm font-medium text-white px-5 py-2.5 rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#1e3a5f' }}
        >
          <Save size={14} /> {salvando ? 'Salvando…' : 'Salvar parâmetros'}
        </button>
        <button
          onClick={() => { setForm(PARAMS_PADRAO); setFeedback(null); }}
          disabled={carregando || salvando}
          className="text-sm text-slate-400 border border-[#2a3147] px-4 py-2.5 rounded-lg hover:bg-[#0f1117] disabled:opacity-50"
        >
          Restaurar padrão
        </button>
      </div>
    </div>
  );
}

export default function ConfiguracoesPage() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Settings size={22} className="text-slate-300" />
          Configurações
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Parâmetros de cadência do motor de automação.
        </p>
      </div>

      <ParametrosMotor />
    </div>
  );
}
