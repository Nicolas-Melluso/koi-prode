import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { createPool } from 'mysql2/promise';

const databaseName = process.env.DATABASE_NAME || 'koi_prode';
const connectionConfig = {
  host: process.env.DATABASE_HOST || '127.0.0.1',
  port: Number(process.env.DATABASE_PORT || 3307),
  user: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 2,
  multipleStatements: true
};

const users = [
  {
    email: process.env.ADMIN_EMAIL || 'nicolas.e.melluso@gmail.com',
    username: process.env.ADMIN_USERNAME || 'nicolas',
    password: process.env.ADMIN_PASSWORD || 'koiadmin',
    firstName: 'Admin',
    lastName: 'Koi',
    role: 'ADMIN',
    areas: ['LABS', 'TECH', 'ECOSYSTEM', 'GERENCIA']
  },
  {
    email: 'qa.usuario1@koi.local',
    username: 'qa_usuario1',
    password: 'KoiProdeQA123!',
    firstName: 'QA',
    lastName: 'Usuario Uno',
    role: 'USER',
    areas: ['TECH']
  },
  {
    email: 'qa.usuario2@koi.local',
    username: 'qa_usuario2',
    password: 'KoiProdeQA123!',
    firstName: 'QA',
    lastName: 'Usuario Dos',
    role: 'USER',
    areas: ['LABS']
  }
];

async function main() {
  const schemaPath = path.resolve('database/schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  const pool = createPool(connectionConfig);
  const connection = await pool.getConnection();

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${databaseName}\``);
    await connection.query(schema);

    for (const user of users) {
      const passwordHash = await bcrypt.hash(user.password, 12);
      await connection.execute(
        `INSERT INTO users (email, username, password_hash, first_name, last_name, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.email.toLowerCase(), user.username.toLowerCase(), passwordHash, user.firstName, user.lastName, user.role]
      );
      const [rows] = await connection.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [user.email.toLowerCase()]);
      const userId = rows[0]?.id;
      for (const area of user.areas) {
        await connection.execute(`INSERT INTO user_areas (user_id, area) VALUES (?, ?)`, [userId, area]);
      }
      await connection.execute(
        `INSERT INTO scores (user_id, last_recalculated_at) VALUES (?, CURRENT_TIMESTAMP)`,
        [userId]
      );
    }

    console.log(`Reset OK: ${databaseName}`);
    for (const user of users) {
      console.log(`${user.role}: ${user.email} / ${user.username} / ${user.password}`);
    }
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
