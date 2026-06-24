import { NextResponse } from 'next/server';
import { evolutionFetch } from '@/lib/evolution';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== 'oriondebug') {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }

  const profileId = 'e1db6a41-8395-4c7d-b92d-70642f26edc0'; // Danilo's profile ID
  const instanceName = `orion_${profileId.replace(/-/g, '')}`;

  const debugInfo: any = {
    checkedInstance: instanceName,
    connectionState: null,
    instancesList: null,
    error: null,
  };

  try {
    // 1. Fetch connection state for Danilo's instance
    try {
      debugInfo.connectionState = await evolutionFetch(`/instance/connectionState/${instanceName}`);
    } catch (err: any) {
      debugInfo.connectionState = { error: err.message || err };
    }

    // 2. Fetch all instances
    try {
      const fetched = await evolutionFetch('/instance/fetchInstances');
      const list = Array.isArray(fetched) ? fetched : fetched?.data || [];
      debugInfo.instancesList = list.map((inst: any) => ({
        instanceName: inst.instanceName || inst.name,
        connectionStatus: inst.status || inst.connectionStatus,
        owner: inst.owner || inst.number,
      }));
    } catch (err: any) {
      debugInfo.instancesList = { error: err.message || err };
    }

    return NextResponse.json(debugInfo);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro no debug' }, { status: 500 });
  }
}
