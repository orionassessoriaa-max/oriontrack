import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeLeadStatus } from '@/lib/leadStatus';

type CsvRow = Record<string, string>;
type LeadInsert = {
  corretor_id: string;
  data_entrada: string;
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
  status: string;
  observacoes: string;
};

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('tipo_usuario')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.tipo_usuario !== 'admin') {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user };
}

function buildCsvUrl(input: string) {
  const url = new URL(input);
  if (url.pathname.endsWith('.csv') || url.searchParams.get('output') === 'csv' || url.searchParams.get('format') === 'csv') {
    return input;
  }

  const idMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  const spreadsheetId = idMatch?.[1];
  const gid = url.searchParams.get('gid') || url.hash.match(/gid=(\d+)/)?.[1] || '0';

  if (!spreadsheetId) {
    throw new Error('Link do Google Sheets invalido.');
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
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
  const headers = (parsed.shift() || []).map(normalizeHeader);

  return parsed.map((cells) => {
    return headers.reduce<CsvRow>((acc, header, index) => {
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

function parseDate(value: string) {
  if (!value) return new Date().toISOString();
  const trimmed = value.trim();
  const br = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return new Date(`${year}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}T12:00:00`).toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function statusFromSheet(value: string) {
  const key = normalizeHeader(value);
  const aliases: Record<string, string> = {
    oportunidade: 'Aguardando atendimento',
    aguardando: 'Aguardando atendimento',
    aguardando_atendimento: 'Aguardando atendimento',
    contato: 'Contato feito',
    contato_feito: 'Contato feito',
    venda: 'Venda realizada',
    venda_realizada: 'Venda realizada',
    sem_interesse: 'Sem interesse',
  };

  return normalizeLeadStatus(aliases[key] || value || 'Aguardando atendimento');
}

function buildNotes(row: CsvRow) {
  const notes = [
    pick(row, ['observacoes', 'observacao', 'obs', 'comentarios']),
    pick(row, ['hospitais']),
    pick(row, ['redes de preferencia']),
    pick(row, ['negocio etapa', 'negocio - etapa']),
  ].filter(Boolean);

  return notes.join(' | ');
}

export async function POST(request: Request) {
  try {
    const guard = await requireAdmin(request);
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const corretorId = String(body.corretor_id || '').trim();
    const sheetUrl = String(body.sheet_url || '').trim();

    if (!corretorId || !sheetUrl) {
      return NextResponse.json({ error: 'Selecione o corretor e informe o link da planilha.' }, { status: 400 });
    }

    const { data: corretor } = await supabaseAdmin
      .from('corretores')
      .select('id, nome')
      .eq('id', corretorId)
      .maybeSingle();

    if (!corretor) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    const csvUrl = buildCsvUrl(sheetUrl);
    const response = await fetch(csvUrl, { cache: 'no-store' });
    const csv = await response.text();

    if (!response.ok || csv.toLowerCase().includes('<html')) {
      return NextResponse.json({
        error: 'Nao consegui ler a planilha. Compartilhe como "qualquer pessoa com o link pode visualizar" ou publique em CSV.'
      }, { status: 400 });
    }

    const rows = toRows(csv);
    let skipped = 0;
    const leads = rows
      .map((row): LeadInsert | null => {
        const nome = pick(row, ['nome', 'name', 'cliente', 'nome completo']);
        const telefone = pick(row, ['telefone', 'phone', 'celular', 'whatsapp', 'fone']);
        if (!nome || !telefone) {
          skipped += 1;
          return null;
        }

        return {
          corretor_id: corretorId,
          data_entrada: parseDate(pick(row, ['data', 'data entrada', 'data_entrada', 'created_time'])),
          nome,
          telefone,
          idades: pick(row, ['idades', 'idade', 'vidas', 'quantidade de vidas', 'qtd vidas']),
          possui_cnpj: pick(row, ['possui cnpj', 'cnpj', 'tem cnpj']) || 'Nao informado',
          tem_plano_ativo: pick(row, ['tem plano ativo', 'plano ativo', 'possui plano']) || 'Nao informado',
          plano_atual: pick(row, ['plano atual', 'operadora atual', 'plano']),
          custo_plano_atual: pick(row, ['custo plano atual', 'custo atual', 'valor plano atual', 'custo do plano', 'custo do plano atual']),
          investimento: pick(row, ['investimento', 'investimento pretendido', 'pretensao investimento', 'quer investir quanto', 'quanto pretende investir', 'orcamento']),
          cidade: pick(row, ['cidade', 'regiao', 'localidade']),
          operadora: pick(row, ['operadora', 'utm_campaign', 'campanha']),
          status: statusFromSheet(pick(row, ['status']) || 'Aguardando atendimento'),
          observacoes: buildNotes(row),
        };
      })
      .filter((lead): lead is LeadInsert => Boolean(lead));

    if (leads.length === 0) {
      return NextResponse.json({ error: 'Nenhum lead valido encontrado. A planilha precisa ter pelo menos Nome e Telefone.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert(leads)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      imported: data?.length || leads.length,
      skipped,
      corretor: corretor.nome,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao importar planilha.' }, { status: 500 });
  }
}
