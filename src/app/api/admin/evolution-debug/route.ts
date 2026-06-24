import { NextResponse } from 'next/server';
import { evolutionFetch, getEvolutionInstanceApiKey, normalizePhone } from '@/lib/evolution';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== 'oriondebug') {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }

  const profileId = 'e1db6a41-8395-4c7d-b92d-70642f26edc0'; // Danilo's profile ID
  const instanceName = `orion_${profileId.replace(/-/g, '')}`;
  const targetPhone = '5511970565216'; // Danilo's phone

  const debugInfo: any = {
    instanceName,
    targetPhone,
    instanceApiKey: null,
    connectionState: null,
    testSendResult: null,
    globalApiKeyUsed: process.env.EVOLUTION_API_KEY ? 'present' : 'missing',
  };

  try {
    // 1. Fetch connection state
    try {
      debugInfo.connectionState = await evolutionFetch(`/instance/connectionState/${instanceName}`);
    } catch (err: any) {
      debugInfo.connectionState = { error: err.message || err };
    }

    // 2. Resolve Instance API Key
    try {
      debugInfo.instanceApiKey = await getEvolutionInstanceApiKey(instanceName);
    } catch (err: any) {
      debugInfo.instanceApiKey = { error: err.message || err };
    }

    // 3. Test sending a message
    try {
      const apiKey = debugInfo.instanceApiKey;
      const response = await fetch(`${String(process.env.EVOLUTION_API_URL).replace(/\/+$/, '')}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          number: targetPhone,
          text: 'OrionTrack Teste de Diagnostico da IA',
        }),
      });

      const status = response.status;
      const body = await response.json().catch(() => ({}));
      debugInfo.testSendResult = { status, body };
    } catch (err: any) {
      debugInfo.testSendResult = { error: err.message || err };
    }

    return NextResponse.json(debugInfo);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro no debug' }, { status: 500 });
  }
}

