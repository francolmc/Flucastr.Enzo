import type { EmailAccountConfig, EmailProviderKind, ImapConnectionConfig } from './emailConfig.js';

function parseImap(imapRaw: unknown): ImapConnectionConfig | undefined {
  if (imapRaw === undefined || imapRaw === null) return undefined;
  if (!imapRaw || typeof imapRaw !== 'object') {
    throw new Error('imap debe ser un objeto con host y user');
  }
  const im = imapRaw as Record<string, unknown>;
  const host = typeof im.host === 'string' ? im.host.trim() : '';
  const user = typeof im.user === 'string' ? im.user.trim() : '';
  let port = 993;
  if (typeof im.port === 'number' && Number.isFinite(im.port)) {
    port = im.port;
  } else if (typeof im.port === 'string' && im.port.trim()) {
    const n = Number(im.port);
    if (!Number.isFinite(n)) throw new Error('imap.port inválido');
    port = n;
  }
  if (!host || !user) {
    return undefined;
  }
  if (port < 1 || port > 65535) {
    throw new Error('imap.port fuera de rango');
  }
  return { host, port: port || 993, user };
}

export function parseProviderField(p: unknown): EmailProviderKind {
  if (p === 'google') return 'google';
  if (p === 'microsoft') return 'microsoft';
  return 'imap';
}

export function normalizeAccountId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) {
    throw new Error('id obligatorio');
  }
  if (id.length > 96) {
    throw new Error('id demasiado largo (máx. 96 caracteres)');
  }
  return id;
}

/** Valida una fila igual que normalizeEmailConfig; lanza mensaje usable en API/UI. */
export function parseEmailAccountInput(raw: unknown): EmailAccountConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Cuerpo de cuenta inválido');
  }
  const o = raw as Record<string, unknown>;

  const id = normalizeAccountId(o.id);

  let label =
    typeof o.label === 'string' && o.label.trim().length > 0 ? o.label.trim() : id;

  const enabled = typeof o.enabled === 'boolean' ? o.enabled : true;
  const provider = parseProviderField(o.provider);

  const addressRaw = o.address;
  const address =
    typeof addressRaw === 'string' && addressRaw.trim().length > 0 ? addressRaw.trim() : undefined;

  let tenant = o.microsoftTenantId;
  let microsoftTenantId: string | undefined;
  if (typeof tenant === 'string' && tenant.trim().length > 0) {
    microsoftTenantId = tenant.trim();
  }

  let imap: EmailAccountConfig['imap'];
  if (Object.prototype.hasOwnProperty.call(o, 'imap')) {
    if (o.imap === null) {
      imap = undefined;
    } else {
      const parsed = parseImap(o.imap);
      if (parsed) imap = parsed;
      else if (o.imap && typeof o.imap === 'object') {
        throw new Error('IMAP: falta host o user válidos');
      }
    }
  }

  if (provider === 'imap') {
    if (!imap?.host || !imap.user) {
      throw new Error('Cuenta IMAP necesita host, usuario y después la contraseña');
    }
    return {
      id,
      label,
      provider: 'imap',
      imap,
      address,
      ...(microsoftTenantId ? { microsoftTenantId } : {}),
      enabled,
    };
  }

  return {
    id,
    label,
    provider,
    ...(imap ? { imap } : {}),
    address,
    ...(microsoftTenantId ? { microsoftTenantId } : {}),
    enabled,
  };
}

/** Igual que `parseEmailAccountInput` pero devuelve null si no válida (carga disco). */
export function tryParseEmailAccountInput(raw: unknown): EmailAccountConfig | null {
  try {
    return parseEmailAccountInput(raw);
  } catch {
    return null;
  }
}

export function mergeEmailAccountPatch(
  current: EmailAccountConfig,
  patchRaw: Record<string, unknown>
): EmailAccountConfig {
  const merged: Record<string, unknown> = {
    id: current.id,
    label: Object.prototype.hasOwnProperty.call(patchRaw, 'label')
      ? patchRaw.label
      : current.label,
    provider: Object.prototype.hasOwnProperty.call(patchRaw, 'provider')
      ? patchRaw.provider
      : current.provider,
    enabled:
      typeof patchRaw.enabled === 'boolean' ? patchRaw.enabled : current.enabled,
  };

  merged.address = Object.prototype.hasOwnProperty.call(patchRaw, 'address')
    ? patchRaw.address
    : (current.address ?? '');

  merged.microsoftTenantId = Object.prototype.hasOwnProperty.call(patchRaw, 'microsoftTenantId')
    ? patchRaw.microsoftTenantId
    : current.microsoftTenantId;

  merged.imap = Object.prototype.hasOwnProperty.call(patchRaw, 'imap')
    ? patchRaw.imap
    : current.imap;

  return parseEmailAccountInput(merged);
}
