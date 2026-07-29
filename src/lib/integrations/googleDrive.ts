const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  modifiedTime?: string;
  thumbnailLink?: string;
};

export type DriveFolder = DriveFile;

export function isGoogleDriveConfigured() {
  return Boolean(
    process.env.GOOGLE_DRIVE_ACCESS_TOKEN ||
      (process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET && process.env.GOOGLE_DRIVE_REFRESH_TOKEN)
  );
}

function requiredConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Drive nao configurado. Defina GOOGLE_DRIVE_ACCESS_TOKEN ou as credenciais OAuth do Drive.');
  }
  return { clientId, clientSecret, refreshToken };
}

async function accessToken() {
  if (process.env.GOOGLE_DRIVE_ACCESS_TOKEN) return process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  const config = requiredConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || 'Nao foi possivel renovar o acesso ao Google Drive.');
  }
  return String(payload.access_token);
}

export function extractDriveId(value?: string | null) {
  const input = String(value || '').trim();
  if (!input) return null;
  const match = input.match(/(?:folders|file\/d)\/([a-zA-Z0-9_-]+)/) || input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match?.[1] || (input.match(/^[a-zA-Z0-9_-]{10,}$/)?.[0] ?? null);
}

async function driveFetch(path: string, init?: RequestInit) {
  const token = await accessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Google Drive recusou a requisicao (${response.status}).`);
  return payload;
}

export async function searchDriveFiles(options: { query?: string; folderId?: string | null; pageSize?: number }) {
  const folderId = options.folderId || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
  const terms = String(options.query || '').trim().replace(/'/g, "\\'");
  const clauses = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];
  if (folderId) clauses.push(`'${folderId}' in parents`);
  if (terms) clauses.push(`name contains '${terms}'`);
  const params = new URLSearchParams({
    q: clauses.join(' and '),
    pageSize: String(Math.min(Math.max(options.pageSize || 50, 1), 100)),
    fields: 'files(id,name,mimeType,size,webViewLink,parents),nextPageToken',
    orderBy: 'name',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  return (await driveFetch(`files?${params.toString()}`)).files as DriveFile[] || [];
}

export async function listDriveChildren(folderId?: string | null, pageSize = 100) {
  const parentId = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
  if (!parentId) throw new Error('Defina GOOGLE_DRIVE_FOLDER_ID com a pasta Criativos Orion.');
  const clauses = ["trashed = false", `'${parentId}' in parents`];
  const params = new URLSearchParams({
    q: clauses.join(' and '),
    pageSize: String(Math.min(Math.max(pageSize, 1), 1000)),
    fields: 'files(id,name,mimeType,size,webViewLink,parents,modifiedTime,thumbnailLink),nextPageToken',
    orderBy: 'folder,name',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const files = (await driveFetch(`files?${params.toString()}`)).files as DriveFile[] || [];
  return {
    folders: files.filter((file) => file.mimeType === 'application/vnd.google-apps.folder') as DriveFolder[],
    files: files.filter((file) => file.mimeType !== 'application/vnd.google-apps.folder'),
  };
}

export async function getDriveFile(fileId: string) {
  const normalizedId = extractDriveId(fileId);
  if (!normalizedId) {
    throw new Error('ID do arquivo ou da pasta do Google Drive vazio ou invalido.');
  }
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,size,webViewLink,parents,modifiedTime,thumbnailLink',
    supportsAllDrives: 'true',
  });
  return (await driveFetch(`files/${encodeURIComponent(normalizedId)}?${params.toString()}`)) as DriveFile;
}

export async function downloadDriveFile(fileId: string) {
  const normalizedId = extractDriveId(fileId);
  if (!normalizedId) {
    throw new Error('ID do criativo do Google Drive vazio ou invalido.');
  }
  const token = await accessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(normalizedId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Nao foi possivel baixar o criativo do Drive (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export async function resolveDriveFile(options: { fileId?: string | null; fileName?: string | null; folderId?: string | null }) {
  if (!isGoogleDriveConfigured()) return { configured: false, file: [] as DriveFile[] };
  if (options.fileId) return { configured: true, file: [await getDriveFile(options.fileId)] };
  const files = await searchDriveFiles({ query: options.fileName || '', folderId: options.folderId });
  return { configured: true, file: files };
}
