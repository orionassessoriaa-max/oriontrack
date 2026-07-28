import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { fetchWithTimeout } from '@/lib/meta/fetchWithTimeout';
import { TRAFFIC_RULES } from '@/lib/trafego/rules';
import { extractDriveId, isGoogleDriveConfigured, resolveDriveFile } from '@/lib/integrations/googleDrive';

async function guard(request: Request) {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (error || !user) return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin.from('profiles').select('id, tipo_usuario').eq('id', user.id).maybeSingle();
  if (!profile || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }
  return { profile };
}

type ChatMessage = { role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> };

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:apolo-chat', { limit: 40, windowMs: 5 * 60_000 });
    if (limited) return limited;
    const access = await guard(request);
    if ('error' in access) return access.error;
    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12) as ChatMessage[] : [];
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') return NextResponse.json({ error: 'Envie uma mensagem para o Apolo.' }, { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY nao configurada.' }, { status: 503 });

    const context = JSON.stringify({
      conta: body.account || null,
      metricas: body.metrics || null,
      estrutura: body.tree || null,
      regras: TRAFFIC_RULES,
      conversa: messages,
      anexo: body.creative_attachment || null,
    }).slice(0, 28000);
    const aiMessages: Array<{ role: 'system' | 'user'; content: string | Array<Record<string, unknown>> }> = [
      {
        role: 'system',
        content: `Voce e o Apolo, analista senior de trafego da Orion. Converse com o gestor em portugues do Brasil.
Use somente os dados de contexto e os prints recebidos. Nao invente metricas, IDs, nomes de campanha, saldo ou resultado.
Se o gestor corrigir sua leitura, reconheca a correcao, atualize a analise e explique o que mudou. Separe fato de hipotese.
Regras oficiais: ${JSON.stringify(TRAFFIC_RULES)}.
O CPL deve usar somente leads CRM de origem Orion. Conta sem rastreio ativo nao pode gerar pausa por CPL.
O gestor pode pedir pausa de anuncio, troca de criativo, ajuste de verba ou criacao de campanha/conjunto/anuncio.
Nunca execute uma alteracao neste chat. Gere apenas um plano para revisao humana. Criacoes novas devem sair PAUSED.
O Google Drive esta disponivel para buscar arquivos quando estiver configurado no ambiente. Nunca diga que encontrou um arquivo sem receber a confirmacao do servidor; se a busca nao retornar exatamente um arquivo, explique isso ao gestor.
Responda sempre em JSON valido neste formato: {"reply":"resposta curta e clara","draft":null}.
Quando o gestor pedir uma acao concreta, preencha draft com campaign, adsets, ads, actions, missing_info e human_review_checklist. Nunca invente creative_id nem daily_budget.`,
      },
      { role: 'user', content: context },
    ];
    const attachmentUrl = body.creative_attachment?.url;
    if (typeof attachmentUrl === 'string' && attachmentUrl.startsWith('http')) {
      aiMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Analise este print ou criativo anexado e use-o para responder ao gestor. Se algo nao estiver legivel, diga isso.' },
          { type: 'image_url', image_url: { url: attachmentUrl } },
        ],
      });
    }

    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.ORION_TRAFFIC_AI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 1400,
        response_format: { type: 'json_object' },
        messages: aiMessages,
      }),
    });

    if (!response.ok) return NextResponse.json({ error: 'O Apolo nao respondeu. Tente novamente em alguns segundos.' }, { status: 502 });
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return NextResponse.json({ error: 'Resposta vazia do Apolo.' }, { status: 502 });
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = { reply: content, draft: null }; }
    let drive: any = { configured: isGoogleDriveConfigured(), status: 'not_requested' };
    const prompt = String(last.content || '');
    const fileUrl = prompt.match(/https?:\/\/drive\.google\.com\/file\/d\/[^\s)]+/i)?.[0] || null;
    const folderUrl = prompt.match(/https?:\/\/drive\.google\.com\/drive\/folders\/[^\s)]+/i)?.[0] || null;
    const fileHint = prompt.match(/(?:criativo|anuncio|ad)\s*(?:de|numero|n[ºo]?|#|-)?\s*([a-z0-9][a-z0-9 _-]{1,50})/i)?.[1]?.trim() || null;
    if (fileUrl || folderUrl || fileHint) {
      const resolution = await resolveDriveFile({
        fileId: fileUrl ? extractDriveId(fileUrl) : null,
        folderId: folderUrl ? extractDriveId(folderUrl) : null,
        fileName: fileHint,
      });
      drive = resolution.configured
        ? { configured: true, status: resolution.file.length === 1 ? 'resolved' : resolution.file.length ? 'multiple_matches' : 'not_found', matches: resolution.file }
        : { configured: false, status: 'not_configured' };
      if (drive.status === 'resolved' && parsed.draft) {
        const file = resolution.file[0];
        const ads = Array.isArray(parsed.draft.ads) ? parsed.draft.ads : [{}];
        parsed.draft = { ...parsed.draft, ads: ads.map((ad: any) => ({ ...ad, drive_file_id: file.id, drive_file_name: file.name, drive_mime_type: file.mimeType, drive_url: file.webViewLink || null })), drive_file: file };
      }
    }
    return NextResponse.json({ success: true, reply: String(parsed.reply || 'Analise concluida.'), draft: parsed.draft || null, drive_connected: drive.configured === true, drive });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao conversar com o Apolo.' }, { status: 500 });
  }
}
