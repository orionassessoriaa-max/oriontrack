const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// Clean baseUrl
const evolutionApiUrl = String(process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const mainApiKey = process.env.EVOLUTION_API_KEY;

async function evolutionFetch(path, init = {}, apiKeyOverride = null) {
  const apiKey = apiKeyOverride || mainApiKey;
  const response = await fetch(`${evolutionApiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || 'Error querying Evolution API');
  }
  return payload;
}

function readInstanceToken(payload, instanceName) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [payload];
  const match = rows.find((row) => {
    const name = row?.instance?.instanceName || row?.instanceName || row?.name;
    return !name || name === instanceName;
  }) || payload;

  return String(
    match?.hash?.apikey ||
    match?.instance?.apikey ||
    match?.instance?.token ||
    match?.apikey ||
    match?.token ||
    ''
  ).trim() || null;
}

async function getEvolutionInstanceApiKey(instance) {
  try {
    const fetched = await evolutionFetch(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
    return readInstanceToken(fetched, instance) || mainApiKey || null;
  } catch (err) {
    console.warn("Could not fetch instance api key, using main api key:", err.message);
    return mainApiKey || null;
  }
}

async function run() {
  const leadId = 'e55186ee-8ec3-4629-9563-92fa4b857d0f';
  const henriqueProfileId = 'c0e7ff54-2e0c-4c76-8745-c9fd85eddf19';
  const henriquePhone = '5511972780355';

  console.log("Fetching lead details...");
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (leadErr || !lead) {
    console.error("Lead not found:", leadErr);
    return;
  }

  console.log("Fetching active AI session...");
  const { data: session, error: sessErr } = await supabase
    .from('lead_ai_sessions')
    .select('*')
    .eq('lead_id', leadId)
    .single();

  if (sessErr || !session) {
    console.error("Session not found:", sessErr);
    return;
  }

  const summary = session.summary || 'Sem resumo disponível.';
  
  const msg = [
    `Atendimento inicial concluído para o lead *${lead.nome}*.`,
    '',
    summary,
    '',
    'Agora é a hora do atendimento humano.',
  ].join('\n');

  console.log("\n--- NOTIFICATION MESSAGE TO SEND ---");
  console.log(msg);
  console.log("------------------------------------\n");

  console.log("1. Creating notification in database...");
  const { error: notifErr } = await supabase.from('notificacoes').insert([{
    titulo: 'Lead pronto para atendimento',
    mensagem: msg,
    destinatario_profile_id: henriqueProfileId,
    lida: false,
  }]);

  if (notifErr) {
    console.error("Failed to create database notification:", notifErr);
  } else {
    console.log("Database notification created successfully!");
  }

  console.log("2. Sending WhatsApp notification via Evolution API (Apolo)...");
  try {
    const apoloInstance = 'apolo_master_sender';
    const instanceApiKey = await getEvolutionInstanceApiKey(apoloInstance);
    
    const text = `*Lead pronto para atendimento*\n\nOlá, Henrique!\n\n${msg}\n\n_Apolo Notificador - Orion Track_`;
    
    const sendResult = await evolutionFetch(`/message/sendText/${apoloInstance}`, {
      method: 'POST',
      body: JSON.stringify({ number: henriquePhone, text }),
    }, instanceApiKey);

    console.log("WhatsApp message sent successfully! Response:", sendResult);
  } catch (err) {
    console.error("Failed to send WhatsApp message via Evolution:", err.message);
  }

  console.log("3. Updating AI session status to handoff...");
  const { error: updateErr } = await supabase
    .from('lead_ai_sessions')
    .update({
      status: 'handoff',
      updated_at: new Date().toISOString()
    })
    .eq('id', session.id);

  if (updateErr) {
    console.error("Failed to update AI session status:", updateErr);
  } else {
    console.log("AI session status updated to handoff!");
  }

  console.log("\nForce handoff complete!");
}

run();
