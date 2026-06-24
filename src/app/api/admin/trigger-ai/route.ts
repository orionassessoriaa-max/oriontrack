import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { startLeadAiIfEligible } from '@/lib/leadAiAgent';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const leadId = searchParams.get('lead_id');
  const secret = searchParams.get('secret');

  if (secret !== 'oriondebug') {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }

  if (!leadId) {
    return NextResponse.json({ error: 'Envie o lead_id.' }, { status: 400 });
  }

  try {
    // 1. Delete existing session for this lead so it can start fresh
    await supabaseAdmin
      .from('lead_ai_sessions')
      .delete()
      .eq('lead_id', leadId);

    // 2. Trigger the AI
    const result = await startLeadAiIfEligible(leadId);

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error('[Trigger AI Error]', error);
    return NextResponse.json({ error: error.message || 'Erro ao iniciar IA' }, { status: 500 });
  }
}
