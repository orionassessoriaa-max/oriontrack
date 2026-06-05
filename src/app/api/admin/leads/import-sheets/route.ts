import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { LEAD_STATUSES, normalizeLeadStatus } from '@/lib/leadStatus';
import { buildLeadImportWarningNote } from '@/lib/leadWarnings';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { buildLeadDuplicateKey } from '@/lib/leadDuplicate';

type CsvRow = Record<string, string>;
type LeadInsert = {
  corretor_id: string;
  data_entrada: string | null;
  nome: string;
  telefone: string;
  idades: string;
  possui_cnpj: string;
  tem_plano_ativo: string;
  plano_atual: string;
  custo_plano_atual: string;
  investimento: string;
  cidade: string;
  operadora: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  status: string;
  observacoes: string;
};

async function requireImporter(request: Request) {
  return requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro']);
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
    'plano_atual',
    'cidade',
    'status',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
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
    pick(row, ['operadora', 'aba', 'sheet', 'tab']),
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
  return found?.[1] || pick(row, ['operadora', 'campanha']);
}

function buildNotes(row: CsvRow) {
  const utms = [
    ['utm_source', pick(row, ['utm_source'])],
    ['utm_medium', pick(row, ['utm_medium'])],
    ['utm_campaign', pick(row, ['utm_campaign'])],
    ['utm_term', pick(row, ['utm_term'])],
    ['utm_content', pick(row, ['utm_content'])],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `${label}: ${value}`)
    .join(' | ');

  const notes = [
    pick(row, ['observacoes', 'observacao', 'obs', 'comentarios']),
    pick(row, ['hospitais']),
    pick(row, ['redes de preferencia']),
    pick(row, ['negocio etapa', 'negocio - etapa']),
    utms,
  ].filter(Boolean);

  return notes.join(' | ');
}

function mergeNotes(...parts: string[]) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' | ');
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

    if (!corretorId || !sheetUrl) {
      return NextResponse.json({ error: 'Selecione o corretor e informe o link da planilha.' }, { status: 400 });
    }

    const { data: corretor } = await supabaseAdmin
      .from('corretores')
      .select('id, nome, nome_empresa')
      .eq('id', corretorId)
      .maybeSingle();

    if (!corretor) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    if (guard.profile.tipo_usuario !== 'admin') {
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
        return NextResponse.json({ error: 'Voce so pode importar leads para sua propria corretora.' }, { status: 403 });
      }
    }

    let targetCorretorId = corretorId;
    if (corretor.nome_empresa) {
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
    let incomplete = 0;
    const leads: LeadInsert[] = [];
    const incomingKeys = new Set<string>();

    for (const source of sources) {
      const response = await fetch(source.csvUrl, { cache: 'no-store' });
      const csv = await response.text();

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
      const sheetName = source.name || await resolveSheetName(editUrl, source.gid);

      rows.forEach((row) => {
          const rawNome = (pick(row, ['nome', 'name', 'cliente', 'nome completo']) || findNameFallback(row)).trim();
          const rawTelefone = (pick(row, ['telefone', 'phone', 'celular', 'whatsapp', 'fone']) || findPhoneFallback(row)).trim();

          // Skip completely empty/blank rows
          if (!rawNome && !rawTelefone) {
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
            possui_cnpj: pick(row, ['possui cnpj', 'cnpj', 'tem cnpj']) || 'Nao informado',
            tem_plano_ativo: pick(row, ['tem plano ativo', 'plano ativo', 'possui plano']) || 'Nao informado',
            plano_atual: pick(row, ['plano atual', 'operadora atual', 'plano']),
            custo_plano_atual: pick(row, ['custo plano atual', 'custo atual', 'valor plano atual', 'custo do plano', 'custo do plano atual']),
            investimento: pick(row, ['investimento', 'investimento pretendido', 'pretensao investimento', 'quer investir quanto', 'quanto pretende investir', 'orcamento']),
            cidade: pick(row, ['cidade', 'regiao', 'localidade']),
            operadora: inferOperadora(row, sheetName),
            utm_source: pick(row, ['utm_source']),
            utm_medium: pick(row, ['utm_medium']),
            utm_campaign: pick(row, ['utm_campaign', 'campanha']),
            utm_term: pick(row, ['utm_term', 'conjunto', 'conjunto de anuncio', 'adset']),
            utm_content: pick(row, ['utm_content', 'anuncio', 'ad', 'criativo']),
            status: statusFromSheet(pick(row, ['status']) || 'Aguardando atendimento'),
            observacoes: mergeNotes(buildLeadImportWarningNote(warnings), buildNotes(row)),
          };

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
    let existingPage = 0;
    const existingLimit = 1000;
    let fetchExisting = true;

    while (fetchExisting) {
      const from = existingPage * existingLimit;
      const to = from + existingLimit - 1;
      const { data: existingLeads, error: existingError } = await supabaseAdmin
        .from('leads')
        .select('corretor_id, data_entrada, nome, telefone, idades, possui_cnpj, tem_plano_ativo, plano_atual, custo_plano_atual, investimento, cidade, operadora, utm_source, utm_medium, utm_campaign, utm_term, utm_content, status')
        .eq('corretor_id', targetCorretorId)
        .range(from, to);

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 500 });
      }

      (existingLeads || []).forEach((lead) => existingKeys.add(buildLeadDuplicateKey(lead)));
      if (!existingLeads || existingLeads.length < existingLimit) {
        fetchExisting = false;
      } else {
        existingPage += 1;
      }
    }

    const uniqueLeads = leads.filter((lead) => {
      const key = buildLeadDuplicateKey(lead);
      if (existingKeys.has(key)) {
        duplicated += 1;
        return false;
      }
      existingKeys.add(key);
      return true;
    });

    if (uniqueLeads.length === 0) {
      return NextResponse.json({
        error: 'Todos os leads da planilha ja existem no CRM.',
        duplicated,
        skipped,
        incomplete,
      }, { status: 409 });
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert(uniqueLeads)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'lead.import_sheet',
      entity_type: 'corretor',
      entity_id: corretorId,
      metadata: {
        corretor_nome: corretor.nome,
        imported: data?.length || uniqueLeads.length,
        incomplete,
        skipped,
        duplicated,
        paginas: sources.length,
      },
    });

    return NextResponse.json({
      success: true,
      imported: data?.length || uniqueLeads.length,
      skipped,
      duplicated,
      incomplete,
      paginas: sources.length,
      corretor: corretor.nome,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao importar planilha.' }, { status: 500 });
  }
}
