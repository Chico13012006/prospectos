'use client';

import { Calendar, CalendarClock } from 'lucide-react';
import { estilosModulo as m, PaginaModulo, TituloSecao } from '@/components/tema/Modulo';

// Módulo Reuniões — placeholder até a agenda de reuniões dos leads
// (reuniao_agendada) ganhar tela própria. Sem dado inventado: só o aviso.
export default function ReunioesPage() {
  return (
    <PaginaModulo grupo="Execução" titulo="Reuniões" subtitulo="Reuniões agendadas com os leads do pipeline.">
      <section className={m.painel}>
        <div className={m.painelBarra}>
          <TituloSecao icone={Calendar} titulo="Agenda de reuniões" subtitulo="Em construção." />
        </div>
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-sky-500/10 text-sky-300 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.2),0_0_18px_rgba(14,165,233,0.12)]">
            <CalendarClock size={26} aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold text-slate-100">Em breve</h2>
          <p className="max-w-sm text-sm leading-relaxed text-slate-400">
            Aqui você vai acompanhar as reuniões agendadas com os leads do pipeline.
          </p>
        </div>
      </section>
    </PaginaModulo>
  );
}
