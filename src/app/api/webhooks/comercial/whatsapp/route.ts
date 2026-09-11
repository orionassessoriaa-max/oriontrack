import { NextResponse } from 'next/server';
import { isCommercialClaimWebhookAuthorized } from '@/lib/commercialClaimSecurity';
import { handleCommercialWhatsAppClaim } from '@/lib/commercialWhatsAppClaim';

export async function POST(request: Request) {
  try {
    if (!isCommercialClaimWebhookAuthorized(new URL(request.url).searchParams.get('secret') || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json();
    const message = body?.message || body?.data?.message || body?.data || body;
    if (message?.fromMe === true || message?.isGroup === false) {
      return NextResponse.json({ ok: true, status: 'ignored' });
    }
    const providerId = typeof message?.id === 'string' ? message.id : '';
    const result = await handleCommercialWhatsAppClaim(providerId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('commercial_whatsapp_claim_failed', error);
    return NextResponse.json({ error: 'Falha ao processar START.' }, { status: 500 });
  }
}
