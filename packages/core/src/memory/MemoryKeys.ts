export const MEMORY_KEYS = {
  NAME: 'name',
  CITY: 'city',
  PROFESSION: 'profession',
  PROJECTS: 'projects',
  PREFERENCES: 'preferences',
  ROUTINES: 'routines',
  FAMILY: 'family',
  OTHER: 'other',
} as const;

export type MemoryKey = (typeof MEMORY_KEYS)[keyof typeof MEMORY_KEYS];

// Mapa de normalización: variantes conocidas → key canónica
export const MEMORY_KEY_ALIASES: Record<string, MemoryKey> = {
  nombre: 'name',
  'full name': 'name',
  fullname: 'name',
  my_name: 'name',
  user_name: 'name',
  username: 'name',
  ciudad: 'city',
  location: 'city',
  ubicacion: 'city',
  ubicación: 'city',
  occupation: 'profession',
  ocupacion: 'profession',
  ocupación: 'profession',
  trabajo: 'profession',
  job: 'profession',
  role: 'profession',
  career: 'profession',
  work: 'profession',
  proyecto: 'projects',
  project: 'projects',
  proyectos: 'projects',
  projects: 'projects',
  'current project': 'projects',
  current_project: 'projects',
  preferencia: 'preferences',
  preference: 'preferences',
  rutina: 'routines',
  routine: 'routines',
  familia: 'family',
  otro: 'other',
  edad: 'other',
  age: 'other',
  idioma: 'other',
  lang: 'other',
  language: 'other',
  lugar: 'city',
  lugar_actual: 'city',
  residence: 'city',
};

export function normalizeMemoryKey(raw: string): MemoryKey {
  const lower = raw.toLowerCase().trim();
  return (
    MEMORY_KEY_ALIASES[lower] ??
    (Object.values(MEMORY_KEYS).includes(lower as MemoryKey) ? (lower as MemoryKey) : 'other')
  );
}

const CANONICAL_MEMORY_KEY_SET = new Set<string>(Object.values(MEMORY_KEYS));

/** Accepts only known API keys or aliases; rejects unknown strings (unlike normalizeMemoryKey, which maps them to `other`). */
export function parseMemoryKeyFromRequest(raw: string): MemoryKey | null {
  const lower = raw.toLowerCase().trim();
  if (lower.length === 0) {
    return null;
  }
  const fromAlias = MEMORY_KEY_ALIASES[lower];
  if (fromAlias) {
    return fromAlias;
  }
  if (CANONICAL_MEMORY_KEY_SET.has(lower)) {
    return lower as MemoryKey;
  }
  return null;
}
