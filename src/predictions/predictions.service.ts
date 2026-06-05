import { BadRequestException, Injectable } from '@nestjs/common';
import { RowDataPacket } from 'mysql2';
import { DbService } from '../common/db.service';
import type { MatchPredictionRow, MatchRow, TeamRow, TournamentPredictionRow } from '../common/types';
import { FixtureService } from '../fixture/fixture.service';
import type { Stage } from '../common/config';

interface MatchPredictionBody {
  matchId: number;
  homeScore: number;
  awayScore: number;
  predictedHomeTeamId?: number;
  predictedAwayTeamId?: number;
}

interface TournamentPredictionBody {
  championTeamId: number;
  finalist1TeamId: number;
  finalist2TeamId: number;
}

interface StageProgressRow extends RowDataPacket {
  total: number;
  completed: number;
}

interface StageCloseRow extends RowDataPacket {
  total: number;
  closed: number;
}

interface GroupPredictionRow extends RowDataPacket {
  match_id: number;
  group_name: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  home_team_name: string | null;
  away_team_name: string | null;
  finished: 0 | 1;
  home_score: number | null;
  away_score: number | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
}

interface StageDuplicatePredictionRow extends RowDataPacket {
  match_number: number | null;
}

interface StandingRow {
  teamId: number;
  name: string;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

const stagePrerequisites: Partial<Record<Stage, Stage>> = {
  r32: 'group',
  r16: 'r32',
  qf: 'r16',
  sf: 'qf',
  third: 'sf',
  final: 'sf'
};

const stageLabels: Record<Stage, string> = {
  group: 'Grupos',
  r32: 'Dieciseisavos',
  r16: 'Octavos',
  qf: 'Cuartos',
  sf: 'Semis',
  third: 'Tercer puesto',
  final: 'Final'
};

@Injectable()
export class PredictionsService {
  constructor(
    private readonly db: DbService,
    private readonly fixture: FixtureService
  ) {}

  async getMine(userId: number) {
    const [matches, tournament] = await Promise.all([
      this.db.query<MatchPredictionRow & RowDataPacket>(
        `SELECT *
         FROM match_predictions
         WHERE user_id = ?
         ORDER BY match_id`,
        [userId]
      ),
      this.db.query<TournamentPredictionRow & RowDataPacket>(
        `SELECT *
         FROM tournament_predictions
         WHERE user_id = ?`,
        [userId]
      )
    ]);

    return { matches, tournament: tournament[0] ?? null };
  }

  async saveMatchPrediction(userId: number, body: MatchPredictionBody) {
    this.validateScore(body.homeScore, 'homeScore');
    this.validateScore(body.awayScore, 'awayScore');

    const match = await this.fixture.assertMatchPredictionOpen(Number(body.matchId));
    await this.assertStagePrerequisiteComplete(userId, match.stage);

    if (match.stage !== 'group' && Number(body.homeScore) === Number(body.awayScore)) {
      throw new BadRequestException('Knockout predictions need a winner in Koi Prode');
    }

    let predictedHomeTeamId = body.predictedHomeTeamId ? Number(body.predictedHomeTeamId) : null;
    let predictedAwayTeamId = body.predictedAwayTeamId ? Number(body.predictedAwayTeamId) : null;

    if (match.stage !== 'group') {
      const resolvedTeams = await this.resolveKnockoutTeamIds(userId, match);
      predictedHomeTeamId = resolvedTeams.homeTeamId;
      predictedAwayTeamId = resolvedTeams.awayTeamId;

      if (predictedHomeTeamId === predictedAwayTeamId) {
        throw new BadRequestException('Knockout teams must be different');
      }
      await this.assertTeamsAreUniqueInStage(userId, match, predictedHomeTeamId, predictedAwayTeamId);
    } else if (predictedHomeTeamId || predictedAwayTeamId) {
      const selectedTeamIds = [predictedHomeTeamId, predictedAwayTeamId].filter((teamId): teamId is number => Boolean(teamId));
      await this.assertTeamsExist(selectedTeamIds);
    }

    await this.assertTournamentLockedTeamsCanWin(
      userId,
      match,
      predictedHomeTeamId,
      predictedAwayTeamId,
      Number(body.homeScore),
      Number(body.awayScore)
    );

    await this.db.execute(
      `INSERT INTO match_predictions (
         user_id, match_id, predicted_home_team_id, predicted_away_team_id,
         predicted_home_score, predicted_away_score, submitted_at, auto_filled
       )
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
       ON DUPLICATE KEY UPDATE
         predicted_home_team_id = VALUES(predicted_home_team_id),
         predicted_away_team_id = VALUES(predicted_away_team_id),
         predicted_home_score = VALUES(predicted_home_score),
         predicted_away_score = VALUES(predicted_away_score),
         auto_filled = 0,
         submitted_at = CURRENT_TIMESTAMP`,
      [
        userId,
        Number(body.matchId),
        predictedHomeTeamId,
        predictedAwayTeamId,
        Number(body.homeScore),
        Number(body.awayScore)
      ]
    );

    return { ok: true };
  }

  async saveTournamentPrediction(userId: number, body: TournamentPredictionBody) {
    const championTeamId = Number(body.championTeamId);
    const finalist1TeamId = Number(body.finalist1TeamId);
    const finalist2TeamId = Number(body.finalist2TeamId);

    if (!championTeamId || !finalist1TeamId || !finalist2TeamId) {
      throw new BadRequestException('Champion and finalists are required');
    }

    if (finalist1TeamId === finalist2TeamId) {
      throw new BadRequestException('Finalists must be different teams');
    }

    if (championTeamId !== finalist1TeamId && championTeamId !== finalist2TeamId) {
      throw new BadRequestException('Champion must be one of the selected finalists');
    }

    const existing = await this.db.query<TournamentPredictionRow & RowDataPacket>(
      `SELECT * FROM tournament_predictions WHERE user_id = ?`,
      [userId]
    );
    if (existing[0]) {
      throw new BadRequestException('Champion and finalists are already locked');
    }

    await this.assertTeamsExist([championTeamId, finalist1TeamId, finalist2TeamId]);
    await this.assertTournamentFinalistsCanMeet(championTeamId, finalist1TeamId, finalist2TeamId);
    await this.assertExistingPredictionsAllowTournamentLock(userId, championTeamId, finalist1TeamId, finalist2TeamId);
    const tier = await this.fixture.getTournamentLockTier();

    await this.db.execute(
      `INSERT INTO tournament_predictions (
         user_id, champion_team_id, finalist1_team_id, finalist2_team_id, lock_tier, locked_at
       )
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [userId, championTeamId, finalist1TeamId, finalist2TeamId, tier]
    );

    return { ok: true, lockTier: tier };
  }

  private validateScore(value: number, field: string): void {
    if (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 30) {
      throw new BadRequestException(`${field} must be an integer between 0 and 30`);
    }
  }

  private async assertTeamsExist(teamIds: number[]): Promise<void> {
    const uniqueIds = Array.from(new Set(teamIds));
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = await this.db.query<{ id: number } & RowDataPacket>(
      `SELECT id FROM teams WHERE id IN (${placeholders})`,
      uniqueIds
    );
    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException('One or more selected teams do not exist');
    }
  }

  private async assertTournamentFinalistsCanMeet(
    championTeamId: number,
    finalist1TeamId: number,
    finalist2TeamId: number
  ): Promise<void> {
    const runnerUpTeamId = championTeamId === finalist1TeamId ? finalist2TeamId : finalist1TeamId;
    const teams = await this.db.query<TeamRow & RowDataPacket>(
      `SELECT *
       FROM teams
       WHERE id IN (?, ?)`,
      [championTeamId, runnerUpTeamId]
    );
    const champion = teams.find((team) => Number(team.id) === Number(championTeamId));
    const runnerUp = teams.find((team) => Number(team.id) === Number(runnerUpTeamId));
    if (!champion || !runnerUp) return;

    const championGroup = this.normalizeGroupCode(champion.group_name || '');
    const runnerUpGroup = this.normalizeGroupCode(runnerUp.group_name || '');
    if (championGroup && runnerUpGroup && championGroup === runnerUpGroup) {
      throw new BadRequestException('Campeon y subcampeon no pueden salir del mismo grupo en este modelo de llave');
    }

    const [championFinalSide, runnerUpFinalSide] = await Promise.all([
      this.finalSideForGroupWinner(championGroup),
      this.finalSideForGroupWinner(runnerUpGroup)
    ]);
    if (championFinalSide && runnerUpFinalSide && championFinalSide === runnerUpFinalSide) {
      throw new BadRequestException('Campeon y subcampeon quedan del mismo lado de la llave, no pueden llegar juntos a la final');
    }
  }

  private async assertExistingPredictionsAllowTournamentLock(
    userId: number,
    championTeamId: number,
    finalist1TeamId: number,
    finalist2TeamId: number
  ): Promise<void> {
    const runnerUpTeamId = championTeamId === finalist1TeamId ? finalist2TeamId : finalist1TeamId;
    const rows = await this.db.query<(MatchPredictionRow & MatchRow & RowDataPacket)>(
      `SELECT
         p.*,
         m.stage,
         m.match_number,
         m.home_team_id,
         m.away_team_id
       FROM match_predictions p
       INNER JOIN matches m ON m.id = p.match_id
       WHERE p.user_id = ?
         AND (
           m.home_team_id IN (?, ?)
           OR m.away_team_id IN (?, ?)
           OR p.predicted_home_team_id IN (?, ?)
           OR p.predicted_away_team_id IN (?, ?)
         )`,
      [
        userId,
        championTeamId,
        runnerUpTeamId,
        championTeamId,
        runnerUpTeamId,
        championTeamId,
        runnerUpTeamId,
        championTeamId,
        runnerUpTeamId
      ]
    );

    for (const row of rows) {
      const homeTeamId = row.stage === 'group'
        ? Number(row.home_team_id)
        : Number(row.predicted_home_team_id);
      const awayTeamId = row.stage === 'group'
        ? Number(row.away_team_id)
        : Number(row.predicted_away_team_id);
      if (!homeTeamId || !awayTeamId || Number(row.predicted_home_score) === Number(row.predicted_away_score)) {
        if (homeTeamId === championTeamId || awayTeamId === championTeamId) {
          throw new BadRequestException('No podes bloquear ese campeon porque ya tenes una prediccion donde no gana');
        }
        if (homeTeamId === runnerUpTeamId || awayTeamId === runnerUpTeamId) {
          throw new BadRequestException('No podes bloquear ese subcampeon porque ya tenes una prediccion donde no gana antes de la final');
        }
        continue;
      }

      const winnerTeamId = Number(row.predicted_home_score) > Number(row.predicted_away_score) ? homeTeamId : awayTeamId;
      const matchLabel = row.match_number ? ` en el partido ${row.match_number}` : '';

      if ((homeTeamId === championTeamId || awayTeamId === championTeamId) && winnerTeamId !== championTeamId) {
        throw new BadRequestException(`No podes bloquear ese campeon porque ya lo hiciste perder${matchLabel}`);
      }

      if (
        (homeTeamId === runnerUpTeamId || awayTeamId === runnerUpTeamId) &&
        row.stage !== 'final' &&
        winnerTeamId !== runnerUpTeamId
      ) {
        throw new BadRequestException(`No podes bloquear ese subcampeon porque ya lo hiciste perder antes de la final${matchLabel}`);
      }
    }
  }

  private async finalSideForGroupWinner(groupCode: string): Promise<'home' | 'away' | null> {
    if (!groupCode) return null;
    const matches = await this.db.query<MatchRow & RowDataPacket>(
      `SELECT *
       FROM matches
       WHERE stage <> 'group'
       ORDER BY match_number, id`
    );

    let current: MatchRow | undefined = matches.find((match) => (
      match.home_placeholder === `Winner Group ${groupCode}` ||
      match.away_placeholder === `Winner Group ${groupCode}`
    ));
    const visited = new Set<number>();

    while (current?.match_number && !visited.has(Number(current.match_number))) {
      visited.add(Number(current.match_number));
      if (current.stage === 'final') {
        return null;
      }

      const next = matches.find((match) => (
        match.home_placeholder === `Winner Match ${current!.match_number}` ||
        match.away_placeholder === `Winner Match ${current!.match_number}`
      ));
      if (!next) return null;
      if (next.stage === 'final') {
        return next.home_placeholder === `Winner Match ${current.match_number}` ? 'home' : 'away';
      }
      current = next;
    }

    return null;
  }

  private async assertTournamentLockedTeamsCanWin(
    userId: number,
    match: MatchRow,
    predictedHomeTeamId: number | null,
    predictedAwayTeamId: number | null,
    homeScore: number,
    awayScore: number
  ): Promise<void> {
    const tournament = await this.db.query<TournamentPredictionRow & RowDataPacket>(
      `SELECT *
       FROM tournament_predictions
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );
    const prediction = tournament[0];
    if (!prediction) return;

    const championTeamId = Number(prediction.champion_team_id);
    const runnerUpTeamId = Number(prediction.champion_team_id) === Number(prediction.finalist1_team_id)
      ? Number(prediction.finalist2_team_id)
      : Number(prediction.finalist1_team_id);
    const homeTeamId = match.stage === 'group' ? Number(match.home_team_id) : Number(predictedHomeTeamId);
    const awayTeamId = match.stage === 'group' ? Number(match.away_team_id) : Number(predictedAwayTeamId);
    if (!homeTeamId || !awayTeamId || homeScore === awayScore) {
      if (homeTeamId === championTeamId || awayTeamId === championTeamId) {
        throw new BadRequestException('El campeon elegido previamente no puede empatar ni perder en esta instancia');
      }
      if (homeTeamId === runnerUpTeamId || awayTeamId === runnerUpTeamId) {
        throw new BadRequestException('El subcampeon elegido previamente no puede empatar ni perder antes de la final');
      }
      return;
    }

    const winnerTeamId = homeScore > awayScore ? homeTeamId : awayTeamId;
    const hasChampion = homeTeamId === championTeamId || awayTeamId === championTeamId;
    const hasRunnerUp = homeTeamId === runnerUpTeamId || awayTeamId === runnerUpTeamId;

    if (hasChampion && winnerTeamId !== championTeamId) {
      throw new BadRequestException('El campeon elegido previamente no puede perder en esta instancia');
    }

    if (hasRunnerUp && match.stage !== 'final' && winnerTeamId !== runnerUpTeamId) {
      throw new BadRequestException('El subcampeon elegido previamente no puede perder antes de la final');
    }

    if (hasChampion && hasRunnerUp && match.stage === 'final' && winnerTeamId !== championTeamId) {
      throw new BadRequestException('En la final, tu campeon elegido tiene que ganarle a tu subcampeon');
    }
  }

  private async resolveKnockoutTeamIds(
    userId: number,
    match: MatchRow
  ): Promise<{ homeTeamId: number; awayTeamId: number }> {
    if (match.stage === 'final') {
      const tournamentFinal = await this.tournamentFinalTeamIds(userId);
      if (tournamentFinal) {
        return {
          homeTeamId: tournamentFinal.championTeamId,
          awayTeamId: tournamentFinal.runnerUpTeamId
        };
      }
    }

    const [homeOptions, awayOptions] = await Promise.all([
      this.expectedTeamIdsForSlot(userId, match, 'home'),
      this.expectedTeamIdsForSlot(userId, match, 'away')
    ]);

    if (homeOptions.length === 0 || awayOptions.length === 0) {
      throw new BadRequestException('Todavia no se pueden resolver los equipos habilitados para este cruce');
    }

    return {
      homeTeamId: Number(homeOptions[0]),
      awayTeamId: Number(awayOptions[0])
    };
  }

  private async tournamentFinalTeamIds(
    userId: number
  ): Promise<{ championTeamId: number; runnerUpTeamId: number } | null> {
    const rows = await this.db.query<TournamentPredictionRow & RowDataPacket>(
      `SELECT *
       FROM tournament_predictions
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );
    const prediction = rows[0];
    if (!prediction) return null;

    const championTeamId = Number(prediction.champion_team_id);
    const finalist1TeamId = Number(prediction.finalist1_team_id);
    const finalist2TeamId = Number(prediction.finalist2_team_id);
    const runnerUpTeamId = championTeamId === finalist1TeamId ? finalist2TeamId : finalist1TeamId;
    if (!championTeamId || !runnerUpTeamId) return null;

    return { championTeamId, runnerUpTeamId };
  }

  private async assertTeamsAreUniqueInStage(
    userId: number,
    match: MatchRow,
    predictedHomeTeamId: number,
    predictedAwayTeamId: number
  ): Promise<void> {
    const rows = await this.db.query<StageDuplicatePredictionRow>(
      `SELECT m.match_number
       FROM match_predictions p
       INNER JOIN matches m ON m.id = p.match_id
       WHERE p.user_id = ?
         AND m.stage = ?
         AND m.id <> ?
         AND (
           p.predicted_home_team_id IN (?, ?)
           OR p.predicted_away_team_id IN (?, ?)
         )
       LIMIT 1`,
      [
        userId,
        match.stage,
        match.id,
        predictedHomeTeamId,
        predictedAwayTeamId,
        predictedHomeTeamId,
        predictedAwayTeamId
      ]
    );

    if (rows[0]) {
      const matchLabel = rows[0].match_number ? ` en el partido ${rows[0].match_number}` : '';
      throw new BadRequestException(`Ese pais ya esta usado${matchLabel} de esta fase`);
    }
  }

  private async expectedTeamIdsForSlot(userId: number, match: MatchRow, side: 'home' | 'away'): Promise<number[]> {
    const tournamentLockedTeamId = await this.tournamentLockedTeamIdForSlot(userId, match, side);
    if (tournamentLockedTeamId) return [tournamentLockedTeamId];

    const placeholder = side === 'home' ? match.home_placeholder : match.away_placeholder;
    const fixedTeamId = Number(side === 'home' ? match.home_team_id : match.away_team_id);

    if (placeholder) {
      const thirdPlaceTeamId = await this.assignedThirdPlaceTeamIdForSlot(userId, match, side, false);
      if (thirdPlaceTeamId) return [thirdPlaceTeamId];

      const fromPlaceholder = await this.teamIdsFromPlaceholder(userId, placeholder, false);
      if (fromPlaceholder.length > 0) return fromPlaceholder;
    }

    return fixedTeamId ? [fixedTeamId] : [];
  }

  private async tournamentLockedTeamIdForSlot(
    userId: number,
    targetMatch: MatchRow,
    targetSide: 'home' | 'away'
  ): Promise<number | null> {
    if (!targetMatch || targetMatch.stage === 'group' || targetMatch.stage === 'final') return null;

    const tournamentRows = await this.db.query<TournamentPredictionRow & RowDataPacket>(
      `SELECT *
       FROM tournament_predictions
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );
    const tournament = tournamentRows[0];
    if (!tournament) return null;

    const championTeamId = Number(tournament.champion_team_id);
    const runnerUpTeamId = championTeamId === Number(tournament.finalist1_team_id)
      ? Number(tournament.finalist2_team_id)
      : Number(tournament.finalist1_team_id);
    if (!championTeamId || !runnerUpTeamId) return null;

    const teams = await this.db.query<TeamRow & RowDataPacket>(
      `SELECT *
       FROM teams
       WHERE id IN (?, ?)`,
      [championTeamId, runnerUpTeamId]
    );
    const lockedTeams = [
      teams.find((team) => Number(team.id) === championTeamId),
      teams.find((team) => Number(team.id) === runnerUpTeamId)
    ].filter((team): team is TeamRow & RowDataPacket => Boolean(team));

    for (const team of lockedTeams) {
      if (await this.tournamentTeamOwnsSlot(team, targetMatch, targetSide)) {
        return Number(team.id);
      }
    }

    return null;
  }

  private async tournamentTeamOwnsSlot(
    team: TeamRow,
    targetMatch: MatchRow,
    targetSide: 'home' | 'away'
  ): Promise<boolean> {
    const group = this.normalizeGroupCode(team.group_name || '');
    if (!group) return false;

    const matches = await this.db.query<MatchRow & RowDataPacket>(
      `SELECT *
       FROM matches
       WHERE stage <> 'group'
       ORDER BY match_number, id`
    );
    let source = `Winner Group ${group}`;
    const visited = new Set<number>();

    while (source) {
      const current = matches.find((match) => (
        match.home_placeholder === source ||
        match.away_placeholder === source
      ));
      if (!current?.match_number) return false;

      const currentNumber = Number(current.match_number);
      if (visited.has(currentNumber)) return false;
      visited.add(currentNumber);

      const side = current.home_placeholder === source ? 'home' : 'away';
      if (Number(current.id) === Number(targetMatch.id) && side === targetSide) {
        return true;
      }

      if (current.stage === 'final') return false;
      source = `Winner Match ${currentNumber}`;
    }

    return false;
  }

  private async assignedThirdPlaceTeamIdForSlot(
    userId: number,
    match: MatchRow,
    side: 'home' | 'away',
    actualOnly: boolean
  ): Promise<number | null> {
    const placeholder = side === 'home' ? match.home_placeholder : match.away_placeholder;
    const groups = this.thirdPlaceGroupsFromPlaceholder(placeholder);
    if (groups.length === 0) return null;

    const assignments = await this.thirdPlaceSlotAssignments(userId, actualOnly);
    return assignments.get(this.thirdPlaceSlotKey(match, side)) ?? null;
  }

  private async thirdPlaceSlotAssignments(userId: number, actualOnly: boolean): Promise<Map<string, number>> {
    const matches = await this.db.query<MatchRow & RowDataPacket>(
      `SELECT *
       FROM matches
       WHERE stage = 'r32'
       ORDER BY match_number, id`
    );

    const slots = matches
      .flatMap((match) => (['home', 'away'] as const).map((side) => ({
        match,
        side,
        groups: this.thirdPlaceGroupsFromPlaceholder(side === 'home' ? match.home_placeholder : match.away_placeholder)
      })))
      .filter((slot) => slot.groups.length > 0);

    if (slots.length === 0) return new Map();

    const bestThirds = (await this.bestThirdPlaceTeams(userId, actualOnly)).slice(0, slots.length);
    if (bestThirds.length === 0) return new Map();

    const rankByTeamId = new Map(bestThirds.map((row, index) => [row.teamId, index]));
    const thirdByGroup = new Map<string, StandingRow>();
    const distinctGroups = Array.from(new Set(slots.flatMap((slot) => slot.groups)));
    for (const group of distinctGroups) {
      const third = (await this.groupStandings(userId, group, actualOnly))[2];
      if (third && rankByTeamId.has(third.teamId)) {
        thirdByGroup.set(group, third);
      }
    }

    const slotCandidates = slots.map((slot, slotIndex) => ({
      ...slot,
      slotIndex,
      candidates: this.uniqueStandingRows(slot.groups.map((group) => thirdByGroup.get(group)).filter((row): row is StandingRow => Boolean(row)))
        .sort((a, b) => (rankByTeamId.get(a.teamId) ?? 999) - (rankByTeamId.get(b.teamId) ?? 999))
    }));

    const orderedSlots = [...slotCandidates].sort((a, b) => (
      a.candidates.length - b.candidates.length ||
      Number(a.match.match_number || a.match.id) - Number(b.match.match_number || b.match.id) ||
      a.slotIndex - b.slotIndex
    ));

    const assigned = new Map<string, number>();
    const usedTeamIds = new Set<number>();
    const search = (index: number): boolean => {
      if (index >= orderedSlots.length) return true;
      const slot = orderedSlots[index];
      for (const candidate of slot.candidates) {
        if (usedTeamIds.has(candidate.teamId)) continue;

        assigned.set(this.thirdPlaceSlotKey(slot.match, slot.side), candidate.teamId);
        usedTeamIds.add(candidate.teamId);
        if (search(index + 1)) return true;
        usedTeamIds.delete(candidate.teamId);
        assigned.delete(this.thirdPlaceSlotKey(slot.match, slot.side));
      }
      return false;
    };

    if (search(0)) return assigned;

    const fallback = new Map<string, number>();
    const fallbackUsedIds = new Set<number>();
    for (const slot of slotCandidates) {
      const team = slot.candidates.find((candidate) => !fallbackUsedIds.has(candidate.teamId));
      if (!team) continue;
      fallback.set(this.thirdPlaceSlotKey(slot.match, slot.side), team.teamId);
      fallbackUsedIds.add(team.teamId);
    }
    return fallback;
  }

  private thirdPlaceGroupsFromPlaceholder(placeholder: string | null): string[] {
    const third = String(placeholder || '').trim().match(/^3rd Group ([A-Z/]+)$/i);
    return third ? third[1].split('/').map((group) => group.toUpperCase()) : [];
  }

  private thirdPlaceSlotKey(match: MatchRow, side: 'home' | 'away'): string {
    return `${Number(match.id)}:${side}`;
  }

  private uniqueStandingRows(rows: StandingRow[]): StandingRow[] {
    const seen = new Set<number>();
    return rows.filter((row) => {
      if (seen.has(row.teamId)) return false;
      seen.add(row.teamId);
      return true;
    });
  }

  private async teamIdsFromPlaceholder(userId: number, placeholder: string, actualOnly: boolean): Promise<number[]> {
    const text = String(placeholder || '').trim();

    const groupWinner = /^Winner Group ([A-Z])$/i.exec(text);
    if (groupWinner) {
      const standings = await this.groupStandings(userId, groupWinner[1], actualOnly);
      return standings[0] ? [standings[0].teamId] : [];
    }

    const groupRunnerUp = /^Runner-up Group ([A-Z])$/i.exec(text);
    if (groupRunnerUp) {
      const standings = await this.groupStandings(userId, groupRunnerUp[1], actualOnly);
      return standings[1] ? [standings[1].teamId] : [];
    }

    const thirdGroups = /^3rd Group ([A-Z/]+)$/i.exec(text);
    if (thirdGroups) {
      const groupCodes = thirdGroups[1].split('/').map((value) => value.toUpperCase());
      const candidates = (await Promise.all(
        groupCodes.map(async (groupCode) => (await this.groupStandings(userId, groupCode, actualOnly))[2])
      )).filter((row): row is StandingRow => Boolean(row));
      if (candidates.length === 0) return [];

      const bestThirdIds = (await this.bestThirdPlaceTeams(userId, actualOnly)).slice(0, 8).map((row) => row.teamId);
      const qualified = bestThirdIds.length > 0
        ? candidates.filter((row) => bestThirdIds.includes(row.teamId))
        : candidates;
      return (qualified.length > 0 ? qualified : candidates).map((row) => row.teamId);
    }

    const sourceMatch = /^(Winner|Loser) Match (\d+)$/i.exec(text);
    if (sourceMatch) {
      const teamId = await this.teamIdFromSourceMatch(
        userId,
        Number(sourceMatch[2]),
        sourceMatch[1].toLowerCase() as 'winner' | 'loser',
        actualOnly
      );
      return teamId ? [teamId] : [];
    }

    return [];
  }

  private async teamIdFromSourceMatch(
    userId: number,
    matchNumber: number,
    target: 'winner' | 'loser',
    actualOnly: boolean
  ): Promise<number | null> {
    const rows = await this.db.query<MatchRow & RowDataPacket>(
      `SELECT * FROM matches WHERE match_number = ? LIMIT 1`,
      [matchNumber]
    );
    const sourceMatch = rows[0];
    if (!sourceMatch) return null;

    const actualTeamId = this.actualTeamIdFromMatch(sourceMatch, target);
    if (actualTeamId) return actualTeamId;
    if (actualOnly) return null;

    const predictions = await this.db.query<MatchPredictionRow & RowDataPacket>(
      `SELECT * FROM match_predictions WHERE user_id = ? AND match_id = ? LIMIT 1`,
      [userId, sourceMatch.id]
    );
    const prediction = predictions[0];
    if (!prediction || Number(prediction.predicted_home_score) === Number(prediction.predicted_away_score)) return null;

    const homeTeamId = Number(prediction.predicted_home_team_id)
      || (await this.expectedTeamIdsForSlot(userId, sourceMatch, 'home'))[0];
    const awayTeamId = Number(prediction.predicted_away_team_id)
      || (await this.expectedTeamIdsForSlot(userId, sourceMatch, 'away'))[0];
    if (!homeTeamId || !awayTeamId) return null;

    const homeWon = Number(prediction.predicted_home_score) > Number(prediction.predicted_away_score);
    if (target === 'winner') return homeWon ? homeTeamId : awayTeamId;
    return homeWon ? awayTeamId : homeTeamId;
  }

  private actualTeamIdFromMatch(match: MatchRow, target: 'winner' | 'loser'): number | null {
    if (
      Number(match.finished) !== 1 ||
      match.home_score === null ||
      match.away_score === null ||
      !match.home_team_id ||
      !match.away_team_id ||
      Number(match.home_score) === Number(match.away_score)
    ) {
      return null;
    }

    const homeWon = Number(match.home_score) > Number(match.away_score);
    if (target === 'winner') return homeWon ? Number(match.home_team_id) : Number(match.away_team_id);
    return homeWon ? Number(match.away_team_id) : Number(match.home_team_id);
  }

  private async groupStandings(userId: number, groupName: string, actualOnly: boolean): Promise<StandingRow[]> {
    const groupCode = this.normalizeGroupCode(groupName);
    if (!groupCode) return [];

    const rows = await this.db.query<GroupPredictionRow>(
      `SELECT
         m.id AS match_id,
         m.group_name,
         m.home_team_id,
         m.away_team_id,
         ht.name AS home_team_name,
         at.name AS away_team_name,
         m.finished,
         m.home_score,
         m.away_score,
         p.predicted_home_score,
         p.predicted_away_score
       FROM matches m
       LEFT JOIN teams ht ON ht.id = m.home_team_id
       LEFT JOIN teams at ON at.id = m.away_team_id
       LEFT JOIN match_predictions p ON p.match_id = m.id AND p.user_id = ?
       WHERE m.stage = 'group'
         AND UPPER(RIGHT(m.group_name, 1)) = ?
       ORDER BY m.match_number, m.id`,
      [userId, groupCode]
    );

    if (rows.length === 0) return [];
    const allActual = rows.every((row) => (
      Number(row.finished) === 1 &&
      row.home_score !== null &&
      row.away_score !== null
    ));
    if (actualOnly && !allActual) return [];

    const useActual = allActual;
    const standings = new Map<number, StandingRow>();
    const ensureTeam = (teamId: number | null, name: string | null) => {
      if (!teamId) return null;
      const numericId = Number(teamId);
      if (!standings.has(numericId)) {
        standings.set(numericId, {
          teamId: numericId,
          name: name || String(numericId),
          points: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0
        });
      }
      return standings.get(numericId)!;
    };

    for (const row of rows) {
      const home = ensureTeam(row.home_team_id, row.home_team_name);
      const away = ensureTeam(row.away_team_id, row.away_team_name);
      if (!home || !away) continue;

      const homeScore = useActual ? row.home_score : row.predicted_home_score;
      const awayScore = useActual ? row.away_score : row.predicted_away_score;
      if (homeScore === null || awayScore === null) continue;

      this.applyStandingResult(home, away, Number(homeScore), Number(awayScore));
    }

    return Array.from(standings.values()).sort((a, b) => (
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) ||
      a.teamId - b.teamId
    ));
  }

  private async bestThirdPlaceTeams(userId: number, actualOnly: boolean): Promise<StandingRow[]> {
    const groups = await this.db.query<{ group_name: string } & RowDataPacket>(
      `SELECT DISTINCT group_name
       FROM matches
       WHERE stage = 'group' AND group_name IS NOT NULL
       ORDER BY group_name`
    );

    const thirds: StandingRow[] = [];
    for (const group of groups) {
      const standings = await this.groupStandings(userId, group.group_name, actualOnly);
      if (standings[2]) thirds.push(standings[2]);
    }

    return thirds.sort((a, b) => (
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) ||
      a.teamId - b.teamId
    ));
  }

  private applyStandingResult(home: StandingRow, away: StandingRow, homeScore: number, awayScore: number): void {
    home.goalsFor += homeScore;
    home.goalsAgainst += awayScore;
    away.goalsFor += awayScore;
    away.goalsAgainst += homeScore;
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;

    if (homeScore > awayScore) {
      home.points += 3;
    } else if (homeScore < awayScore) {
      away.points += 3;
    } else {
      home.points += 1;
      away.points += 1;
    }
  }

  private normalizeGroupCode(value: string): string {
    const match = String(value || '').trim().match(/([A-Z])$/i);
    return match ? match[1].toUpperCase() : '';
  }

  private async assertStagePrerequisiteComplete(userId: number, stage: Stage): Promise<void> {
    const requiredStage = stagePrerequisites[stage];
    if (!requiredStage) return;

    await this.assertStagePrerequisiteComplete(userId, requiredStage);

    let progress = await this.stageProgress(userId, requiredStage);
    if (Number(progress.total) > 0 && Number(progress.completed) >= Number(progress.total)) return;

    if (await this.isStagePredictionClosed(requiredStage)) {
      await this.autoFillMissingStagePredictions(userId, requiredStage);
      progress = await this.stageProgress(userId, requiredStage);
      if (Number(progress.total) > 0 && Number(progress.completed) >= Number(progress.total)) return;
    }

    throw new BadRequestException(this.stagePrerequisiteMessage(stage, requiredStage, Number(progress.completed), Number(progress.total)));
  }

  private async stageProgress(userId: number, stage: Stage): Promise<StageProgressRow> {
    const rows = await this.db.query<StageProgressRow>(
      `SELECT
         COUNT(m.id) AS total,
         COUNT(p.id) AS completed
       FROM matches m
       LEFT JOIN match_predictions p ON p.match_id = m.id AND p.user_id = ?
       WHERE m.stage = ?`,
      [userId, stage]
    );
    return rows[0] ?? { total: 0, completed: 0 } as StageProgressRow;
  }

  private async isStagePredictionClosed(stage: Stage): Promise<boolean> {
    const rows = await this.db.query<StageCloseRow>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN prediction_closes_at IS NOT NULL AND NOW() >= prediction_closes_at THEN 1 ELSE 0 END) AS closed
       FROM matches
       WHERE stage = ?`,
      [stage]
    );
    const row = rows[0] ?? { total: 0, closed: 0 };
    return Number(row.total) > 0 && Number(row.closed) >= Number(row.total);
  }

  private async autoFillMissingStagePredictions(userId: number, stage: Stage): Promise<void> {
    const matches = await this.db.query<MatchRow & RowDataPacket>(
      `SELECT m.*
       FROM matches m
       LEFT JOIN match_predictions p ON p.match_id = m.id AND p.user_id = ?
       WHERE m.stage = ?
         AND p.id IS NULL
       ORDER BY m.kickoff_at IS NULL, m.kickoff_at, m.match_number, m.id`,
      [userId, stage]
    );

    for (const match of matches) {
      const autoPrediction = await this.autoPredictionForMatch(userId, match);
      if (!autoPrediction) continue;

      await this.db.execute(
        `INSERT IGNORE INTO match_predictions (
           user_id, match_id, predicted_home_team_id, predicted_away_team_id,
           predicted_home_score, predicted_away_score, submitted_at, auto_filled,
           points, exact_hit, outcome_hit, difference_hit, home_goals_hit, away_goals_hit
         )
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1, 0, 0, 0, 0, 0, 0)`,
        [
          userId,
          match.id,
          autoPrediction.homeTeamId,
          autoPrediction.awayTeamId,
          autoPrediction.homeScore,
          autoPrediction.awayScore
        ]
      );
    }
  }

  private async autoPredictionForMatch(
    userId: number,
    match: MatchRow
  ): Promise<{ homeTeamId: number | null; awayTeamId: number | null; homeScore: number; awayScore: number } | null> {
    if (match.stage === 'group') {
      const homeTeamId = match.home_team_id ? Number(match.home_team_id) : null;
      const awayTeamId = match.away_team_id ? Number(match.away_team_id) : null;
      if (!homeTeamId || !awayTeamId) return null;

      return {
        homeTeamId,
        awayTeamId,
        homeScore: Number(match.finished) === 1 && match.home_score !== null ? Number(match.home_score) : 0,
        awayScore: Number(match.finished) === 1 && match.away_score !== null ? Number(match.away_score) : 0
      };
    }

    const resolvedTeams = await this.resolveKnockoutTeamIds(userId, match);
    const actualHomeScore = match.home_score !== null ? Number(match.home_score) : null;
    const actualAwayScore = match.away_score !== null ? Number(match.away_score) : null;
    if (
      Number(match.finished) === 1 &&
      actualHomeScore !== null &&
      actualAwayScore !== null &&
      actualHomeScore !== actualAwayScore
    ) {
      return {
        ...resolvedTeams,
        homeScore: actualHomeScore,
        awayScore: actualAwayScore
      };
    }

    const autoScore = await this.autoKnockoutScore(userId, match, resolvedTeams.homeTeamId, resolvedTeams.awayTeamId);
    return {
      ...resolvedTeams,
      ...autoScore
    };
  }

  private async autoKnockoutScore(
    userId: number,
    match: MatchRow,
    homeTeamId: number,
    awayTeamId: number
  ): Promise<{ homeScore: number; awayScore: number }> {
    const tournamentFinal = await this.tournamentFinalTeamIds(userId);
    const championTeamId = tournamentFinal?.championTeamId ?? null;
    const runnerUpTeamId = tournamentFinal?.runnerUpTeamId ?? null;

    let winnerTeamId = homeTeamId;
    if (championTeamId && (homeTeamId === championTeamId || awayTeamId === championTeamId)) {
      winnerTeamId = championTeamId;
    } else if (
      runnerUpTeamId &&
      match.stage !== 'final' &&
      (homeTeamId === runnerUpTeamId || awayTeamId === runnerUpTeamId)
    ) {
      winnerTeamId = runnerUpTeamId;
    }

    return winnerTeamId === awayTeamId
      ? { homeScore: 0, awayScore: 1 }
      : { homeScore: 1, awayScore: 0 };
  }

  private stagePrerequisiteMessage(stage: Stage, requiredStage: Stage, completed: number, total: number): string {
    const missing = Math.max(0, total - completed);
    const progress = total > 0
      ? `Completaste ${completed}/${total}; te faltan ${missing}.`
      : `Todavia no hay partidos cargados de ${stageLabels[requiredStage]}.`;

    if (stage === 'r32') {
      return `Para completar Dieciseisavos primero tenes que completar todos los partidos de Grupos. ${progress}`;
    }
    if (stage === 'third') {
      return `El tercer puesto es opcional para sumar puntos, pero se habilita cuando completes Semis. ${progress}`;
    }
    if (stage === 'final') {
      return `Para completar la Final primero tenes que completar Semis. El tercer puesto es opcional y no bloquea la final. ${progress}`;
    }
    return `Para completar ${stageLabels[stage]} primero tenes que completar ${stageLabels[requiredStage]}. ${progress}`;
  }
}
