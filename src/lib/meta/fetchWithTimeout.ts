type FetchInit = RequestInit & { next?: { revalidate?: number } };

export async function fetchWithTimeout(url: string, init: FetchInit = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Tempo limite ao consultar a Meta (${timeoutMs / 1000}s).`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
