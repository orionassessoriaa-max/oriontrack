export type UnityMacroActions = {
  closeConversation: boolean;
  status: string | null;
  labelIds: string[];
};

export type UnityMacroMessage = {
  id: string;
  type: 'text' | 'audio' | 'file';
  text: string;
  audioBase64?: string;
  audioMimeType?: string;
  audioDuration?: string;
  fileBase64?: string;
  fileMimeType?: string;
  fileName?: string;
};

export type UnityMacro = {
  id: string;
  title: string;
  text: string;
  messages: UnityMacroMessage[];
  intervalSeconds: number;
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
    const legacyText = String(item?.text || '').trim().slice(0, 4000);
    const rawMessages = Array.isArray(item.messages) ? item.messages : [];
    const messages = rawMessages.slice(0, 10).flatMap((rawMessage, index) => {
      const message = rawMessage && typeof rawMessage === 'object'
        ? rawMessage as Record<string, unknown>
        : {};
      const type = message.type === 'audio' || message.type === 'file' ? message.type : 'text';
      const text = String(message.text || '').trim().slice(0, 4000);
      const audioBase64 = String(message.audioBase64 || '').trim();
      const fileBase64 = String(message.fileBase64 || '').trim();
      const validAudio = type === 'audio'
        && audioBase64.length > 0
        && audioBase64.length <= 3_000_000
        && /^[a-z0-9+/=]+$/i.test(audioBase64);
      const validFile = type === 'file'
        && fileBase64.length > 0
        && fileBase64.length <= 3_000_000
        && /^[a-z0-9+/=]+$/i.test(fileBase64);
      if (type === 'text' && !text) return [];
      if (type === 'audio' && !validAudio) return [];
      if (type === 'file' && !validFile) return [];
      return [{
        id: String(message.id || `mensagem-${index + 1}`),
        type,
        text,
        ...(validAudio ? {
          audioBase64,
          audioMimeType: String(message.audioMimeType || 'audio/webm').slice(0, 100),
          audioDuration: String(message.audioDuration || '').slice(0, 10),
        } : {}),
        ...(validFile ? {
          fileBase64,
          fileMimeType: String(message.fileMimeType || 'application/octet-stream').slice(0, 120),
          fileName: String(message.fileName || 'arquivo').replace(/[\\/]/g, '-').slice(0, 180),
        } : {}),
      } satisfies UnityMacroMessage];
    });
    if (messages.length === 0 && legacyText) {
      messages.push({ id: 'mensagem-1', type: 'text', text: legacyText });
    }
    const text = messages.find((message) => message.type === 'text')?.text
      || messages.find((message) => message.type === 'file')?.fileName
      || (messages.length ? '[Mensagem de voz]' : '');
    const key = title.toLocaleLowerCase('pt-BR');
    if (!title || messages.length === 0 || seen.has(key)) return [];
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
      messages,
      intervalSeconds: Math.min(120, Math.max(0, Number(item.intervalSeconds) || 0)),
      actions: {
        closeConversation: rawActions.closeConversation === true,
        status,
        labelIds,
      },
    }];
  });
}
