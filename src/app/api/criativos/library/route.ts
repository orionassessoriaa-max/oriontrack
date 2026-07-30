import { NextResponse } from 'next/server';
import { requireApiUser, rateLimit, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  canUseCreativeFolder,
  getCreativeCorretorScope,
  groupCreativeFolders,
} from '@/lib/creatives/access';
import {
  createDriveFolder,
  deleteDriveFile,
  extractDriveId,
  findOrCreateDriveFolder,
  isGoogleDriveConfigured,
  listDriveChildren,
  uploadDriveFile,
  type DriveFolder,
} from '@/lib/integrations/googleDrive';
import type { ApiProfile } from '@/lib/api/security';

const BUCKET = 'criativos';
const STAFF_ROLES = ['admin', 'gestor_trafego', 'designer', 'account_manager'] as const;

type LibraryAsset = {
  id: string;
  corretor_id: string;
  titulo: string;
  descricao: string | null;
  arquivo_url: string | null;
  status: string;
  operadora: string | null;
  regiao: string | null;
  headline: string | null;
  legenda: string | null;
  created_at: string;
};

type LibraryStrategy = {
  id: string;
  corretor_id: string;
  operadora: string;
  regiao: string;
};

type ScopedDriveFolder = ReturnType<typeof groupCreativeFolders>[number] & {
  drive_folder_id: string;
  drive_web_view_link: string | null;
  drive_files_count: number;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isDriveWriteScopeError(error: unknown) {
  return /insufficient authentication scopes|insufficient.*scope|insufficientPermissions/i
    .test(errorMessage(error, ''));
}

function safeFileName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'criativo-gerado';
}

function normalizeFolderName(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function companyFolderKey(value?: string | null) {
  const ignored = new Set([
    'corretora',
    'corretora de seguros',
    'seguros',
    'seguro',
    'concessionaria',
    'assessoria',
  ]);
  const normalized = normalizeFolderName(value);
  const withoutPhrases = [...ignored]
    .sort((a, b) => b.length - a.length)
    .reduce((current, phrase) => current.replace(new RegExp(`\\b${phrase}\\b`, 'g'), ' '), normalized);
  return withoutPhrases.replace(/\s+/g, ' ').trim() || normalized;
}

async function resolveManager(
  profile: ApiProfile,
  requestedGestorId?: string | null
): Promise<{ id: string; nome: string } | null> {
  if (profile.tipo_usuario === 'gestor_trafego') {
    return { id: profile.id, nome: String(profile.nome || '').trim() };
  }
  if (profile.tipo_usuario !== 'admin' || !requestedGestorId) return null;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, nome')
    .eq('id', requestedGestorId)
    .eq('tipo_usuario', 'gestor_trafego')
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, nome: String(data.nome || '').trim() } : null;
}

function findManagerFolder(folders: DriveFolder[], managerName: string) {
  const manager = normalizeFolderName(managerName);
  const firstName = manager.split(' ')[0];
  const matches = folders.filter((folder) => {
    const name = normalizeFolderName(folder.name);
    return name === manager || name === firstName;
  });
  if (matches.length > 1) {
    throw new Error(`Mais de uma pasta foi encontrada para o gestor "${managerName}" no Google Drive.`);
  }
  return matches[0] || null;
}

async function resolveDriveLibraryScope(
  profile: ApiProfile,
  requestedGestorId?: string | null,
  options: { createMissing?: boolean } = {}
) {
  if (!isGoogleDriveConfigured()) {
    throw new Error('Google Drive nao configurado no servidor. As pastas virtuais foram desativadas.');
  }
  const rootId = extractDriveId(process.env.GOOGLE_DRIVE_FOLDER_ID);
  if (!rootId) throw new Error('GOOGLE_DRIVE_FOLDER_ID nao aponta para a pasta raiz de criativos.');

  const manager = await resolveManager(profile, requestedGestorId);
  if (!manager?.nome) throw new Error('Nao foi possivel identificar o gestor desta biblioteca.');

  const corretores = await getCreativeCorretorScope(profile, requestedGestorId);
  const assignedFolders = groupCreativeFolders(corretores);
  const root = await listDriveChildren(rootId, 1000);
  let managerFolder = findManagerFolder(root.folders, manager.nome);
  const createdFolders: string[] = [];
  let writePermissionMissing = false;
  if (!managerFolder) {
    if (!options.createMissing) {
      throw new Error(`Pasta do gestor "${manager.nome}" nao encontrada no Google Drive.`);
    }
    try {
      managerFolder = await createDriveFolder({
        parentId: rootId,
        name: normalizeFolderName(manager.nome).split(' ')[0].toUpperCase(),
      });
    } catch (error: unknown) {
      if (isDriveWriteScopeError(error)) {
        throw new Error(
          `A pasta do gestor "${manager.nome}" nao existe e a conexao atual do Google Drive permite somente leitura.`
        );
      }
      throw error;
    }
    createdFolders.push(managerFolder.name);
  }

  const managerChildren = await listDriveChildren(managerFolder.id, 1000);
  const matchedKeys = new Set<string>();
  const folders: ScopedDriveFolder[] = [];

  for (const driveFolder of managerChildren.folders) {
    const driveKey = companyFolderKey(driveFolder.name);
    const matches = assignedFolders.filter((folder) => companyFolderKey(folder.name) === driveKey);
    if (matches.length > 1) {
      throw new Error(`A pasta "${driveFolder.name}" corresponde a mais de uma concessionaria no CRM.`);
    }
    const assigned = matches[0];
    if (!assigned) continue;
    matchedKeys.add(assigned.key);
    folders.push({
      ...assigned,
      name: driveFolder.name,
      drive_folder_id: driveFolder.id,
      drive_web_view_link: driveFolder.webViewLink || null,
      drive_files_count: 0,
    });
  }

  if (options.createMissing) {
    for (const assigned of assignedFolders.filter((folder) => !matchedKeys.has(folder.key))) {
      let created: DriveFolder;
      try {
        created = await createDriveFolder({
          parentId: managerFolder.id,
          name: assigned.name,
        });
      } catch (error: unknown) {
        if (isDriveWriteScopeError(error)) {
          writePermissionMissing = true;
          break;
        }
        throw error;
      }
      matchedKeys.add(assigned.key);
      createdFolders.push(`${managerFolder.name}/${created.name}`);
      folders.push({
        ...assigned,
        name: created.name,
        drive_folder_id: created.id,
        drive_web_view_link: created.webViewLink || null,
        drive_files_count: 0,
      });
    }
  }

  return {
    corretores,
    folders: folders.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    missingFolders: assignedFolders
      .filter((folder) => !matchedKeys.has(folder.key))
      .map((folder) => folder.name),
    createdFolders,
    writePermissionMissing,
    managerFolder,
  };
}

async function ensureBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (buckets?.some((bucket) => bucket.name === BUCKET)) return;

  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 30 * 1024 * 1024,
  });
  if (error) throw error;
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...STAFF_ROLES]);
  if ('error' in guard) return guard.error;

  try {
    const url = new URL(request.url);
    const gestorId = url.searchParams.get('gestor_id');
    const driveScope = await resolveDriveLibraryScope(guard.profile, gestorId, { createMissing: true });
    const { corretores, folders } = driveScope;
    const corretorIds = corretores.map((corretor) => corretor.id);

    let assets: LibraryAsset[] = [];
    let strategies: LibraryStrategy[] = [];
    if (corretorIds.length > 0) {
      const [assetsResult, strategiesResult] = await Promise.all([
        supabaseAdmin
          .from('criativo_assets')
          .select('id, corretor_id, titulo, descricao, arquivo_url, status, operadora, regiao, headline, legenda, created_at')
          .in('corretor_id', corretorIds)
          .order('created_at', { ascending: false })
          .limit(1000),
        supabaseAdmin
          .from('trafego_estrategias_criativos')
          .select('id, corretor_id, operadora, regiao')
          .in('corretor_id', corretorIds)
          .eq('ativa', true)
          .order('created_at', { ascending: false }),
      ]);
      if (assetsResult.error) throw assetsResult.error;
      if (strategiesResult.error) throw strategiesResult.error;
      assets = assetsResult.data || [];
      strategies = strategiesResult.data || [];
    }

    return NextResponse.json({
      folders: folders.map((folder) => ({
        ...folder,
        assets: assets.filter((asset) => folder.corretor_ids.includes(asset.corretor_id)),
        strategies: strategies.filter((strategy) => folder.corretor_ids.includes(strategy.corretor_id)),
      })),
      missing_folders: driveScope.missingFolders,
      created_folders: driveScope.createdFolders,
      drive_write_permission_missing: driveScope.writePermissionMissing,
      manager_drive_folder: {
        id: driveScope.managerFolder.id,
        name: driveScope.managerFolder.name,
        web_view_link: driveScope.managerFolder.webViewLink || null,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error, 'Erro ao carregar as pastas de criativos.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, [...STAFF_ROLES]);
  if ('error' in guard) return guard.error;

  const limited = rateLimit(request, 'criativos:library:save', {
    limit: 20,
    windowMs: 10 * 60_000,
    key: guard.profile.id,
  });
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => ({}));
    const corretorId = String(body.corretor_id || '').trim();
    const gestorId = String(body.gestor_id || '').trim() || null;
    const driveFolderId = extractDriveId(String(body.drive_folder_id || ''));
    const titulo = String(body.titulo || '').trim().slice(0, 160);
    const prompt = String(body.prompt || '').trim().slice(0, 4000);
    const operadora = String(body.operadora || '').trim().slice(0, 120);
    const regiao = String(body.regiao || '').trim().slice(0, 120);
    const imageDataUrl = String(body.image_data_url || '');

    if (!corretorId || !driveFolderId || !titulo || !imageDataUrl || !operadora || !regiao) {
      return NextResponse.json({ error: 'Informe a concessionaria, a regiao, a operadora, o nome e a imagem gerada.' }, { status: 400 });
    }
    if (!(await canUseCreativeFolder(guard.profile, corretorId, gestorId))) {
      return NextResponse.json({ error: 'Esta pasta nao pertence ao escopo deste gestor.' }, { status: 403 });
    }

    const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/);
    if (!match) {
      return NextResponse.json({ error: 'Formato da imagem gerada invalido.' }, { status: 400 });
    }

    const contentType = match[1];
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'A imagem deve ter no maximo 20 MB.' }, { status: 400 });
    }

    const driveScope = await resolveDriveLibraryScope(guard.profile, gestorId);
    const destination = driveScope.folders.find(
      (folder) => folder.id === corretorId && folder.drive_folder_id === driveFolderId
    );
    if (!destination) {
      return NextResponse.json({
        error: 'A pasta fisica da concessionaria nao foi encontrada no Google Drive deste gestor.',
      }, { status: 404 });
    }

    await ensureBucket();
    const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1];
    const fileName = `${safeFileName(titulo)}.${extension}`;
    const path = `${corretorId}/gerados-por-ia/${Date.now()}-${fileName}`;
    const regionFolder = await findOrCreateDriveFolder({
      parentId: destination.drive_folder_id,
      name: regiao,
    });
    const operatorFolder = await findOrCreateDriveFolder({
      parentId: regionFolder.id,
      name: operadora,
    });
    const driveFile = await uploadDriveFile({
      folderId: operatorFolder.id,
      name: fileName,
      mimeType: contentType,
      bytes,
    });
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (uploadError) {
      await deleteDriveFile(driveFile.id).catch(() => undefined);
      throw uploadError;
    }

    const publicUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const { data: asset, error: insertError } = await supabaseAdmin
      .from('criativo_assets')
      .insert([{
        corretor_id: corretorId,
        titulo,
        descricao: prompt ? `Gerado por IA. Prompt: ${prompt}` : 'Gerado por IA no Orion Track.',
        arquivo_url: publicUrl,
        arquivo_path: path,
        status: 'rascunho',
        enviado_por_profile_id: guard.profile.id,
        operadora,
        regiao,
        drive_file_id: driveFile.id,
        drive_folder_id: operatorFolder.id,
      }])
      .select('id, corretor_id, titulo, descricao, arquivo_url, status, created_at')
      .single();
    if (insertError) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      await deleteDriveFile(driveFile.id).catch(() => undefined);
      throw insertError;
    }

    await writeAuditLog(request, guard.profile, {
      action: 'creative.ai.save',
      entity_type: 'criativo_asset',
      entity_id: asset.id,
      metadata: {
        corretor_id: corretorId,
        drive_folder_id: operatorFolder.id,
        drive_file_id: driveFile.id,
        model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
      },
    });

    return NextResponse.json({ ok: true, asset, drive_file: driveFile });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error, 'Erro ao salvar o criativo na pasta.') }, { status: 500 });
  }
}
