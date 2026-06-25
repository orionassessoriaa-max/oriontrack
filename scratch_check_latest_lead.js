const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing Supabase credentials!");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

async function check() {
  console.log("Fetching latest leads...");
  const { data: leads, error } = await supabaseAdmin
    .from('leads')
    .select('id, nome, telefone, corretor_id, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error("Error querying leads:", error);
    return;
  }

  console.log("Latest leads in database:");
  for (const lead of leads) {
    console.log(`- Lead ID: ${lead.id}, Nome: ${lead.nome}, Telefone: ${lead.telefone}, Corretor ID: ${lead.corretor_id}, Criado: ${lead.created_at}`);
    
    // Check if there is an AI config for this broker
    const { data: broker } = await supabaseAdmin
      .from('corretores')
      .select('nome_empresa')
      .eq('id', lead.corretor_id)
      .maybeSingle();

    console.log(`  Brokerage/Concessionaria name: ${broker?.nome_empresa || 'NOT FOUND'}`);

    if (broker?.nome_empresa) {
      const { data: corretora } = await supabaseAdmin
        .from('corretoras')
        .select('id, nome')
        .ilike('nome', broker.nome_empresa)
        .maybeSingle();
      
      console.log(`  Corretora row: ${corretora ? `${corretora.nome} (ID: ${corretora.id})` : 'NOT FOUND'}`);

      if (corretora) {
        const { data: aiConfig } = await supabaseAdmin
          .from('corretora_ai_configs')
          .select('id, status, persona')
          .eq('corretora_id', corretora.id)
          .maybeSingle();
        console.log(`  AI Config: ${aiConfig ? `Persona: ${aiConfig.persona}, Status: ${aiConfig.status} (ID: ${aiConfig.id})` : 'NOT FOUND'}`);
      }
    }

    // Check if there is an AI session for this lead
    const { data: session } = await supabaseAdmin
      .from('lead_ai_sessions')
      .select('id, status, summary')
      .eq('lead_id', lead.id)
      .maybeSingle();
    
    console.log(`  AI Session: ${session ? `Status: ${session.status} (ID: ${session.id})` : 'NONE'}`);
  }
}

check();
