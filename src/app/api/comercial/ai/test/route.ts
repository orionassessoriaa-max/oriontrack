import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { COMMERCIAL_MASTER_INSTANCE, normalizePhone } from '@/lib/uazapi';
import { startCommercialBotIfEligible } from '@/lib/commercialBot';
import { startCommercialSdrOpeningIfEligible } from '@/lib/commercialSdrAgent';

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  try {
    const body = await request.json().catch(() => ({}));
    const testMode = body.mode === 'bot' ? 'bot' : 'ia';
    const phone = normalizePhone(body.telefone);
    const name = String(body.nome || 'Teste IA').trim().slice(0, 120) || 'Teste IA';
    const ages = String(body.idades || '32').trim().slice(0, 80) || '32';
    const email = String(body.email || '').trim().slice(0, 160) || null;
    const traffic = String(body.ja_investiu_trafego || '').trim().slice(0, 160) || null;
    const revenue = String(body.faturamento_mensal || '').trim().slice(0, 160) || null;
    const investment = String(body.investimento || '').trim().slice(0, 160) || null;
    const priority = String(body.prioridade || '').trim().slice(0, 160) || null;
    const lives = String(body.vidas || '').trim().slice(0, 160) || null;
    if (!phone || phone.length < 12) return NextResponse.json({ error: 'Informe um WhatsApp valido com DDD.' }, { status: 400 });

    const { data: config, error: configError } = await supabaseAdmin
      .from('comercial_config')
      .select('ia_sdr_ativa,bot_comercial_ativo')
      .eq('id', 1)
      .maybeSingle();
    if (configError) throw new Error(`Configuracao comercial indisponivel: ${configError.message}`);
    if (!config) return NextResponse.json({ error: 'A configuracao comercial ainda nao foi criada no banco.' }, { status: 503 });

    const now = new Date().toISOString();
    const origem = testMode === 'bot' ? 'Teste Bot comercial' : 'Teste IA SDR';
    const leadData = {
      nome: name,
      telefone: phone,
      email,
      idades: ages,
      ja_investiu_trafego: traffic,
      faturamento_mensal: revenue,
      investimento: investment,
      prioridade: priority,
      vidas: lives,
      origem,
      status: 'Oportunidade',
      observacoes: `Lead criado pelo teste do ${testMode === 'bot' ? 'Bot' : 'IA SDR'} comercial.`,
      created_by: guard.profile.id,
      data_entrada: now,
      sdr_id: guard.profile.id,
    };

    let { data: lead, error: leadError } = await supabaseAdmin
      .from('comercial_leads')
      .insert(leadData)
      .select('id,nome,telefone')
      .single();
    if (leadError && /column .*schema cache|could not find the .* column/i.test(leadError.message)) {
      const fallbackNotes = [
        `Lead criado pelo teste do ${testMode === 'bot' ? 'Bot' : 'IA SDR'} comercial.`,
        `Idades: ${ages}`,
        email ? `E-mail: ${email}` : '',
        traffic ? `Tráfego pago: ${traffic}` : '',
        revenue ? `Faturamento: ${revenue}` : '',
        investment ? `Investimento: ${investment}` : '',
        priority ? `Prioridade: ${priority}` : '',
        lives ? `Vidas: ${lives}` : '',
      ].filter(Boolean).join(' | ');
      const fallback = await supabaseAdmin.from('comercial_leads').insert({
        nome: name,
        telefone: phone,
        origem,
        status: 'Oportunidade',
        observacoes: fallbackNotes,
        created_by: guard.profile.id,
        data_entrada: now,
        sdr_id: guard.profile.id,
      }).select('id,nome,telefone').single();
      lead = fallback.data;
      leadError = fallback.error;
    }
    if (leadError) throw leadError;
    if (!lead?.id) return NextResponse.json({ error: 'Nao consegui criar o lead de teste.' }, { status: 500 });

    // O teste chama exatamente o mesmo caminho que o webhook do funil usa. Antes
    // esta rota tinha uma implementacao propria da abertura, entao um teste
    // verde nao provava que o fluxo real funcionava.
    if (testMode === 'bot') {
      const botResult = await startCommercialBotIfEligible(lead.id, { manualTest: true });
      if (!botResult.started) return NextResponse.json({ error: `O Bot nao enviou: ${botResult.reason}.` }, { status: 502 });
      return NextResponse.json({ ok: true, lead, mode: 'bot', liveMode: config.bot_comercial_ativo === true ? 'bot' : (config.ia_sdr_ativa === false ? 'nenhum' : 'ia'), sender: { nome: 'Orion', instance: COMMERCIAL_MASTER_INSTANCE } });
    }

    const aiResult = await startCommercialSdrOpeningIfEligible(lead.id, { manualTest: true });
    if (!aiResult.started) return NextResponse.json({ error: `A IA nao enviou: ${aiResult.reason}.` }, { status: 502 });
    return NextResponse.json({
      ok: true,
      lead,
      mode: 'ia',
      liveMode: config.bot_comercial_ativo === true ? 'bot' : (config.ia_sdr_ativa === false ? 'nenhum' : 'ia'),
      messages: aiResult.messages,
      message: (aiResult.messages || []).join('\n\n'),
      sender: { nome: 'Orion', instance: COMMERCIAL_MASTER_INSTANCE },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nao foi possivel enviar o teste da IA.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
