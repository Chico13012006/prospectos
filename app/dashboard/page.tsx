import DashboardWidgets from '@/components/dashboard/DashboardWidgets'

export default function DashboardPage() {
  return (
    <div className="space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Acompanhe cada área da operação em seu próprio painel.
        </p>
      </header>

      <DashboardWidgets />
    </div>
  )
}
