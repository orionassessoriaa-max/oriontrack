function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeValue(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function deepValues(value: unknown, keys: string[], depth = 0): string[] {
  if (!value || depth > 8) return [];
  const wanted = new Set(keys.map(normalizeKey));
  const found: string[] = [];

  if (Array.isArray(value)) {
    for (const item of value) found.push(...deepValues(item, keys, depth + 1));
    return found;
  }
  if (typeof value !== 'object') return found;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (wanted.has(normalizeKey(key)) && (typeof item === 'string' || typeof item === 'boolean')) {
      const text = String(item).trim();
      if (text) found.push(text);
    }
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    found.push(...deepValues(item, keys, depth + 1));
  }
  return found;
}

function hasValue(payload: unknown, keys: string[], predicate: (value: string) => boolean) {
  return deepValues(payload, keys).some((value) => predicate(normalizeValue(value)));
}

export function isClickToWhatsAppAd(payload: unknown) {
  if (deepValues(payload, ['ctwaClid', 'ctwa_clid']).some(Boolean)) return true;

  if (hasValue(payload, ['sourceType', 'source_type'], (value) => value === 'ad' || value.includes('advert'))) {
    return true;
  }

  if (hasValue(payload, ['conversionSource', 'conversion_source'], (value) => value === 'fb_ads' || value === 'facebook_ads')) {
    return true;
  }

  if (hasValue(payload, ['entryPointConversionSource', 'entry_point_conversion_source'], (value) => value.includes('ctwa_ad'))) {
    return true;
  }

  const isInstagramOrFacebookEntry = hasValue(
    payload,
    ['entryPointConversionApp', 'entry_point_conversion_app', 'sourceApp', 'source_app'],
    (value) => value === 'instagram' || value === 'facebook'
  );
  const hasAdAttribution = hasValue(
    payload,
    ['showAdAttribution', 'show_ad_attribution', 'clickToWhatsappCall', 'click_to_whatsapp_call'],
    (value) => value === 'true'
  );
  if (isInstagramOrFacebookEntry && hasAdAttribution) return true;

  return hasValue(payload, ['sourceUrl', 'source_url'], (value) => (
    value.includes('facebook.com/ads') ||
    value.includes('instagram.com/ads')
  ));
}
