export type UnityMacroActions = {
  closeConversation: boolean;
  status: string | null;
  labelIds: string[];
};

export type UnityMacro = {
  id: string;
  title: string;
  text: string;
  actions: UnityMacroActions;
};

export function sanitizeUnityMacros(value: unknown): UnityMacro[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.slice(0, 50).flatMap((rawItem) => {
    const item = rawItem && typeof rawItem === 'object' ? rawItem as Record<string, unknown> : {};
    const rawActions = item.actions && typeof item.actions === 'object'
      ? item.actions as Record<string, unknown>
      : {};
    const title = String(item?.title || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const text = String(item?.text || '').trim().slice(0, 4000);
    const key = title.toLocaleLowerCase('pt-BR');
    if (!title || !text || seen.has(key)) return [];
    seen.add(key);

    const status = String(rawActions.status || '').trim().slice(0, 80) || null;
    const labelIds = Array.from(new Set(
      (Array.isArray(rawActions.labelIds) ? rawActions.labelIds : [])
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean),
    )).slice(0, 20) as string[];

    return [{
      id: String(item?.id || crypto.randomUUID()),
      title,
      text,
      actions: {
        closeConversation: rawActions.closeConversation === true,
        status,
        labelIds,
      },
    }];
  });
}
