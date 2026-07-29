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

export type ResolvedCreativeFile = {
  file: DriveFile;
  brokerageFolder: DriveFolder;
  path: DriveFolder[];
  region: string | null;
};

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const BRAZILIAN_REGIONS = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapa'], ['AM', 'Amazonas'],
  ['BA', 'Bahia'], ['CE', 'Ceara'], ['DF', 'Distrito Federal'],
  ['ES', 'Espirito Santo'], ['GO', 'Goias'], ['MA', 'Maranhao'],
  ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'],
  ['PA', 'Para'], ['PB', 'Paraiba'], ['PR', 'Parana'], ['PE', 'Pernambuco'],
  ['PI', 'Piaui'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondonia'], ['RR', 'Roraima'],
  ['SC', 'Santa Catarina'], ['SP', 'Sao Paulo'], ['SE', 'Sergipe'],
  ['TO', 'Tocantins'],
] as const;

function normalizeDriveName(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function meaningfulTokens(value?: string | null) {
  const ignored = new Set([
    'conjunto', 'adset', 'anuncio', 'campanha', 'criativo', 'orion',
    'sp', 'df', 'sao', 'paulo', 'distrito', 'federal',
  ]);
  return normalizeDriveName(value).split(' ').filter((token) => token.length > 1 && !ignored.has(token));
}

function nameScore(expected?: string | null, actual?: string | null) {
  const left = normalizeDriveName(expected);
  const right = normalizeDriveName(actual);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.9;
  const expectedTokens = meaningfulTokens(expected);
  if (!expectedTokens.length) return 0;
  const actualTokens = new Set(meaningfulTokens(actual));
  return expectedTokens.filter((token) => actualTokens.has(token)).length / expectedTokens.length;
}

export function regionFromAdsetName(value: string): string | null {
  const normalized = ` ${normalizeDriveName(value)} `;
  const aliases = BRAZILIAN_REGIONS
    .flatMap(([uf, name]) => [
      { uf, alias: normalizeDriveName(name) },
      { uf, alias: normalizeDriveName(uf) },
    ])
    .sort((a, b) => b.alias.length - a.alias.length);
  return aliases.find(({ alias }) => normalized.includes(` ${alias} `))?.uf || null;
}

function pathHasRegion(path: DriveFolder[], region: string) {
  const normalizedRegion = normalizeDriveName(region);
  const knownRegion = BRAZILIAN_REGIONS.find(
    ([uf, name]) => normalizeDriveName(uf) === normalizedRegion || normalizeDriveName(name) === normalizedRegion
  );
  const acceptedNames = new Set(
    knownRegion
      ? [normalizeDriveName(knownRegion[0]), normalizeDriveName(knownRegion[1])]
      : [normalizedRegion]
  );
  return path.some((folder) => acceptedNames.has(normalizeDriveName(folder.name)));
}

function isSupportedCreative(file: DriveFile) {
  return file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/');
}

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
    folders: files.filter((file) => file.mimeType === DRIVE_FOLDER_MIME) as DriveFolder[],
    files: files.filter((file) => file.mimeType !== DRIVE_FOLDER_MIME),
  };
}

/**
 * Busca dentro da pasta da corretora e usa a identificação do conjunto.
 * Se o nome do conjunto indicar uma UF, somente considera arquivos na região.
 */
export async function resolveCreativeForAdset(options: {
  brokerageName: string;
  adsetName: string;
  region?: string | null;
  rootFolderId?: string | null;
  maxDepth?: number;
  mediaKind?: 'image' | 'video' | null;
}): Promise<ResolvedCreativeFile> {
  const rootId = options.rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
  if (!rootId) throw new Error('GOOGLE_DRIVE_FOLDER_ID nao configurado com a pasta raiz de criativos.');

  let root: Awaited<ReturnType<typeof listDriveChildren>>;
  try {
    root = await listDriveChildren(rootId, 1000);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/file not found/i.test(message)) {
      throw new Error('Pasta raiz de criativos nao encontrada no Google Drive.');
    }
    throw error;
  }

  const expectedBrokerageName = normalizeDriveName(options.brokerageName);
  if (!expectedBrokerageName) {
    throw new Error('Nome da concessionaria vazio; pasta nao encontrada no Google Drive.');
  }
  let brokerageMatches: Array<{ folder: DriveFolder; parentPath: DriveFolder[] }> = [];
  const brokerageSearchDepth = 4;
  let brokerageLevel = root.folders.map((folder) => ({ folder, parentPath: [] as DriveFolder[] }));
  for (let depth = 1; depth <= brokerageSearchDepth && brokerageLevel.length; depth += 1) {
    brokerageMatches = brokerageLevel.filter(
      ({ folder }) => normalizeDriveName(folder.name) === expectedBrokerageName
    );
    if (brokerageMatches.length > 0 || depth === brokerageSearchDepth) break;

    const nested = await Promise.all(brokerageLevel.map(async ({ folder, parentPath }) => {
      const children = await listDriveChildren(folder.id, 1000);
      return children.folders.map((child) => ({
        folder: child,
        parentPath: [...parentPath, folder],
      }));
    }));
    brokerageLevel = nested.flat();
  }
  if (brokerageMatches.length === 0) {
    throw new Error(`Pasta da concessionaria "${options.brokerageName}" nao encontrada no Google Drive.`);
  }
  if (brokerageMatches.length > 1) {
    throw new Error(`Mais de uma pasta com o nome da concessionaria "${options.brokerageName}" foi encontrada no Google Drive.`);
  }
  const brokerageFolder = brokerageMatches[0].folder;

  const candidates: Array<{ file: DriveFile; path: DriveFolder[]; score: number }> = [];
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 5, 1), 8);

  async function walk(folder: DriveFolder, path: DriveFolder[], depth: number): Promise<void> {
    const children = await listDriveChildren(folder.id, 1000);
    const currentPath = [...path, folder];
    const pathScore = Math.max(...currentPath.map((item) => nameScore(options.adsetName, item.name)));

    children.files
      .filter((file) => isSupportedCreative(file) && (
        !options.mediaKind || file.mimeType.startsWith(`${options.mediaKind}/`)
      ))
      .forEach((file) => candidates.push({
        file,
        path: currentPath,
        score: Math.max(pathScore, nameScore(options.adsetName, file.name) * 0.8),
      }));

    if (depth >= maxDepth) return;
    await Promise.all(children.folders.map((child) => walk(child, currentPath, depth + 1)));
  }

  await walk(brokerageFolder, [], 1);
  const regionalCandidates = options.region
    ? candidates.filter((candidate) => pathHasRegion(candidate.path, options.region!))
    : candidates;

  if (options.region && regionalCandidates.length === 0) {
    throw new Error(`Pasta ${options.region} da concessionaria "${options.brokerageName}" nao encontrada ou sem criativo compativel.`);
  }

  const selected = regionalCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.file.modifiedTime || '').localeCompare(String(a.file.modifiedTime || ''));
  })[0];

  if (!selected || selected.score < 0.35) {
    throw new Error(`Pasta compativel com o conjunto "${options.adsetName}" nao encontrada dentro de "${brokerageFolder.name}".`);
  }

  return {
    file: selected.file,
    brokerageFolder,
    path: selected.path,
    region: options.region || null,
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
