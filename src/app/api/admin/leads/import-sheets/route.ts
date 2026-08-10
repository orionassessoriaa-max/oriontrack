import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { LEAD_STATUSES, normalizeLeadStatus } from '@/lib/leadStatus';
import { buildLeadImportWarningNote } from '@/lib/leadWarnings';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { buildLeadContactKey, buildLeadDuplicateKey, buildLeadIdentityKey } from '@/lib/leadDuplicate';
import { isMissingLeadOriginColumn, resolveLeadOrigin } from '@/lib/leadOrigin';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { isBlockedLeadSpam } from '@/lib/leadSpam';

type CsvRow = Record<string, string>;
type LeadInsert = {
  corretor_id: string;
  data_entrada: string | null;
  nome: string;
  telefone: string;
  idades: string;
  possui_cnpj: string;
  cnpj?: string | null;
  tem_plano_ativo: string;
  plano_atual: string;
  custo_plano_atual: string;
  investimento: string;
  cidade: string;
  operadora: string;
  origem?: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  valor_negociacao?: number | null;
  operadora_negociacao?: string | null;
  status: string;
  observacoes: string;
  responsavel_membro_id?: string | null;
  responsavel_profile_id?: string | null;
};

const IMPORT_INSERT_BATCH_SIZE = 200;
const IMPORT_EXISTING_PAGE_SIZE = 1000;
const IMPORT_PARALLEL_BATCHES = 4;
const IMPORT_PARALLEL_UPDATES = 10;

async function requireImporter(request: Request) {
  return requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro', 'gestor_trafego']);
}

function parseSheetLink(input: string) {
  const url = new URL(input);
  if (url.pathname.endsWith('.csv') || url.searchParams.get('output') === 'csv' || url.searchParams.get('format') === 'csv') {
    return { csvUrl: input, spreadsheetId: '', gid: '', editUrl: '', isDirectCsv: true };
  }

  const idMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  const spreadsheetId = idMatch?.[1];
  const gid = url.searchParams.get('gid') || url.hash.match(/gid=(\d+)/)?.[1] || '0';

  if (!spreadsheetId) {
    throw new Error('Link do Google Sheets invalido.');
  }

  return {
    csvUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`,
    spreadsheetId,
    gid,
    editUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}`,
    isDirectCsv: false,
  };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let insideQuotes = false;
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/;/g)?.length || 0) > (firstLine.match(/,/g)?.length || 0) ? ';' : ',';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === delimiter && !insideQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  row.push(current);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toRows(csv: string): CsvRow[] {
  const parsed = parseCsv(csv);
  const knownHeaders = new Set([
    'data',
    'data_entrada',
    'data_cadastro',
    'data_do_lead',
    'created_time',
    'timestamp',
    'nome',
    'name',
    'cliente',
    'nome_completo',
    'telefone',
    'phone',
    'celular',
    'whatsapp',
    'fone',
    'idades',
    'idade',
    'vidas',
    'possui_cnpj',
    'cnpj',
    'tem_cnpj',
    'tem_plano_ativo',
    'plano_ativo',
    'planoativo',
    'plano_atual',
    'convenio_atual',
    'operadora_atual',
    'investimento',
    'investimento_pretendido',
    'valor_negociacao',
    'valor_da_negociacao',
    'valor_cotacao',
    'valor_da_cotacao',
    'valor_proposta',
    'operadora',
    'pagina',
    'aba',
    'operadora_venda',
    'operadora_negociacao',
    'cidade',
    'status',
    'utm_source',
    'source',
    'utm_medium',
    'medium',
    'utm_campaign',
    'campaign',
    'campanha',
    'utm_term',
    'adset',
    'conjunto',
    'utm_content',
    'ad',
    'anuncio',
    'criativo',
  ]);

  const headerIndex = parsed.slice(0, 15).reduce((best, row, index) => {
    const normalized = row.map(normalizeHeader);
    const score = normalized.filter((header) => knownHeaders.has(header)).length;
    return score > best.score ? { index, score } : best;
  }, { index: 0, score: 0 });

  const headers = (parsed[headerIndex.index] || []).map(normalizeHeader);
  const dataRows = parsed.slice(headerIndex.index + 1);

  return dataRows.map((cells) => {
    return headers.reduce<CsvRow>((acc, header, index) => {
      acc[`__cell_${index}`] = String(cells[index] || '').trim();
      if (header) acc[header] = String(cells[index] || '').trim();
      return acc;
    }, {});
  });
}

function pick(row: CsvRow, names: string[]) {
  for (const name of names) {
    const key = normalizeHeader(name);
    if (row[key]) return row[key];
  }
  return '';
}

function parseCurrencyValue(value: string) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return null;
  const numeric = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePlanActiveLabel(value: string) {
  const text = String(value || '').trim();
  const normalized = normalizeHeader(text);
  if (!normalized) return '';
  if (normalized.includes('nao_tenho') || normalized.includes('nao_possui') || normalized === 'nao' || normalized === 'n') return 'Nao';
  if (normalized.includes('tenho') || normalized.includes('possui') || normalized === 'sim' || normalized === 's') return 'Sim';
  return text;
}

function normalizeCnpjOwnershipLabel(value: string) {
  const text = String(value || '').trim();
  const normalized = normalizeHeader(text);
  if (!normalized) return '';
  if (normalized.includes('mei')) return 'Tenho MEI';
  if (normalized.includes('nao') || normalized === 'n' || normalized === 'false' || normalized === '0') return 'Nao';
  if (normalized === 'sim' || normalized === 's' || normalized === 'true' || normalized === '1') return 'Sim';
  if (normalized.includes('tenho_cnpj') || normalized.includes('possui_cnpj')) return 'Sim';
  if (text.replace(/\D/g, '').length >= 11) return 'Sim';
  return text;
}

function extractCnpjValue(value: string) {
  const text = String(value || '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 11) return text;
  return '';
}

function isBlankStored(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return true;
  return ['nao informado', 'não informado', 'sem aba'].includes(text.toLowerCase());
}

function buildEnrichmentUpdate(existing: any, incoming: LeadInsert) {
  const update: Record<string, string | number | null> = {};
  const fields: Array<keyof LeadInsert> = [
    'idades',
    'possui_cnpj',
    'cnpj',
    'tem_plano_ativo',
    'plano_atual',
    'custo_plano_atual',
    'investimento',
    'cidade',
    'operadora',
    'origem',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'valor_negociacao',
    'operadora_negociacao',
  ];

  fields.forEach((field) => {
    const value = incoming[field];
    if (value === undefined || value === null || value === '') return;
    if (isBlankStored(existing[field])) {
      update[field] = value;
    }
  });

  return update;
}

function mergeLeadImportData(existing: LeadInsert, incoming: LeadInsert) {
  const update = buildEnrichmentUpdate(existing, incoming);
  if (Object.keys(update).length > 0) {
    Object.assign(existing, update);
  }
  if (incoming.observacoes && !String(existing.observacoes || '').includes(incoming.observacoes)) {
    existing.observacoes = mergeNotes(existing.observacoes, incoming.observacoes);
  }
}

function isLeadDedupeConstraintError(error: any) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return String(error?.code || '') === '23505'
    || message.includes('leads_exact_dedupe_v2_idx')
    || message.includes('duplicate key value');
}

async function insertLeadBatchHandlingMissingOrigin(leads: LeadInsert[]) {
  let { data, error } = await supabaseAdmin
    .from('leads')
    .insert(leads)
    .select('id');

  if (error && isMissingLeadOriginColumn(error)) {
    const fallbackLeads = leads.map(({ origem: _origem, ...lead }) => lead);
    const retry = await supabaseAdmin
      .from('leads')
      .insert(fallbackLeads)
      .select('id');
    data = retry.data;
    error = retry.error;
  }

  return { data: data || [], error };
}

async function insertLeadBatchResilient(leads: LeadInsert[]): Promise<{ ids: string[]; duplicated: number }> {
  if (leads.length === 0) return { ids: [], duplicated: 0 };

  const { data, error } = await insertLeadBatchHandlingMissingOrigin(leads);
  if (!error) {
    return {
      ids: data.map((lead) => String(lead.id)).filter(Boolean),
      duplicated: 0,
    };
  }

  if (!isLeadDedupeConstraintError(error)) {
    throw new Error(error.message || 'Erro ao inserir lote de leads.');
  }

  if (leads.length === 1) {
    return { ids: [], duplicated: 1 };
  }

  const middle = Math.ceil(leads.length / 2);
  const [left, right] = await Promise.all([
    insertLeadBatchResilient(leads.slice(0, middle)),
    insertLeadBatchResilient(leads.slice(middle)),
  ]);

  return {
    ids: [...left.ids, ...right.ids],
    duplicated: left.duplicated + right.duplicated,
  };
}

async function updateLeadEnrichment(item: { id: string; update: Record<string, string | number | null> }) {
  const payload = { ...item.update, updated_at: new Date().toISOString() };
  const { error } = await supabaseAdmin
    .from('leads')
    .update(payload)
    .eq('id', item.id);

  if (!error) return true;
  if (isLeadDedupeConstraintError(error)) return false;

  if (isMissingLeadOriginColumn(error) && item.update.origem !== undefined) {
    const { origem: _origem, ...fallbackUpdate } = item.update;
    const fallback = await supabaseAdmin
      .from('leads')
      .update({ ...fallbackUpdate, updated_at: payload.updated_at })
      .eq('id', item.id);

    if (!fallback.error) return true;
    if (isLeadDedupeConstraintError(fallback.error)) return false;
    throw new Error(fallback.error.message);
  }

  throw new Error(error.message);
}

function orderedCells(row: CsvRow) {
  return Object.entries(row)
    .filter(([key]) => key.startsWith('__cell_'))
    .sort(([a], [b]) => Number(a.replace('__cell_', '')) - Number(b.replace('__cell_', '')))
    .map(([, value]) => String(value || '').trim());
}

function findPhoneFallback(row: CsvRow) {
  return orderedCells(row).find((cell) => {
    const digits = cell.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 14;
  }) || '';
}

function findNameFallback(row: CsvRow) {
  return orderedCells(row).find((cell) => {
    const text = cell.trim();
    if (!text) return false;
    if (text.includes('@')) return false;
    if (extractDateCandidate(text)) return false;
    if (text.replace(/\D/g, '').length >= 8) return false;
    if (/^r?\$?\s*[\d.,]+$/i.test(text)) return false;
    return /[a-zA-ZÀ-ÿ]/.test(text);
  }) || '';
}

function extractDateCandidate(value: string) {
  const text = String(value || '')
    .trim()
    .replace(/^[="'\s]+|[="'\s]+$/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  if (!text) return '';

  const brDate = text.match(/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}(?:\s+(?:\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}h\d{2}))?/);
  if (brDate?.[0]) return brDate[0];

  const isoDate = text.match(/^\d{4}-\d{1,2}-\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (isoDate?.[0]) return isoDate[0];

  const serialDate = text.match(/^\d{5}(?:[.,]\d+)?$/);
  if (serialDate?.[0]) return serialDate[0];

  return '';
}

function parseDate(value: string) {
  const fallback = '';
  if (!value) return fallback;
  const candidate = extractDateCandidate(value);
  const trimmed = String(candidate || value)
    .trim()
    .replace(/^[="'\s]+|[="'\s]+$/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  if (!trimmed) return fallback;
  if (/[+-]\d{5,}-/.test(trimmed) || /^\d{5,}-/.test(trimmed)) return fallback;

  const safeIso = (year: number, month: number, day: number, hour: number, minute: number, second: number) => {
    if (year < 2024 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      return fallback;
    }

    try {
      const date = new Date(Date.UTC(year, month - 1, day, hour + 3, minute, second));
      const localCheck = new Date(date.getTime() - 3 * 60 * 60 * 1000);
      if (
        Number.isNaN(date.getTime()) ||
        localCheck.getUTCFullYear() !== year ||
        localCheck.getUTCMonth() !== month - 1 ||
        localCheck.getUTCDate() !== day
      ) {
        return fallback;
      }
      if (date.getTime() > Date.now() + 86_400_000) {
        return fallback;
      }

      return date.toISOString();
    } catch {
      return fallback;
    }
  };

  const googleSerial = trimmed.match(/^\d{5}(?:[.,]\d+)?$/);
  if (googleSerial) {
    const serial = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000);
      if (Number.isNaN(date.getTime())) return fallback;
      return safeIso(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds()
      );
    }
  }

  const dateText = trimmed
    .replace(/\s+as\s+/i, ' ')
    .replace(/\s+às\s+/i, ' ')
    .replace(/(\d{1,2})h(\d{2})/i, '$1:$2');

  const br = dateText.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    const month = Number(br[2]);
    const day = Number(br[1]);
    const hour = Number(br[4] || 12);
    const minute = Number(br[5] || 0);
    const second = Number(br[6] || 0);

    return safeIso(year, month, day, hour, minute, second);
  }

  const iso = dateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const hour = Number(iso[4] || 12);
    const minute = Number(iso[5] || 0);
    const second = Number(iso[6] || 0);

    return safeIso(year, month, day, hour, minute, second);
  }

  return fallback;
}

function resolveLeadDate(row: CsvRow) {
  const explicitDate = parseDate([
    pick(row, [
      'data',
      'data entrada',
      'data_entrada',
      'created_time',
      'timestamp',
      'data cadastro',
      'data do lead',
      'data de criacao',
      'data criação',
      'date',
    ]),
    row.__cell_0,
  ].find((value) => extractDateCandidate(value || '')) || '');

  if (explicitDate) return explicitDate;

  const rawCells = orderedCells(row);

  for (const cell of rawCells.slice(0, 6)) {
    const parsed = parseDate(cell);
    if (parsed) return parsed;
  }

  return null;
}

function statusFromSheet(value: string) {
  const key = normalizeHeader(value);
  const aliases: Record<string, string> = {
    oportunidade: 'Aguardando atendimento',
    aguardando: 'Aguardando atendimento',
    aguardando_atendimento: 'Aguardando atendimento',
    aguardando_atendimento_comercial: 'Aguardando atendimento',
    inicio: 'Inicio',
    primeiro_contato: 'Inicio',
    primeira_abordagem: 'Inicio',
    contato: 'Contato feito',
    contato_feito: 'Contato feito',
    feito_contato: 'Contato feito',
    em_contato: 'Contato feito',
    cotacao: 'CotaÃ§Ã£o enviada',
    cotacao_enviada: 'CotaÃ§Ã£o enviada',
    cotacao_enviada_: 'CotaÃ§Ã£o enviada',
    proposta_enviada: 'CotaÃ§Ã£o enviada',
    em_negociacao: 'Em negociaÃ§Ã£o',
    negociacao: 'Em negociaÃ§Ã£o',
    sem_retorno: 'NÃ£o tive retorno',
    nao_tive_retorno: 'NÃ£o tive retorno',
    sem_resposta: 'NÃ£o tive retorno',
    venda: 'Venda realizada',
    venda_realizada: 'Venda realizada',
    vendido: 'Venda realizada',
    sem_interesse: 'Sem interesse',
    descartado: 'Sem interesse',
    regiao_sem_comercializacao: 'RegiÃ£o sem comercializaÃ§Ã£o',
    sem_comercializacao: 'RegiÃ£o sem comercializaÃ§Ã£o',
    chamou_duas_vezes: 'Chamou duas vezes',
    telefone_nao_existe: 'Telefone nÃ£o existe',
  };

  const exact = LEAD_STATUSES.find((status) => normalizeHeader(status) === key);
  if (exact) return exact;
  if (aliases[key]) return normalizeLeadStatus(aliases[key]);
  if (key.includes('cotacao')) return normalizeLeadStatus('CotaÃ§Ã£o enviada');
  if (key.includes('negoci')) return normalizeLeadStatus('Em negociaÃ§Ã£o');
  if (key.includes('retorno') || key.includes('resposta')) return normalizeLeadStatus('NÃ£o tive retorno');
  if (key.includes('venda') || key.includes('vendido')) return normalizeLeadStatus('Venda realizada');
  if (key.includes('interesse') || key.includes('descart')) return normalizeLeadStatus('Sem interesse');
  if (key.includes('telefone')) return normalizeLeadStatus('Telefone nÃ£o existe');
  return 'Aguardando atendimento';
}

async function resolveSheetName(editUrl: string, gid: string) {
  if (!editUrl || !gid) return '';

  try {
    const response = await fetch(editUrl, { cache: 'no-store' });
    const html = await response.text();
    const tabEntry = html.match(new RegExp(String.raw`\[\d+,0,\\\"${gid}\\\",[\s\S]{0,600}?\[0,0,\\\"([^\\\"]+)\\\"`));
    if (tabEntry?.[1]) return tabEntry[1];

    const marker = `\\"${gid}\\"`;
    const index = html.indexOf(marker);
    if (index < 0) return '';

    const slice = html.slice(index, index + 1200);
    const candidates = [...slice.matchAll(/\\\"([^\\\"]+)\\\"/g)]
      .map((match) => match[1])
      .filter((candidate) => candidate && candidate !== gid && !/^\d+$/.test(candidate));

    return candidates.find((candidate) => candidate.length > 1 && candidate.length < 40) || '';
  } catch {
    return '';
  }
}

async function resolveSheetTabs(spreadsheetId: string, fallbackGid: string) {
  if (!spreadsheetId) return [];

  try {
    const response = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, { cache: 'no-store' });
    const html = await response.text();
    const tabs = new Map<string, string>();
    const patterns = [
      /\[\d+,0,\\"(\d+)\\",[\s\S]{0,800}?\[0,0,\\"([^\\"]+)\\"/g,
      /\[\d+,0,"(\d+)",[\s\S]{0,800}?\[0,0,"([^"]+)"/g,
    ];

    patterns.forEach((pattern) => {
      for (const match of html.matchAll(pattern)) {
        const gid = match[1];
        const name = match[2]?.replace(/\\u([\dA-Fa-f]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
        if (gid && name && name.length < 80 && !tabs.has(gid)) {
          tabs.set(gid, name);
        }
      }
    });

    if (tabs.size > 0) {
      return Array.from(tabs.entries()).map(([gid, name]) => ({ gid, name }));
    }
  } catch {
    // Fallback below keeps import working even when Google changes the edit HTML.
  }

  return [{ gid: fallbackGid || '0', name: '' }];
}

function inferOperadora(row: CsvRow, sheetName: string) {
  if (sheetName) return sheetName;

  const raw = [
    pick(row, ['operadora', 'pagina', 'página', 'aba', 'sheet', 'tab', 'page', 'source_page']),
    pick(row, ['utm_campaign', 'campanha']),
    pick(row, ['plano atual', 'operadora atual']),
  ].filter(Boolean).join(' ');

  const normalized = normalizeHeader(raw);
  const operators: Array<[string, string]> = [
    ['bradesco', 'BRADESCO'],
    ['amil', 'AMIL'],
    ['sulamerica', 'SULAMERICA'],
    ['sul_america', 'SULAMERICA'],
    ['porto', 'PORTO'],
    ['medsenior', 'MEDSENIOR'],
    ['hapvida', 'HAPVIDA'],
    ['alice', 'ALICE'],
    ['odontoprev', 'ODONTOPREV'],
    ['aurora', 'AURORA'],
    ['sao_lucas', 'SAO LUCAS'],
    ['clientes_diversos', 'CLIENTES DIVERSOS'],
  ];

  const found = operators.find(([key]) => normalized.includes(key));
  return found?.[1] || pick(row, ['operadora', 'pagina', 'página', 'aba', 'campanha']);
}

function buildNotes(row: CsvRow) {
  const utms = [
    ['utm_source', pick(row, ['utm_source', 'source', 'origem', 'utm origem'])],
    ['utm_medium', pick(row, ['utm_medium', 'medium', 'meio', 'utm meio'])],
    ['utm_campaign', pick(row, ['utm_campaign', 'campaign', 'campanha', 'nome campanha'])],
    ['utm_term', pick(row, ['utm_term', 'term', 'conjunto', 'conjunto de anuncio', 'adset', 'ad set'])],
    ['utm_content', pick(row, ['utm_content', 'content', 'anuncio', 'anúncio', 'ad', 'criativo'])],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `${label}: ${value}`)
    .join(' | ');

  const notes = [
    pick(row, ['observacoes', 'observacao', 'obs', 'comentarios']),
    pick(row, ['hospitais']),
    pick(row, ['redes de preferencia']),
    pick(row, ['negocio etapa', 'negocio - etapa']),
  ].filter(Boolean);

  return notes.join(' | ');
}

function mergeNotes(...parts: string[]) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' | ');
}

function normalizeImportOrigin(value: unknown) {
  const raw = String(value || '').trim();
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized === 'orion' || normalized.includes('campanha')) return 'Orion';
  if (normalized.includes('base')) return 'Base antiga';
  if (normalized.includes('indic')) return 'Indicacao';
  if (normalized.includes('organ')) return 'Organico';
  if (normalized.includes('manual')) return 'Manual';
  if (normalized.includes('outro')) return 'Outro';
  return raw || 'Manual';
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'admin:leads:import-sheets', { limit: 6, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireImporter(request);
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const corretorId = String(body.corretor_id || '').trim();
    const sheetUrl = String(body.sheet_url || '').trim();
    const importOrigin = normalizeImportOrigin(body.origem || body.import_origin || body.source_origin);

    if (!corretorId || !sheetUrl) {
      return NextResponse.json({ error: 'Selecione o corretor e informe o link da planilha.' }, { status: 400 });
    }

    const { data: corretor } = await supabaseAdmin
      .from('corretores')
      .select('id, nome, nome_empresa, gestor_trafego_id, time_operacional')
      .eq('id', corretorId)
      .maybeSingle();

    if (!corretor) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    if (guard.profile.tipo_usuario === 'gestor_trafego') {
      if (!isGestorLinkedToConcessionariaCorretor(corretor, guard.profile)) {
        return NextResponse.json({ error: 'Voce so pode importar leads para concessionarias atribuidas a voce.' }, { status: 403 });
      }
    } else if (guard.profile.tipo_usuario !== 'admin') {
      if (!guard.profile.corretor_id) {
        return NextResponse.json({ error: 'Perfil sem corretor vinculado.' }, { status: 403 });
      }

      const { data: requesterCorretor } = await supabaseAdmin
        .from('corretores')
        .select('id, nome_empresa')
        .eq('id', guard.profile.corretor_id)
        .maybeSingle();

      const sameBrokerage = Boolean(
        requesterCorretor?.nome_empresa
          && corretor.nome_empresa
          && requesterCorretor.nome_empresa === corretor.nome_empresa
      );

      if (guard.profile.corretor_id !== corretorId && !sameBrokerage) {
        return NextResponse.json({ error: 'Voce so pode importar leads para sua propria concessionaria.' }, { status: 403 });
      }
    }

    let targetCorretorId = corretorId;
    if (corretor.nome_empresa && guard.profile.tipo_usuario !== 'gestor_trafego') {
      const { data: primaryBroker } = await supabaseAdmin
        .from('corretores')
        .select('id')
        .eq('nome_empresa', corretor.nome_empresa)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (primaryBroker?.id) {
        targetCorretorId = primaryBroker.id;
      }
    }

    const { csvUrl, editUrl, gid, spreadsheetId, isDirectCsv } = parseSheetLink(sheetUrl);
    const sources = isDirectCsv
      ? [{ csvUrl, gid, name: '' }]
      : (await resolveSheetTabs(spreadsheetId, gid)).map((tab) => ({
          csvUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${tab.gid}`,
          gid: tab.gid,
          name: tab.name,
        }));

    let skipped = 0;
    let duplicated = 0;
    let blockedSpam = 0;
    let incomplete = 0;
    const leads: LeadInsert[] = [];
    const incomingKeys = new Set<string>();
    const incomingIdentity = new Map<string, LeadInsert>();

    const loadedSources = await Promise.all(sources.map(async (source) => {
      const [response, resolvedName] = await Promise.all([
        fetch(source.csvUrl, { cache: 'no-store' }),
        source.name ? Promise.resolve(source.name) : resolveSheetName(editUrl, source.gid),
      ]);
      const csv = await response.text();
      return { source, response, csv, sheetName: resolvedName };
    }));

    for (const loaded of loadedSources) {
      const { source, response, csv, sheetName } = loaded;

      if (!response.ok || csv.toLowerCase().includes('<html')) {
        if (sources.length === 1) {
          return NextResponse.json({
            error: 'Nao consegui ler a planilha. Compartilhe como "qualquer pessoa com o link pode visualizar" ou publique em CSV.'
          }, { status: 400 });
        }
        skipped += 1;
        continue;
      }

      const rows = toRows(csv);

      rows.forEach((row) => {
          const rawNome = (pick(row, ['nome', 'name', 'cliente', 'nome completo']) || findNameFallback(row)).trim();
          const rawTelefone = (pick(row, ['telefone', 'phone', 'celular', 'whatsapp', 'fone']) || findPhoneFallback(row)).trim();

          // Skip completely empty/blank rows
          if (!rawNome && !rawTelefone) {
            return;
          }

          if (isBlockedLeadSpam({ nome: rawNome, telefone: rawTelefone })) {
            blockedSpam += 1;
            return;
          }

          const warnings = [
            !rawNome ? 'Nome ausente na planilha' : '',
            !rawTelefone ? 'Telefone ausente na planilha' : '',
          ].filter(Boolean);

          if (warnings.length > 0) incomplete += 1;

          const lead = {
            corretor_id: targetCorretorId,
            data_entrada: resolveLeadDate(row),
            nome: rawNome || 'Lead sem nome',
            telefone: rawTelefone || 'Telefone nao informado',
            idades: pick(row, ['idades', 'idade', 'vidas', 'quantidade de vidas', 'qtd vidas']),
            possui_cnpj: normalizeCnpjOwnershipLabel(pick(row, ['possui cnpj', 'tem cnpj', 'tem mei', 'mei']) || pick(row, ['cnpj'])) || 'Nao informado',
            cnpj: extractCnpjValue(pick(row, ['cnpj do cliente', 'numero cnpj', 'nÃºmero cnpj', 'cnpj numero', 'cnpj nÃºmero', 'cnpj'])) || null,
            tem_plano_ativo: normalizePlanActiveLabel(pick(row, ['tem plano ativo', 'plano ativo', 'planoativo', 'possui plano', 'possui convenio', 'tem convenio', 'ja tem plano', 'já tem plano'])) || 'Nao informado',
            plano_atual: pick(row, ['plano atual', 'operadora atual', 'convenio atual', 'convênio atual', 'seguradora atual', 'plano']),
            custo_plano_atual: pick(row, ['custo plano atual', 'custo atual', 'valor plano atual', 'custo do plano', 'custo do plano atual', 'valor do plano atual', 'mensalidade atual']),
            investimento: pick(row, ['investimento', 'investimento pretendido', 'pretensao investimento', 'quer investir quanto', 'quanto pretende investir', 'orcamento']),
            cidade: pick(row, ['cidade', 'regiao', 'localidade']),
            operadora: inferOperadora(row, sheetName),
            origem: resolveLeadOrigin({
              origem: pick(row, ['origem', 'utm origem', 'utm_source', 'source']),
              utm_source: pick(row, ['utm_source', 'source', 'origem', 'utm origem']),
              utm_medium: pick(row, ['utm_medium', 'medium', 'meio', 'utm meio']),
              utm_campaign: pick(row, ['utm_campaign', 'campaign', 'campanha', 'nome campanha']),
              utm_term: pick(row, ['utm_term', 'term', 'conjunto', 'conjunto de anuncio', 'adset', 'ad set']),
              utm_content: pick(row, ['utm_content', 'content', 'anuncio', 'anÃºncio', 'ad', 'criativo']),
              operadora: inferOperadora(row, sheetName),
              observacoes: buildNotes(row),
            }, importOrigin),
            utm_source: pick(row, ['utm_source', 'source', 'origem', 'utm origem']),
            utm_medium: pick(row, ['utm_medium', 'medium', 'meio', 'utm meio']),
            utm_campaign: pick(row, ['utm_campaign', 'campaign', 'campanha', 'nome campanha']),
            utm_term: pick(row, ['utm_term', 'term', 'conjunto', 'conjunto de anuncio', 'adset', 'ad set']),
            utm_content: pick(row, ['utm_content', 'content', 'anuncio', 'anúncio', 'ad', 'criativo']),
            valor_negociacao: parseCurrencyValue(pick(row, ['valor negociacao', 'valor negociação', 'valor da negociacao', 'valor da negociação', 'valor cotacao', 'valor cotação', 'valor da cotacao', 'valor da cotação', 'valor proposta', 'valor da proposta', 'valor venda', 'valor fechado', 'receita'])),
            operadora_negociacao: pick(row, ['operadora venda', 'operadora da venda', 'operadora negociacao', 'operadora negociação', 'operadora escolhida']),
            status: statusFromSheet(pick(row, ['status', 'negocio etapa', 'negocio - etapa']) || 'Aguardando atendimento'),
            observacoes: mergeNotes(buildLeadImportWarningNote(warnings), buildNotes(row)),
          };

          const identityKey = buildLeadIdentityKey(lead);
          const existingIncoming = incomingIdentity.get(identityKey);
          if (existingIncoming) {
            mergeLeadImportData(existingIncoming, lead);
            duplicated += 1;
            return;
          }
          incomingIdentity.set(identityKey, lead);

          const key = buildLeadDuplicateKey(lead);
          if (incomingKeys.has(key)) {
            duplicated += 1;
            return;
          }
          incomingKeys.add(key);
          leads.push(lead);
      });
    }

    if (leads.length === 0) {
      return NextResponse.json({ error: 'Nenhuma linha encontrada para importar. Verifique se a planilha esta compartilhada corretamente.' }, { status: 400 });
    }

    const existingKeys = new Set<string>();
    const existingIdentity = new Map<string, any>();
    const previousOwnerByContact = new Map<string, any>();
    const existingColumns = 'id, corretor_id, data_entrada, nome, telefone, idades, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, custo_plano_atual, investimento, cidade, operadora, utm_source, utm_medium, utm_campaign, utm_term, utm_content, valor_negociacao, operadora_negociacao, status, responsavel_membro_id, responsavel_profile_id';
    const firstExistingPage = await supabaseAdmin
      .from('leads')
      .select(existingColumns, { count: 'exact' })
      .eq('corretor_id', targetCorretorId)
      .order('id', { ascending: true })
      .range(0, IMPORT_EXISTING_PAGE_SIZE - 1);

    if (firstExistingPage.error) {
      return NextResponse.json({ error: firstExistingPage.error.message }, { status: 500 });
    }

    const totalExisting = firstExistingPage.count ?? firstExistingPage.data?.length ?? 0;
    const remainingPageIndexes = Array.from(
      { length: Math.max(0, Math.ceil(totalExisting / IMPORT_EXISTING_PAGE_SIZE) - 1) },
      (_, index) => index + 1,
    );
    const remainingExistingPages = await Promise.all(remainingPageIndexes.map((pageIndex) => {
      const from = pageIndex * IMPORT_EXISTING_PAGE_SIZE;
      return supabaseAdmin
        .from('leads')
        .select(existingColumns)
        .eq('corretor_id', targetCorretorId)
        .order('id', { ascending: true })
        .range(from, from + IMPORT_EXISTING_PAGE_SIZE - 1);
    }));

    const failedExistingPage = remainingExistingPages.find((page) => page.error);
    if (failedExistingPage?.error) {
      return NextResponse.json({ error: failedExistingPage.error.message }, { status: 500 });
    }

    const allExistingLeads = [
      ...(firstExistingPage.data || []),
      ...remainingExistingPages.flatMap((page) => page.data || []),
    ];

    allExistingLeads.forEach((lead) => {
        existingKeys.add(buildLeadDuplicateKey(lead));
        existingIdentity.set(buildLeadIdentityKey(lead), lead);
        if (lead.responsavel_membro_id || lead.responsavel_profile_id) {
          const contactKey = buildLeadContactKey(lead);
          const current = previousOwnerByContact.get(contactKey);
          if (!current || new Date(lead.data_entrada || 0).getTime() > new Date(current.data_entrada || 0).getTime()) {
            previousOwnerByContact.set(contactKey, lead);
          }
        }
    });

    const enrichmentUpdates: Array<{ id: string; update: Record<string, string | number | null> }> = [];
    const uniqueLeads = leads.filter((lead) => {
      const key = buildLeadDuplicateKey(lead);
      const identityKey = buildLeadIdentityKey(lead);
      const existing = existingIdentity.get(identityKey);
      if (existingKeys.has(key) || existing) {
        if (existing?.id) {
          const update = buildEnrichmentUpdate(existing, lead);
          if (Object.keys(update).length > 0) {
            enrichmentUpdates.push({ id: existing.id, update });
            Object.assign(existing, update);
          }
        }
        duplicated += 1;
        return false;
      }
      const previousOwner = previousOwnerByContact.get(buildLeadContactKey(lead));
      if (previousOwner) {
        lead.responsavel_membro_id = previousOwner.responsavel_membro_id || null;
        lead.responsavel_profile_id = previousOwner.responsavel_profile_id || null;
      }
      existingKeys.add(key);
      existingIdentity.set(identityKey, lead);
      return true;
    });

    let enriched = 0;
    for (let index = 0; index < enrichmentUpdates.length; index += IMPORT_PARALLEL_UPDATES) {
      const results = await Promise.all(
        enrichmentUpdates
          .slice(index, index + IMPORT_PARALLEL_UPDATES)
          .map(updateLeadEnrichment),
      );
      enriched += results.filter(Boolean).length;
    }

    if (uniqueLeads.length === 0) {
      return NextResponse.json({
        success: true,
        message: enriched > 0 ? 'Leads existentes atualizados com dados faltantes.' : 'Todos os leads da planilha ja existem no CRM.',
        imported: 0,
        enriched,
        duplicated,
        skipped,
        incomplete,
        blocked_spam: blockedSpam,
      });
    }

    const insertBatches = Array.from(
      { length: Math.ceil(uniqueLeads.length / IMPORT_INSERT_BATCH_SIZE) },
      (_, index) => uniqueLeads.slice(
        index * IMPORT_INSERT_BATCH_SIZE,
        (index + 1) * IMPORT_INSERT_BATCH_SIZE,
      ),
    );
    const insertResults: Array<{ ids: string[]; duplicated: number }> = [];
    for (let index = 0; index < insertBatches.length; index += IMPORT_PARALLEL_BATCHES) {
      const results = await Promise.all(
        insertBatches.slice(index, index + IMPORT_PARALLEL_BATCHES).map(insertLeadBatchResilient),
      );
      insertResults.push(...results);
    }
    const insertedIds = insertResults.flatMap((result) => result.ids);
    duplicated += insertResults.reduce((sum, result) => sum + result.duplicated, 0);

    await writeAuditLog(request, guard.profile, {
      action: 'lead.import_sheet',
      entity_type: 'corretor',
      entity_id: corretorId,
      metadata: {
        corretor_nome: corretor.nome,
        imported: insertedIds.length,
        enriched,
        incomplete,
        skipped,
        duplicated,
        blocked_spam: blockedSpam,
        paginas: sources.length,
      },
    });

    return NextResponse.json({
      success: true,
      imported: insertedIds.length,
      enriched,
      skipped,
      duplicated,
      incomplete,
      blocked_spam: blockedSpam,
      paginas: sources.length,
      corretor: corretor.nome,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao importar planilha.' }, { status: 500 });
  }
}
