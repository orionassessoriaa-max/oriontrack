import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireCommercialUser } from "@/lib/api/comercial";
import { podeVerPropostaKripto } from "@/lib/propostaKripto";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * A proposta e um HTML fechado em si, com as imagens ja embutidas em base64.
 *
 * Ele mora em conteudo/ e nao em public/ de proposito: dentro de public/ o
 * arquivo seria servido a quem tivesse a URL, sem passar pelo login, e a
 * proposta tem preco dentro. Aqui ele so sai depois da checagem de acesso.
 *
 * Como o Dockerfile monta a imagem final copiando apenas .next, public, scripts
 * e node_modules, a pasta conteudo/ precisa estar na lista de COPY do runner.
 */
const ARQUIVO = path.join(process.cwd(), "conteudo", "proposta-kripto.html");

// 1,6 MB lidos do disco a cada request seria desperdicio: cada replica guarda
// a sua copia depois da primeira leitura.
let cache: string | null = null;
const MAX_SNAPSHOT_SIZE = 3_000_000;

type ProposalLead = { nome: string; empresa: string | null };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

function applyLeadToCover(html: string, lead: ProposalLead | null) {
  if (!lead) return html;
  const date = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date());
  return html
    .replace("Nome do lead", escapeHtml(lead.nome))
    .replace("Corretora de planos de saúde", escapeHtml(lead.empresa || "Corretora de planos de saúde"))
    .replace("Setembro de 2026", escapeHtml(date.charAt(0).toUpperCase() + date.slice(1)));
}

function bridge(html: string, lead: ProposalLead | null) {
  const leadData = JSON.stringify(lead);
  const preflight = `<script id="orionProposalPreflight">(function(){document.body.classList.remove('editing','idle','library','parent-fullscreen');var viewport=document.getElementById('viewport');var stage=document.getElementById('stage');if(viewport)viewport.removeAttribute('style');if(stage)stage.removeAttribute('style');var slides=Array.prototype.slice.call(document.querySelectorAll('.slide'));slides.forEach(function(slide,index){slide.classList.remove('is-active','is-out');slide.removeAttribute('style');if(index===0)slide.classList.add('is-active')});document.querySelectorAll('.zone.open').forEach(function(zone){zone.classList.remove('open')});document.querySelectorAll('[contenteditable]').forEach(function(element){element.removeAttribute('contenteditable')});var dots=document.getElementById('dots');if(dots)dots.innerHTML='';var counter=document.getElementById('counter');if(counter)counter.textContent='01 / '+String(slides.length).padStart(2,'0')})();</script>`;
  const initialState = lead ? `<script id="orionProposalInitialState">window.__ORION_BAKED__=true;window.__ORION_STATE__={client:${JSON.stringify(lead.nome)}};</script>` : "";
  const script = `<script id="orionProposalBridge">(function(){var style=document.getElementById('orionProposalHostStyle');if(!style){style=document.createElement('style');style.id='orionProposalHostStyle';style.textContent='body.parent-fullscreen #chrome{opacity:0!important;pointer-events:none!important}';document.head.appendChild(style)}var client=document.getElementById('clientName');var lead=${leadData};function setText(selector,value){document.querySelectorAll(selector).forEach(function(element){element.textContent=value})}if(lead){var date=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date());date=date.charAt(0).toUpperCase()+date.slice(1);setText('[data-proposal-client]',lead.nome);setText('[data-proposal-segment]',lead.empresa||'Corretora de planos de saúde');setText('[data-proposal-date]',date);if(client)client.value=lead.nome}if(!client)return;var hint=document.querySelector('#editbar .hint');if(hint)hint.textContent='Clique em qualquer texto e digite. Quando terminar, clique em Concluir para salvar.';var edit=document.getElementById('editBtn');var fs=document.getElementById('fsBtn');if(edit)edit.style.display='none';if(fs)fs.style.display='none';function tell(type,extra){window.parent.postMessage(Object.assign({type:type,clientName:client.value.trim()},extra||{}),'*')}client.addEventListener('change',function(){tell('orion-proposal-client-updated')});var done=document.getElementById('doneBtn');if(done)done.addEventListener('click',function(){tell('orion-proposal-edit-finished')});window.addEventListener('message',function(event){if(event.source!==window.parent||!event.data)return;if(event.data.type==='orion-proposal-toggle-edit'){var wasEditing=document.body.classList.contains('editing');if(edit)edit.click();if(wasEditing)tell('orion-proposal-edit-finished');return}if(event.data.type==='orion-proposal-fullscreen-state'){document.body.classList.toggle('parent-fullscreen',Boolean(event.data.active));window.dispatchEvent(new Event('resize'));return}if(event.data.type!=='orion-proposal-snapshot-request')return;var state={client:client.value,texts:{},mod:'mensal',prices:null};try{var current=window.__ORION_COLLECT__?window.__ORION_COLLECT__():JSON.parse(localStorage.getItem('orion-proposta-v2')||'{}');state.mod=current.mod||state.mod;state.prices=current.prices||state.prices;state.texts=current.texts||state.texts}catch(error){}document.querySelectorAll('[data-e]').forEach(function(element,index){state.texts[index]=element.innerHTML});var output='<!doctype html>'+document.documentElement.outerHTML;output=output.replace('<script id="pageScript">','<script>window.__ORION_BAKED__=true;window.__ORION_STATE__='+JSON.stringify(state).replace(/<\\/script/gi,'<\\\\/script')+';<\\/script><script id="pageScript">');tell('orion-proposal-snapshot',{html:output})})})();</script>`;
  const withoutPreviousBridge = html
    .replace(/<script id="orionProposalBridge">[\s\S]*?<\/script>/i, "")
    .replace(/<script id="orionProposalPreflight">[\s\S]*?<\/script>/i, "")
    .replace(/<script id="orionProposalInitialState">[\s\S]*?<\/script>/i, "")
    .replace(/<script>\(function\(\)\{var client=document\.getElementById\('clientName'\);[\s\S]*?<\/script>\s*(?=<\/body>)/i, "");
  const preparedHtml = withoutPreviousBridge.replace('<script id="pageScript">', `${preflight}${initialState}<script id="pageScript">`);
  // O deck tem um "Exportar arquivo" que monta HTML por concatenacao, e dentro
  // dele existe a string '</body></html>'. Como replace sem /g troca a PRIMEIRA
  // ocorrencia, o bridge era injetado no meio daquele literal de JavaScript: o
  // script do deck virava erro de sintaxe e morria inteiro, levando junto a
  // navegacao e a edicao. Ancorar na ULTIMA ocorrencia acerta a tag de verdade.
  const corte = preparedHtml.lastIndexOf("</body>");
  if (corte === -1) return preparedHtml + script;
  return (
    preparedHtml.slice(0, corte) +
    script +
    preparedHtml.slice(corte)
  );
}

async function guardProposalAccess(request: Request) {
  const guard = await requireCommercialUser(request);
  if ("error" in guard) return guard;
  if (!podeVerPropostaKripto(guard.profile)) {
    return { error: NextResponse.json({ error: "Proposta restrita ao Leo e aos administradores." }, { status: 403 }) };
  }
  return guard;
}

export async function GET(request: Request) {
  const guard = await guardProposalAccess(request);
  if ("error" in guard) return guard.error;
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "leads") {
    const includeLeadId = String(url.searchParams.get("include_lead_id") || "").trim();
    const { data, error } = await supabaseAdmin.from("comercial_leads")
      .select("id,nome,empresa,reuniao_agendada_at,status")
      .eq("status", "Reuniões agendadas")
      .order("reuniao_agendada_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const leads = [...(data || [])];
    if (includeLeadId && !leads.some((lead) => lead.id === includeLeadId)) {
      const { data: currentLead, error: currentLeadError } = await supabaseAdmin.from("comercial_leads")
        .select("id,nome,empresa,reuniao_agendada_at,status")
        .eq("id", includeLeadId)
        .maybeSingle();
      if (currentLeadError) return NextResponse.json({ error: currentLeadError.message }, { status: 500 });
      if (currentLead) leads.unshift(currentLead);
    }
    return NextResponse.json({ leads });
  }
  if (url.searchParams.get("mode") === "list") {
    const { data: proposals, error } = await supabaseAdmin
      .from("comercial_propostas")
      .select("id,lead_id,nome_cliente,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const leadIds = (proposals || []).map((proposal) => proposal.lead_id);
    const { data: leads, error: leadsError } = leadIds.length
      ? await supabaseAdmin.from("comercial_leads").select("id,nome").in("id", leadIds)
      : { data: [], error: null };
    if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 });
    const nameByLead = new Map((leads || []).map((lead) => [lead.id, lead.nome]));
    return NextResponse.json({ proposals: (proposals || []).map((proposal) => ({ ...proposal, lead_nome: nameByLead.get(proposal.lead_id) || proposal.nome_cliente })) });
  }
  const proposalId = url.searchParams.get("proposal_id");
  if (proposalId) {
    const { data } = await supabaseAdmin.from("comercial_propostas")
      .select("id,lead_id,nome_cliente,html_snapshot")
      .eq("id", proposalId)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
    return new NextResponse(bridge(data.html_snapshot, null), { headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Orion-Proposal-Id": data.id,
      "X-Orion-Lead-Id": data.lead_id,
      "X-Orion-Client-Name": encodeURIComponent(data.nome_cliente),
    } });
  }

  const leadId = url.searchParams.get("lead_id");
  let leadForProposal: ProposalLead | null = null;
  if (leadId) {
    const { data: lead, error } = await supabaseAdmin.from("comercial_leads")
      .select("nome,empresa,status")
      .eq("id", leadId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!lead || lead.status !== "Reuniões agendadas") {
      return NextResponse.json({ error: "Selecione um lead que esteja em Reuniões agendadas." }, { status: 400 });
    }
    leadForProposal = { nome: lead.nome, empresa: lead.empresa };
  }

  if (!cache) cache = await readFile(ARQUIVO, "utf8").catch(() => null);
  if (!cache) {
    return NextResponse.json(
      { error: "Arquivo da proposta nao encontrado no servidor." },
      { status: 404 },
    );
  }

  return new NextResponse(bridge(applyLeadToCover(cache, leadForProposal), leadForProposal), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Nao e pagina publica: nem CDN nem navegador guardam copia.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function POST(request: Request) {
  const guard = await guardProposalAccess(request);
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));
  const leadId = String(body.lead_id || "").trim();
  const sourceProposalId = String(body.source_proposal_id || "").trim();
  const nomeCliente = String(body.nome_cliente || "").trim().slice(0, 160);
  const htmlSnapshot = String(body.html_snapshot || "");
  if (!leadId || !nomeCliente || !htmlSnapshot) return NextResponse.json({ error: "Informe o cliente, o lead agendado e a apresentação." }, { status: 400 });
  if (htmlSnapshot.length > MAX_SNAPSHOT_SIZE) return NextResponse.json({ error: "A apresentação excede o tamanho permitido." }, { status: 413 });
  const { data: lead } = await supabaseAdmin.from("comercial_leads").select("id,status").eq("id", leadId).maybeSingle();
  let cloningCurrentLead = false;
  if (sourceProposalId) {
    const { data: sourceProposal } = await supabaseAdmin.from("comercial_propostas")
      .select("id,lead_id")
      .eq("id", sourceProposalId)
      .maybeSingle();
    cloningCurrentLead = sourceProposal?.lead_id === leadId;
  }
  if (!lead || (lead.status !== "Reuniões agendadas" && !cloningCurrentLead)) {
    return NextResponse.json({ error: "Selecione um lead que esteja em Reuniões agendadas." }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.from("comercial_propostas")
    .insert({ lead_id: leadId, nome_cliente: nomeCliente, html_snapshot: htmlSnapshot, criado_por: guard.profile.id })
    .select("id,lead_id,nome_cliente,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ proposal: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const guard = await guardProposalAccess(request);
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));
  const proposalId = String(body.proposal_id || "").trim();
  const leadId = String(body.lead_id || "").trim();
  const nomeCliente = String(body.nome_cliente || "").trim().slice(0, 160);
  const htmlSnapshot = String(body.html_snapshot || "");
  if (!proposalId || !leadId || !nomeCliente || !htmlSnapshot) {
    return NextResponse.json({ error: "Informe a proposta, o cliente, o lead e a apresentação." }, { status: 400 });
  }
  if (htmlSnapshot.length > MAX_SNAPSHOT_SIZE) {
    return NextResponse.json({ error: "A apresentação excede o tamanho permitido." }, { status: 413 });
  }

  const { data: current } = await supabaseAdmin.from("comercial_propostas")
    .select("id,lead_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });

  if (current.lead_id !== leadId) {
    const { data: lead } = await supabaseAdmin.from("comercial_leads")
      .select("id,status")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead || lead.status !== "Reuniões agendadas") {
      return NextResponse.json({ error: "Para trocar o lead, selecione um contato em Reuniões agendadas." }, { status: 400 });
    }
  }

  const { data, error } = await supabaseAdmin.from("comercial_propostas")
    .update({ lead_id: leadId, nome_cliente: nomeCliente, html_snapshot: htmlSnapshot, updated_at: new Date().toISOString() })
    .eq("id", proposalId)
    .select("id,lead_id,nome_cliente,created_at,updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ proposal: data });
}

export async function DELETE(request: Request) {
  const guard = await guardProposalAccess(request);
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));
  const proposalId = String(body.proposal_id || "").trim();
  if (!proposalId) return NextResponse.json({ error: "Informe a proposta que deseja excluir." }, { status: 400 });

  const { data, error } = await supabaseAdmin.from("comercial_propostas")
    .delete()
    .eq("id", proposalId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
  return NextResponse.json({ deleted: true, proposal_id: data.id });
}
