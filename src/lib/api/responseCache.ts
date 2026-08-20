import 'server-only';

/**
 * Cache curto em memoria para rotas que varrem tabela inteira e sao chamadas em
 * laco pela tela. Sem isso, cinco abas abertas viram cinco varreduras por
 * intervalo de polling, e o banco leva a carga multiplicada pelo numero de
 * pessoas com o CRM aberto.
 *
 * Vale por container. Nao substitui indice nem paginacao: serve para achatar o
 * pico de leituras identicas dentro de poucos segundos.
 */
type Entry = { expiresAt: number; value: unknown };

const store = new Map<string, Entry>();
const MAX_ENTRIES = 200;

function prune(now: number) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  if (store.size <= MAX_ENTRIES) return;
  const excess = store.size - MAX_ENTRIES;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
}

export async function cachedPayload<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = store.get(key);
  if (cached && cached.expiresAt > now) return cached.value as T;

  const value = await loader();
  store.set(key, { expiresAt: now + ttlMs, value });
  prune(now);
  return value;
}

/** Usar depois de gravar algo que a rota em cache le, para a tela nao ficar velha. */
export function invalidateCachedPayload(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
