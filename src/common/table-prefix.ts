import { DATABASE_TABLE_PREFIX } from './config';

export const PRODE_TABLES = [
  'admin_audit_logs',
  'tournament_predictions',
  'match_predictions',
  'notifications',
  'user_areas',
  'matches',
  'scores',
  'teams',
  'users'
] as const;

export type ProdeTableName = (typeof PRODE_TABLES)[number];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function prefixedTableName(table: ProdeTableName, prefix = DATABASE_TABLE_PREFIX): string {
  return `${prefix}${table}`;
}

export function applyDatabaseTablePrefix(sql: string, prefix = DATABASE_TABLE_PREFIX): string {
  if (!prefix) {
    return sql;
  }

  let nextSql = sql;
  for (const table of PRODE_TABLES) {
    const tablePattern = escapeRegExp(table);
    const tableContext = new RegExp(
      `(\\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?)(\`?)${tablePattern}\\2(?=\\b|\\s|\\(|;|,)`,
      'gi'
    );

    nextSql = nextSql.replace(tableContext, (_match, context: string, quote: string) => (
      `${context}${quote}${prefix}${table}${quote}`
    ));
  }

  return nextSql;
}
