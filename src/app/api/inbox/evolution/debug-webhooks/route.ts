import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { evolutionFetch } from '@/lib/evolution';

const ADMIN_ROLES = ['admin', 'corretor_admin'] as const;

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, [...ADMIN_ROLES]);
    if ('error' in guard) return guard.error;

    console.log('[Debug Webhooks] Buscando instâncias na Evolution API...');
    const instances = await evolutionFetch('/instance/fetchInstances');

    const result: any[] = [];

    if (Array.isArray(instances)) {
      for (const inst of instances) {
        const name = inst.name || inst.instanceName;
        if (!name) continue;

        try {
          // Buscar webhook desta instância
          // O token da instância pode ser a chave global se a API key da instância não estiver disponível
          const webhookConfig = await evolutionFetch(`/webhook/find/${name}`, { method: 'GET' });
          result.push({
            instanceName: name,
            connectionStatus: inst.connectionStatus || inst.status,
            webhook: webhookConfig,
          });
        } catch (err: any) {
          result.push({
            instanceName: name,
            connectionStatus: inst.connectionStatus || inst.status,
            error: err.message || 'Erro ao buscar webhook',
          });
        }
      }
    } else {
      return NextResponse.json({ error: 'Evolution API não retornou uma lista de instâncias válida.', raw: instances });
    }

    return NextResponse.json({ ok: true, instances: result });
  } catch (error: any) {
    console.error('[Debug Webhooks Error]', error);
    return NextResponse.json({ error: error.message || 'Erro interno de debug' }, { status: 500 });
  }
}
