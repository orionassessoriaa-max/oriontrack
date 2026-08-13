import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  extractDriveId,
  findOrCreateDriveFolder,
  uploadDriveFile,
} from '@/lib/integrations/googleDrive';
import { creativeOperatorProfile } from '@/lib/creatives/operatorPrompts';

const BUCKET = 'criativos';

type JobRow = {
  id: string;
  estrategia_id?: string | null;
  corretor_id: string;
  gestor_id: string;
  operadora: string;
  regiao: string;
  quantidade: number;
  briefing: string | null;
  referencia_url: string | null;
  origem: string;
};

type CopyVariation = {
  angle: string;
  headline: string;
  legenda: string;
  visual_prompt: string;
};

function safeName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'criativo';
}

async function ensureBucket() {
  const { data } = await supabaseAdmin.storage.listBuckets();
  if (data?.some((bucket) => bucket.name === BUCKET)) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 30 * 1024 * 1024,
  });
  if (error) throw error;
}

function fallbackCopies(job: JobRow): CopyVariation[] {
  const base = `${job.operadora} em ${job.regiao}`;
  const profile = creativeOperatorProfile(job.operadora);
  if (profile === 'medsenior_49') {
    return [
      { angle: 'economia', headline: 'Cuide-se pagando melhor', legenda: `Compare opções ${base} para pessoas a partir de 49 anos.`, visual_prompt: 'adultos brasileiros maduros e ativos, visual premium, limpo e acolhedor' },
      { angle: 'comparacao', headline: 'Seu plano pode caber melhor', legenda: `Veja alternativas ${base} para o público 49+ com orientação especializada.`, visual_prompt: 'casal maduro brasileiro em ambiente moderno, composição clara e confiável' },
      { angle: 'cuidado', headline: 'Cuidado para a sua fase', legenda: `Conheça possibilidades ${base} a partir de 49 anos e compare seu plano atual.`, visual_prompt: 'mulher brasileira madura e ativa, luz natural, tipografia grande, poucos elementos' },
      { angle: 'consultoria', headline: 'Compare antes de decidir', legenda: `Converse com um especialista sobre opções ${base} para pessoas 49+.`, visual_prompt: 'atendimento consultivo a pessoa madura, composição minimalista e humana' },
    ];
  }
  const minimumLives = profile === 'amil_2_vidas' ? 2 : profile === 'empresarial_3_vidas' ? 3 : null;
  if (minimumLives) {
    return [
      { angle: 'reducao', headline: `CNPJ a partir de ${minimumLives} vidas`, legenda: `Compare seu plano empresarial ${base} e verifique oportunidades de redução.`, visual_prompt: 'equipe de pequena empresa brasileira, composição premium, limpa e corporativa' },
      { angle: 'economia', headline: 'Sua empresa pode pagar melhor', legenda: `Para CNPJ ou MEI a partir de ${minimumLives} vidas. Compare opções ${base}.`, visual_prompt: 'empreendedores brasileiros em escritório contemporâneo, poucos elementos' },
      { angle: 'comparacao', headline: 'Compare o plano da empresa', legenda: `Conheça alternativas ${base} para CNPJ a partir de ${minimumLives} vidas.`, visual_prompt: 'gestor analisando custos com equipe, visual claro e profissional' },
      { angle: 'consultoria', headline: 'Reduza custos com estratégia', legenda: `Solicite uma análise para CNPJ ou MEI a partir de ${minimumLives} vidas.`, visual_prompt: 'consultoria empresarial brasileira, fundo limpo, tipografia de alto contraste' },
    ];
  }
  return [
    { angle: 'seguranca', headline: `Protecao para sua rotina`, legenda: `Conheca as possibilidades de ${base} e converse com um especialista.`, visual_prompt: 'familia brasileira em momento cotidiano, atmosfera de seguranca e acolhimento' },
    { angle: 'praticidade', headline: `Cuidado sem complicacao`, legenda: `Veja como encontrar uma opcao de ${base} adequada ao seu momento.`, visual_prompt: 'pessoa usando celular com tranquilidade, composicao limpa e moderna' },
    { angle: 'planejamento', headline: `Planeje seu cuidado`, legenda: `Compare alternativas de ${base} com orientacao especializada.`, visual_prompt: 'casal planejando o futuro em casa, luz natural, tom confiavel' },
    { angle: 'atendimento', headline: `Conte com orientacao`, legenda: `Tire suas duvidas sobre ${base} com atendimento consultivo.`, visual_prompt: 'consultora brasileira atendendo cliente, ambiente profissional e humano' },
  ];
}

async function generateCopies(job: JobRow): Promise<CopyVariation[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackCopies(job).slice(0, job.quantidade);
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ORION_TRAFFIC_AI_MODEL || 'gpt-4o-mini',
      temperature: 0.8,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Crie variações de anúncios de plano de saúde em português do Brasil.
Cada variação deve usar um ângulo diferente e obedecer integralmente ao briefing, inclusive idade, CNPJ e quantidade mínima de vidas.
Não invente preço, percentual de economia, cobertura, carência, rede, telefone ou promessa.
Use headline curta, no máximo uma linha curta de apoio, legenda persuasiva e responsável e visual_prompt descrevendo uma composição limpa com poucos elementos.
O criativo deve qualificar o lead antes do clique. Não esconda nem flexibilize os requisitos obrigatórios do briefing.
Retorne JSON: {"variations":[{"angle":"","headline":"","legenda":"","visual_prompt":""}]}.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            operadora: job.operadora,
            regiao: job.regiao,
            quantidade: job.quantidade,
            briefing: job.briefing,
          }),
        },
      ],
    }),
  });
  if (!response.ok) return fallbackCopies(job).slice(0, job.quantidade);
  const payload = await response.json().catch(() => ({}));
  try {
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
    const variations = Array.isArray(parsed.variations) ? parsed.variations : [];
    const valid = variations
      .map((item: Record<string, unknown>) => ({
        angle: String(item.angle || '').trim(),
        headline: String(item.headline || '').trim(),
        legenda: String(item.legenda || '').trim(),
        visual_prompt: String(item.visual_prompt || '').trim(),
      }))
      .filter((item: CopyVariation) => item.headline && item.legenda && item.visual_prompt);
    if (valid.length >= job.quantidade) return valid.slice(0, job.quantidade);
  } catch { /* fallback below */ }
  return fallbackCopies(job).slice(0, job.quantidade);
}

function parseReferenceUrls(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5);
  } catch { /* A single legacy URL is handled below. */ }
  return [value];
}

async function fetchReference(url?: string | null) {
  if (!url || !url.startsWith('http')) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Nao foi possivel baixar a imagem de referencia.');
  const contentType = response.headers.get('content-type') || '';
  if (!/^image\/(png|jpeg|webp)/.test(contentType)) {
    throw new Error('A referencia deve ser PNG, JPG ou WebP.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('A referencia deve ter no maximo 10 MB.');
  return { bytes, contentType };
}

async function fetchReferences(value?: string | null) {
  return (await Promise.all(parseReferenceUrls(value).map((url) => fetchReference(url))))
    .filter((reference): reference is NonNullable<Awaited<ReturnType<typeof fetchReference>>> => Boolean(reference));
}

async function generateImage(job: JobRow, variation: CopyVariation, references: Awaited<ReturnType<typeof fetchReferences>>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada.');
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
  const prompt = `Crie uma arte publicitaria premium para redes sociais, formato quadrado 1:1.
Operadora: ${job.operadora}. Regiao: ${job.regiao}. Angulo: ${variation.angle}.
Headline visivel: "${variation.headline}".
Direcao visual: ${variation.visual_prompt}.
Briefing adicional: ${job.briefing || 'nenhum'}.
Nao inclua preco, desconto, telefone, carencia, rede, cobertura ou promessa nao fornecida.
Texto em portugues do Brasil, ortografia revisada, leitura clara no celular, sem mockup e sem marca d'agua.
${references.length ? `Use as ${references.length} imagens enviadas como referencias de composicao, combinando apenas elementos coerentes e sem copiar marcas ou informacoes nao confirmadas.` : ''}`;
  let response: Response;
  if (references.length) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    form.append('quality', 'medium');
    form.append('output_format', 'png');
    references.forEach((reference, index) => {
      const extension = reference.contentType === 'image/jpeg' ? 'jpg' : reference.contentType.split('/')[1];
      form.append('image[]', new Blob([Uint8Array.from(reference.bytes).buffer as ArrayBuffer], { type: reference.contentType }), `referencia-${index + 1}.${extension}`);
    });
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1024x1024', quality: 'medium', output_format: 'png' }),
    });
  }
  const payload = await response.json().catch(() => ({}));
  const base64 = payload.data?.[0]?.b64_json;
  if (!response.ok || !base64) throw new Error(payload.error?.message || 'A IA nao retornou a imagem.');
  return Buffer.from(base64, 'base64');
}

type FolderPathInput = Pick<JobRow, 'corretor_id' | 'gestor_id' | 'operadora' | 'regiao'>;

async function resolveFolderPath(job: FolderPathInput) {
  const rootId = extractDriveId(process.env.GOOGLE_DRIVE_FOLDER_ID);
  if (!rootId) throw new Error('GOOGLE_DRIVE_FOLDER_ID nao configurado.');
  const [{ data: corretor, error: corretorError }, { data: gestor, error: gestorError }] = await Promise.all([
    supabaseAdmin.from('corretores').select('id, nome, nome_empresa').eq('id', job.corretor_id).maybeSingle(),
    supabaseAdmin.from('profiles').select('id, nome').eq('id', job.gestor_id).maybeSingle(),
  ]);
  if (corretorError) throw corretorError;
  if (gestorError) throw gestorError;
  if (!corretor || !gestor) throw new Error('Gestor ou concessionaria nao encontrada.');
  const gestorName = String(gestor.nome || 'GESTOR').trim().split(/\s+/)[0].toUpperCase();
  const concessionariaName = String(corretor.nome_empresa || corretor.nome).trim();
  const gestorFolder = await findOrCreateDriveFolder({ parentId: rootId, name: gestorName });
  const concessionariaFolder = await findOrCreateDriveFolder({ parentId: gestorFolder.id, name: concessionariaName });
  const regionFolder = await findOrCreateDriveFolder({ parentId: concessionariaFolder.id, name: job.regiao });
  const operatorFolder = await findOrCreateDriveFolder({ parentId: regionFolder.id, name: job.operadora });
  return { gestorFolder, concessionariaFolder, regionFolder, operatorFolder, concessionariaName };
}

export async function ensureCreativeStrategyFolder(input: {
  strategyId: string;
  corretorId: string;
  gestorId: string;
  operadora: string;
  regiao: string;
}) {
  const folders = await resolveFolderPath({
    corretor_id: input.corretorId,
    gestor_id: input.gestorId,
    operadora: input.operadora,
    regiao: input.regiao,
  });
  const { error } = await supabaseAdmin
    .from('trafego_estrategias_criativos')
    .update({
      drive_gestor_folder_id: folders.gestorFolder.id,
      drive_concessionaria_folder_id: folders.concessionariaFolder.id,
      drive_regiao_folder_id: folders.regionFolder.id,
      drive_operadora_folder_id: folders.operatorFolder.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.strategyId);
  if (error) throw error;
  return folders;
}

export async function ensureConcessionariaDriveFolder(corretorId: string, gestorId?: string | null) {
  const rootId = extractDriveId(process.env.GOOGLE_DRIVE_FOLDER_ID);
  if (!rootId) throw new Error('GOOGLE_DRIVE_FOLDER_ID nao configurado.');
  const { data: corretor, error: corretorError } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, gestor_trafego_id, time_operacional')
    .eq('id', corretorId)
    .maybeSingle();
  if (corretorError) throw corretorError;
  if (!corretor) throw new Error('Concessionaria nao encontrada.');
  const teamManager = Array.isArray(corretor.time_operacional)
    ? corretor.time_operacional.find((member: Record<string, unknown>) => {
        const role = String(member?.tipo_usuario || '').trim().toLowerCase();
        const position = String(member?.cargo || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();
        return role === 'gestor_trafego' || position.includes('gestor de trafego');
      })
    : null;
  const resolvedGestorId = gestorId || corretor.gestor_trafego_id || String(teamManager?.profile_id || '').trim() || null;
  if (!resolvedGestorId) return null;
  if (!corretor.gestor_trafego_id) {
    await supabaseAdmin
      .from('corretores')
      .update({ gestor_trafego_id: resolvedGestorId })
      .eq('id', corretor.id);
  }
  const { data: gestor, error: gestorError } = await supabaseAdmin
    .from('profiles')
    .select('id, nome')
    .eq('id', resolvedGestorId)
    .maybeSingle();
  if (gestorError) throw gestorError;
  if (!gestor) return null;
  const gestorName = String(gestor.nome || 'GESTOR').trim().split(/\s+/)[0].toUpperCase();
  const concessionariaName = String(corretor.nome_empresa || corretor.nome).trim();
  const gestorFolder = await findOrCreateDriveFolder({ parentId: rootId, name: gestorName });
  const concessionariaFolder = await findOrCreateDriveFolder({ parentId: gestorFolder.id, name: concessionariaName });
  return { gestorFolder, concessionariaFolder };
}

export async function processCreativeGenerationJob(jobId: string) {
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('criativo_generation_jobs')
    .update({ status: 'gerando', started_at: new Date().toISOString(), erro: null, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'na_fila')
    .select('id, corretor_id, gestor_id, estrategia_id, operadora, regiao, quantidade, briefing, referencia_url, origem')
    .maybeSingle();
  if (claimError || !claimed) return;
  const job = claimed as JobRow;
  try {
    await ensureBucket();
    const [folderPath, variations, references] = await Promise.all([
      resolveFolderPath(job),
      generateCopies(job),
      fetchReferences(job.referencia_url),
    ]);
    if (job.estrategia_id) {
      await supabaseAdmin
        .from('trafego_estrategias_criativos')
        .update({
          drive_gestor_folder_id: folderPath.gestorFolder.id,
          drive_concessionaria_folder_id: folderPath.concessionariaFolder.id,
          drive_regiao_folder_id: folderPath.regionFolder.id,
          drive_operadora_folder_id: folderPath.operatorFolder.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.estrategia_id);
    }
    const results: Array<Record<string, unknown>> = [];
    for (let index = 0; index < job.quantidade; index += 1) {
      const { data: currentJob } = await supabaseAdmin
        .from('criativo_generation_jobs')
        .select('status')
        .eq('id', job.id)
        .maybeSingle();
      if (currentJob?.status === 'cancelado') return;

      const variation = variations[index] || fallbackCopies(job)[index % 4];
      const bytes = await generateImage(job, variation, references);
      const { data: jobAfterGeneration } = await supabaseAdmin
        .from('criativo_generation_jobs')
        .select('status')
        .eq('id', job.id)
        .maybeSingle();
      if (jobAfterGeneration?.status === 'cancelado') return;

      const fileName = `${safeName(job.operadora)}-${safeName(job.regiao)}-${String(index + 1).padStart(2, '0')}.png`;
      const storagePath = `${job.corretor_id}/${safeName(job.regiao)}/${safeName(job.operadora)}/${Date.now()}-${fileName}`;
      const driveFile = await uploadDriveFile({
        folderId: folderPath.operatorFolder.id,
        name: fileName,
        mimeType: 'image/png',
        bytes,
      });
      const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, bytes, {
        contentType: 'image/png',
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const publicUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
      const { data: asset, error: assetError } = await supabaseAdmin
        .from('criativo_assets')
        .insert({
          corretor_id: job.corretor_id,
          titulo: `${job.operadora} ${job.regiao} | ${variation.angle || `Angulo ${index + 1}`}`,
          descricao: job.briefing || `Gerado automaticamente para ${job.operadora}/${job.regiao}.`,
          arquivo_url: publicUrl,
          arquivo_path: storagePath,
          status: 'rascunho',
          enviado_por_profile_id: job.gestor_id,
          generation_job_id: job.id,
          operadora: job.operadora,
          regiao: job.regiao,
          headline: variation.headline,
          legenda: variation.legenda,
          drive_file_id: driveFile.id,
          drive_folder_id: folderPath.operatorFolder.id,
        })
        .select('id')
        .single();
      if (assetError) throw assetError;
      results.push({
        asset_id: asset.id,
        drive_file_id: driveFile.id,
        arquivo_url: publicUrl,
        headline: variation.headline,
        legenda: variation.legenda,
        angle: variation.angle,
      });
      await supabaseAdmin
        .from('criativo_generation_jobs')
        .update({ progresso: index + 1, resultado: results, updated_at: new Date().toISOString() })
        .eq('id', job.id);
    }
    const finishedAt = new Date().toISOString();
    await supabaseAdmin
      .from('criativo_generation_jobs')
      .update({ status: 'pronto', progresso: results.length, resultado: results, finished_at: finishedAt, updated_at: finishedAt })
      .eq('id', job.id)
      .eq('status', 'gerando');
    await supabaseAdmin.from('notificacoes').insert({
      titulo: 'Criativos prontos',
      mensagem: `${results.length} criativos de ${job.operadora}/${job.regiao} foram gerados para revisao.`,
      destinatario_profile_id: job.gestor_id,
      destinatario_tipo: 'gestor_trafego',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Falha ao gerar criativos.';
    const finishedAt = new Date().toISOString();
    await supabaseAdmin
      .from('criativo_generation_jobs')
      .update({ status: 'falhou', erro: message, finished_at: finishedAt, updated_at: finishedAt })
      .eq('id', job.id);
    await supabaseAdmin.from('notificacoes').insert({
      titulo: 'Falha ao gerar criativos',
      mensagem: `${job.operadora}/${job.regiao}: ${message}`,
      destinatario_profile_id: job.gestor_id,
      destinatario_tipo: 'gestor_trafego',
    });
  }
}
