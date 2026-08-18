import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { startCommercialFirstContact } from '@/lib/commercialFirstContact';
import { assignNextCommercialSdr } from '@/lib/commercialDistribution';

function key(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseCsv(text: string) {
  const delimiter = (text.split(/\r?\n/, 1)[0] || '').split(';').length > (text.split(/\r?\n/, 1)[0] || '').split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let cell = '', row: string[] = [], quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = ''; continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function value(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) if (row[key(alias)]) return row[key(alias)];
  return null;
}

function dateValue(valueToParse: string | null) {
  if (!valueToParse) return new Date().toISOString();
  const parsed = new Date(valueToParse);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const match = valueToParse.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? new Date(`${match[3]}-${match[2]}-${match[1]}T12:00:00-03:00`).toISOString() : new Date().toISOString();
}

function statusValue(valueToParse: string | null) {
  const statuses = ['Oportunidade', '1º dia', 'Tentando contato', 'Plano de saúde', 'Reuniões agendadas', 'No-show', 'Perdido', 'Negócio fechado'];
  return statuses.find((status) => key(status) === key(valueToParse || '')) || 'Oportunidade';
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  try {
    const body = await request.json();
    const link = String(body.link || '').trim();
    if (!link) return NextResponse.json({ error: 'Informe o link do Google Sheets.' }, { status: 400 });
    const parsedUrl = new URL(link);
    const match = parsedUrl.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) return NextResponse.json({ error: 'Link do Google Sheets invalido.' }, { status: 400 });
    const gid = parsedUrl.searchParams.get('gid') || parsedUrl.hash.match(/gid=(\d+)/)?.[1] || '0';
    const csvResponse = await fetch(`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`, { cache: 'no-store' });
    if (!csvResponse.ok) return NextResponse.json({ error: 'Nao foi possivel ler a planilha. Verifique se ela esta compartilhada.' }, { status: 400 });
    const rows = parseCsv(await csvResponse.text());
    if (rows.length < 2) return NextResponse.json({ error: 'A planilha nao possui linhas de leads.' }, { status: 400 });

    const headers = rows[0].map(key);
    const leads = rows.slice(1).map((cells) => {
      const row = headers.reduce<Record<string, string>>((result, header, index) => { if (header) result[header] = cells[index] || ''; return result; }, {});
      const nome = value(row, ['nome', 'name', 'cliente']);
      const telefone = value(row, ['telefone', 'whatsapp', 'phone', 'celular']);
      if (!nome || !telefone) return null;
      return {
        nome,
        telefone,
        email: value(row, ['email', 'e-mail']),
        empresa: value(row, ['empresa', 'company']),
        estado: (value(row, ['estado', 'uf', 'state']) || '').toUpperCase().slice(0, 2) || null,
        origem: value(row, ['origem', 'source']) || 'Planilha comercial',
        campanha: value(row, ['campanha', 'campaign', 'utm_campaign']),
        ja_investiu_trafego: value(row, ['ja investiu em trafego', 'ja_investiu_trafego', 'traffic']),
        faturamento_mensal: value(row, ['faturamento mensal', 'faturamento_mensal', 'revenue']),
        prioridade: value(row, ['prioridade', 'priority']),
        investimento: value(row, ['investimento', 'investment']),
        vidas: value(row, ['vidas', 'lives']),
        utm_source: value(row, ['utm_source']), utm_medium: value(row, ['utm_medium']),
        utm_campaign: value(row, ['utm_campaign']), utm_term: value(row, ['utm_term']), utm_content: value(row, ['utm_content']),
        status: statusValue(value(row, ['status', 'etapa', 'status do crm'])),
        data_entrada: dateValue(value(row, ['data', 'data entrada', 'data_entrada', 'timestamp'])),
        sdr_id: null, closer_id: null, lead_qualificado: false, valor_negociacao: 0, observacoes: null, created_by: guard.profile.id,
      };
    }).filter(Boolean) as Array<Record<string, unknown>>;

    let created = 0, enriched = 0;
    for (const lead of leads) {
      const { data: existing } = await supabaseAdmin.from('comercial_leads').select('*').eq('telefone', lead.telefone).maybeSingle();
      if (existing?.id) {
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const field of ['email', 'empresa', 'estado', 'origem', 'campanha', 'ja_investiu_trafego', 'faturamento_mensal', 'prioridade', 'investimento', 'vidas', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
          if ((!existing[field] || existing[field] === '-') && lead[field]) update[field] = lead[field];
        }
        if (Object.keys(update).length > 1) { await supabaseAdmin.from('comercial_leads').update(update).eq('id', existing.id); enriched += 1; }
        continue;
      }
      const sdrId = await assignNextCommercialSdr();
      const { data: inserted, error } = await supabaseAdmin
        .from('comercial_leads')
        .insert({ ...lead, sdr_id: sdrId })
        .select('id')
        .single();
      if (!error && inserted?.id) {
        created += 1;
        try {
          await startCommercialFirstContact(inserted.id);
        } catch (botError) {
          console.error('commercial_first_contact_failed', botError);
        }
      }
    }
    return NextResponse.json({ created, enriched, ignored: rows.length - 1 - leads.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao importar planilha.' }, { status: 500 });
  }
}
