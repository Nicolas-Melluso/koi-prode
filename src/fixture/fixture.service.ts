import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RowDataPacket } from 'mysql2';
import { DbService } from '../common/db.service';
import { parseWorldCup26LocalDate } from '../common/date-utils';
import type { MatchRow, TeamRow } from '../common/types';
import type { Stage, TournamentLockTier } from '../common/config';
import { compareSqlDate } from '../common/date-utils';

const SOURCE = 'worldcup26';

interface WorldCupTeam {
  id: string;
  name_en: string;
  fifa_code?: string;
  groups?: string;
  flag?: string;
}

interface WorldCupStadium {
  id: string;
  name_en: string;
  fifa_name?: string;
  city_en?: string;
}

interface WorldCupGame {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score?: string;
  away_score?: string;
  group?: string;
  matchday?: string;
  local_date?: string;
  stadium_id?: string;
  finished?: string;
  time_elapsed?: string;
  type?: string;
  home_team_name_en?: string;
  away_team_name_en?: string;
  home_team_label?: string;
  away_team_label?: string;
}

interface MatchListRow extends RowDataPacket {
  id: number;
  match_number: number | null;
  stage: Stage;
  group_name: string | null;
  kickoff_at: string | null;
  api_local_date: string | null;
  prediction_closes_at: string | null;
  stadium_name: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  finished: 0 | 1;
  home_team_id: number | null;
  away_team_id: number | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_team_code: string | null;
  away_team_code: string | null;
  home_flag_url: string | null;
  away_flag_url: string | null;
  home_placeholder: string | null;
  away_placeholder: string | null;
}

interface DeadlineRow extends RowDataPacket {
  now_value: string;
  group_close: string | null;
  r32_close: string | null;
  qf_close: string | null;
}

interface ExistingTeamPreviewRow extends RowDataPacket {
  external_id: string | null;
  name: string;
  code: string | null;
  group_name: string | null;
  flag_url: string | null;
}

interface ExistingMatchPreviewRow extends RowDataPacket {
  external_id: string | null;
  match_number: number | null;
  stage: Stage;
  group_name: string | null;
  kickoff_at: string | Date | null;
  api_local_date: string | null;
  stadium_name: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  finished: 0 | 1;
  home_external_id: string | null;
  away_external_id: string | null;
  home_placeholder: string | null;
  away_placeholder: string | null;
}

@Injectable()
export class FixtureService {
  constructor(private readonly db: DbService) {}

  async listTeams(): Promise<TeamRow[]> {
    return this.db.query<TeamRow & RowDataPacket>(
      `SELECT id, external_id, source, name, code, group_name, flag_url
       FROM teams
       ORDER BY group_name IS NULL, group_name, name`
    );
  }

  async listMatches(): Promise<MatchListRow[]> {
    return this.db.query<MatchListRow>(
      `SELECT
         m.id,
         m.match_number,
         m.stage,
         m.group_name,
         m.kickoff_at,
         m.api_local_date,
         m.prediction_closes_at,
         m.stadium_name,
         m.status,
         m.home_score,
         m.away_score,
         m.finished,
         m.home_team_id,
         m.away_team_id,
         ht.name AS home_team_name,
         at.name AS away_team_name,
         ht.code AS home_team_code,
         at.code AS away_team_code,
         ht.flag_url AS home_flag_url,
         at.flag_url AS away_flag_url,
         m.home_placeholder,
         m.away_placeholder
       FROM matches m
       LEFT JOIN teams ht ON ht.id = m.home_team_id
       LEFT JOIN teams at ON at.id = m.away_team_id
       ORDER BY m.kickoff_at IS NULL, m.kickoff_at, m.match_number`
    );
  }

  async getMatch(matchId: number): Promise<MatchRow> {
    const rows = await this.db.query<MatchRow & RowDataPacket>(`SELECT * FROM matches WHERE id = ?`, [matchId]);
    if (!rows[0]) {
      throw new NotFoundException('Match not found');
    }
    return rows[0];
  }

  async previewWorldCup26Import() {
    const [teamsPayload, stadiumsPayload, gamesPayload] = await Promise.all([
      this.fetchJson<{ teams: WorldCupTeam[] }>('https://worldcup26.ir/get/teams'),
      this.fetchJson<{ stadiums: WorldCupStadium[] }>('https://worldcup26.ir/get/stadiums'),
      this.fetchJson<{ games: WorldCupGame[] }>('https://worldcup26.ir/get/games')
    ]);

    const teams = teamsPayload.teams ?? [];
    const stadiums = stadiumsPayload.stadiums ?? [];
    const games = gamesPayload.games ?? [];

    if (teams.length === 0 || games.length === 0) {
      throw new BadGatewayException('World Cup API returned an empty fixture payload');
    }

    const stadiumById = new Map<string, WorldCupStadium>();
    for (const stadium of stadiums) {
      stadiumById.set(String(stadium.id), stadium);
    }

    const [localTeams, localMatches] = await Promise.all([
      this.db.query<ExistingTeamPreviewRow>(
        `SELECT external_id, name, code, group_name, flag_url
         FROM teams
         WHERE source = ?`,
        [SOURCE]
      ),
      this.db.query<ExistingMatchPreviewRow>(
        `SELECT
           m.external_id,
           m.match_number,
           m.stage,
           m.group_name,
           m.kickoff_at,
           m.api_local_date,
           m.stadium_name,
           m.status,
           m.home_score,
           m.away_score,
           m.finished,
           ht.external_id AS home_external_id,
           at.external_id AS away_external_id,
           m.home_placeholder,
           m.away_placeholder
         FROM matches m
         LEFT JOIN teams ht ON ht.id = m.home_team_id
         LEFT JOIN teams at ON at.id = m.away_team_id
         WHERE m.source = ?`,
        [SOURCE]
      )
    ]);

    const localTeamByExternal = new Map(localTeams.filter((team) => team.external_id).map((team) => [String(team.external_id), team]));
    const localMatchByExternal = new Map(localMatches.filter((match) => match.external_id).map((match) => [String(match.external_id), match]));
    const newTeams = [];
    const changedTeams = [];
    const newMatches = [];
    const changedMatches = [];
    const resultUpdates = [];
    const protectedResults = [];
    let unchangedMatches = 0;

    for (const team of teams) {
      const incoming = {
        externalId: String(team.id),
        name: team.name_en,
        code: team.fifa_code ?? null,
        group: team.groups ?? null,
        flag: team.flag ?? null
      };
      const existing = localTeamByExternal.get(incoming.externalId);
      if (!existing) {
        newTeams.push(incoming);
        continue;
      }

      const comparableIncoming = {
        name: incoming.name,
        code: incoming.code,
        group: incoming.group,
        flag: incoming.flag
      };
      const fields = this.changedFields(
        {
          name: existing.name,
          code: existing.code,
          group: existing.group_name,
          flag: existing.flag_url
        },
        comparableIncoming
      );
      if (fields.length > 0) {
        changedTeams.push({ ...incoming, previousName: existing.name, fields });
      }
    }

    for (const game of games) {
      const normalized = this.normalizePreviewGame(game, stadiumById);
      const existing = localMatchByExternal.get(normalized.externalId);
      if (!existing) {
        newMatches.push(normalized);
        continue;
      }

      const fields = this.changedFields(
        {
          matchNumber: existing.match_number,
          stage: existing.stage,
          group: existing.group_name,
          kickoff: this.dateCompareValue(existing.kickoff_at),
          apiLocalDate: existing.api_local_date,
          stadium: existing.stadium_name,
          homeTeam: existing.home_external_id,
          awayTeam: existing.away_external_id,
          homePlaceholder: existing.home_placeholder,
          awayPlaceholder: existing.away_placeholder
        },
        {
          matchNumber: normalized.matchNumber,
          stage: normalized.stage,
          group: normalized.group,
          kickoff: normalized.kickoff,
          apiLocalDate: normalized.apiLocalDate,
          stadium: normalized.stadium,
          homeTeam: normalized.homeTeamExternalId,
          awayTeam: normalized.awayTeamExternalId,
          homePlaceholder: normalized.homePlaceholder,
          awayPlaceholder: normalized.awayPlaceholder
        }
      );

      if (normalized.finished) {
        const sameScore = Number(existing.home_score) === normalized.homeScore && Number(existing.away_score) === normalized.awayScore;
        if (!Number(existing.finished)) {
          resultUpdates.push({
            ...normalized,
            previous: {
              finished: Boolean(existing.finished),
              homeScore: existing.home_score,
              awayScore: existing.away_score
            }
          });
        } else if (!sameScore) {
          protectedResults.push({
            ...normalized,
            previous: {
              finished: Boolean(existing.finished),
              homeScore: existing.home_score,
              awayScore: existing.away_score
            }
          });
        }
      }

      if (fields.length > 0) {
        changedMatches.push({ ...normalized, fields });
      } else {
        unchangedMatches += 1;
      }
    }

    return {
      source: 'worldcup26.ir',
      fetchedAt: new Date().toISOString(),
      api: {
        teams: teams.length,
        matches: games.length,
        finishedMatches: games.filter((game) => String(game.finished ?? '').toUpperCase() === 'TRUE').length
      },
      local: {
        teams: localTeams.length,
        matches: localMatches.length,
        finishedMatches: localMatches.filter((match) => Number(match.finished) === 1).length
      },
      summary: {
        newTeams: newTeams.length,
        changedTeams: changedTeams.length,
        newMatches: newMatches.length,
        changedMatches: changedMatches.length,
        resultUpdates: resultUpdates.length,
        protectedResults: protectedResults.length,
        unchangedMatches
      },
      teams: {
        new: newTeams.slice(0, 20),
        changed: changedTeams.slice(0, 20)
      },
      matches: {
        new: newMatches.slice(0, 20),
        changed: changedMatches.slice(0, 20),
        resultUpdates: resultUpdates.slice(0, 20),
        protectedResults: protectedResults.slice(0, 20)
      }
    };
  }

  async importWorldCup26(): Promise<{ teams: number; matches: number; locksUpdated: Record<string, number> }> {
    const [teamsPayload, stadiumsPayload, gamesPayload] = await Promise.all([
      this.fetchJson<{ teams: WorldCupTeam[] }>('https://worldcup26.ir/get/teams'),
      this.fetchJson<{ stadiums: WorldCupStadium[] }>('https://worldcup26.ir/get/stadiums'),
      this.fetchJson<{ games: WorldCupGame[] }>('https://worldcup26.ir/get/games')
    ]);

    const teams = teamsPayload.teams ?? [];
    const stadiums = stadiumsPayload.stadiums ?? [];
    const games = gamesPayload.games ?? [];

    if (teams.length === 0 || games.length === 0) {
      throw new BadGatewayException('World Cup API returned an empty fixture payload');
    }

    const stadiumById = new Map<string, WorldCupStadium>();
    for (const stadium of stadiums) {
      stadiumById.set(String(stadium.id), stadium);
    }

    await this.db.transaction(async (connection) => {
      for (const team of teams) {
        await connection.execute(
          `INSERT INTO teams (external_id, source, name, code, group_name, flag_url, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             code = VALUES(code),
             group_name = VALUES(group_name),
             flag_url = VALUES(flag_url),
             raw_json = VALUES(raw_json)`,
          [
            String(team.id),
            SOURCE,
            team.name_en,
            team.fifa_code ?? null,
            team.groups ?? null,
            team.flag ?? null,
            JSON.stringify(team)
          ]
        );
      }

      const [teamRows] = await connection.query<(TeamRow & RowDataPacket)[]>(
        `SELECT id, external_id, source, name, code, group_name, flag_url
         FROM teams
         WHERE source = ?`,
        [SOURCE]
      );
      const teamIdByExternal = new Map<string, number>();
      for (const row of teamRows) {
        if (row.external_id) {
          teamIdByExternal.set(String(row.external_id), Number(row.id));
        }
      }

      for (const game of games) {
        const stage = this.normalizeStage(game.type, game.group);
        const finished = String(game.finished ?? '').toUpperCase() === 'TRUE';
        const stadium = game.stadium_id ? stadiumById.get(String(game.stadium_id)) : undefined;
        const homeTeamId = this.resolveTeamId(game.home_team_id, teamIdByExternal);
        const awayTeamId = this.resolveTeamId(game.away_team_id, teamIdByExternal);

        await connection.execute(
          `INSERT INTO matches (
             external_id, source, match_number, stage, group_name,
             home_team_id, away_team_id, home_placeholder, away_placeholder,
             kickoff_at, api_local_date, stadium_name, status, home_score, away_score,
             finished, raw_json
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             match_number = VALUES(match_number),
             stage = VALUES(stage),
             group_name = VALUES(group_name),
             home_team_id = VALUES(home_team_id),
             away_team_id = VALUES(away_team_id),
             home_placeholder = VALUES(home_placeholder),
             away_placeholder = VALUES(away_placeholder),
             kickoff_at = VALUES(kickoff_at),
             api_local_date = VALUES(api_local_date),
             stadium_name = VALUES(stadium_name),
             status = IF(finished = 1, status, VALUES(status)),
             home_score = IF(finished = 1, home_score, IF(VALUES(finished) = 1, VALUES(home_score), home_score)),
             away_score = IF(finished = 1, away_score, IF(VALUES(finished) = 1, VALUES(away_score), away_score)),
             finished = IF(finished = 1, 1, VALUES(finished)),
             raw_json = VALUES(raw_json)`,
          [
            String(game.id),
            SOURCE,
            Number.parseInt(game.id, 10) || null,
            stage,
            stage === 'group' ? game.group ?? null : null,
            homeTeamId,
            awayTeamId,
            homeTeamId ? null : game.home_team_label ?? game.home_team_name_en ?? null,
            awayTeamId ? null : game.away_team_label ?? game.away_team_name_en ?? null,
            parseWorldCup26LocalDate(game.local_date),
            game.local_date ?? null,
            stadium?.fifa_name ?? stadium?.name_en ?? null,
            finished ? 'completed' : this.normalizeStatus(game.time_elapsed),
            finished ? Number.parseInt(game.home_score ?? '0', 10) : null,
            finished ? Number.parseInt(game.away_score ?? '0', 10) : null,
            finished ? 1 : 0,
            JSON.stringify(game)
          ]
        );
      }
    });

    const locksUpdated = await this.recalculatePredictionLocks();
    return { teams: teams.length, matches: games.length, locksUpdated };
  }

  async recalculatePredictionLocks(): Promise<Record<string, number>> {
    const updates: Record<string, number> = {};

    const groupRows = await this.db.query<{ first_group_kickoff: string | null } & RowDataPacket>(
      `SELECT MIN(kickoff_at) AS first_group_kickoff
       FROM matches
       WHERE stage = 'group'
         AND kickoff_at IS NOT NULL`
    );

    const firstGroupKickoff = groupRows[0]?.first_group_kickoff;
    if (firstGroupKickoff) {
      const result = await this.db.execute(
        `UPDATE matches
         SET prediction_closes_at = DATE_SUB(?, INTERVAL 1 HOUR)
         WHERE stage = 'group'`,
        [firstGroupKickoff]
      );
      updates.group = result.affectedRows;
    }

    for (const stage of ['r32', 'r16', 'qf', 'sf', 'third', 'final'] as const) {
      const rows = await this.db.query<{ first_kickoff: string | null } & RowDataPacket>(
        `SELECT MIN(kickoff_at) AS first_kickoff
         FROM matches
         WHERE stage = ? AND kickoff_at IS NOT NULL`,
        [stage]
      );
      const firstKickoff = rows[0]?.first_kickoff;
      if (!firstKickoff) {
        continue;
      }
      const result = await this.db.execute(
        `UPDATE matches
         SET prediction_closes_at = DATE_SUB(?, INTERVAL 1 DAY)
         WHERE stage = ?`,
        [firstKickoff, stage]
      );
      updates[stage] = result.affectedRows;
    }

    return updates;
  }

  async getTournamentLockTier(): Promise<TournamentLockTier> {
    const rows = await this.db.query<DeadlineRow>(
      `SELECT
         DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS now_value,
         MIN(CASE WHEN stage = 'group' THEN prediction_closes_at END) AS group_close,
         MIN(CASE WHEN stage = 'r32' THEN prediction_closes_at END) AS r32_close,
         MIN(CASE WHEN stage = 'qf' THEN prediction_closes_at END) AS qf_close
       FROM matches`
    );
    const row = rows[0];
    if (!row) {
      return 'early';
    }

    if (!row.group_close || compareSqlDate(row.now_value, row.group_close) < 0) {
      return 'early';
    }
    if (!row.r32_close || compareSqlDate(row.now_value, row.r32_close) < 0) {
      return 'before_r32';
    }
    if (!row.qf_close || compareSqlDate(row.now_value, row.qf_close) < 0) {
      return 'before_qf';
    }

    throw new BadRequestException('Champion and finalist predictions are already closed');
  }

  async assertMatchPredictionOpen(matchId: number): Promise<MatchRow> {
    const rows = await this.db.query<MatchRow & RowDataPacket>(
      `SELECT *
       FROM matches
       WHERE id = ?
         AND (prediction_closes_at IS NULL OR NOW() < prediction_closes_at)`,
      [matchId]
    );
    if (!rows[0]) {
      const existing = await this.db.query<MatchRow & RowDataPacket>(`SELECT * FROM matches WHERE id = ?`, [matchId]);
      if (existing[0]) {
        throw new BadRequestException('Predictions are closed for this match');
      }
      throw new NotFoundException('Match not found');
    }
    return rows[0];
  }

  private normalizePreviewGame(game: WorldCupGame, stadiumById: Map<string, WorldCupStadium>) {
    const stage = this.normalizeStage(game.type, game.group);
    const finished = String(game.finished ?? '').toUpperCase() === 'TRUE';
    const stadium = game.stadium_id ? stadiumById.get(String(game.stadium_id)) : undefined;
    return {
      externalId: String(game.id),
      matchNumber: Number.parseInt(game.id, 10) || null,
      stage,
      group: stage === 'group' ? game.group ?? null : null,
      kickoff: parseWorldCup26LocalDate(game.local_date),
      apiLocalDate: game.local_date ?? null,
      stadium: stadium?.fifa_name ?? stadium?.name_en ?? null,
      status: finished ? 'completed' : this.normalizeStatus(game.time_elapsed),
      finished,
      homeScore: finished ? Number.parseInt(game.home_score ?? '0', 10) : null,
      awayScore: finished ? Number.parseInt(game.away_score ?? '0', 10) : null,
      homeTeamExternalId: this.previewTeamExternalId(game.home_team_id),
      awayTeamExternalId: this.previewTeamExternalId(game.away_team_id),
      homeName: game.home_team_name_en ?? game.home_team_label ?? 'TBD',
      awayName: game.away_team_name_en ?? game.away_team_label ?? 'TBD',
      homePlaceholder: this.previewTeamExternalId(game.home_team_id) ? null : game.home_team_label ?? game.home_team_name_en ?? null,
      awayPlaceholder: this.previewTeamExternalId(game.away_team_id) ? null : game.away_team_label ?? game.away_team_name_en ?? null
    };
  }

  private changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
    return Object.keys(after).filter((key) => String(before[key] ?? '') !== String(after[key] ?? ''));
  }

  private dateCompareValue(value: string | Date | null): string | null {
    if (!value) return null;
    if (value instanceof Date) {
      const pad = (part: number) => String(part).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
    }
    return String(value).replace('T', ' ').slice(0, 19);
  }

  private previewTeamExternalId(externalId: string | undefined): string | null {
    if (!externalId || externalId === '0') return null;
    return String(externalId);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      throw new BadGatewayException(`Could not fetch ${url}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private normalizeStage(type: string | undefined, group: string | undefined): Stage {
    const value = String(type ?? '').toLowerCase();
    if (value === 'group' || group?.match(/^[A-L]$/)) return 'group';
    if (value === 'r32') return 'r32';
    if (value === 'r16') return 'r16';
    if (value === 'qf') return 'qf';
    if (value === 'sf') return 'sf';
    if (value === 'third' || value === '3rd') return 'third';
    if (value === 'final') return 'final';
    return 'group';
  }

  private normalizeStatus(timeElapsed: string | undefined): string {
    const value = String(timeElapsed ?? '').toLowerCase();
    if (!value || value === 'notstarted') return 'scheduled';
    if (value === 'finished') return 'completed';
    return 'live';
  }

  private resolveTeamId(externalId: string | undefined, teamIdByExternal: Map<string, number>): number | null {
    if (!externalId || externalId === '0') {
      return null;
    }
    return teamIdByExternal.get(String(externalId)) ?? null;
  }
}
