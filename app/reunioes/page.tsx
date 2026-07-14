import { Calendar } from 'lucide-react';

// Módulo Reuniões — placeholder até a agenda de reuniões dos leads
// (reuniao_agendada) ganhar tela própria.
export default function ReunioesPage() {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 p-6 text-center animate-in">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-500/15 border border-indigo-500/30">
        <Calendar size={28} className="text-indigo-400" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Reuniões</h1>
        <p className="text-sm text-slate-400 mt-1">Em breve</p>
      </div>
      <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
        Aqui você vai acompanhar as reuniões agendadas com os leads do pipeline.
      </p>
    </div>
  );
}
