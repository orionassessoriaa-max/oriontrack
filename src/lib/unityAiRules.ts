function normalizeUnityText(text?: string | null) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export const UNITY_PLAN_GUARDRAILS = `Regras comerciais obrigatorias e exclusivas da Unity Saude:
- A Unity trabalha somente com planos de cobertura regional. Nao ofereca cobertura nacional.
- Nunca pergunte se o cliente prefere cobertura nacional ou regional.
- Se o cliente pedir ou responder "nacional", explique com naturalidade que a Unity trabalha com cobertura regional e continue a qualificacao considerando apenas a modalidade regional.
- Nunca confirme que a cobertura sera nacional e nunca registre cobertura nacional no resumo.
- Leia todo o historico antes de responder. Nao repita pergunta ja respondida nem envie a mesma mensagem duas vezes.`;

export function isUnityCoverageQuestion(text?: string | null) {
  const normalized = normalizeUnityText(text);
  return (
    normalized.includes('cobertura nacional ou regional') ||
    normalized.includes('nacional ou regional') ||
    (normalized.includes('cobertura') && normalized.includes('nacional') && normalized.includes('regional'))
  );
}

export function enforceUnityRegionalReply(reply: string, nextQuestion: string) {
  const normalized = normalizeUnityText(reply);
  const discussesCoverage = normalized.includes('nacional') || isUnityCoverageQuestion(reply);
  if (!discussesCoverage) return reply;

  const remaining = (reply.match(/[^.!?]+[.!?]?/g) || [])
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const value = normalizeUnityText(part);
      return !value.includes('nacional') && !isUnityCoverageQuestion(part);
    })
    .join(' ')
    .trim();

  const correction = 'Na Unity, trabalhamos somente com planos de cobertura regional.';
  return `${correction} ${remaining || nextQuestion}`.trim();
}
