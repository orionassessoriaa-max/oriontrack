import { NextResponse } from "next/server";
import { applyCommercialLeadScope, requireCommercialUser } from "@/lib/api/comercial";
import { buildCommercialBriefingPdf } from "@/lib/commercialBriefingPdf";
import { supabaseAdmin } from "@/lib/supabase/admin";

function safeFilename(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60) || "cliente";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireCommercialUser(request);
  if ("error" in guard) return guard.error;
  if (!guard.canViewCommercialFinancials) {
    return NextResponse.json({ error: "Somente o administrador pode baixar o briefing financeiro da venda." }, { status: 403 });
  }

  const { id } = await context.params;
  let query = supabaseAdmin.from("comercial_leads").select("*").eq("id", id);
  query = applyCommercialLeadScope(query, guard.commercialRole, guard.profile.id);
  const { data: lead, error } = await query.maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado ou sem permissão." }, { status: 404 });
  if (!lead.onboarding_briefing) {
    return NextResponse.json({ error: "O briefing desta venda ainda não foi gerado." }, { status: 404 });
  }

  const { data: seller } = lead.closer_id
    ? await supabaseAdmin.from("profiles").select("nome").eq("id", lead.closer_id).maybeSingle()
    : { data: null };
  const bytes = await buildCommercialBriefingPdf({
    leadName: lead.nome,
    company: lead.empresa,
    closedAt: lead.fechado_at,
    amountPaid: lead.valor_pago ?? lead.valor_fechado,
    paymentModel: lead.modelo_pagamento,
    sellerName: seller?.nome,
    briefing: lead.onboarding_briefing,
    generatedAt: lead.briefing_gerado_at,
  });
  const filename = `briefing-onboarding-${safeFilename(lead.nome)}.pdf`;
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
