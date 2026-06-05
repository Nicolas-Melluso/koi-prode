import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2';
import { createPool } from 'mysql2/promise';
import { AREAS, dbConfig, normalizeEmail, normalizeUsername } from '../src/common/config';
import { applyDatabaseTablePrefix } from '../src/common/table-prefix';

async function main(): Promise<void> {
  const email = normalizeEmail(process.env.ADMIN_EMAIL ?? 'nicolas.e.melluso@gmail.com');
  const username = normalizeUsername(process.env.ADMIN_USERNAME ?? 'nicolas');
  const password = process.env.ADMIN_PASSWORD;

  if (!password || password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be set locally and be at least 8 characters');
  }

  const pool = createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 2
  });

  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      applyDatabaseTablePrefix(`INSERT INTO users (email, username, password_hash, first_name, last_name, role)
       VALUES (?, ?, ?, ?, ?, 'ADMIN')
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         role = 'ADMIN',
         first_name = VALUES(first_name),
         last_name = VALUES(last_name)`),
      [email, username, passwordHash, 'Nicolas', 'Melluso']
    );

    const [rows] = await connection.query<({ id: number } & RowDataPacket)[]>(
      applyDatabaseTablePrefix(`SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1`),
      [email, username]
    );
    const userId = rows[0]?.id;
    if (!userId) {
      throw new Error('Admin user was not created');
    }

    for (const area of AREAS) {
      await connection.execute(
        applyDatabaseTablePrefix(`INSERT IGNORE INTO user_areas (user_id, area) VALUES (?, ?)`),
        [userId, area]
      );
    }

    await connection.execute(
      applyDatabaseTablePrefix(`INSERT INTO scores (user_id, last_recalculated_at)
       VALUES (?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE last_recalculated_at = VALUES(last_recalculated_at)`),
      [userId]
    );

    await connection.commit();
    console.log(`Admin ready: ${email} / ${username}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
