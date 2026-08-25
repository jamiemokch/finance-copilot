type AuthOriginOptions = {
  nodeEnv?: string;
  previewDomain?: string;
};

type AuthOriginHeaders = {
  host?: string | string[];
  'x-forwarded-host'?: string | string[];
  'x-forwarded-proto'?: string | string[];
};

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',')[0]?.trim() || undefined;
}

function previewOrigin(previewDomain: string | undefined): string | undefined {
  if (!previewDomain?.trim()) return undefined;
  const candidate = previewDomain.includes('://')
    ? previewDomain
    : `https://${previewDomain}`;
  const url = new URL(candidate);
  return url.protocol === 'https:' ? url.origin : undefined;
}

/**
 * Replit preview requests can pass through API-specific proxy hops. OIDC must
 * return to the browser-visible preview host, which is supplied explicitly in
 * development; deployed environments continue to use the request origin.
 */
export function getAuthOrigin(
  headers: AuthOriginHeaders,
  options: AuthOriginOptions = {},
): string {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const configuredPreviewOrigin = previewOrigin(
    options.previewDomain ?? process.env.REPLIT_DEV_DOMAIN,
  );
  if (nodeEnv !== 'production' && configuredPreviewOrigin) {
    return configuredPreviewOrigin;
  }

  const protocol = firstHeaderValue(headers['x-forwarded-proto']) ?? 'https';
  const host = firstHeaderValue(headers['x-forwarded-host'])
    ?? firstHeaderValue(headers.host)
    ?? 'localhost';
  return new URL(`${protocol}://${host}`).origin;
}