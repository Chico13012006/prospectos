import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { concluirDisparoUnicoSeFinalizado } from '../conclusaoDisparoServidor'

describe('conclusão de disparo único', () => {
  it('não conclui automaticamente quando a fila termina', async () => {
    const client = {
      from: () => { throw new Error('não deve consultar nem atualizar') },
    } as unknown as SupabaseClient

    await expect(concluirDisparoUnicoSeFinalizado(client, 'org-1', 'campanha-1')).resolves.toBe(false)
  })
})
