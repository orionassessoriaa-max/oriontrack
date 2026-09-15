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
  const script = `<script>(function(){var client=document.getElementById('clientName');var lead=${leadData};function setText(selector,value){document.querySelectorAll(selector).forEach(function(element){element.textContent=value})}if(lead){var date=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date());date=date.charAt(0).toUpperCase()+date.slice(1);setText('[data-proposal-client]',lead.nome);setText('[data-proposal-segment]',lead.empresa||'Corretora de planos de saúde');setText('[data-proposal-date]',date);if(client)client.value=lead.nome}if(!client)return;function tell(type,extra){window.parent.postMessage(Object.assign({type:type,clientName:client.value.trim()},extra||{}),'*')}client.addEventListener('change',function(){tell('orion-proposal-client-changed')});window.addEventListener('message',function(event){if(!event.data||event.data.type!=='orion-proposal-snapshot-request')return;var state={client:client.value,texts:{},mod:'mensal',prices:null};try{var saved=JSON.parse(localStorage.getItem('orion-proposta-v2')||'{}');state.mod=saved.mod||state.mod;state.prices=saved.prices||state.prices;state.texts=saved.texts||state.texts}catch(error){}document.querySelectorAll('[contenteditable]').forEach(function(element,index){state.texts[index]=element.innerHTML});var output='<!doctype html>'+document.documentElement.outerHTML;output=output.replace('<script id="pageScript">','<script>window.__ORION_BAKED__=true;window.__ORION_STATE__='+JSON.stringify(state).replace(/<\\/script/gi,'<\\\\/script')+';<\\/script><script id="pageScript">');tell('orion-proposal-snapshot',{html:output})})})();</script>`;
  return html.replace(/<\/body>/i, `${script}</body>`);
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
    const { data, error } = await supabaseAdmin.from("comercial_leads")
      .select("id,nome,empresa,reuniao_agendada_at,status")
      .eq("status", "Reuniões agendadas")
      .order("reuniao_agendada_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ leads: data || [] });
  }
  if (url.searchParams.get("mode") === "list") {
    const { data: proposals, error } = await supabaseAdmin
      .from("comercial_propostas")
      .select("id,lead_id,nome_cliente,created_at")
      .order("created_at", { ascending: false })
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
    const { data } = await supabaseAdmin.from("comercial_propostas").select("html_snapshot").eq("id", proposalId).maybeSingle();
    if (!data) return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
    return new NextResponse(data.html_snapshot, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
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
  const nomeCliente = String(body.nome_cliente || "").trim().slice(0, 160);
  const htmlSnapshot = String(body.html_snapshot || "");
  if (!leadId || !nomeCliente || !htmlSnapshot) return NextResponse.json({ error: "Informe o cliente, o lead agendado e a apresentação." }, { status: 400 });
  if (htmlSnapshot.length > MAX_SNAPSHOT_SIZE) return NextResponse.json({ error: "A apresentação excede o tamanho permitido." }, { status: 413 });
  const { data: lead } = await supabaseAdmin.from("comercial_leads").select("id,status").eq("id", leadId).maybeSingle();
  if (!lead || lead.status !== "Reuniões agendadas") return NextResponse.json({ error: "Selecione um lead que esteja em Reuniões agendadas." }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("comercial_propostas")
    .insert({ lead_id: leadId, nome_cliente: nomeCliente, html_snapshot: htmlSnapshot, criado_por: guard.profile.id })
    .select("id,lead_id,nome_cliente,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ proposal: data }, { status: 201 });
}
