import type { Request } from 'express';
import type { Area, Stage, TournamentLockTier } from './config';

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: 'USER' | 'ADMIN';
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export interface UserRow {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: 'USER' | 'ADMIN';
  created_at: string;
}

export interface TeamRow {
  id: number;
  external_id: string | null;
  source: string;
  name: string;
  code: string | null;
  group_name: string | null;
  flag_url: string | null;
}

export interface MatchRow {
  id: number;
  external_id: string | null;
  source: string;
  match_number: number | null;
  stage: Stage;
  group_name: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  home_placeholder: string | null;
  away_placeholder: string | null;
  kickoff_at: string | null;
  api_local_date: string | null;
  stadium_name: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  finished: 0 | 1;
  prediction_closes_at: string | null;
}

export interface MatchPredictionRow {
  id: number;
  user_id: number;
  match_id: number;
  predicted_home_team_id: number | null;
  predicted_away_team_id: number | null;
  predicted_home_score: number;
  predicted_away_score: number;
  submitted_at: string;
  auto_filled: 0 | 1;
  points: number;
  exact_hit: 0 | 1;
  outcome_hit: 0 | 1;
  difference_hit: 0 | 1;
  home_goals_hit: 0 | 1;
  away_goals_hit: 0 | 1;
}

export interface TournamentPredictionRow {
  id: number;
  user_id: number;
  champion_team_id: number;
  finalist1_team_id: number;
  finalist2_team_id: number;
  lock_tier: TournamentLockTier;
  locked_at: string;
  champion_hit: 0 | 1;
  finalist_hits: number;
  champion_points: number;
  finalist_points: number;
  points_awarded: number;
}

export interface RegisterBody {
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  areas: Area[];
}

export interface LoginBody {
  identifier: string;
  password: string;
}
