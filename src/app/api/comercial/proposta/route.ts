import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireCommercialUser } from "@/lib/api/comercial";
import { podeVerPropostaKripto } from "@/lib/propostaKripto";

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

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ("error" in guard) return guard.error;

  if (!podeVerPropostaKripto(guard.profile)) {
    return NextResponse.json(
      { error: "Proposta restrita ao Leo e aos administradores." },
      { status: 403 },
    );
  }

  if (!cache) cache = await readFile(ARQUIVO, "utf8").catch(() => null);
  if (!cache) {
    return NextResponse.json(
      { error: "Arquivo da proposta nao encontrado no servidor." },
      { status: 404 },
    );
  }

  return new NextResponse(cache, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Nao e pagina publica: nem CDN nem navegador guardam copia.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
