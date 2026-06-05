import { Injectable } from '@nestjs/common';
import { RowDataPacket } from 'mysql2';
import { tournamentPointValues } from '../common/config';
import { DbService } from '../common/db.service';
import type { MatchPredictionRow, MatchRow, TournamentPredictionRow, UserRow } from '../common/types';

interface FinishedMatchRow extends MatchRow, RowDataPacket {
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
}

interface ScoreBreakdown {
  points: number;
  exactHit: boolean;
  outcomeHit: boolean;
  differenceHit: boolean;
  homeGoalsHit: boolean;
  awayGoalsHit: boolean;
}

interface ScoreRow extends RowDataPacket {
  total_points: number;
  match_points: number;
  streak_bonus_points: number;
  tournament_points: number;
  completion_points: number;
  exact_count: number;
  outcome_count: number;
  max_streak: number;
  champion_correct: 0 | 1;
  finalist_correct_count: number;
}

@Injectable()
export class ScoringService {
  constructor(private readonly db: DbService) {}

  async recalculateAll(): Promise<{ users: number; finishedMatches: number }> {
    const [users, finishedMatches, predictions] = await Promise.all([
      this.db.query<UserRow & RowDataPacket>(`SELECT * FROM users ORDER BY id`),
      this.db.query<FinishedMatchRow>(
        `SELECT *
         FROM matches
         WHERE finished = 1
           AND home_score IS NOT NULL
           AND away_score IS NOT NULL
         ORDER BY kickoff_at IS NULL, kickoff_at, match_number, id`
      ),
      this.db.query<MatchPredictionRow & RowDataPacket>(`SELECT * FROM match_predictions`)
    ]);

    const predictionByUserMatch = new Map<string, MatchPredictionRow>();
    for (const prediction of predictions) {
      predictionByUserMatch.set(`${prediction.user_id}:${prediction.match_id}`, prediction);
    }

    const finalMatch = finishedMatches.find((match) => match.stage === 'final' && match.home_team_id && match.away_team_id);
    const tournamentPredictions = await this.db.query<TournamentPredictionRow & RowDataPacket>(
      `SELECT * FROM tournament_predictions`
    );
    const tournamentByUser = new Map<number, TournamentPredictionRow>();
    for (const prediction of tournamentPredictions) {
      tournamentByUser.set(Number(prediction.user_id), prediction);
    }

    for (const user of users) {
      let matchPoints = 0;
      let streakBonusPoints = 0;
      let tournamentPoints = 0;
      let exactCount = 0;
      let outcomeCount = 0;
      let currentStreak = 0;
      let maxStreak = 0;
      let championCorrect = false;
      let finalistCorrectCount = 0;

      for (const match of finishedMatches) {
        const prediction = predictionByUserMatch.get(`${user.id}:${match.id}`);
        if (!prediction) {
          currentStreak = 0;
          continue;
        }
        if (Number(prediction.auto_filled) === 1) {
          currentStreak = 0;
          await this.db.execute(
            `UPDATE match_predictions
             SET points = 0,
                 exact_hit = 0,
                 outcome_hit = 0,
                 difference_hit = 0,
                 home_goals_hit = 0,
                 away_goals_hit = 0
             WHERE id = ?`,
            [prediction.id]
          );
          continue;
        }

        const scored = this.scorePredictionForMatch(prediction, match, tournamentByUser.get(Number(user.id)));

        matchPoints += scored.points;
        exactCount += scored.exactHit ? 1 : 0;
        outcomeCount += scored.outcomeHit ? 1 : 0;

        if (scored.outcomeHit) {
          currentStreak += 1;
          if (currentStreak === 3) streakBonusPoints += 3;
          if (currentStreak === 5) streakBonusPoints += 6;
          if (currentStreak === 8) streakBonusPoints += 10;
        } else {
          currentStreak = 0;
        }
        maxStreak = Math.max(maxStreak, currentStreak);

        await this.db.execute(
          `UPDATE match_predictions
           SET points = ?,
               exact_hit = ?,
               outcome_hit = ?,
               difference_hit = ?,
               home_goals_hit = ?,
               away_goals_hit = ?
           WHERE id = ?`,
          [
            scored.points,
            scored.exactHit ? 1 : 0,
            scored.outcomeHit ? 1 : 0,
            scored.differenceHit ? 1 : 0,
            scored.homeGoalsHit ? 1 : 0,
            scored.awayGoalsHit ? 1 : 0,
            prediction.id
          ]
        );
      }

      const tournamentPrediction = tournamentByUser.get(Number(user.id));
      if (tournamentPrediction && finalMatch && finalMatch.home_score !== finalMatch.away_score) {
        const finalTeamIds = [Number(finalMatch.home_team_id), Number(finalMatch.away_team_id)];
        const championTeamId = finalMatch.home_score > finalMatch.away_score
          ? Number(finalMatch.home_team_id)
          : Number(finalMatch.away_team_id);
        const predictedFinalists = [
          Number(tournamentPrediction.finalist1_team_id),
          Number(tournamentPrediction.finalist2_team_id)
        ];

        championCorrect = Number(tournamentPrediction.champion_team_id) === championTeamId;
        finalistCorrectCount = predictedFinalists.filter((teamId) => finalTeamIds.includes(teamId)).length;

        const championPoints = championCorrect
          ? tournamentPointValues.champion[tournamentPrediction.lock_tier]
          : 0;
        const finalistPoints = finalistCorrectCount * tournamentPointValues.finalist[tournamentPrediction.lock_tier];
        tournamentPoints = championPoints + finalistPoints;

        await this.db.execute(
          `UPDATE tournament_predictions
           SET champion_hit = ?,
               finalist_hits = ?,
               champion_points = ?,
               finalist_points = ?,
               points_awarded = ?
           WHERE id = ?`,
          [
            championCorrect ? 1 : 0,
            finalistCorrectCount,
            championPoints,
            finalistPoints,
            tournamentPoints,
            tournamentPrediction.id
          ]
        );
      }

      const totalPoints = matchPoints + streakBonusPoints + tournamentPoints;
      await this.db.execute(
        `INSERT INTO scores (
           user_id, match_points, streak_bonus_points, tournament_points, total_points,
           exact_count, outcome_count, max_streak, champion_correct, finalist_correct_count,
           last_recalculated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
           match_points = VALUES(match_points),
           streak_bonus_points = VALUES(streak_bonus_points),
           tournament_points = VALUES(tournament_points),
           total_points = VALUES(total_points),
           exact_count = VALUES(exact_count),
           outcome_count = VALUES(outcome_count),
           max_streak = VALUES(max_streak),
           champion_correct = VALUES(champion_correct),
           finalist_correct_count = VALUES(finalist_correct_count),
           last_recalculated_at = CURRENT_TIMESTAMP`,
        [
          user.id,
          matchPoints,
          streakBonusPoints,
          tournamentPoints,
          totalPoints,
          exactCount,
          outcomeCount,
          maxStreak,
          championCorrect ? 1 : 0,
          finalistCorrectCount
        ]
      );
    }

    return { users: users.length, finishedMatches: finishedMatches.length };
  }

  async ranking() {
    return this.db.query<RowDataPacket>(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.username,
         u.created_at,
         GROUP_CONCAT(ua.area ORDER BY ua.area SEPARATOR ', ') AS areas,
         COALESCE(s.total_points, 0) + COALESCE(cp.completion_points, 0) AS total_points,
         COALESCE(s.match_points, 0) AS match_points,
         COALESCE(s.streak_bonus_points, 0) AS streak_bonus_points,
         COALESCE(s.tournament_points, 0) AS tournament_points,
         COALESCE(cp.completion_points, 0) AS completion_points,
         COALESCE(s.exact_count, 0) AS exact_count,
         COALESCE(s.outcome_count, 0) AS outcome_count,
         COALESCE(s.max_streak, 0) AS max_streak,
         COALESCE(s.champion_correct, 0) AS champion_correct,
         COALESCE(s.finalist_correct_count, 0) AS finalist_correct_count
       FROM users u
       LEFT JOIN user_areas ua ON ua.user_id = u.id
       LEFT JOIN scores s ON s.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS completion_points
         FROM match_predictions
         WHERE auto_filled = 0
         GROUP BY user_id
       ) cp ON cp.user_id = u.id
       GROUP BY u.id, s.id, cp.completion_points
       ORDER BY
         total_points DESC,
         exact_count DESC,
         max_streak DESC,
         outcome_count DESC,
         champion_correct DESC,
         finalist_correct_count DESC,
         u.created_at ASC`
    );
  }

  async rankingDetail(userId: number, viewerUserId: number) {
    const [userRows, areas, scoreRows, visibleHistory, hiddenRows, tournamentRows, tournamentVisibilityRows] = await Promise.all([
      this.db.query<RowDataPacket>(
        `SELECT id, username, first_name, last_name, created_at
         FROM users
         WHERE id = ?`,
        [userId]
      ),
      this.db.query<RowDataPacket>(`SELECT area FROM user_areas WHERE user_id = ? ORDER BY area`, [userId]),
      this.db.query<ScoreRow>(
        `SELECT
           COALESCE(s.match_points, 0) AS match_points,
           COALESCE(s.streak_bonus_points, 0) AS streak_bonus_points,
           COALESCE(s.tournament_points, 0) AS tournament_points,
           COALESCE(cp.completion_points, 0) AS completion_points,
           COALESCE(s.total_points, 0) + COALESCE(cp.completion_points, 0) AS total_points,
           COALESCE(s.exact_count, 0) AS exact_count,
           COALESCE(s.outcome_count, 0) AS outcome_count,
           COALESCE(s.max_streak, 0) AS max_streak,
           COALESCE(s.champion_correct, 0) AS champion_correct,
           COALESCE(s.finalist_correct_count, 0) AS finalist_correct_count
         FROM users u
         LEFT JOIN scores s ON s.user_id = u.id
         LEFT JOIN (
           SELECT user_id, COUNT(*) AS completion_points
           FROM match_predictions
           WHERE auto_filled = 0
           GROUP BY user_id
         ) cp ON cp.user_id = u.id
         WHERE u.id = ?`,
        [userId]
      ),
      this.db.query<RowDataPacket>(
        `SELECT
           m.id AS match_id,
           m.match_number,
           m.stage,
           m.group_name,
           m.kickoff_at,
           m.prediction_closes_at,
           m.finished,
           m.home_team_id,
           m.away_team_id,
           ht.name AS home_team_name,
           ht.code AS home_team_code,
           ht.flag_url AS home_flag_url,
           at.name AS away_team_name,
           at.code AS away_team_code,
           at.flag_url AS away_flag_url,
           m.home_placeholder,
           m.away_placeholder,
           m.home_score,
           m.away_score,
           p.predicted_home_team_id,
           p.predicted_away_team_id,
           pht.name AS predicted_home_team_name,
           pht.code AS predicted_home_team_code,
           pht.flag_url AS predicted_home_flag_url,
           pat.name AS predicted_away_team_name,
           pat.code AS predicted_away_team_code,
           pat.flag_url AS predicted_away_flag_url,
           p.predicted_home_score,
           p.predicted_away_score,
           p.auto_filled,
           p.points,
           p.exact_hit,
           p.outcome_hit,
           p.difference_hit,
           p.home_goals_hit,
           p.away_goals_hit,
           p.submitted_at
         FROM match_predictions p
         JOIN matches m ON m.id = p.match_id
         LEFT JOIN teams ht ON ht.id = m.home_team_id
         LEFT JOIN teams at ON at.id = m.away_team_id
         LEFT JOIN teams pht ON pht.id = p.predicted_home_team_id
         LEFT JOIN teams pat ON pat.id = p.predicted_away_team_id
         WHERE p.user_id = ?
           AND (
             m.finished = 1
             OR (m.prediction_closes_at IS NOT NULL AND NOW() >= m.prediction_closes_at)
           )
         ORDER BY m.kickoff_at IS NULL, m.kickoff_at, m.match_number, m.id`,
        [userId]
      ),
      this.db.query<RowDataPacket>(
        `SELECT COUNT(*) AS hidden_count
         FROM match_predictions p
         JOIN matches m ON m.id = p.match_id
         WHERE p.user_id = ?
           AND NOT (
             m.finished = 1
             OR (m.prediction_closes_at IS NOT NULL AND NOW() >= m.prediction_closes_at)
           )`,
        [userId]
      ),
      this.db.query<RowDataPacket>(
        `SELECT
           tp.*,
           champion.name AS champion_name,
           champion.code AS champion_code,
           champion.flag_url AS champion_flag_url,
           f1.name AS finalist1_name,
           f1.code AS finalist1_code,
           f1.flag_url AS finalist1_flag_url,
           f2.name AS finalist2_name,
           f2.code AS finalist2_code,
           f2.flag_url AS finalist2_flag_url
         FROM tournament_predictions tp
         JOIN teams champion ON champion.id = tp.champion_team_id
         JOIN teams f1 ON f1.id = tp.finalist1_team_id
         JOIN teams f2 ON f2.id = tp.finalist2_team_id
         WHERE tp.user_id = ?`,
        [userId]
      ),
      this.db.query<RowDataPacket>(
        `SELECT
           CASE
             WHEN MIN(CASE WHEN stage = 'group' THEN prediction_closes_at END) IS NOT NULL
              AND NOW() >= MIN(CASE WHEN stage = 'group' THEN prediction_closes_at END)
             THEN 1
             ELSE 0
           END AS group_visible,
           CASE
             WHEN MIN(CASE WHEN stage = 'qf' THEN prediction_closes_at END) IS NOT NULL
              AND NOW() >= MIN(CASE WHEN stage = 'qf' THEN prediction_closes_at END)
             THEN 1
             ELSE 0
           END AS tournament_visible
         FROM matches`
      )
    ]);

    const tournament = tournamentRows[0] ?? null;
    const visibility = tournamentVisibilityRows[0] ?? null;
    const canViewPredictions = Number(viewerUserId) === Number(userId) || Number(visibility?.group_visible) === 1;
    const tournamentVisible = Boolean(
      tournament &&
      canViewPredictions &&
      Number(visibility?.tournament_visible) === 1
    );
    const hiddenPredictionCount = Number(hiddenRows[0]?.hidden_count ?? 0) + (canViewPredictions ? 0 : visibleHistory.length);

    return {
      user: userRows[0] ?? null,
      areas: areas.map((row) => row.area),
      score: scoreRows[0] ?? null,
      history: canViewPredictions ? visibleHistory : [],
      hiddenPredictionCount,
      lockedByGroupClose: !canViewPredictions,
      tournament: tournament
        ? tournamentVisible
          ? { ...tournament, visible: true }
          : {
              id: tournament.id,
              user_id: tournament.user_id,
              lock_tier: tournament.lock_tier,
              locked_at: tournament.locked_at,
              visible: false
            }
        : null
    };
  }

  async profile(userId: number) {
    const [userRows, areas, scoreRows, history, tournament] = await Promise.all([
      this.db.query<RowDataPacket>(
        `SELECT id, email, username, first_name, last_name, role, created_at
         FROM users
         WHERE id = ?`,
        [userId]
      ),
      this.db.query<RowDataPacket>(`SELECT area FROM user_areas WHERE user_id = ? ORDER BY area`, [userId]),
      this.db.query<ScoreRow>(
        `SELECT
           COALESCE(s.match_points, 0) AS match_points,
           COALESCE(s.streak_bonus_points, 0) AS streak_bonus_points,
           COALESCE(s.tournament_points, 0) AS tournament_points,
           COALESCE(cp.completion_points, 0) AS completion_points,
           COALESCE(s.total_points, 0) + COALESCE(cp.completion_points, 0) AS total_points,
           COALESCE(s.exact_count, 0) AS exact_count,
           COALESCE(s.outcome_count, 0) AS outcome_count,
           COALESCE(s.max_streak, 0) AS max_streak,
           COALESCE(s.champion_correct, 0) AS champion_correct,
           COALESCE(s.finalist_correct_count, 0) AS finalist_correct_count
         FROM users u
         LEFT JOIN scores s ON s.user_id = u.id
         LEFT JOIN (
           SELECT user_id, COUNT(*) AS completion_points
           FROM match_predictions
           WHERE auto_filled = 0
           GROUP BY user_id
         ) cp ON cp.user_id = u.id
         WHERE u.id = ?`,
        [userId]
      ),
      this.db.query<RowDataPacket>(
        `SELECT
           m.id AS match_id,
           m.match_number,
           m.stage,
           m.group_name,
           m.kickoff_at,
           m.prediction_closes_at,
           m.finished,
           m.home_team_id,
           m.away_team_id,
           ht.name AS home_team_name,
           ht.code AS home_team_code,
           ht.flag_url AS home_flag_url,
           at.name AS away_team_name,
           at.code AS away_team_code,
           at.flag_url AS away_flag_url,
           m.home_placeholder,
           m.away_placeholder,
           m.home_score,
           m.away_score,
           p.predicted_home_team_id,
           p.predicted_away_team_id,
           pht.name AS predicted_home_team_name,
           pht.code AS predicted_home_team_code,
           pht.flag_url AS predicted_home_flag_url,
           pat.name AS predicted_away_team_name,
           pat.code AS predicted_away_team_code,
           pat.flag_url AS predicted_away_flag_url,
           p.predicted_home_score,
           p.predicted_away_score,
           p.auto_filled,
           p.points,
           p.exact_hit,
           p.outcome_hit,
           p.difference_hit,
           p.home_goals_hit,
           p.away_goals_hit,
           p.submitted_at
         FROM matches m
         LEFT JOIN teams ht ON ht.id = m.home_team_id
         LEFT JOIN teams at ON at.id = m.away_team_id
         LEFT JOIN match_predictions p ON p.match_id = m.id AND p.user_id = ?
         LEFT JOIN teams pht ON pht.id = p.predicted_home_team_id
         LEFT JOIN teams pat ON pat.id = p.predicted_away_team_id
         ORDER BY m.kickoff_at IS NULL, m.kickoff_at, m.match_number`,
        [userId]
      ),
      this.db.query<RowDataPacket>(
        `SELECT
           tp.*,
           champion.name AS champion_name,
           champion.code AS champion_code,
           champion.flag_url AS champion_flag_url,
           f1.name AS finalist1_name,
           f1.code AS finalist1_code,
           f1.flag_url AS finalist1_flag_url,
           f2.name AS finalist2_name,
           f2.code AS finalist2_code,
           f2.flag_url AS finalist2_flag_url
         FROM tournament_predictions tp
         JOIN teams champion ON champion.id = tp.champion_team_id
         JOIN teams f1 ON f1.id = tp.finalist1_team_id
         JOIN teams f2 ON f2.id = tp.finalist2_team_id
         WHERE tp.user_id = ?`,
        [userId]
      )
    ]);

    return {
      user: userRows[0] ?? null,
      areas: areas.map((row) => row.area),
      score: scoreRows[0] ?? null,
      tournament: tournament[0] ?? null,
      history
    };
  }

  scoreMatch(predHome: number, predAway: number, actualHome: number, actualAway: number): ScoreBreakdown {
    const exactHit = predHome === actualHome && predAway === actualAway;
    const outcomeHit = this.outcome(predHome, predAway) === this.outcome(actualHome, actualAway);
    const differenceHit = predHome - predAway === actualHome - actualAway;
    const homeGoalsHit = predHome === actualHome;
    const awayGoalsHit = predAway === actualAway;

    let points = 0;
    if (exactHit) {
      points += 10;
    } else if (outcomeHit) {
      points += 5;
    }
    if (differenceHit) points += 3;
    if (homeGoalsHit) points += 1;
    if (awayGoalsHit) points += 1;

    return {
      points: Math.min(points, 15),
      exactHit,
      outcomeHit,
      differenceHit,
      homeGoalsHit,
      awayGoalsHit
    };
  }

  private outcome(home: number, away: number): 'HOME' | 'DRAW' | 'AWAY' {
    if (home > away) return 'HOME';
    if (home < away) return 'AWAY';
    return 'DRAW';
  }

  private scorePredictionForMatch(
    prediction: MatchPredictionRow,
    match: FinishedMatchRow,
    tournamentPrediction?: TournamentPredictionRow
  ): ScoreBreakdown {
    if (match.stage !== 'group' && match.home_team_id && match.away_team_id) {
      const predictedHomeTeamId = match.stage === 'final' && tournamentPrediction
        ? Number(tournamentPrediction.champion_team_id)
        : Number(prediction.predicted_home_team_id);
      const predictedAwayTeamId = match.stage === 'final' && tournamentPrediction
        ? this.runnerUpTeamId(tournamentPrediction)
        : Number(prediction.predicted_away_team_id);
      const predictedMatchupIsCorrect =
        predictedHomeTeamId === Number(match.home_team_id) &&
        predictedAwayTeamId === Number(match.away_team_id);

      if (!predictedMatchupIsCorrect) {
        return this.zeroScore();
      }
    }

    return this.scoreMatch(
      prediction.predicted_home_score,
      prediction.predicted_away_score,
      match.home_score,
      match.away_score
    );
  }

  private runnerUpTeamId(prediction: TournamentPredictionRow): number {
    const championTeamId = Number(prediction.champion_team_id);
    const finalist1TeamId = Number(prediction.finalist1_team_id);
    const finalist2TeamId = Number(prediction.finalist2_team_id);
    return championTeamId === finalist1TeamId ? finalist2TeamId : finalist1TeamId;
  }

  private zeroScore(): ScoreBreakdown {
    return {
      points: 0,
      exactHit: false,
      outcomeHit: false,
      differenceHit: false,
      homeGoalsHit: false,
      awayGoalsHit: false
    };
  }
}
