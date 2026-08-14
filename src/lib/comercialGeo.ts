// Origem geografica dos leads a partir do telefone.
//
// O DDD e a unica pista de localizacao confiavel que todo lead tem, ja que o
// campo `estado` so vem preenchido em parte das origens. A tabela abaixo era
// duplicada dentro de /api/comercial/overview e passou a viver aqui para a sala
// imersiva e o dashboard lerem a mesma fonte.

export type BrazilRegion =
  | "Norte"
  | "Nordeste"
  | "Centro-Oeste"
  | "Sudeste"
  | "Sul";

export const DDD_STATE: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ", "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC", "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF", "62": "GO", "63": "TO", "64": "GO", "65": "MT", "66": "MT", "67": "MS",
  "68": "AC", "69": "RO", "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA", "79": "SE",
  "81": "PE", "82": "AL", "83": "PB", "84": "RN", "85": "CE", "86": "PI", "87": "PE", "88": "CE", "89": "PI",
  "91": "PA", "92": "AM", "93": "PA", "94": "PA", "95": "RR", "96": "AP", "97": "AM", "98": "MA", "99": "MA",
};

// Cidade de referencia e coordenada aproximada de cada DDD. Serve para o pino
// pulsar perto de onde o lead entrou, e nao no centro do estado inteiro.
export const DDD_INFO: Record<string, { cidade: string; lat: number; lon: number }> = {
  "11": { cidade: "São Paulo", lat: -23.55, lon: -46.63 },
  "12": { cidade: "São José dos Campos", lat: -23.18, lon: -45.88 },
  "13": { cidade: "Santos", lat: -23.96, lon: -46.33 },
  "14": { cidade: "Bauru", lat: -22.31, lon: -49.06 },
  "15": { cidade: "Sorocaba", lat: -23.5, lon: -47.46 },
  "16": { cidade: "Ribeirão Preto", lat: -21.17, lon: -47.81 },
  "17": { cidade: "São José do Rio Preto", lat: -20.81, lon: -49.37 },
  "18": { cidade: "Presidente Prudente", lat: -22.12, lon: -51.38 },
  "19": { cidade: "Campinas", lat: -22.9, lon: -47.06 },
  "21": { cidade: "Rio de Janeiro", lat: -22.9, lon: -43.2 },
  "22": { cidade: "Campos dos Goytacazes", lat: -21.75, lon: -41.33 },
  "24": { cidade: "Volta Redonda", lat: -22.52, lon: -44.1 },
  "27": { cidade: "Vitória", lat: -20.32, lon: -40.34 },
  "28": { cidade: "Cachoeiro de Itapemirim", lat: -20.85, lon: -41.11 },
  "31": { cidade: "Belo Horizonte", lat: -19.92, lon: -43.94 },
  "32": { cidade: "Juiz de Fora", lat: -21.76, lon: -43.35 },
  "33": { cidade: "Governador Valadares", lat: -18.85, lon: -41.95 },
  "34": { cidade: "Uberlândia", lat: -18.91, lon: -48.28 },
  "35": { cidade: "Poços de Caldas", lat: -21.79, lon: -46.56 },
  "37": { cidade: "Divinópolis", lat: -20.14, lon: -44.88 },
  "38": { cidade: "Montes Claros", lat: -16.73, lon: -43.86 },
  "41": { cidade: "Curitiba", lat: -25.43, lon: -49.27 },
  "42": { cidade: "Ponta Grossa", lat: -25.09, lon: -50.16 },
  "43": { cidade: "Londrina", lat: -23.31, lon: -51.16 },
  "44": { cidade: "Maringá", lat: -23.42, lon: -51.94 },
  "45": { cidade: "Foz do Iguaçu", lat: -25.55, lon: -54.59 },
  "46": { cidade: "Francisco Beltrão", lat: -26.08, lon: -53.05 },
  "47": { cidade: "Joinville", lat: -26.3, lon: -48.85 },
  "48": { cidade: "Florianópolis", lat: -27.6, lon: -48.55 },
  "49": { cidade: "Chapecó", lat: -27.1, lon: -52.62 },
  "51": { cidade: "Porto Alegre", lat: -30.03, lon: -51.23 },
  "53": { cidade: "Pelotas", lat: -31.77, lon: -52.34 },
  "54": { cidade: "Caxias do Sul", lat: -29.17, lon: -51.18 },
  "55": { cidade: "Santa Maria", lat: -29.68, lon: -53.81 },
  "61": { cidade: "Brasília", lat: -15.79, lon: -47.88 },
  "62": { cidade: "Goiânia", lat: -16.68, lon: -49.25 },
  "63": { cidade: "Palmas", lat: -10.18, lon: -48.33 },
  "64": { cidade: "Rio Verde", lat: -17.79, lon: -50.93 },
  "65": { cidade: "Cuiabá", lat: -15.6, lon: -56.1 },
  "66": { cidade: "Rondonópolis", lat: -16.47, lon: -54.64 },
  "67": { cidade: "Campo Grande", lat: -20.45, lon: -54.62 },
  "68": { cidade: "Rio Branco", lat: -9.97, lon: -67.81 },
  "69": { cidade: "Porto Velho", lat: -8.76, lon: -63.9 },
  "71": { cidade: "Salvador", lat: -12.97, lon: -38.5 },
  "73": { cidade: "Ilhéus", lat: -14.79, lon: -39.03 },
  "74": { cidade: "Juazeiro", lat: -9.42, lon: -40.5 },
  "75": { cidade: "Feira de Santana", lat: -12.27, lon: -38.97 },
  "77": { cidade: "Barreiras", lat: -12.15, lon: -44.99 },
  "79": { cidade: "Aracaju", lat: -10.91, lon: -37.07 },
  "81": { cidade: "Recife", lat: -8.05, lon: -34.88 },
  "82": { cidade: "Maceió", lat: -9.67, lon: -35.74 },
  "83": { cidade: "João Pessoa", lat: -7.12, lon: -34.86 },
  "84": { cidade: "Natal", lat: -5.79, lon: -35.21 },
  "85": { cidade: "Fortaleza", lat: -3.73, lon: -38.53 },
  "86": { cidade: "Teresina", lat: -5.09, lon: -42.8 },
  "87": { cidade: "Petrolina", lat: -9.39, lon: -40.5 },
  "88": { cidade: "Sobral", lat: -3.69, lon: -40.35 },
  "89": { cidade: "Picos", lat: -7.08, lon: -41.47 },
  "91": { cidade: "Belém", lat: -1.46, lon: -48.5 },
  "92": { cidade: "Manaus", lat: -3.12, lon: -60.02 },
  "93": { cidade: "Santarém", lat: -2.44, lon: -54.71 },
  "94": { cidade: "Marabá", lat: -5.37, lon: -49.12 },
  "95": { cidade: "Boa Vista", lat: 2.82, lon: -60.67 },
  "96": { cidade: "Macapá", lat: 0.03, lon: -51.07 },
  "97": { cidade: "Coari", lat: -4.09, lon: -63.14 },
  "98": { cidade: "São Luís", lat: -2.53, lon: -44.3 },
  "99": { cidade: "Imperatriz", lat: -5.53, lon: -47.48 },
};

const REGION_BY_STATE: Record<string, BrazilRegion> = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste",
  PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

export function regionForState(state?: string | null): BrazilRegion | null {
  return REGION_BY_STATE[String(state || "").toUpperCase()] || null;
}

/** Extrai o DDD de um telefone em qualquer formato, com ou sem o 55 na frente. */
export function dddFromPhone(phone: unknown): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  const national =
    digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  const ddd = national.slice(0, 2);
  return DDD_STATE[ddd] ? ddd : null;
}

export function stateFromPhone(phone: unknown): string | null {
  const ddd = dddFromPhone(phone);
  return ddd ? DDD_STATE[ddd] : null;
}

export function cityFromDdd(ddd?: string | null): string | null {
  return DDD_INFO[String(ddd || "")]?.cidade || null;
}

/** Estado do lead: o campo declarado vence, o DDD e o plano B. */
export function leadState(lead: {
  estado?: string | null;
  telefone?: string | null;
}): string | null {
  const declared = String(lead.estado || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(declared) && REGION_BY_STATE[declared]) return declared;
  return stateFromPhone(lead.telefone);
}
