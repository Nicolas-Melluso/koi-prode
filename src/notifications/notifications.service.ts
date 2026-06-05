import { BadRequestException, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { RowDataPacket } from 'mysql2';
import { AREAS, isArea, smtpConfig } from '../common/config';
import { DbService } from '../common/db.service';

interface CreateNotificationBody {
  title: string;
  body: string;
  channel: 'banner' | 'email' | 'banner_email';
  targetArea?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

interface UserEmailRow extends RowDataPacket {
  email: string;
  first_name: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  async activeForUser(userId: number) {
    const areas = await this.db.query<{ area: string } & RowDataPacket>(
      `SELECT area FROM user_areas WHERE user_id = ?`,
      [userId]
    );
    const areaValues = areas.map((row) => row.area);

    if (areaValues.length === 0) {
      return [];
    }

    const placeholders = areaValues.map(() => '?').join(', ');
    return this.db.query<RowDataPacket>(
      `SELECT id, title, body, channel, target_area, starts_at, ends_at, created_at
       FROM notifications
       WHERE channel IN ('banner', 'banner_email')
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at > NOW())
         AND (target_area IS NULL OR target_area IN (${placeholders}))
       ORDER BY created_at DESC
       LIMIT 1`,
      areaValues
    );
  }

  async activeBannersForAdmin() {
    return this.db.query<RowDataPacket>(
      `SELECT id, title, body, channel, target_area, starts_at, ends_at, created_at
       FROM notifications
       WHERE channel IN ('banner', 'banner_email')
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at > NOW())
       ORDER BY created_at DESC
       LIMIT 1`
    );
  }

  async create(actorUserId: number, body: CreateNotificationBody) {
    if (!body.title?.trim() || !body.body?.trim()) {
      throw new BadRequestException('Title and body are required');
    }

    if (!['banner', 'email', 'banner_email'].includes(body.channel)) {
      throw new BadRequestException('Invalid notification channel');
    }

    if (body.targetArea && !isArea(body.targetArea)) {
      throw new BadRequestException(`Invalid target area. Allowed: ${AREAS.join(', ')}`);
    }

    if (body.channel.includes('banner')) {
      await this.expireActiveBanners();
    }

    const result = await this.db.execute(
      `INSERT INTO notifications (
         title, body, channel, target_area, starts_at, ends_at, email_status, created_by
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.title.trim(),
        body.body.trim(),
        body.channel,
        body.targetArea || null,
        body.startsAt || null,
        body.endsAt || null,
        body.channel.includes('email') ? 'pending' : 'not_requested',
        actorUserId
      ]
    );

    let emailStatus: 'not_requested' | 'not_configured' | 'sent' | 'failed' = 'not_requested';
    if (body.channel.includes('email')) {
      emailStatus = await this.sendEmail(result.insertId, body);
    }

    return {
      id: result.insertId,
      emailStatus
    };
  }

  async delete(id: number): Promise<{ ok: true }> {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT id
       FROM notifications
       WHERE id = ?
         AND channel IN ('banner', 'banner_email')
       LIMIT 1`,
      [id]
    );
    if (!rows[0]) {
      throw new BadRequestException('Notification not found');
    }

    await this.db.execute(
      `DELETE FROM notifications
       WHERE channel IN ('banner', 'banner_email')
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at > NOW())`
    );

    return { ok: true };
  }

  private async expireActiveBanners(): Promise<void> {
    await this.db.execute(
      `UPDATE notifications
       SET ends_at = NOW()
       WHERE channel IN ('banner', 'banner_email')
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at > NOW())`
    );
  }

  private async sendEmail(notificationId: number, body: CreateNotificationBody): Promise<'not_configured' | 'sent' | 'failed'> {
    if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.password) {
      return 'not_configured';
    }

    const users = await this.emailRecipients(body.targetArea ?? null);
    if (users.length === 0) {
      await this.db.execute(`UPDATE notifications SET email_status = 'sent' WHERE id = ?`, [notificationId]);
      return 'sent';
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.port === 465,
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.password
        }
      });

      await transporter.sendMail({
        from: smtpConfig.from,
        to: users.map((user) => user.email),
        subject: body.title.trim(),
        text: body.body.trim()
      });

      await this.db.execute(`UPDATE notifications SET email_status = 'sent' WHERE id = ?`, [notificationId]);
      return 'sent';
    } catch {
      await this.db.execute(`UPDATE notifications SET email_status = 'failed' WHERE id = ?`, [notificationId]);
      return 'failed';
    }
  }

  private async emailRecipients(area: string | null): Promise<UserEmailRow[]> {
    if (!area) {
      return this.db.query<UserEmailRow>(`SELECT email, first_name FROM users ORDER BY email`);
    }

    return this.db.query<UserEmailRow>(
      `SELECT DISTINCT u.email, u.first_name
       FROM users u
       JOIN user_areas ua ON ua.user_id = u.id
       WHERE ua.area = ?
       ORDER BY u.email`,
      [area]
    );
  }
}
