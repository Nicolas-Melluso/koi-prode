import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RowDataPacket } from 'mysql2';
import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import {
  AREAS,
  JWT_SECRET,
  REGISTRATION_CODE,
  isArea,
  normalizeEmail,
  normalizeUsername
} from '../common/config';
import { DbService } from '../common/db.service';
import type { AuthUser, LoginBody, RegisterBody, UserRow } from '../common/types';

interface AreaRow extends RowDataPacket {
  area: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  async register(body: RegisterBody): Promise<{ token: string; user: AuthUser; areas: string[] }> {
    this.validateRegisterBody(body);

    const email = normalizeEmail(body.email);
    const username = normalizeUsername(body.username);
    const passwordHash = await bcrypt.hash(body.password, 12);

    try {
      const userId = await this.db.transaction(async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO users (email, username, password_hash, first_name, last_name)
           VALUES (?, ?, ?, ?, ?)`,
          [email, username, passwordHash, body.firstName.trim(), body.lastName.trim()]
        );

        await this.insertAreas(connection, result.insertId, body.areas);
        await connection.execute(
          `INSERT INTO scores (user_id, last_recalculated_at)
           VALUES (?, CURRENT_TIMESTAMP)
           ON DUPLICATE KEY UPDATE last_recalculated_at = VALUES(last_recalculated_at)`,
          [result.insertId]
        );

        return result.insertId;
      });

      const user = await this.getAuthUserById(userId);
      return { token: this.sign(user), user, areas: body.areas };
    } catch (error) {
      if (this.isDuplicateError(error)) {
        throw new ConflictException('Email or username already exists');
      }
      throw error;
    }
  }

  async login(body: LoginBody): Promise<{ token: string; user: AuthUser; areas: string[] }> {
    if (!body.identifier?.trim() || !body.password) {
      throw new BadRequestException('Identifier and password are required');
    }

    const identifier = body.identifier.trim().toLowerCase();
    const rows = await this.db.query<UserRow & RowDataPacket>(
      `SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1`,
      [identifier, identifier]
    );

    const row = rows[0];
    if (!row) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(body.password, row.password_hash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = this.toAuthUser(row);
    return { token: this.sign(user), user, areas: await this.getAreas(user.id) };
  }

  async getAuthUserById(id: number): Promise<AuthUser> {
    const rows = await this.db.query<UserRow & RowDataPacket>(`SELECT * FROM users WHERE id = ?`, [id]);
    if (!rows[0]) {
      throw new UnauthorizedException('User not found');
    }
    return this.toAuthUser(rows[0]);
  }

  async getAreas(userId: number): Promise<string[]> {
    const rows = await this.db.query<AreaRow>(`SELECT area FROM user_areas WHERE user_id = ? ORDER BY area`, [userId]);
    return rows.map((row) => row.area);
  }

  private validateRegisterBody(body: RegisterBody): void {
    if (body.code !== REGISTRATION_CODE) {
      throw new BadRequestException('Invalid registration code');
    }

    if (!body.firstName?.trim() || !body.lastName?.trim()) {
      throw new BadRequestException('First name and last name are required');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email ?? '')) {
      throw new BadRequestException('Valid email is required');
    }

    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(body.username ?? '')) {
      throw new BadRequestException('Username must be 1-80 characters using letters, numbers, dot, dash or underscore');
    }

    if (!body.password || body.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    if (!Array.isArray(body.areas) || body.areas.length === 0) {
      throw new BadRequestException('At least one area is required');
    }

    const invalid = body.areas.filter((area) => !isArea(area));
    if (invalid.length > 0) {
      throw new BadRequestException(`Invalid area. Allowed: ${AREAS.join(', ')}`);
    }
  }

  private async insertAreas(connection: PoolConnection, userId: number, areas: string[]): Promise<void> {
    const uniqueAreas = Array.from(new Set(areas));
    for (const area of uniqueAreas) {
      await connection.execute(`INSERT INTO user_areas (user_id, area) VALUES (?, ?)`, [userId, area]);
    }
  }

  private toAuthUser(row: UserRow): AuthUser {
    return {
      id: Number(row.id),
      email: row.email,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role
    };
  }

  private sign(user: AuthUser): string {
    return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
  }

  private isDuplicateError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
  }
}
