import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  extractDriveId,
  findOrCreateDriveFolder,
  uploadDriveFile,
} from '@/lib/integrations/googleDrive';

const BUCKET = 'criativos';

type JobRow = {
  id: string;
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
          content: `Crie variacoes de anuncios de plano de saude em portugues do Brasil.
Cada variacao deve usar um angulo diferente. Nao invente preco, desconto, cobertura, carencia, rede, telefone ou promessa.
Headline curta, legenda persuasiva e responsavel, e visual_prompt descrevendo apenas a direcao visual.
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

async function generateImage(job: JobRow, variation: CopyVariation, reference: Awaited<ReturnType<typeof fetchReference>>) {
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
${reference ? 'Use a imagem enviada como referencia de composicao, sem copiar marcas ou informacoes nao confirmadas.' : ''}`;
  let response: Response;
  if (reference) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    form.append('quality', 'medium');
    form.append('output_format', 'png');
    form.append('image[]', new Blob([Uint8Array.from(reference.bytes).buffer as ArrayBuffer], { type: reference.contentType }), 'referencia.png');
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

async function resolveFolderPath(job: JobRow) {
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

export async function ensureConcessionariaDriveFolder(corretorId: string, gestorId?: string | null) {
  const rootId = extractDriveId(process.env.GOOGLE_DRIVE_FOLDER_ID);
  if (!rootId) throw new Error('GOOGLE_DRIVE_FOLDER_ID nao configurado.');
  const { data: corretor, error: corretorError } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa, gestor_trafego_id')
    .eq('id', corretorId)
    .maybeSingle();
  if (corretorError) throw corretorError;
  if (!corretor) throw new Error('Concessionaria nao encontrada.');
  const resolvedGestorId = gestorId || corretor.gestor_trafego_id;
  if (!resolvedGestorId) return null;
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
    .select('id, corretor_id, gestor_id, operadora, regiao, quantidade, briefing, referencia_url, origem')
    .maybeSingle();
  if (claimError || !claimed) return;
  const job = claimed as JobRow;
  try {
    await ensureBucket();
    const [folderPath, variations, reference] = await Promise.all([
      resolveFolderPath(job),
      generateCopies(job),
      fetchReference(job.referencia_url),
    ]);
    const results: Array<Record<string, unknown>> = [];
    for (let index = 0; index < job.quantidade; index += 1) {
      const variation = variations[index] || fallbackCopies(job)[index % 4];
      const bytes = await generateImage(job, variation, reference);
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
      .eq('id', job.id);
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
