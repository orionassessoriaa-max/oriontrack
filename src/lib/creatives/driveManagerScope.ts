import type { ApiProfile } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  extractDriveId,
  getDriveFile,
  listDriveChildren,
  type DriveFolder,
} from '@/lib/integrations/googleDrive';

function normalizeName(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function resolveManager(actor: ApiProfile, requestedManagerId?: string | null) {
  if (actor.tipo_usuario === 'gestor_trafego') {
    return { id: actor.id, nome: String(actor.nome || '').trim() };
  }
  if (actor.tipo_usuario !== 'admin' || !requestedManagerId) return null;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id,nome')
    .eq('id', requestedManagerId)
    .eq('tipo_usuario', 'gestor_trafego')
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, nome: String(data.nome || '').trim() } : null;
}

function findManagerFolder(folders: DriveFolder[], managerName: string) {
  const normalizedManager = normalizeName(managerName);
  const firstName = normalizedManager.split(' ')[0];
  const matches = folders.filter((folder) => {
    const folderName = normalizeName(folder.name);
    return folderName === normalizedManager || folderName === firstName;
  });
  if (matches.length > 1) {
    throw new Error(`Mais de uma pasta foi encontrada para o gestor "${managerName}".`);
  }
  return matches[0] || null;
}

export async function resolveManagerDriveScope(actor: ApiProfile, requestedManagerId?: string | null) {
  const configuredRootId = extractDriveId(process.env.GOOGLE_DRIVE_FOLDER_ID);
  if (!configuredRootId) throw new Error('GOOGLE_DRIVE_FOLDER_ID nao configurado.');

  const manager = await resolveManager(actor, requestedManagerId);
  if (!manager?.nome) throw new Error('Nao foi possivel identificar o gestor desta biblioteca.');

  const root = await listDriveChildren(configuredRootId, 1000);
  const managerFolder = findManagerFolder(root.folders, manager.nome);
  if (!managerFolder) {
    throw new Error(`Pasta do gestor "${manager.nome}" nao encontrada no Google Drive.`);
  }
  return { manager, managerFolder };
}

export async function isDriveItemInsideFolder(itemId: string, allowedRootId: string) {
  let currentId = extractDriveId(itemId);
  const rootId = extractDriveId(allowedRootId);
  if (!currentId || !rootId) return false;

  for (let depth = 0; depth < 10 && currentId; depth += 1) {
    if (currentId === rootId) return true;
    const current = await getDriveFile(currentId);
    currentId = extractDriveId(current.parents?.[0]);
  }
  return false;
}
