import { BadRequestException, Injectable } from '@nestjs/common';
import { RowDataPacket } from 'mysql2';
import { DbService } from '../common/db.service';
import type { AuthUser } from '../common/types';
import { FixtureService } from '../fixture/fixture.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ScoringService } from '../scoring/scoring.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DbService,
    private readonly fixture: FixtureService,
    private readonly scoring: ScoringService,
    private readonly notifications: NotificationsService
  ) {}

  async previewWorldCup26Import(actor: AuthUser) {
    const result = await this.fixture.previewWorldCup26Import();
    await this.audit(actor.id, 'fixture.preview_worldcup26', 'fixture', null, {
      summary: result.summary,
      api: result.api,
      local: result.local
    });
    return result;
  }

  async importWorldCup26(actor: AuthUser) {
    const result = await this.fixture.importWorldCup26();
    await this.audit(actor.id, 'fixture.import_worldcup26', 'fixture', null, result);
    return result;
  }

  async recalculateLocks(actor: AuthUser) {
    const result = await this.fixture.recalculatePredictionLocks();
    await this.audit(actor.id, 'locks.recalculate', 'matches', null, result);
    return result;
  }

  async updateMatchResult(
    actor: AuthUser,
    matchId: number,
    body: { homeScore: number; awayScore: number; homeTeamId?: number; awayTeamId?: number }
  ) {
    const match = await this.fixture.getMatch(matchId);
    const homeScore = Number(body.homeScore);
    const awayScore = Number(body.awayScore);
    const isKnockout = match.stage !== 'group';
    let homeTeamId = match.home_team_id ? Number(match.home_team_id) : null;
    let awayTeamId = match.away_team_id ? Number(match.away_team_id) : null;

    if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
      throw new BadRequestException('Scores must be non-negative integers');
    }

    if (isKnockout) {
      homeTeamId = body.homeTeamId ? Number(body.homeTeamId) : homeTeamId;
      awayTeamId = body.awayTeamId ? Number(body.awayTeamId) : awayTeamId;

      if (!homeTeamId || !awayTeamId) {
        throw new BadRequestException('Knockout matches need both real teams before saving the result');
      }

      if (homeTeamId === awayTeamId) {
        throw new BadRequestException('Real teams must be different');
      }

      await this.assertTeamsExist([homeTeamId, awayTeamId]);
    } else if (!homeTeamId || !awayTeamId) {
      throw new BadRequestException('Group matches need fixed teams before saving the result');
    }

    if (isKnockout && homeScore === awayScore) {
      throw new BadRequestException('Knockout matches need a winner in Koi Prode');
    }

    await this.db.execute(
      `UPDATE matches
       SET home_team_id = ?,
           away_team_id = ?,
           home_score = ?,
           away_score = ?,
           finished = 1,
           status = 'completed'
       WHERE id = ?`,
      [homeTeamId, awayTeamId, homeScore, awayScore, matchId]
    );

    await this.audit(actor.id, 'match.result_update', 'match', String(matchId), {
      homeTeamId,
      awayTeamId,
      homeScore,
      awayScore
    });

    return { ok: true };
  }

  async recalculateScores(actor: AuthUser) {
    const result = await this.scoring.recalculateAll();
    await this.audit(actor.id, 'scores.recalculate', 'scores', null, result);
    return result;
  }

  private async assertTeamsExist(teamIds: number[]): Promise<void> {
    const uniqueIds = Array.from(new Set(teamIds));
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = await this.db.query<RowDataPacket>(
      `SELECT id FROM teams WHERE id IN (${placeholders})`,
      uniqueIds
    );
    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException('One or more selected teams do not exist');
    }
  }

  async users() {
    return this.db.query<RowDataPacket>(
      `SELECT
         u.id,
         u.email,
         u.username,
         u.first_name,
         u.last_name,
         u.role,
         u.created_at,
         GROUP_CONCAT(ua.area ORDER BY ua.area SEPARATOR ', ') AS areas
       FROM users u
       LEFT JOIN user_areas ua ON ua.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
  }

  async predictions() {
    return this.db.query<RowDataPacket>(
      `SELECT
         p.id,
         p.user_id,
         CONCAT(u.first_name, ' ', u.last_name) AS user_name,
         m.match_number,
         m.stage,
         COALESCE(ht.name, m.home_placeholder) AS home_team,
         COALESCE(at.name, m.away_placeholder) AS away_team,
         p.predicted_home_score,
         p.predicted_away_score,
         p.auto_filled,
         p.points,
         p.submitted_at,
         m.prediction_closes_at,
         CASE
           WHEN m.prediction_closes_at IS NOT NULL AND NOW() >= m.prediction_closes_at THEN 1
           ELSE 0
         END AS locked
       FROM match_predictions p
       JOIN users u ON u.id = p.user_id
       JOIN matches m ON m.id = p.match_id
       LEFT JOIN teams ht ON ht.id = m.home_team_id
       LEFT JOIN teams at ON at.id = m.away_team_id
       ORDER BY m.match_number, u.last_name, u.first_name`
    );
  }

  async listNotifications() {
    return this.notifications.activeBannersForAdmin();
  }

  async createNotification(
    actor: AuthUser,
    body: {
      title: string;
      body: string;
      channel: 'banner' | 'email' | 'banner_email';
      targetArea?: string | null;
      startsAt?: string | null;
      endsAt?: string | null;
    }
  ) {
    const result = await this.notifications.create(actor.id, body);
    await this.audit(actor.id, 'notification.create', 'notification', String(result.id), {
      title: body.title,
      channel: body.channel,
      targetArea: body.targetArea ?? null,
      emailStatus: result.emailStatus
    });
    return result;
  }

  async deleteNotification(actor: AuthUser, id: number) {
    const result = await this.notifications.delete(id);
    await this.audit(actor.id, 'notification.delete', 'notification', String(id), {});
    return result;
  }

  private async audit(
    actorUserId: number,
    action: string,
    entityType: string,
    entityId: string | null,
    payload: unknown
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO admin_audit_logs (actor_user_id, action, entity_type, entity_id, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [actorUserId, action, entityType, entityId, JSON.stringify(payload ?? {})]
    );
  }
}
