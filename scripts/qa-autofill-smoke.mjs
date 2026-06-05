import 'dotenv/config';
import { createConnection } from 'mysql2/promise';

const baseUrl = `http://localhost:${process.env.PORT || 3000}`;

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const db = await createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3307),
    user: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || 'koi_prode'
  });

  try {
    await db.execute(`UPDATE matches SET prediction_closes_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE stage = 'group'`);

    const login = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'qa_usuario1', password: 'KoiProdeQA123!' })
    });
    const headers = { Authorization: `Bearer ${login.token}` };
    const [matches] = await db.query(`SELECT id FROM matches WHERE stage = 'r32' ORDER BY match_number, id LIMIT 1`);
    const matchId = matches[0]?.id;
    if (!matchId) throw new Error('No r32 match found');

    await api('/api/predictions/match', {
      method: 'POST',
      headers,
      body: JSON.stringify({ matchId, homeScore: 1, awayScore: 0 })
    });

    const [counts] = await db.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN auto_filled = 1 THEN 1 ELSE 0 END) AS auto_filled,
         SUM(CASE WHEN auto_filled = 0 THEN 1 ELSE 0 END) AS manual_count
       FROM match_predictions
       WHERE user_id = ?`,
      [login.user.id]
    );
    console.log(JSON.stringify({ ok: true, matchId, counts: counts[0] }));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
