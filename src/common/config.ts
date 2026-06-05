import 'dotenv/config';

export const AREAS = ['LABS', 'TECH', 'ECOSYSTEM', 'GERENCIA'] as const;
export type Area = (typeof AREAS)[number];

export const STAGES = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'] as const;
export type Stage = (typeof STAGES)[number];

export const REGISTRATION_CODE = process.env.REGISTRATION_CODE ?? 'KOIPRODE123';

export const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-only-change-me';

function normalizeRoutePrefix(value: string | undefined): string {
  return (value ?? 'api/prode').trim().replace(/^\/+|\/+$/g, '');
}

export const API_ROUTE_PREFIX = normalizeRoutePrefix(process.env.API_ROUTE_PREFIX);

function normalizeTablePrefix(value: string | undefined): string {
  const prefix = value?.trim() ?? '';
  if (!prefix) {
    return '';
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(prefix)) {
    throw new Error('DATABASE_TABLE_PREFIX must contain only letters, numbers and underscores, and start with a letter');
  }
  return prefix;
}

export const DATABASE_TABLE_PREFIX = normalizeTablePrefix(process.env.DATABASE_TABLE_PREFIX);

export const dbConfig = {
  host: process.env.DATABASE_HOST ?? '127.0.0.1',
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER ?? 'root',
  password: process.env.DATABASE_PASSWORD ?? '',
  database: process.env.DATABASE_NAME ?? 'koi_prode'
};

export const smtpConfig = {
  host: process.env.SMTP_HOST ?? '',
  port: Number(process.env.SMTP_PORT ?? 587),
  user: process.env.SMTP_USER ?? '',
  password: process.env.SMTP_PASSWORD ?? '',
  from: process.env.SMTP_FROM ?? 'Koi Prode <no-reply@koi-prode.local>'
};

export const tournamentPointValues = {
  champion: {
    early: 40,
    before_r32: 25,
    before_qf: 15
  },
  finalist: {
    early: 20,
    before_r32: 12,
    before_qf: 8
  }
} as const;

export type TournamentLockTier = keyof typeof tournamentPointValues.champion;

export function isArea(value: string): value is Area {
  return (AREAS as readonly string[]).includes(value);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim();
}
