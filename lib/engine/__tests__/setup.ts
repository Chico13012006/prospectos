// Roda ANTES de cada arquivo de teste — fixa o ambiente do motor para valores
// pequenos e determinísticos (a engineConfig é avaliada uma vez, na importação).
process.env.MODO_ENSAIO = 'true'
process.env.MAX_ENVIOS_DIA = '2'
process.env.HORAS_ENTRE_FOLLOWUPS = '48'
process.env.MAX_FOLLOWUPS = '3'
process.env.CLOSER_EMAIL = 'closer@inovacode.com.br'
process.env.INTERNAL_SECRET = 'test-secret'

// Evita qualquer surpresa caso algum módulo toque no client do Supabase.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-test'
