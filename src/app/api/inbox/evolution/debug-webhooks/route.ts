import { NextResponse } from 'next/server';
import { configureEvolutionWebhook, evolutionFetch, getEvolutionInstanceApiKey } from '@/lib/evolution';

export async function GET(request: Request) {
  try {
    console.log('[Debug Webhooks] Buscando instâncias na Evolution API...');
    const instances = await evolutionFetch('/instance/fetchInstances');

    const result: any[] = [];

    if (Array.isArray(instances)) {
      for (const inst of instances) {
        const name = inst.name || inst.instanceName;
        if (!name) continue;

        try {
          const instanceApiKey = await getEvolutionInstanceApiKey(name).catch(() => null);
          const webhookConfig = await evolutionFetch(`/webhook/find/${name}`, { method: 'GET' }, instanceApiKey);
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

export async function POST(request: Request) {
  try {
    console.log('[Debug Webhooks] Iniciando reconfiguração de webhooks de todas as instâncias...');
    const instances = await evolutionFetch('/instance/fetchInstances');
    const result: any[] = [];

    if (Array.isArray(instances)) {
      for (const inst of instances) {
        const name = inst.name || inst.instanceName;
        if (!name) continue;

        try {
          const instanceApiKey = await getEvolutionInstanceApiKey(name).catch(() => null);
          
          // Re-configura o webhook usando a lógica atualizada
          await configureEvolutionWebhook(name, instanceApiKey);

          // Busca a nova configuração para confirmar
          const webhookConfig = await evolutionFetch(`/webhook/find/${name}`, { method: 'GET' }, instanceApiKey);
          
          result.push({
            instanceName: name,
            status: 'reconfigured',
            webhook: webhookConfig,
          });
        } catch (err: any) {
          result.push({
            instanceName: name,
            status: 'error',
            error: err.message || 'Erro ao reconfigurar webhook',
          });
        }
      }
    } else {
      return NextResponse.json({ error: 'Evolution API não retornou uma lista de instâncias válida.', raw: instances });
    }

    return NextResponse.json({ ok: true, reconfigured: result });
  } catch (error: any) {
    console.error('[Debug Webhooks POST Error]', error);
    return NextResponse.json({ error: error.message || 'Erro interno ao reconfigurar webhooks' }, { status: 500 });
  }
}
