import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { createPool } from 'mysql2/promise';

const BASE_URL = process.env.SIM_BASE_URL || 'http://localhost:3000';
const ADMIN_IDENTIFIER = process.env.SIM_ADMIN_IDENTIFIER;
const ADMIN_PASSWORD = process.env.SIM_ADMIN_PASSWORD;
const ADMIN_TOKEN = process.env.SIM_ADMIN_TOKEN;

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${payload?.message || text}`);
  }
  return payload;
}

async function getAdminToken() {
  if (ADMIN_TOKEN) return ADMIN_TOKEN;

  if (ADMIN_IDENTIFIER && ADMIN_PASSWORD) {
    const admin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: ADMIN_IDENTIFIER, password: ADMIN_PASSWORD })
    });
    return admin.token;
  }

  const pool = createPool({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || 'koi_prode',
    waitForConnections: true,
    connectionLimit: 1
  });

  try {
    const [rows] = await pool.query(
      `SELECT id, email, username, first_name, last_name, role
       FROM users
       WHERE role = 'ADMIN'
       ORDER BY id
       LIMIT 1`
    );
    const admin = rows[0];
    if (!admin) {
      throw new Error('No ADMIN user exists in the local DB.');
    }

    return jwt.sign(
      {
        id: Number(admin.id),
        email: admin.email,
        username: admin.username,
        firstName: admin.first_name,
        lastName: admin.last_name,
        role: admin.role
      },
      process.env.JWT_SECRET || 'dev-only-change-me',
      { expiresIn: '7d' }
    );
  } finally {
    await pool.end();
  }
}

async function registerQaUser(stamp, suffix, firstName, lastName, area) {
  return api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      code: 'KOIPRODE123',
      firstName,
      lastName,
      email: `qa-${suffix}-${stamp}@koiprode.test`,
      username: `qa_${suffix}_${stamp}`,
      password: 'qa123456',
      areas: [area]
    })
  });
}

async function savePrediction(token, matchId, homeScore, awayScore) {
  return api('/api/predictions/match', {
    method: 'POST',
    token,
    body: JSON.stringify({ matchId, homeScore, awayScore })
  });
}

async function setResult(token, matchId, homeScore, awayScore) {
  return api(`/api/admin/matches/${matchId}/result`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ homeScore, awayScore })
  });
}

function byMatchNumber(matches, matchNumber) {
  const match = matches.find((item) => Number(item.match_number) === Number(matchNumber));
  if (!match) throw new Error(`Match number ${matchNumber} not found`);
  return match;
}

function pickRankingRows(ranking, userIds) {
  return ranking
    .filter((row) => userIds.includes(Number(row.id)))
    .map((row) => ({
      id: Number(row.id),
      name: `${row.first_name} ${row.last_name}`,
      total_points: Number(row.total_points),
      match_points: Number(row.match_points),
      completion_points: Number(row.completion_points),
      streak_bonus_points: Number(row.streak_bonus_points),
      exact_count: Number(row.exact_count),
      outcome_count: Number(row.outcome_count),
      max_streak: Number(row.max_streak)
    }));
}

function profileSummary(profile) {
  const score = profile.score;
  return {
    total_points: Number(score.total_points),
    match_points: Number(score.match_points),
    completion_points: Number(score.completion_points),
    streak_bonus_points: Number(score.streak_bonus_points),
    exact_count: Number(score.exact_count),
    outcome_count: Number(score.outcome_count),
    max_streak: Number(score.max_streak)
  };
}

function assertExpected(label, actual, expected) {
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => Number(actual[key]) !== Number(value))
    .map(([key, value]) => `${key}: expected ${value}, got ${actual[key]}`);

  return {
    label,
    pass: mismatches.length === 0,
    mismatches
  };
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

const adminToken = await getAdminToken();

const [alpha, beta] = await Promise.all([
  registerQaUser(stamp, 'alpha', 'QA Exacta', 'Koi', 'TECH'),
  registerQaUser(stamp, 'beta', 'QA Mixta', 'Koi', 'LABS')
]);

const matches = await api('/api/matches', { token: adminToken });
const simulation = [
  {
    matchNumber: 3,
    result: [2, 1],
    alpha: [2, 1],
    beta: [1, 0]
  },
  {
    matchNumber: 4,
    result: [0, 0],
    alpha: [0, 0],
    beta: [1, 1]
  },
  {
    matchNumber: 8,
    result: [1, 3],
    alpha: [1, 3],
    beta: [2, 1]
  },
  {
    matchNumber: 7,
    result: [3, 1],
    alpha: [3, 1],
    beta: [2, 1]
  }
].map((item) => ({
  ...item,
  match: byMatchNumber(matches, item.matchNumber)
}));

for (const item of simulation) {
  await savePrediction(alpha.token, item.match.id, item.alpha[0], item.alpha[1]);
  await savePrediction(beta.token, item.match.id, item.beta[0], item.beta[1]);
}

for (const item of simulation) {
  await setResult(adminToken, item.match.id, item.result[0], item.result[1]);
}

const recalculation = await api('/api/admin/scores/recalculate', {
  method: 'POST',
  token: adminToken
});

const [alphaProfile, betaProfile, ranking] = await Promise.all([
  api('/api/profile', { token: alpha.token }),
  api('/api/profile', { token: beta.token }),
  api('/api/ranking', { token: adminToken })
]);

const alphaSummary = profileSummary(alphaProfile);
const betaSummary = profileSummary(betaProfile);

const expectedAlpha = {
  total_points: 67,
  match_points: 60,
  completion_points: 4,
  streak_bonus_points: 3,
  exact_count: 4,
  outcome_count: 4,
  max_streak: 4
};

const expectedBeta = {
  total_points: 26,
  match_points: 22,
  completion_points: 4,
  streak_bonus_points: 0,
  exact_count: 0,
  outcome_count: 3,
  max_streak: 2
};

const result = {
  stamp,
  users: [
    {
      id: alpha.user.id,
      username: alpha.user.username,
      email: alpha.user.email,
      password: 'qa123456',
      summary: alphaSummary,
      check: assertExpected('QA Exacta Koi', alphaSummary, expectedAlpha)
    },
    {
      id: beta.user.id,
      username: beta.user.username,
      email: beta.user.email,
      password: 'qa123456',
      summary: betaSummary,
      check: assertExpected('QA Mixta Koi', betaSummary, expectedBeta)
    }
  ],
  matches: simulation.map((item) => ({
    match_id: item.match.id,
    match_number: item.matchNumber,
    teams: `${item.match.home_team_name} vs ${item.match.away_team_name}`,
    result: item.result.join('-'),
    alpha_prediction: item.alpha.join('-'),
    beta_prediction: item.beta.join('-')
  })),
  ranking_rows: pickRankingRows(ranking, [alpha.user.id, beta.user.id]),
  recalculation
};

console.log(JSON.stringify(result, null, 2));
