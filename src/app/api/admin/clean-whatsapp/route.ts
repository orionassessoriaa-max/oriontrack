import { NextResponse } from 'next/server';
import { rateLimit, requireApiUser } from '@/lib/api/security';
import { evolutionFetch } from '@/lib/evolution';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:clean:whatsapp', { limit: 5, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    console.log('[Clean WhatsApp] Starting WhatsApp sessions and database cleanup...');

    // 1. Obter todas as instâncias da Evolution API
    let instances: any[] = [];
    try {
      instances = await evolutionFetch('/instance/fetchInstances', { method: 'GET' });
    } catch (err: any) {
      console.error('[Clean WhatsApp] Failed to fetch instances from Evolution API:', err);
    }

    const deletedInstances: string[] = [];

    // 2. Filtrar e excluir apenas instâncias do CRM (que começam com 'orion_')
    if (Array.isArray(instances)) {
      for (const inst of instances) {
        const name = inst.instanceName || inst.name;
        if (name && name.startsWith('orion_')) {
          console.log(`[Clean WhatsApp] Logging out and deleting instance: ${name}`);
          
          // Desconectar o WhatsApp da Evolution API
          try {
            await evolutionFetch(`/instance/logout/${name}`, { method: 'DELETE' });
          } catch (e) {
            console.warn(`[Clean WhatsApp] Logout failed for ${name}:`, e);
          }

          // Excluir a instância do servidor
          try {
            await evolutionFetch(`/instance/delete/${name}`, { method: 'DELETE' });
            deletedInstances.push(name);
          } catch (e) {
            console.warn(`[Clean WhatsApp] Delete failed for ${name}:`, e);
          }
        }
      }
    }

    // 3. Limpar tabelas de mensagens e conversas de WhatsApp no banco de dados para dar tela 100% limpa
    const { error: msgDeleteError } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Deleta todas as linhas com segurança

    if (msgDeleteError) {
      console.error('[Clean WhatsApp] Failed to clear whatsapp_mensagens:', msgDeleteError);
    }

    const { error: convDeleteError } = await supabaseAdmin
      .from('whatsapp_conversas')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Deleta todas as linhas com segurança

    if (convDeleteError) {
      console.error('[Clean WhatsApp] Failed to clear whatsapp_conversas:', convDeleteError);
    }

    return NextResponse.json({
      success: true,
      message: 'Ambiente de testes de WhatsApp resetado com sucesso!',
      deleted_instances: deletedInstances,
      database_cleared: !msgDeleteError && !convDeleteError
    });
  } catch (error: any) {
    console.error('[POST /api/admin/clean-whatsapp] ERROR:', error);
    return NextResponse.json({ error: error.message || 'Erro ao efetuar a limpeza geral de WhatsApp.' }, { status: 500 });
  }
}
