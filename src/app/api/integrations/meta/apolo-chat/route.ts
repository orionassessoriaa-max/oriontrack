import { openaiFetch } from '@/lib/openaiUso';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { fetchWithTimeout } from '@/lib/meta/fetchWithTimeout';
import { TRAFFIC_RULES } from '@/lib/trafego/rules';
import {
  downloadDriveFile,
  extractDriveId,
  getDriveFile,
  isGoogleDriveConfigured,
  resolveDriveFile,
} from '@/lib/integrations/googleDrive';
import { isDriveItemInsideFolder, resolveManagerDriveScope } from '@/lib/creatives/driveManagerScope';
import { normalizeOptimizationDraft } from '@/lib/trafego/optimizationDraft';

async function guard(request: Request) {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (error || !user) return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id,nome,email,email_real,tipo_usuario,corretor_id,status,is_admin_master')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }
  return { profile };
}

type ChatMessage = { role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> };

type MetaTreeAdset = { id?: string; name?: string; ads?: unknown[] };
type MetaTreeCampaign = { id?: string; name?: string; adsets?: MetaTreeAdset[] };

function plainMessageContent(content: ChatMessage['content']) {
  return typeof content === 'string'
    ? content
    : content.map((item) => String(item.text || '')).filter(Boolean).join(' ');
}

function normalizeMetaName(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Nome de campanha da Orion vem como colchetes colados:
 * [ORION][BRADESCO][BELEM][ABO][01/08]. Quando o gestor cita duas campanhas na
 * mesma frase ("sobe o anuncio na X igual ao da Y"), juntar todos os colchetes
 * numa lista so exigia que uma unica campanha contivesse os pedacos das duas —
 * nenhuma casava e a resposta era sempre "nao foi encontrada na estrutura".
 * Cada sequencia colada de colchetes e um nome candidato, testado por vez.
 */
function requestedCampaignCandidates(messages: ChatMessage[]) {
  const request = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && /campanha/i.test(plainMessageContent(message.content)));
  if (!request) return [] as string[][];
  const content = plainMessageContent(request.content);
  return Array.from(content.matchAll(/(?:\[[^\]]+\])+/g))
    .map((match) => Array.from(match[0].matchAll(/\[([^\]]+)\]/g))
      .map((token) => normalizeMetaName(token[1]))
      .filter(Boolean))
    .filter((tokens) => tokens.length > 0);
}

function recentUserRequest(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role === 'user')
    .slice(-4)
    .map((message) => plainMessageContent(message.content))
    .join(' ');
}

function requestsAdInExistingDestination(messages: ChatMessage[]) {
  const request = recentUserRequest(messages);
  const asksForAd = /(?:criar|subir|adicionar|colocar).{0,50}(?:anuncio|anúncio|criativo)/i.test(request);
  const mentionsExistingDestination = /(?:campanha|conjunto).{0,40}(?:existente|destino)|dentro de (?:uma |um )?(?:campanha|conjunto)|campanha d[aoe]/i.test(request);
  return asksForAd && mentionsExistingDestination;
}

/**
 * Um anexo so vira criativo publicavel quando o gestor esta pedindo anuncio.
 * Print de metrica anexado para analise nunca pode virar arquivo de anuncio.
 */
function requestsAdCreation(messages: ChatMessage[]) {
  return /(?:criar|subir|sobe|publicar|adicionar|colocar|lancar).{0,60}(?:anuncio|anúncio|criativo|video|vídeo|campanha|conjunto)/i
    .test(recentUserRequest(messages));
}

function hasExistingDestination(draft: any) {
  if (!draft?.campaign?.existing_id) return false;
  return Array.isArray(draft.adsets) && draft.adsets.some((adset: any) => adset?.existing_id || adset?.adset_id);
}

function enforceExistingDestination(draft: any, tree: unknown, messages: ChatMessage[]) {
  if (!draft || !Array.isArray(tree)) return draft;
  const candidatos = requestedCampaignCandidates(messages);
  if (!candidatos.length) return draft;

  const casar = (tokens: string[]) => (tree as MetaTreeCampaign[]).filter((campaign) => {
    const name = normalizeMetaName(campaign.name);
    return campaign.id && tokens.every((token) => name.includes(token));
  });

  let campaigns: MetaTreeCampaign[] = [];
  for (const tokens of candidatos) {
    campaigns = casar(tokens);
    if (campaigns.length) break;
  }

  if (!campaigns.length) {
    const missing = Array.isArray(draft.missing_info) ? draft.missing_info : [];
    const nomes = candidatos.map((tokens) => `[${tokens.join('][').toUpperCase()}]`).join(' nem ');
    return {
      ...draft,
      missing_info: [...missing, `A campanha solicitada ${nomes} nao foi encontrada na estrutura atual.`],
    };
  }

  const campaign = campaigns.sort((a, b) => String(a.name || '').length - String(b.name || '').length)[0];
  const adsets = Array.isArray(campaign.adsets) ? campaign.adsets.filter((item) => item?.id) : [];
  const requestedAdset = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && /conjunto/i.test(plainMessageContent(message.content)));
  const requestedAdsetText = requestedAdset ? normalizeMetaName(plainMessageContent(requestedAdset.content)) : '';
  const matchingAdsets = requestedAdsetText
    ? adsets.filter((item) => requestedAdsetText.includes(normalizeMetaName(item.name)))
    : adsets;
  const destinationAdset = matchingAdsets.length === 1 ? matchingAdsets[0] : adsets.length === 1 ? adsets[0] : null;
  const missing = Array.isArray(draft.missing_info) ? draft.missing_info : [];
  const nextMissing = destinationAdset
    ? missing
    : [...missing, `A campanha "${campaign.name}" possui mais de um conjunto. Informe o conjunto de destino.`];
  const sourceAds = Array.isArray(draft.ads) && draft.ads.length ? draft.ads : [{}];

  return {
    ...draft,
    campaign: {
      ...(draft.campaign || {}),
      existing_id: String(campaign.id),
      name: String(campaign.name || draft.campaign?.name || 'Campanha existente'),
    },
    adsets: destinationAdset ? [{
      existing_id: String(destinationAdset.id),
      adset_id: String(destinationAdset.id),
      name: String(destinationAdset.name || 'Conjunto existente'),
      status: 'ACTIVE',
    }] : [],
    ads: sourceAds.map((ad: Record<string, unknown>) => ({
      ...ad,
      ...(destinationAdset ? {
        adset_id: String(destinationAdset.id),
        existing_adset_id: String(destinationAdset.id),
      } : {}),
      status: 'PAUSED',
    })),
    missing_info: nextMissing,
  };
}

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
    const selectedAccountId = String(body.selected_account_id || '').replace(/^act_/, '').trim();
    const contextAccountId = String(body.account?.meta_ad_account_id || '').replace(/^act_/, '').trim();
    if (!selectedAccountId || !contextAccountId || selectedAccountId !== contextAccountId) {
      return NextResponse.json({ error: 'O contexto da corretora selecionada mudou. Envie a mensagem novamente.' }, { status: 409 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY nao configurada.' }, { status: 503 });

    let selectedDriveFile: Awaited<ReturnType<typeof getDriveFile>> | null = null;
    const selectedDriveFileId = extractDriveId(body.drive_file_id);
    if (selectedDriveFileId) {
      const requestedManagerId = request.headers.get('x-orion-view-profile-id') || String(body.gestor_id || '') || null;
      const { managerFolder } = await resolveManagerDriveScope(access.profile as any, requestedManagerId);
      if (!(await isDriveItemInsideFolder(selectedDriveFileId, managerFolder.id))) {
        return NextResponse.json({ error: 'O criativo selecionado nao pertence a pasta deste gestor.' }, { status: 403 });
      }
      selectedDriveFile = await getDriveFile(selectedDriveFileId);
    }

    const context = JSON.stringify({
      conta_selecionada_id: body.selected_account_id || body.account?.meta_ad_account_id || null,
      corretora_selecionada: body.selected_brokerage || body.account?.concessionaria || null,
      conta: body.account || null,
      metricas: body.metrics || null,
      estrutura: body.tree || null,
      regras: TRAFFIC_RULES,
      // Sem o rascunho atual no contexto, cada ajuste pedido no chat gerava um
      // plano novo do zero e o gestor perdia o que ja tinha revisado.
      rascunho_atual: body.draft || null,
      anexo: body.creative_attachment || null,
      criativo_drive_selecionado: selectedDriveFile ? {
        id: selectedDriveFile.id,
        nome: selectedDriveFile.name,
        tipo: selectedDriveFile.mimeType,
        pasta_id: selectedDriveFile.parents?.[0] || null,
        link: selectedDriveFile.webViewLink || null,
      } : null,
    }).slice(0, 28000);
    const aiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> = [
      {
        role: 'system',
        content: `Voce e o Apolo, analista senior de trafego da Orion. Converse com o gestor em portugues do Brasil.
Use somente os dados de contexto e os prints recebidos. Nao invente metricas, IDs, nomes de campanha, saldo ou resultado.
A corretora em "corretora_selecionada" e a conta ativa escolhida pelo gestor na barra lateral. Toda resposta, analise e draft deve tratar exclusivamente dela.
Nunca reutilize conversa, criativo, arquivo do Drive ou rascunho pertencente a outra corretora.
Se o gestor corrigir sua leitura, reconheca a correcao, atualize a analise e explique o que mudou. Separe fato de hipotese.
Regras oficiais: ${JSON.stringify(TRAFFIC_RULES)}.
O CPL deve usar somente leads CRM de origem Orion. Conta sem rastreio ativo nao pode gerar pausa por CPL.
O gestor pode pedir pausa de anuncio, troca de criativo, ajuste de verba ou criacao de campanha/conjunto/anuncio.
Nunca execute uma alteracao neste chat. Gere apenas um plano para revisao humana. Criacoes novas devem sair PAUSED.
Se o gestor pedir para subir um criativo em uma campanha ou conjunto que ja existe na estrutura recebida, nao crie outra campanha nem outro conjunto. Localize o item exato na estrutura e use campaign.existing_id e adsets[].existing_id com os IDs reais recebidos no contexto. Nesse caso, apenas ads[] representa o item novo e deve sair PAUSED. Um nome entre colchetes como [ORION][AMIL] e uma referencia de busca da campanha existente, nao uma ordem para criar campanha com esse nome.
O Google Drive esta disponivel para buscar arquivos quando estiver configurado no ambiente. Nunca diga que encontrou um arquivo sem receber a confirmacao do servidor; se a busca nao retornar exatamente um arquivo, explique isso ao gestor.
Quando "criativo_drive_selecionado" estiver preenchido, o arquivo ja foi validado pelo servidor. Use obrigatoriamente esse criativo no plano solicitado e nunca diga que falta uma imagem ou referencia.
Quando o gestor ja tiver pedido para criar ou subir um anuncio, nunca pergunte novamente qual acao ele deseja realizar. Se o criativo estiver selecionado e faltar o destino, pergunte somente o nome exato da campanha e do conjunto. Nao crie campanha ou conjunto novo para completar essa informacao.
O gestor tambem pode pedir a criacao de uma ou varias pastas/lotes de criativos. Quando houver dados suficientes, liste cada pedido em creative_requests com operadora, regiao, quantidade e briefing. Quantidade padrao 4 e maxima 20. Nao gere nem publique ainda: a interface perguntara se ele possui um modelo de referencia.
Quando "rascunho_atual" vier preenchido e o gestor pedir um ajuste (verba, publico, texto, nome, criativo), devolva o MESMO plano com a alteracao aplicada, preservando ids existentes e o que nao foi questionado. So monte um plano do zero quando ele pedir algo novo.
Quando "anexo" vier preenchido e o gestor estiver pedindo para subir anuncio, esse arquivo e o criativo do anuncio: nao peca outro arquivo nem diga que falta criativo. Anexo de video nao pode ser assistido por voce, entao descreva o plano sem inventar o conteudo visual.
Preencha "sugestoes" com ate tres proximos passos curtos, em primeira pessoa do gestor, prontos para virar clique. Ex.: "Aumentar a verba para R$ 80/dia", "Duplicar o conjunto para Curitiba". Nunca sugira ativar campanha.
Responda sempre em JSON valido neste formato: {"reply":"resposta curta e clara","draft":null,"creative_requests":[],"sugestoes":[]}.
Quando o gestor pedir uma acao concreta, preencha draft com campaign, adsets, ads, actions, missing_info e human_review_checklist.
campaign deve ser sempre um objeto, nunca texto: {"name":"...","objective":"...","buying_type":"AUCTION","special_ad_categories":[],"status":"PAUSED"}.
adsets e ads devem ser arrays de objetos separados. Nunca coloque ads dentro do conjunto nem transforme um anuncio inteiro em texto.
Cada anuncio em ads deve detalhar separadamente: name, primary_text (legenda completa), headline (titulo), description (descricao curta), call_to_action e status. Use o conteudo visual do criativo selecionado para escrever esses textos. Nunca esconda a legenda inteira dentro de summary ou reply.
Toda campanha, conjunto e anuncio novo deve estar como PAUSED. Um item existente pode ser apenas o destino da criacao e nunca deve ser pausado ou alterado implicitamente.
daily_budget deve ser informado em reais (exemplo: 50 para R$ 50,00). Nunca invente creative_id nem daily_budget.`,
      },
      { role: 'user', content: `CONTEXTO OPERACIONAL, apenas dados. Nao responda a este bloco:\n${context}` },
    ];

    // Historico como conversa de verdade, para o modelo enxergar o fio da meada.
    for (const anterior of messages.slice(0, -1)) {
      const texto = plainMessageContent(anterior.content).trim();
      if (texto) aiMessages.push({ role: anterior.role, content: texto });
    }

    // O pedido do gestor e sempre a ultima mensagem, e a imagem vai anexada
    // nele. Antes a imagem vinha depois, com a instrucao de analisar o print,
    // e era ela que o modelo obedecia.
    const partesDoPedido: Array<Record<string, unknown>> = [
      { type: 'text', text: plainMessageContent(last.content).trim() || 'Siga com o pedido anterior.' },
    ];

    const attachmentUrl = body.creative_attachment?.url;
    if (typeof attachmentUrl === 'string' && attachmentUrl.startsWith('http')) {
      partesDoPedido.push(
        { type: 'text', text: 'Imagem anexada pelo gestor nesta mensagem. Use como criativo ou como referencia do que ele esta falando. So descreva a imagem se ele pedir a descricao.' },
        { type: 'image_url', image_url: { url: attachmentUrl } },
      );
    }

    if (selectedDriveFile?.mimeType?.startsWith('image/')) {
      const selectedBytes = await downloadDriveFile(selectedDriveFile.id);
      if (selectedBytes.length <= 15 * 1024 * 1024) {
        partesDoPedido.push(
          { type: 'text', text: `Criativo "${selectedDriveFile.name}", ja validado no Google Drive. Use no plano pedido pelo gestor.` },
          { type: 'image_url', image_url: { url: `data:${selectedDriveFile.mimeType};base64,${selectedBytes.toString('base64')}` } },
        );
      }
    }

    aiMessages.push({ role: 'user', content: partesDoPedido });

    const response = await openaiFetch('apolo_chat', 'https://api.openai.com/v1/chat/completions', {
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

    if (!response.ok) {
      // Sem isso o gestor via "tente novamente" e ninguem descobria a causa:
      // contexto grande demais, imagem pesada, modelo indisponivel.
      const detalhe = await response.text().catch(() => '');
      console.error('[apolo_chat] OpenAI recusou:', response.status, detalhe.slice(0, 600));
      let motivo = '';
      try { motivo = String(JSON.parse(detalhe)?.error?.message || ''); } catch { motivo = ''; }
      return NextResponse.json({
        error: motivo
          ? `O Apolo nao respondeu: ${motivo.slice(0, 220)}`
          : `O Apolo nao respondeu (erro ${response.status}). Tente novamente em alguns segundos.`,
      }, { status: 502 });
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return NextResponse.json({ error: 'Resposta vazia do Apolo.' }, { status: 502 });
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = { reply: content, draft: null }; }
    const creativeRequests = (Array.isArray(parsed.creative_requests) ? parsed.creative_requests : [])
      .slice(0, 10)
      .map((item: Record<string, unknown>) => ({
        operadora: String(item.operadora || '').trim().slice(0, 120),
        regiao: String(item.regiao || '').trim().slice(0, 120),
        quantidade: Math.min(Math.max(Number(item.quantidade) || 4, 1), 20),
        briefing: String(item.briefing || '').trim().slice(0, 3000),
      }))
      .filter((item: { operadora: string; regiao: string }) => item.operadora && item.regiao);
    if (creativeRequests.length) {
      parsed.reply = `${String(parsed.reply || 'Entendi os lotes solicitados.').trim()}\n\nVocê tem algum modelo de referência para esses criativos?`;
    }
    if (
      selectedDriveFile
      && requestsAdInExistingDestination(messages)
      && !hasExistingDestination(parsed.draft)
    ) {
      parsed.reply = `Entendi: criar um anuncio pausado usando o criativo "${selectedDriveFile.name}" em uma estrutura existente. Informe o nome exato da campanha e do conjunto de destino.`;
      parsed.draft = null;
    }
    // O upload feito na tela vive no Storage da Orion. O publicador aceita essa
    // URL do mesmo jeito que aceita um arquivo do Drive.
    const attachment = body.creative_attachment;
    const attachmentType = String(attachment?.type || '');
    const attachmentIsCreative = Boolean(attachment?.url)
      && (attachmentType.startsWith('image/') || attachmentType.startsWith('video/'))
      && requestsAdCreation(messages);
    if (attachmentIsCreative && !selectedDriveFile && parsed.draft) {
      const ads = Array.isArray(parsed.draft.ads) && parsed.draft.ads.length ? parsed.draft.ads : [{}];
      parsed.draft = {
        ...parsed.draft,
        ads: ads.map((ad: any) => (ad?.drive_file_id || ad?.creative_id ? ad : {
          ...ad,
          upload_url: String(attachment.url),
          upload_name: String(attachment.name || 'criativo'),
          upload_mime: attachmentType,
        })),
      };
    }

    let drive: any = { configured: isGoogleDriveConfigured(), status: 'not_requested' };
    const prompt = String(last.content || '');
    const fileUrl = prompt.match(/https?:\/\/drive\.google\.com\/file\/d\/[^\s)]+/i)?.[0] || null;
    const folderUrl = prompt.match(/https?:\/\/drive\.google\.com\/drive\/folders\/[^\s)]+/i)?.[0] || null;
    const fileHint = prompt.match(/(?:criativo|anuncio|ad)\s*(?:de|numero|n[ºo]?|#|-)?\s*([a-z0-9][a-z0-9 _-]{1,50})/i)?.[1]?.trim() || null;
    if (selectedDriveFile) {
      drive = { configured: true, status: 'resolved', matches: [selectedDriveFile] };
      if (parsed.draft) {
        const ads = Array.isArray(parsed.draft.ads) && parsed.draft.ads.length ? parsed.draft.ads : [{}];
        parsed.draft = {
          ...parsed.draft,
          ads: ads.map((ad: any) => ({
            ...ad,
            drive_file_id: selectedDriveFile!.id,
            drive_file_name: selectedDriveFile!.name,
            drive_mime_type: selectedDriveFile!.mimeType,
            drive_url: selectedDriveFile!.webViewLink || null,
          })),
          drive_file: selectedDriveFile,
        };
      }
    } else if (fileUrl || folderUrl || fileHint) {
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
    const destinationSafeDraft = parsed.draft
      ? enforceExistingDestination(parsed.draft, body.tree, messages)
      : null;
    const normalizedDraft = destinationSafeDraft ? normalizeOptimizationDraft(destinationSafeDraft) : null;
    const sugestoes = (Array.isArray(parsed.sugestoes) ? parsed.sugestoes : [])
      .map((item: unknown) => String(item || '').trim().slice(0, 90))
      .filter(Boolean)
      .slice(0, 3);
    return NextResponse.json({
      success: true,
      reply: String(parsed.reply || 'Analise concluida.'),
      draft: normalizedDraft,
      creative_requests: creativeRequests,
      sugestoes,
      creative_source: normalizedDraft
        ? (selectedDriveFile ? 'drive' : attachmentIsCreative ? 'upload' : null)
        : null,
      drive_connected: drive.configured === true,
      drive,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao conversar com o Apolo.' }, { status: 500 });
  }
}
