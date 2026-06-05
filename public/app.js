const state = {
  token: localStorage.getItem('koi_token'),
  me: null,
  teams: [],
  matches: [],
  predictions: { matches: [], tournament: null },
  ranking: [],
  notifications: [],
  adminNotifications: [],
  profile: null,
  view: 'home',
  stage: 'group',
  authMode: 'login',
  rankingOpenUserId: null,
  rankingDetails: {},
  rankingDetailLoadingId: null,
  adminImportPreview: null,
  adminImportLoading: false,
  adminResultMatchId: null,
  tutorialOpen: false,
  tutorialStep: 0,
  fixtureSearch: '',
  fixtureStatusFilter: 'all',
  fixtureFocusMatchId: null,
  pointBurstMatchId: null,
  quickPointBurst: false,
  tournamentDraft: null,
  pendingTournamentLock: null
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const DEFAULT_API_BASE_URL = LOCAL_HOSTNAMES.has(window.location.hostname)
  ? '/api/prode'
  : 'https://api.noxus.com.ar/api/prode';
const API_BASE_URL = String(window.KOI_PRODE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');

const stages = [
  ['tournament', 'Torneo'],
  ['group', 'Grupos'],
  ['r32', 'Dieciseisavos'],
  ['r16', 'Octavos'],
  ['qf', 'Cuartos'],
  ['sf', 'Semis'],
  ['third', 'Tercer puesto'],
  ['final', 'Final']
];

const stagePrerequisites = {
  r32: 'group',
  r16: 'r32',
  qf: 'r16',
  sf: 'qf',
  third: 'sf',
  final: 'sf'
};

const stagesWithScrollTop = ['group', 'r32', 'r16'];

const tournamentLockRows = [
  { tier: 'early', window: 'Antes del cierre general de grupos', champion: 40, finalist: 20 },
  { tier: 'before_r32', window: 'Antes de dieciseisavos', champion: 25, finalist: 12 },
  { tier: 'before_qf', window: 'Antes de cuartos', champion: 15, finalist: 8 },
  { tier: 'closed', window: 'Despues de eso', champion: 0, finalist: 0 }
];

const tutorialSteps = [
  {
    eyebrow: 'Koi Prode',
    title: 'Jugá, creé, ganá',
    body: 'Completá la fase de grupos poniendo los goles para cada equipo, solo participar ya suma +1 punto. Sumás puntos por acertar el ganador, puntos extra por acertar cantidad de goles, diferencia de goles y puntaje exacto!',
    bullets: [
      'Cargá los resultados desde el inicio o directamente desde el fixture',
      'Si predecís el campeon en la pestaña de torneo puede sumar +40 puntos',
      'Según tus predicciones se arman las llaves del mundial'
    ],
    flow: [
      ['1', 'Predecí', 'Cargá tus resultados'],
      ['2', 'Contempla', 'Observa la llave que armaste por tus resultados'],
      ['3', 'Disfruta', 'Divertite mientras dia a dia se va actualizando la pagina']
    ]
  },
  {
    eyebrow: 'La llave',
    title: 'Cómo se arma la llave del prode?',
    body: 'Cuando completas grupos, la app arma tus dieciseisavos segun tus propios resultados. Despues octavos, cuartos, semis y final dependen de lo que vos fuiste prediciendo.',
    bullets: [
      'Los campos seleccionados no reflejan el fixture real',
      'Podes elegir quien pasa de octavos a cuartos y así',
      'Al confirmarse un partido vas a ver el resultado debajo'
    ],
    flow: [
      ['1', 'Analizo', 'Cargas los goles pero sin empates, uno tiene que ganar'],
      ['2', 'Proyecto', 'La llave se va a armar con tus predicciones para las siguientes etapas'],
      ['3', 'Festejo', 'No olvides revisar el ranking cada vez que un resultado se confirme del mundial']
    ]
  },
  {
    eyebrow: 'Bloqueos',
    title: '¿Ya decidiste al campeon?',
    body: 'La fase de grupos cierra 1 hora antes del primer partido del Mundial. Mientras completas la fase de grupos podés predecir al campeon y sub campeon por muchos puntos o dejarlo hasta el final por menos puntos',
    bullets: ['El cierre general es antes del partido inaugural, así nadie juega con resultados reales ya vistos.', 'Antes del cierre general: campeon 40, finalista 20.', 'Antes de dieciseisavos: campeon 25, finalista 12.', 'Antes de cuartos: campeon 15, finalista 8.'],
    flow: [
      ['1', 'Cuidado', 'Una vez bloqueado el campeon no se puede cambiar']
    ]
  },
  {
    eyebrow: 'Koi Prode',
    title: 'Muchas gracias por jugar',
    body: 'El objetivo de este prode es que juntos podamos divertirnos y elegir sanamente disfrutar de un evento que sucede cada 4 años',
    bullets: ['Ante cualquier inconveniente con la página comunicarse con el administrador: nicolas.melluso@koiventures.tech'],
    flow: []
  }
];

const areas = ['LABS', 'TECH', 'ECOSYSTEM', 'GERENCIA'];
const root = document.querySelector('#root');
let globalEventsBound = false;
let appMessageTimeoutId = null;
let appMessageToken = 0;
let countdownIntervalId = null;

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function scoreValue(value) {
  return value === null || value === undefined || value === '' ? 0 : value;
}

function isAutoFilledPrediction(prediction) {
  return Number(prediction?.auto_filled) === 1;
}

function predictionDisplayPoints(prediction) {
  if (!prediction) return null;
  return isAutoFilledPrediction(prediction) ? 0 : Number(prediction.points || 0) + 1;
}

function teamName(match, side) {
  if (side === 'home') return match.home_team_name || translateMatchPlaceholder(match.home_placeholder) || 'TBD';
  return match.away_team_name || translateMatchPlaceholder(match.away_placeholder) || 'TBD';
}

function translateMatchPlaceholder(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const winner = text.match(/^Winner Match (\d+)$/i);
  if (winner) return `Ganador partido ${winner[1]}`;
  const loser = text.match(/^Loser Match (\d+)$/i);
  if (loser) return `Perdedor partido ${loser[1]}`;
  const runnerUp = text.match(/^Runner-up Group ([A-Z])$/i);
  if (runnerUp) return `Segundo grupo ${runnerUp[1].toUpperCase()}`;
  const groupWinner = text.match(/^Winner Group ([A-Z])$/i);
  if (groupWinner) return `Ganador grupo ${groupWinner[1].toUpperCase()}`;
  const third = text.match(/^3rd Group ([A-Z/]+)$/i);
  if (third) return `Mejor tercero ${third[1].toUpperCase()}`;
  return text;
}

function teamFlag(match, side) {
  return side === 'home' ? match.home_flag_url : match.away_flag_url;
}

function teamCode(match, side) {
  return side === 'home' ? match.home_team_code : match.away_team_code;
}

function teamById(teamId) {
  if (!teamId) return null;
  return state.teams.find((item) => Number(item.id) === Number(teamId)) ?? null;
}

function uniqueTeams(teams) {
  const seen = new Set();
  return (teams || []).filter((team) => {
    if (!team?.id || seen.has(Number(team.id))) return false;
    seen.add(Number(team.id));
    return true;
  });
}

function sortedTeamOptions(teams) {
  return [...(teams || [])].sort((a, b) => {
    const aIsArgentina = isArgentinaTeam(a);
    const bIsArgentina = isArgentinaTeam(b);
    if (aIsArgentina && !bIsArgentina) return -1;
    if (!aIsArgentina && bIsArgentina) return 1;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'es', { sensitivity: 'base' });
  });
}

function isArgentinaTeam(team) {
  return normalizeSearchText(team?.code) === 'arg' || normalizeSearchText(team?.name) === 'argentina';
}

function teamNameById(teamId) {
  const team = teamById(teamId);
  return team?.name ?? null;
}

function matchByNumber(matchNumber) {
  if (!matchNumber) return null;
  return state.matches.find((item) => Number(item.match_number) === Number(matchNumber)) ?? null;
}

function predictionByMatchId(matchId) {
  return state.predictions.matches.find((prediction) => Number(prediction.match_id) === Number(matchId)) ?? null;
}

function stageUsedTeamIds(stage, currentMatchId) {
  const used = new Set();
  if (!stage || stage === 'group') return used;

  for (const prediction of state.predictions.matches) {
    const match = state.matches.find((item) => Number(item.id) === Number(prediction.match_id));
    if (!match || match.stage !== stage || Number(match.id) === Number(currentMatchId)) continue;

    if (prediction.predicted_home_team_id) used.add(Number(prediction.predicted_home_team_id));
    if (prediction.predicted_away_team_id) used.add(Number(prediction.predicted_away_team_id));
  }

  return used;
}

function groupCode(value) {
  const match = String(value || '').trim().match(/([A-Z])$/i);
  return match ? match[1].toUpperCase() : '';
}

function standingSort(a, b) {
  return b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    String(a.team?.name || '').localeCompare(String(b.team?.name || ''), 'es', { sensitivity: 'base' }) ||
    Number(a.team?.id || 0) - Number(b.team?.id || 0);
}

function applyStandingResult(home, away, homeScore, awayScore) {
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

function groupStandings(groupName, actualOnly = false) {
  const code = groupCode(groupName);
  if (!code) return [];

  const groupMatches = state.matches.filter((match) => match.stage === 'group' && groupCode(match.group_name) === code);
  const allActual = groupMatches.length > 0 && groupMatches.every((match) => (
    Number(match.finished) === 1 &&
    match.home_score !== null &&
    match.away_score !== null
  ));
  if (actualOnly && !allActual) return [];

  const useActual = allActual;
  const standings = new Map();
  const ensureTeam = (teamId) => {
    const team = teamById(teamId);
    if (!team) return null;
    if (!standings.has(Number(team.id))) {
      standings.set(Number(team.id), {
        team,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0
      });
    }
    return standings.get(Number(team.id));
  };

  for (const match of groupMatches) {
    const home = ensureTeam(match.home_team_id);
    const away = ensureTeam(match.away_team_id);
    if (!home || !away) continue;

    const prediction = predictionByMatchId(match.id);
    const homeScore = useActual ? match.home_score : prediction?.predicted_home_score;
    const awayScore = useActual ? match.away_score : prediction?.predicted_away_score;
    if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) continue;
    applyStandingResult(home, away, Number(homeScore), Number(awayScore));
  }

  return Array.from(standings.values()).sort(standingSort);
}

function groupTeams(groupName) {
  const code = groupCode(groupName);
  if (!code) return [];

  const teams = [];
  for (const match of state.matches) {
    if (match.stage !== 'group' || groupCode(match.group_name) !== code) continue;

    const homeTeam = teamById(match.home_team_id);
    const awayTeam = teamById(match.away_team_id);
    if (homeTeam) teams.push(homeTeam);
    if (awayTeam) teams.push(awayTeam);
  }

  return uniqueTeams(teams);
}

function bestThirdPlaceStandings(actualOnly = false) {
  const groups = Array.from(new Set(state.matches
    .filter((match) => match.stage === 'group')
    .map((match) => groupCode(match.group_name))
    .filter(Boolean)));

  return groups
    .map((group) => {
      const row = groupStandings(group, actualOnly)[2];
      return row ? { ...row, group } : null;
    })
    .filter(Boolean)
    .sort(standingSort);
}

function thirdPlaceGroupsFromPlaceholder(placeholder) {
  const third = String(placeholder || '').trim().match(/^3rd Group ([A-Z/]+)$/i);
  return third ? third[1].split('/').map((group) => group.toUpperCase()) : [];
}

function thirdPlaceSlotKey(match, side) {
  return `${Number(match.id)}:${side}`;
}

function thirdPlaceSlotAssignments(actualOnly = false) {
  const slots = state.matches
    .filter((match) => match.stage === 'r32')
    .flatMap((match) => ['home', 'away'].map((side) => {
      const placeholder = side === 'home' ? match.home_placeholder : match.away_placeholder;
      return {
        match,
        side,
        groups: thirdPlaceGroupsFromPlaceholder(placeholder)
      };
    }))
    .filter((slot) => slot.groups.length > 0)
    .sort((a, b) => Number(a.match.match_number || a.match.id) - Number(b.match.match_number || b.match.id));

  if (slots.length === 0) return new Map();

  const bestThirds = bestThirdPlaceStandings(actualOnly).slice(0, slots.length);
  if (bestThirds.length === 0) return new Map();

  const rankByTeamId = new Map(bestThirds.map((row, index) => [Number(row.team.id), index]));
  const teamByGroup = new Map(bestThirds.map((row) => [groupCode(row.group), row.team]));
  const slotCandidates = slots.map((slot, slotIndex) => ({
    ...slot,
    slotIndex,
    candidates: uniqueTeams(slot.groups.map((group) => teamByGroup.get(group)).filter(Boolean))
      .sort((a, b) => (rankByTeamId.get(Number(a.id)) ?? 999) - (rankByTeamId.get(Number(b.id)) ?? 999))
  }));

  const orderedSlots = [...slotCandidates].sort((a, b) => (
    a.candidates.length - b.candidates.length ||
    Number(a.match.match_number || a.match.id) - Number(b.match.match_number || b.match.id) ||
    a.slotIndex - b.slotIndex
  ));
  const assigned = new Map();
  const usedTeamIds = new Set();

  const search = (index) => {
    if (index >= orderedSlots.length) return true;
    const slot = orderedSlots[index];
    for (const team of slot.candidates) {
      const teamId = Number(team.id);
      if (usedTeamIds.has(teamId)) continue;

      assigned.set(thirdPlaceSlotKey(slot.match, slot.side), team);
      usedTeamIds.add(teamId);
      if (search(index + 1)) return true;
      usedTeamIds.delete(teamId);
      assigned.delete(thirdPlaceSlotKey(slot.match, slot.side));
    }
    return false;
  };

  if (search(0)) return assigned;

  const fallback = new Map();
  const fallbackUsedIds = new Set();
  for (const slot of slotCandidates) {
    const team = slot.candidates.find((candidate) => !fallbackUsedIds.has(Number(candidate.id)));
    if (!team) continue;
    fallback.set(thirdPlaceSlotKey(slot.match, slot.side), team);
    fallbackUsedIds.add(Number(team.id));
  }
  return fallback;
}

function thirdPlaceAssignedTeamForSlot(match, side, actualOnly = false) {
  const placeholder = side === 'home' ? match.home_placeholder : match.away_placeholder;
  if (thirdPlaceGroupsFromPlaceholder(placeholder).length === 0) return null;
  return thirdPlaceSlotAssignments(actualOnly).get(thirdPlaceSlotKey(match, side)) ?? null;
}

function actualTeamFromCompletedMatch(match, target) {
  if (
    !match ||
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
  const teamId = target === 'winner'
    ? homeWon ? match.home_team_id : match.away_team_id
    : homeWon ? match.away_team_id : match.home_team_id;
  return teamById(teamId);
}

function predictedTeamFromSourceMatch(match, target, actualOnly = false) {
  const actualTeam = actualTeamFromCompletedMatch(match, target);
  if (actualTeam) return actualTeam;
  if (actualOnly || !match) return null;

  const prediction = predictionByMatchId(match.id);
  if (!prediction || Number(prediction.predicted_home_score) === Number(prediction.predicted_away_score)) return null;

  const homeTeam = predictedTeamForSlot(match, prediction, 'home');
  const awayTeam = predictedTeamForSlot(match, prediction, 'away');
  if (!homeTeam || !awayTeam) return null;

  const homeWon = Number(prediction.predicted_home_score) > Number(prediction.predicted_away_score);
  return target === 'winner'
    ? homeWon ? homeTeam : awayTeam
    : homeWon ? awayTeam : homeTeam;
}

function teamsFromPlaceholder(placeholder, actualOnly = false) {
  const text = String(placeholder || '').trim();

  const groupWinner = text.match(/^Winner Group ([A-Z])$/i);
  if (groupWinner) {
    const standings = groupStandings(groupWinner[1], actualOnly);
    const team = standings[0]?.team;
    return team ? [team] : actualOnly ? [] : groupTeams(groupWinner[1]);
  }

  const runnerUp = text.match(/^Runner-up Group ([A-Z])$/i);
  if (runnerUp) {
    const standings = groupStandings(runnerUp[1], actualOnly);
    const team = standings[1]?.team;
    return team ? [team] : actualOnly ? [] : groupTeams(runnerUp[1]);
  }

  const third = text.match(/^3rd Group ([A-Z/]+)$/i);
  if (third) {
    const groups = third[1].split('/');
    const candidates = groups
      .map((group) => groupStandings(group, actualOnly)[2])
      .filter(Boolean);
    if (candidates.length === 0) {
      return actualOnly ? [] : uniqueTeams(groups.flatMap((group) => groupTeams(group)));
    }

    const bestThirdIds = bestThirdPlaceStandings(actualOnly).slice(0, 8).map((row) => Number(row.team.id));
    const qualified = bestThirdIds.length > 0
      ? candidates.filter((row) => bestThirdIds.includes(Number(row.team.id)))
      : candidates;
    return (qualified.length > 0 ? qualified : candidates).map((row) => row.team);
  }

  const source = text.match(/^(Winner|Loser) Match (\d+)$/i);
  if (source) {
    const team = predictedTeamFromSourceMatch(
      matchByNumber(Number(source[2])),
      source[1].toLowerCase() === 'winner' ? 'winner' : 'loser',
      actualOnly
    );
    return team ? [team] : [];
  }

  return [];
}

function resolvedTeamForSlot(match, side) {
  const teamId = side === 'home' ? match.home_team_id : match.away_team_id;
  const placeholder = side === 'home' ? match.home_placeholder : match.away_placeholder;
  if (!placeholder) return teamById(teamId);

  const announcedOptions = teamsFromPlaceholder(placeholder, true);
  const announcedTeam = teamById(teamId);
  if (announcedTeam && announcedOptions.some((team) => Number(team.id) === Number(announcedTeam.id))) {
    return announcedTeam;
  }

  const options = teamsFromPlaceholder(placeholder, false);
  return options.length === 1 ? options[0] : null;
}

function bracketSlotOptions(match, side) {
  const placeholder = side === 'home' ? match.home_placeholder : match.away_placeholder;
  if (placeholder) {
    const assignedThird = thirdPlaceAssignedTeamForSlot(match, side, true) || thirdPlaceAssignedTeamForSlot(match, side, false);
    if (assignedThird) return [assignedThird];
    const announcedOptions = teamsFromPlaceholder(placeholder, true);
    if (announcedOptions.length > 0) return announcedOptions;
    return teamsFromPlaceholder(placeholder, false);
  }

  const resolvedTeam = resolvedTeamForSlot(match, side);
  return resolvedTeam ? [resolvedTeam] : [];
}

function availableBracketSlotOptions(match, side) {
  const options = bracketSlotOptions(match, side);
  const usedIds = stageUsedTeamIds(match.stage, match.id);
  if (usedIds.size === 0) return options;
  return options.filter((team) => !usedIds.has(Number(team.id)));
}

function adminRealSlotOptions(match, side) {
  const placeholder = side === 'home' ? match.home_placeholder : match.away_placeholder;
  const fixedTeamId = side === 'home' ? match.home_team_id : match.away_team_id;
  const fixedTeam = teamById(fixedTeamId);
  const options = placeholder ? adminTeamsFromPlaceholder(placeholder) : fixedTeam ? [fixedTeam] : [];
  return uniqueTeams([...(fixedTeam ? [fixedTeam] : []), ...options]);
}

function adminTeamsFromPlaceholder(placeholder) {
  const text = String(placeholder || '').trim();

  const groupWinner = text.match(/^Winner Group ([A-Z])$/i);
  if (groupWinner) {
    const standings = groupStandings(groupWinner[1], true);
    return standings[0]?.team ? [standings[0].team] : groupTeams(groupWinner[1]);
  }

  const runnerUp = text.match(/^Runner-up Group ([A-Z])$/i);
  if (runnerUp) {
    const standings = groupStandings(runnerUp[1], true);
    return standings[1]?.team ? [standings[1].team] : groupTeams(runnerUp[1]);
  }

  const third = text.match(/^3rd Group ([A-Z/]+)$/i);
  if (third) {
    const groups = third[1].split('/');
    const candidates = groups
      .map((group) => groupStandings(group, true)[2])
      .filter(Boolean);
    const bestThirdIds = bestThirdPlaceStandings(true).slice(0, 8).map((row) => Number(row.team.id));
    const qualified = bestThirdIds.length > 0
      ? candidates.filter((row) => bestThirdIds.includes(Number(row.team.id)))
      : candidates;
    if (qualified.length > 0 || candidates.length > 0) {
      return (qualified.length > 0 ? qualified : candidates).map((row) => row.team);
    }
    return uniqueTeams(groups.flatMap((group) => groupTeams(group)));
  }

  const source = text.match(/^(Winner|Loser) Match (\d+)$/i);
  if (source) {
    const team = actualTeamFromCompletedMatch(
      matchByNumber(Number(source[2])),
      source[1].toLowerCase() === 'winner' ? 'winner' : 'loser'
    );
    return team ? [team] : [];
  }

  return [];
}

function predictedTeamForSlot(match, prediction, side) {
  const predictedTeamId = side === 'home'
    ? prediction?.predicted_home_team_id
    : prediction?.predicted_away_team_id;
  const options = bracketSlotOptions(match, side);
  const predictedTeam = teamById(predictedTeamId);
  if (predictedTeam && (options.length === 0 || options.some((team) => Number(team.id) === Number(predictedTeam.id)))) {
    return predictedTeam;
  }
  if (options.length === 1) return options[0];
  return null;
}

function apiDate(value) {
  if (!value) return 'Sin fecha';
  return value.replace('T', ' ').slice(0, 16);
}

function shortMatchDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return apiDate(value);
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function matchTime(match) {
  const raw = match.kickoff_at || match.api_local_date;
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const value = new Date(String(raw).replace(' ', 'T')).getTime();
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function isClosed(match) {
  if (!match.prediction_closes_at) return false;
  return new Date(match.prediction_closes_at.replace(' ', 'T')).getTime() <= Date.now();
}

function closeTime(match) {
  if (!match.prediction_closes_at) return Number.MAX_SAFE_INTEGER;
  const value = new Date(match.prediction_closes_at.replace(' ', 'T')).getTime();
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function stageCloseTime(stage) {
  const times = state.matches
    .filter((match) => match.stage === stage)
    .map(closeTime)
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? Math.min(...times) : Number.MAX_SAFE_INTEGER;
}

function nextPhaseCloseTarget() {
  const now = Date.now();
  const targets = stages
    .map(([stage]) => stage)
    .filter((stage) => stage !== 'tournament')
    .map((stage) => {
      const stageMatches = state.matches.filter((match) => match.stage === stage);
      const targetTime = stageCloseTime(stage);
      const match = stageMatches.find((item) => closeTime(item) === targetTime) ?? stageMatches[0] ?? null;
      return {
        stage,
        targetTime,
        prediction_closes_at: match?.prediction_closes_at ?? null
      };
    })
    .filter((target) => Number.isFinite(target.targetTime) && target.targetTime > now)
    .sort((a, b) => a.targetTime - b.targetTime);

  return targets[0] ?? null;
}

function currentTournamentLockTier() {
  const now = Date.now();
  if (now < stageCloseTime('group')) return 'early';
  if (now < stageCloseTime('r32')) return 'before_r32';
  if (now < stageCloseTime('qf')) return 'before_qf';
  return 'closed';
}

function tournamentLockRow(tier = currentTournamentLockTier()) {
  return tournamentLockRows.find((row) => row.tier === tier) ?? tournamentLockRows[0];
}

function countdownParts(targetTime) {
  const diff = Math.max(0, targetTime - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { diff, days, hours, minutes, seconds };
}

function countdownText(targetTime) {
  if (!Number.isFinite(targetTime) || targetTime === Number.MAX_SAFE_INTEGER) return 'Sin cierre definido';
  const parts = countdownParts(targetTime);
  if (parts.diff <= 0) return 'Cerrado';
  if (parts.days > 0) return `${parts.days}d ${String(parts.hours).padStart(2, '0')}h ${String(parts.minutes).padStart(2, '0')}m ${String(parts.seconds).padStart(2, '0')}s`;
  return `${String(parts.hours).padStart(2, '0')}h ${String(parts.minutes).padStart(2, '0')}m ${String(parts.seconds).padStart(2, '0')}s`;
}

function countdownLabel(match) {
  if (!match) return 'Sin partidos abiertos';
  const stageLabel = stages.find(([key]) => key === match.stage)?.[1] ?? 'Predicciones';
  if (match.stage === 'group') return 'Proximo cierre de fase: grupos';
  return `Proximo cierre de fase: ${stageLabel}`;
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchStatusKey(match, prediction = null) {
  const hasPrediction = Boolean(prediction);
  if (Number(match.finished) === 1) return hasPrediction ? 'finished' : 'closed';
  if (isClosed(match)) return hasPrediction ? 'locked' : 'closed';
  return 'open';
}

function matchStatusLabel(match, prediction = null) {
  return {
    open: 'Abierto',
    locked: 'Bloqueado',
    closed: 'Cerrado',
    finished: 'Finalizado'
  }[matchStatusKey(match, prediction)] ?? 'Partido';
}

function stagePredictionProgress(stage) {
  const stageMatches = state.matches.filter((match) => match.stage === stage);
  const predictedIds = new Set(state.predictions.matches.map((prediction) => Number(prediction.match_id)));
  const completed = stageMatches.filter((match) => predictedIds.has(Number(match.id))).length;
  return { total: stageMatches.length, completed, missing: Math.max(0, stageMatches.length - completed) };
}

function stagePredictionsClosed(stage) {
  const stageMatches = state.matches.filter((match) => match.stage === stage);
  return stageMatches.length > 0 && stageMatches.every((match) => isClosed(match));
}

function stageGate(stage) {
  const requiredStage = stagePrerequisites[stage];
  if (!requiredStage) return { blocked: false, autoUnlock: false, reason: '', requiredStage: null, progress: null };

  const progress = stagePredictionProgress(requiredStage);
  if (progress.total > 0 && progress.completed >= progress.total) {
    return { blocked: false, autoUnlock: false, reason: '', requiredStage, progress };
  }

  if (stagePredictionsClosed(requiredStage)) {
    return {
      blocked: false,
      autoUnlock: true,
      reason: stageAutoUnlockReason(stage, requiredStage, progress),
      requiredStage,
      progress
    };
  }

  return {
    blocked: true,
    autoUnlock: false,
    reason: stageGateReason(stage, requiredStage, progress),
    requiredStage,
    progress
  };
}

function stageAutoUnlockReason(stage, requiredStage, progress) {
  const currentLabel = stageName(stage);
  const requiredLabel = stageRequiredLabel(requiredStage);
  const missing = progress?.missing ?? 0;
  return `Podés jugar ${currentLabel}. Como ${requiredLabel} ya cerró, al guardar se autocompletan ${missing} partidos faltantes sin sumar puntos.`;
}

function stageGateReason(stage, requiredStage, progress) {
  const requiredLabel = stageName(requiredStage);
  const currentLabel = stageName(stage);
  const progressText = progress.total > 0
    ? `Completaste ${progress.completed}/${progress.total}; te faltan ${progress.missing}.`
    : `Todavia no hay partidos cargados de ${requiredLabel}.`;

  if (stage === 'r32') {
    return `Para completar Dieciseisavos primero tenes que completar todos los partidos de Grupos. ${progressText}`;
  }

  if (stage === 'third') {
    return `El tercer puesto es opcional para sumar puntos, pero se habilita cuando completes Semis. ${progressText}`;
  }

  if (stage === 'final') {
    return `Para completar la Final primero tenes que completar Semis. El tercer puesto es opcional y no bloquea la final. ${progressText}`;
  }

  return `Para completar ${currentLabel} primero tenes que completar ${requiredLabel}. ${progressText}`;
}

function stageRequiredLabel(stage) {
  if (stage === 'group') return 'la fase de grupos';
  return stageName(stage);
}

function stageJumpLabel(stage) {
  if (stage === 'group') return 'Completar grupos';
  return `Completar ${stageName(stage)}`;
}

function matchSearchHaystack(match, prediction = null) {
  const home = teamName(match, 'home');
  const away = teamName(match, 'away');
  const predictedHome = teamById(prediction?.predicted_home_team_id);
  const predictedAway = teamById(prediction?.predicted_away_team_id);
  const parts = [
    match.id,
    match.match_number,
    `partido ${match.match_number || match.id}`,
    `#${match.match_number || match.id}`,
    stageName(match.stage),
    groupLabel(match.group_name),
    apiDate(match.kickoff_at || match.api_local_date),
    shortMatchDate(match.kickoff_at || match.api_local_date),
    apiDate(match.prediction_closes_at),
    home,
    away,
    teamCode(match, 'home'),
    teamCode(match, 'away'),
    `${home} vs ${away}`,
    `${away} vs ${home}`,
    match.home_placeholder,
    match.away_placeholder,
    predictedHome?.name,
    predictedAway?.name,
    predictedHome?.code,
    predictedAway?.code,
    matchStatusLabel(match, prediction)
  ];

  return normalizeSearchText(parts.filter((part) => part !== null && part !== undefined && part !== '').join(' '));
}

function filterFixtureMatches(matches, predictions) {
  const query = normalizeSearchText(state.fixtureSearch);
  const status = state.fixtureStatusFilter || 'all';
  return matches.filter((match) => {
    const prediction = predictions.get(Number(match.id));
    const statusMatches = status === 'all' || matchStatusKey(match, prediction) === status;
    const queryMatches = !query || matchSearchHaystack(match, prediction).includes(query);
    return statusMatches && queryMatches;
  });
}

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (response.status === 401) logout(false);
    throw new Error(payload?.message || 'Request failed');
  }
  return payload;
}

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const prodePath = normalizedPath.startsWith('/api/')
    ? normalizedPath.slice('/api'.length)
    : normalizedPath;

  return `${API_BASE_URL}${prodePath}`;
}

async function init() {
  bindGlobalEvents();
  if (!state.token) {
    renderAuth();
    return;
  }
  try {
    const me = await api('/api/auth/me');
    state.me = me;
    await loadAppData();
    state.tutorialOpen = shouldShowTutorial();
    state.tutorialStep = 0;
    renderApp();
  } catch {
    logout(false);
    renderAuth();
  }
}

async function loadAppData() {
  const [teams, matches, predictions, ranking, notifications, profile] = await Promise.all([
    api('/api/teams'),
    api('/api/matches'),
    api('/api/predictions/me'),
    api('/api/ranking'),
    api('/api/notifications'),
    api('/api/profile')
  ]);
  state.teams = teams;
  state.matches = matches;
  state.predictions = predictions;
  state.ranking = ranking;
  state.notifications = notifications;
  state.profile = profile;
  state.adminNotifications = state.me?.user?.role === 'ADMIN'
    ? await api('/api/admin/notifications')
    : [];
}

function renderAuth(message = '') {
  root.innerHTML = `
    <section class="auth-layout">
      <div class="brand-block">
        <div class="brand-row">
          <img class="brand-mark" src="logo-koi.png?v=logo-koi-20260605" alt="Koi Prode" />
          <div>
            <h1 class="brand-title">Koi Prode</h1>
            <p class="brand-copy">Ranking interno Mundial 2026</p>
          </div>
        </div>
      </div>
      <div class="panel auth-panel">
        <div class="tabs">
          <button class="tab ${state.authMode === 'login' ? 'active' : ''}" data-auth="login">Entrar</button>
          <button class="tab ${state.authMode === 'register' ? 'active' : ''}" data-auth="register">Registro</button>
        </div>
        ${message ? `<div class="error">${html(message)}</div>` : ''}
        ${state.authMode === 'login' ? loginForm() : registerForm()}
      </div>
    </section>
  `;

  root.querySelectorAll('[data-auth]').forEach((button) => {
    button.addEventListener('click', () => {
      state.authMode = button.dataset.auth;
      renderAuth();
    });
  });

  const form = root.querySelector('form');
  form.addEventListener('submit', state.authMode === 'login' ? onLogin : onRegister);
}

function loginForm() {
  return `
    <form class="form">
      <label class="field">
        <span class="label">Email o usuario</span>
        <input class="input" name="identifier" autocomplete="username" required />
      </label>
      <label class="field">
        <span class="label">Contrasena</span>
        <input class="input" name="password" type="password" autocomplete="current-password" required />
      </label>
      <button class="primary" type="submit">Entrar</button>
      <p class="meta">Recuperar contrasena: contactar al administrador.</p>
    </form>
  `;
}

function registerForm() {
  return `
    <form class="form">
      <label class="field">
        <span class="label">Codigo</span>
        <input class="input" name="code" required />
      </label>
      <div class="two-col">
        <label class="field">
          <span class="label">Nombre</span>
          <input class="input" name="firstName" required />
        </label>
        <label class="field">
          <span class="label">Apellido</span>
          <input class="input" name="lastName" required />
        </label>
      </div>
      <label class="field">
        <span class="label">Email</span>
        <input class="input" name="email" type="email" autocomplete="email" required />
      </label>
      <label class="field">
        <span class="label">Usuario</span>
        <input class="input" name="username" autocomplete="username" required />
      </label>
      <label class="field">
        <span class="label">Contrasena</span>
        <input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required />
      </label>
      <div class="field">
        <span class="label">Areas</span>
        <div class="area-grid">
          ${areas.map((area) => `
            <label class="check-pill">
              <input type="checkbox" name="areas" value="${area}" />
              <span>${area}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <button class="primary" type="submit">Crear cuenta</button>
    </form>
  `;
}

async function onLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: form.get('identifier'),
        password: form.get('password')
      })
    });
    state.token = result.token;
    localStorage.setItem('koi_token', result.token);
    await init();
  } catch (error) {
    renderAuth(error.message);
  }
}

async function onRegister(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        code: form.get('code'),
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
        email: form.get('email'),
        username: form.get('username'),
        password: form.get('password'),
        areas: form.getAll('areas')
      })
    });
    state.token = result.token;
    localStorage.setItem('koi_token', result.token);
    await init();
  } catch (error) {
    renderAuth(error.message);
  }
}

function renderApp(message = '', isError = false) {
  const user = state.me.user;
  root.innerHTML = `
    <header class="app-header">
      <div class="topbar">
        <div class="brand-row">
          <img class="brand-mark" src="logo-koi.png?v=logo-koi-20260605" alt="Koi Prode" />
          <div>
            <h1 class="section-title">Koi Prode</h1>
            <div class="meta">${html(user.firstName)} ${html(user.lastName)}</div>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="secondary compact help-button" data-open-tutorial>Como funciona</button>
          <button class="secondary logout-button" data-action="logout">Salir</button>
        </div>
      </div>
      <nav class="nav">
        ${navButton('home', 'Inicio')}
        ${navButton('fixture', 'Fixture')}
        ${navButton('ranking', 'Ranking')}
        ${navButton('profile', 'Perfil')}
        ${user.role === 'ADMIN' ? navButton('admin', 'Admin') : ''}
      </nav>
    </header>
    <section class="grid">
      ${message ? `<div class="toast-message ${isError ? 'error' : 'ok'}" role="${isError ? 'alert' : 'status'}">${html(message)}</div>` : ''}
      ${renderBanners()}
      ${viewMarkup()}
    </section>
    ${renderTournamentLockModal()}
    ${renderFixtureImportPreviewModal()}
    ${renderTutorialModal()}
  `;

  root.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderApp();
    });
  });
  root.querySelectorAll('[data-open-tutorial]').forEach((button) => {
    button.addEventListener('click', () => openTutorial());
  });
  root.querySelectorAll('[data-close-tutorial]').forEach((button) => {
    button.addEventListener('click', () => closeTutorial());
  });
  root.querySelectorAll('[data-tutorial-step]').forEach((button) => {
    button.addEventListener('click', () => setTutorialStep(Number(button.dataset.tutorialStep)));
  });
  root.querySelectorAll('[data-tutorial-prev]').forEach((button) => {
    button.addEventListener('click', () => setTutorialStep(state.tutorialStep - 1));
  });
  root.querySelectorAll('[data-tutorial-next]').forEach((button) => {
    button.addEventListener('click', () => setTutorialStep(state.tutorialStep + 1));
  });
  root.querySelector('[data-action="logout"]').addEventListener('click', () => logout(true));
  bindViewEvents();
  syncCountdowns();
  focusPendingFixtureMatch();
}

function renderTemporaryAppMessage(message, isError = false, duration = 2400, onClose = null) {
  const token = ++appMessageToken;
  if (appMessageTimeoutId) {
    window.clearTimeout(appMessageTimeoutId);
  }
  renderApp(message, isError);
  appMessageTimeoutId = window.setTimeout(() => {
    if (token !== appMessageToken) return;
    if (onClose) onClose();
    renderApp();
  }, duration);
}

function navButton(view, label) {
  return `<button class="nav-button ${state.view === view ? 'active' : ''}" data-view="${view}">${label}</button>`;
}

function jumpToFixtureMatch(matchId) {
  const match = state.matches.find((item) => Number(item.id) === Number(matchId));
  if (!match) return;

  state.view = 'fixture';
  state.stage = match.stage;
  state.fixtureSearch = '';
  state.fixtureStatusFilter = 'all';
  state.fixtureFocusMatchId = Number(match.id);
  renderApp();
}

function jumpToFixtureStage(stage) {
  if (!stage) return;
  const predictedIds = new Set(state.predictions.matches.map((prediction) => Number(prediction.match_id)));
  const firstPendingMatch = state.matches.find((match) => match.stage === stage && !predictedIds.has(Number(match.id)));

  state.view = 'fixture';
  state.stage = stage;
  state.fixtureSearch = '';
  state.fixtureStatusFilter = 'all';
  state.fixtureFocusMatchId = firstPendingMatch ? Number(firstPendingMatch.id) : null;
  renderApp();
}

function focusPendingFixtureMatch() {
  if (state.view !== 'fixture' || !state.fixtureFocusMatchId) return;

  const matchId = Number(state.fixtureFocusMatchId);
  window.requestAnimationFrame(() => {
    const target = root.querySelector(`[data-fixture-match-id="${matchId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    window.setTimeout(() => {
      if (Number(state.fixtureFocusMatchId) === matchId) {
        state.fixtureFocusMatchId = null;
      }
      target.classList.remove('fixture-focus-target');
    }, 2400);
  });
}

function syncCountdowns() {
  if (countdownIntervalId) {
    window.clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
  updateCountdowns();
  if (root.querySelector('[data-countdown-target]')) {
    countdownIntervalId = window.setInterval(updateCountdowns, 1000);
  }
}

function updateCountdowns() {
  root.querySelectorAll('[data-countdown-target]').forEach((item) => {
    const targetTime = Number(item.dataset.countdownTarget);
    const value = item.querySelector('[data-countdown-value]');
    if (value) value.textContent = countdownText(targetTime);
    item.classList.toggle('closed', Number.isFinite(targetTime) && targetTime <= Date.now());
  });
}

function bindGlobalEvents() {
  if (globalEventsBound) return;
  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const winnerButton = target.closest('[data-winner]');
    if (winnerButton && root.contains(winnerButton)) {
      selectKnockoutWinner(winnerButton);
    }
  });
  globalEventsBound = true;
}

function renderBanners() {
  return state.notifications.map((item) => `
    <div class="banner">
      <strong>${html(item.title)}</strong>
      <span>${html(item.body)}</span>
    </div>
  `).join('');
}

function viewMarkup() {
  if (state.view === 'fixture') return renderFixture();
  if (state.view === 'ranking') return renderRanking();
  if (state.view === 'profile') return renderProfile();
  if (state.view === 'admin') return renderAdmin();
  return renderHome();
}

function renderHome() {
  const score = state.profile?.score || {};
  const predictions = new Map(state.predictions.matches.map((prediction) => [Number(prediction.match_id), prediction]));
  const upcomingMatches = state.matches
    .filter((match) => !Number(match.finished))
    .sort((a, b) => matchTime(a) - matchTime(b));
  const openUpcomingMatches = upcomingMatches.filter((match) => !isClosed(match));
  const pendingOpenMatches = openUpcomingMatches.filter((match) => !predictions.has(Number(match.id)));
  const nextPhaseClose = nextPhaseCloseTarget();
  const nextMatch = pendingOpenMatches[0] ?? openUpcomingMatches[0] ?? upcomingMatches[0] ?? null;
  const nextMatchIsPending = nextMatch ? !predictions.has(Number(nextMatch.id)) && !isClosed(nextMatch) : false;
  const nextMatches = upcomingMatches.slice(0, 3);
  const prodeComplete = state.matches.length > 0 && state.matches.every((match) => predictions.has(Number(match.id)));
  return `
    <section class="grid desktop-two">
      <div class="section">
        <h2 class="section-title">Resumen</h2>
        ${predictionCountdown(nextPhaseClose, nextPhaseClose?.targetTime ?? null)}
        <div class="metric-grid">
          ${metric(score.total_points || 0, 'Puntos')}
          ${metric(score.exact_count || 0, 'Exactos')}
          ${metric(score.outcome_count || 0, 'Aciertos')}
          ${metric(score.max_streak || 0, 'Racha max')}
        </div>
        ${prodeComplete ? renderProdeCompletePanel() : `
          <div class="panel auth-panel section">
            <div class="section-head quick-match-head">
              <div>
                <h2 class="section-title">${nextMatchIsPending ? 'Siguiente pendiente' : 'Proximo partido'}</h2>
                <div class="meta">${nextMatch ? shortMatchDate(nextMatch.kickoff_at || nextMatch.api_local_date) : 'Sin fixture cargado'}</div>
              </div>
              <button class="secondary compact quick-fixture-cta" data-jump-view="fixture">Ver fixture</button>
            </div>
            ${nextMatch ? quickMatchPrediction(nextMatch, predictions.get(Number(nextMatch.id))) : '<div class="meta">Todavia no hay partidos disponibles.</div>'}
          </div>
        `}
      </div>
      <div class="section">
        <h2 class="section-title">Proximos partidos</h2>
        <div class="match-list">
          ${nextMatches.map((match, index) => matchSummary(match, predictions.get(Number(match.id)), index)).join('') || '<div class="meta">Sin partidos cargados.</div>'}
        </div>
        <button class="secondary upcoming-fixture-action" data-jump-view="fixture">Ver fixture</button>
      </div>
    </section>
  `;
}

function renderProdeCompletePanel() {
  return `
    <div class="panel auth-panel section prode-complete-panel">
      <span class="prode-complete-badge">Prode completo</span>
      <h2 class="section-title">Ya completaste todo el prode</h2>
      <p>Mira el fixture para revisar como quedaron tus selecciones por si queres cambiar algo antes de que cierre cada fecha.</p>
      <p>Recorda revisar todos los dias el ranking para ver como se mueve la tabla cuando se carguen los resultados reales.</p>
      <div class="prode-complete-actions">
        <button class="secondary quick-fixture-cta" type="button" data-stage-jump="qf">Ver fixture</button>
        <button class="primary" type="button" data-jump-view="ranking">Ver ranking</button>
      </div>
      <p class="prode-complete-contact">Gracias por participar. Ante cualquier duda, consulta o bug, comunicarse con nicolas.melluso@koiventures.tech</p>
    </div>
  `;
}

function predictionCountdown(match, targetTime) {
  if (!match || !targetTime) {
    return `
      <div class="countdown-card">
        <div>
          <span>Predicciones</span>
          <strong>Sin cierres activos</strong>
        </div>
        <b>--</b>
      </div>
    `;
  }

  return `
    <div class="countdown-card" data-countdown-target="${html(targetTime)}">
      <div>
        <span>${html(countdownLabel(match))}</span>
        <strong>${html(apiDate(match.prediction_closes_at))}</strong>
      </div>
      <b data-countdown-value>${html(countdownText(targetTime))}</b>
    </div>
  `;
}

function metric(value, label) {
  return `
    <div class="metric">
      <div class="metric-value">${html(value)}</div>
      <div class="metric-label">${html(label)}</div>
    </div>
  `;
}

function pointBurstFor(matchId, context = 'match') {
  const showMatchBurst = Number(state.pointBurstMatchId) === Number(matchId);
  const showQuickBurst = context === 'quick' && state.quickPointBurst;
  return showMatchBurst || showQuickBurst ? '<div class="point-burst">+1 pts</div>' : '';
}

function saveAction(matchId, buttonClass, disabled, label, context = 'match', lockedReason = '') {
  const tooltipAttrs = lockedReason
    ? ` tabindex="0" data-tooltip="${html(lockedReason)}" aria-label="${html(`${label}: ${lockedReason}`)}"`
    : '';
  return `
    <div class="save-action ${lockedReason ? 'locked' : ''}"${tooltipAttrs}>
      ${pointBurstFor(matchId, context)}
      <button class="${buttonClass}" type="submit" ${disabled ? 'disabled' : ''}>${html(label)}</button>
    </div>
  `;
}

function stageLockNotice(stage, gate = stageGate(stage)) {
  if (!gate.blocked || !gate.requiredStage) return '';

  const progress = gate.progress;
  const progressText = progress && progress.total > 0
    ? `Te faltan ${progress.missing} de ${progress.total} predicciones.`
    : `Todavia no hay partidos cargados de ${stageRequiredLabel(gate.requiredStage)}.`;

  return `
    <div class="stage-lock-note" role="note">
      <div>
        <strong>Fase bloqueada</strong>
        <span>Para desbloquear ${html(stageName(stage))}, completá primero ${html(stageRequiredLabel(gate.requiredStage))}. ${html(progressText)}</span>
      </div>
      <button class="secondary compact" type="button" data-stage-jump="${html(gate.requiredStage)}">${html(stageJumpLabel(gate.requiredStage))}</button>
    </div>
  `;
}

function stageAutoUnlockNotice(stage, gate = stageGate(stage)) {
  if (!gate.autoUnlock || !gate.requiredStage) return '';

  return `
    <div class="stage-lock-note auto-unlock" role="note">
      <div>
        <strong>Desbloqueo automatico</strong>
        <span>${html(gate.reason)}</span>
      </div>
    </div>
  `;
}

function quickMatchPrediction(match, prediction) {
  const closed = isClosed(match);
  const finished = Number(match.finished) === 1;
  const gate = stageGate(match.stage);
  const lockedReason = gate.blocked && !closed && !finished ? gate.reason : '';
  const disabled = closed || finished || gate.blocked;
  const predictedHomeTeam = match.stage !== 'group' ? teamForPredictionSlot(match, prediction, 'home') : null;
  const predictedAwayTeam = match.stage !== 'group' ? teamForPredictionSlot(match, prediction, 'away') : null;
  return `
    <form class="quick-match-card" data-form="match" data-match-id="${match.id}" data-stage="${html(match.stage)}">
      <div class="quick-match-context">
        <div class="quick-match-stage-block">
          <span class="quick-stage-label">Estas prediciendo</span>
          <strong>${html(stageName(match.stage))}</strong>
          <small>${html(quickMatchOrigin(match))}</small>
        </div>
        ${statusPill(match, prediction)}
      </div>
      ${quickTeamScore(match, 'home', prediction?.predicted_home_score, disabled, predictedHomeTeam)}
      <div class="versus">vs</div>
      ${quickTeamScore(match, 'away', prediction?.predicted_away_score, disabled, predictedAwayTeam)}
      ${saveAction(match.id, 'primary', disabled, 'Guardar prediccion', 'quick', lockedReason)}
      ${gate.blocked && !closed && !finished ? stageLockNotice(match.stage, gate) : ''}
      ${gate.autoUnlock && !closed && !finished ? stageAutoUnlockNotice(match.stage, gate) : ''}
      <div class="meta">Completar este partido suma +1 punto. Cierre: ${html(apiDate(match.prediction_closes_at))}</div>
    </form>
  `;
}

function quickMatchOrigin(match) {
  const number = `Partido #${match.match_number || match.id}`;

  if (match.stage === 'group') {
    return `${number} - ${groupLabel(match.group_name)}`;
  }

  const sources = [match.home_placeholder, match.away_placeholder]
    .filter(Boolean)
    .map((value) => translateMatchPlaceholder(value));
  const sourceText = sources.length > 0
    ? `Cruce proyectado desde tu llave: ${sources.join(' vs ')}`
    : 'Cruce de eliminatorias';
  return `${number} - ${sourceText}`;
}

function quickTeamScore(match, side, value, disabled, selectedTeam = null) {
  const isHome = side === 'home';
  const flag = selectedTeam?.flag_url ?? (isHome ? match.home_flag_url : match.away_flag_url);
  const code = selectedTeam?.code ?? (isHome ? match.home_team_code : match.away_team_code);
  const name = selectedTeam?.name ?? teamName(match, side);
  const inputName = isHome ? 'homeScore' : 'awayScore';
  return `
    <label class="team-score-row" data-team-score-side="${side}">
      <span class="team-identity">
        ${flag ? `<img class="team-flag" src="${html(flag)}" alt="${html(name)}" />` : '<span class="team-flag fallback-flag"></span>'}
        <span>
          <strong>${html(name)}</strong>
          <small>${html(code || '')}</small>
        </span>
      </span>
      <input class="input score-input team-score-input" name="${inputName}" type="number" min="0" max="30" value="${html(scoreValue(value))}" ${disabled ? 'disabled' : ''} required />
    </label>
  `;
}

function matchSummary(match, prediction = null, index = 0) {
  return `
    <article class="match-card upcoming-card ${index >= 3 ? 'mobile-extra' : ''}" role="button" tabindex="0" data-upcoming-match-id="${html(match.id)}" aria-label="Ir al fixture para ${html(teamName(match, 'home'))} vs ${html(teamName(match, 'away'))}">
      <div class="upcoming-head">
        <div class="match-number">${html(match.match_number || match.id)}</div>
        <div class="upcoming-main">
          <div class="upcoming-date">${html(shortMatchDate(match.kickoff_at || match.api_local_date))}</div>
          <div class="upcoming-teams">
            ${upcomingTeam(match, 'home')}
            <span class="upcoming-versus">vs</span>
            ${upcomingTeam(match, 'away')}
          </div>
        </div>
        ${statusPill(match, prediction)}
      </div>
      <div class="upcoming-footer">
        <span>${html(apiDate(match.kickoff_at || match.api_local_date))}</span>
        <span>Cierre ${html(apiDate(match.prediction_closes_at))}</span>
      </div>
    </article>
  `;
}

function upcomingTeam(match, side) {
  const name = teamName(match, side);
  const flag = teamFlag(match, side);
  const code = teamCode(match, side);
  return `
    <div class="upcoming-team">
      ${flag ? `<img class="upcoming-flag" src="${html(flag)}" alt="${html(name)}" />` : '<span class="upcoming-flag fallback-flag"></span>'}
      <div>
        <strong>${html(name)}</strong>
        <small>${html(code || '')}</small>
      </div>
    </div>
  `;
}

function renderTournament(context = 'home') {
  const prediction = state.predictions.tournament;
  const isFinalContext = context === 'final';
  if (prediction) {
    const champion = teamById(prediction.champion_team_id);
    const finalist1 = teamById(prediction.finalist1_team_id);
    const finalist2 = teamById(prediction.finalist2_team_id);
    const runnerUp = predictedRunnerUp(champion, finalist1, finalist2);
    return `
      <div class="panel auth-panel section tournament-locked">
        <div class="section-head">
          <h2 class="section-title">Campeon y subcampeon</h2>
          ${tournamentLockedPill()}
        </div>
        <div class="locked-tournament-grid">
          ${lockedTournamentTeam(champion, 'Campeon elegido', 'champion')}
          <div class="locked-finalists">
            ${lockedTournamentTeam(runnerUp, 'Subcampeon elegido', 'finalist')}
            <div class="lock-note compact-note">Final elegida: ${html(champion?.name ?? 'TBD')} vs ${html(runnerUp?.name ?? 'TBD')}</div>
          </div>
        </div>
        <div class="lock-note">
          <strong>${html(lockTierLabel(prediction.lock_tier))}</strong>
          <span>Tu prediccion de torneo quedo bloqueada y ya no se puede editar.</span>
        </div>
      </div>
    `;
  }

  const draft = state.tournamentDraft || {};
  const runnerUpDraftId = draft.finalist2TeamId || '';
  const currentRow = tournamentLockRow();
  const isClosedForTournament = currentRow.tier === 'closed';
  return `
    <div class="panel auth-panel section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Bloquear campeon y subcampeon</h2>
          <div class="meta">${isClosedForTournament ? 'El bloqueo de torneo ya esta cerrado.' : `Bloqueo actual: ${html(currentRow.champion)} pts campeon, ${html(currentRow.finalist)} pts por finalista correcto.`}</div>
        </div>
      </div>
      <form class="form" data-form="tournament">
        <div class="field">
          <span class="label">Campeon</span>
          ${teamPicker('championTeamId', draft.championTeamId, { placeholder: 'Seleccionar campeon' })}
        </div>
        <div class="field">
          <span class="label">Subcampeon</span>
          ${teamPicker('finalist2TeamId', runnerUpDraftId, { placeholder: 'Seleccionar subcampeon' })}
        </div>
        <button class="primary" type="submit" ${isClosedForTournament ? 'disabled' : ''}>Bloquear</button>
      </form>
    </div>
  `;
}

function predictedRunnerUp(champion, finalist1, finalist2) {
  if (!champion) return finalist1 ?? finalist2 ?? null;
  return Number(finalist1?.id) === Number(champion.id) ? finalist2 : finalist1;
}

function tournamentFinalSelection() {
  const prediction = state.predictions.tournament;
  if (prediction) {
    const champion = teamById(prediction.champion_team_id);
    const finalist1 = teamById(prediction.finalist1_team_id);
    const finalist2 = teamById(prediction.finalist2_team_id);
    return {
      locked: true,
      lockTier: prediction.lock_tier,
      champion,
      finalist1,
      finalist2,
      runnerUp: predictedRunnerUp(champion, finalist1, finalist2)
    };
  }

  const draft = state.tournamentDraft || {};
  const champion = teamById(draft.championTeamId);
  const finalist1 = champion;
  const finalist2 = teamById(draft.finalist2TeamId);
  if (!champion && !finalist2) return null;

  return {
    locked: false,
    lockTier: null,
    champion,
    finalist1,
    finalist2,
    runnerUp: predictedRunnerUp(champion, finalist1, finalist2)
  };
}

function finalTournamentTeamForSide(side) {
  const selection = tournamentFinalSelection();
  if (!selection?.champion || !selection?.runnerUp) return null;
  return side === 'home' ? selection.champion : selection.runnerUp;
}

function tournamentLockedTeamForSlot(match, side) {
  const selection = tournamentFinalSelection();
  if (!selection?.locked || !match || match.stage === 'group' || match.stage === 'final') return null;

  const lockedTeams = [selection.champion, selection.runnerUp].filter(Boolean);
  return lockedTeams.find((team) => tournamentTeamOwnsSlot(team, match, side)) ?? null;
}

function tournamentTeamOwnsSlot(team, targetMatch, targetSide) {
  const group = teamGroupCode(team);
  if (!group || !targetMatch || !targetSide) return false;

  let source = `Winner Group ${group}`;
  const visited = new Set();

  while (source) {
    const current = state.matches.find((match) => (
      match.stage !== 'group' &&
      (
        match.home_placeholder === source ||
        match.away_placeholder === source
      )
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

function teamGroupCode(team) {
  const value = String(team?.group_name || '').trim();
  const match = value.match(/([A-Z])$/i);
  return match ? match[1].toUpperCase() : '';
}

function finalSideForGroupWinner(groupCode) {
  if (!groupCode) return null;
  let current = state.matches.find((match) => (
    match.stage !== 'group' &&
    (
      match.home_placeholder === `Winner Group ${groupCode}` ||
      match.away_placeholder === `Winner Group ${groupCode}`
    )
  ));
  const visited = new Set();

  while (current?.match_number && !visited.has(Number(current.match_number))) {
    visited.add(Number(current.match_number));
    const source = `Winner Match ${current.match_number}`;
    const next = state.matches.find((match) => (
      match.home_placeholder === source ||
      match.away_placeholder === source
    ));
    if (!next) return null;
    if (next.stage === 'final') {
      return next.home_placeholder === source ? 'home' : 'away';
    }
    current = next;
  }

  return null;
}

function tournamentFinalistIssue(championTeamId, runnerUpTeamId) {
  const champion = teamById(championTeamId);
  const runnerUp = teamById(runnerUpTeamId);
  if (!champion || !runnerUp) return '';
  if (Number(champion.id) === Number(runnerUp.id)) {
    return 'Campeon y subcampeon deben ser paises distintos.';
  }

  const championGroup = teamGroupCode(champion);
  const runnerUpGroup = teamGroupCode(runnerUp);
  if (championGroup && runnerUpGroup && championGroup === runnerUpGroup) {
    return 'Campeon y subcampeon no pueden salir del mismo grupo en este modelo de llave.';
  }

  const championSide = finalSideForGroupWinner(championGroup);
  const runnerUpSide = finalSideForGroupWinner(runnerUpGroup);
  if (championSide && runnerUpSide && championSide === runnerUpSide) {
    return 'Campeon y subcampeon quedan del mismo lado de la llave y no pueden llegar juntos a la final.';
  }

  return '';
}

function teamForPredictionSlot(match, prediction, side) {
  if (!match) return null;
  if (match.stage === 'group') {
    return teamById(side === 'home' ? match.home_team_id : match.away_team_id);
  }
  if (match.stage === 'final') {
    const tournamentTeam = finalTournamentTeamForSide(side);
    if (tournamentTeam) return tournamentTeam;
  }
  const lockedTournamentTeam = tournamentLockedTeamForSlot(match, side);
  if (lockedTournamentTeam) return lockedTournamentTeam;
  return predictedTeamForSlot(match, prediction, side);
}

function tournamentLockedTeamIssue(match, homeTeam, awayTeam, homeScore, awayScore) {
  const tournament = state.predictions.tournament;
  if (!tournament || !match || !homeTeam || !awayTeam) return '';

  const championTeamId = Number(tournament.champion_team_id);
  const runnerUpTeamId = Number(tournament.champion_team_id) === Number(tournament.finalist1_team_id)
    ? Number(tournament.finalist2_team_id)
    : Number(tournament.finalist1_team_id);
  const homeTeamId = Number(homeTeam.id);
  const awayTeamId = Number(awayTeam.id);
  const hasChampion = homeTeamId === championTeamId || awayTeamId === championTeamId;
  const hasRunnerUp = homeTeamId === runnerUpTeamId || awayTeamId === runnerUpTeamId;
  const winnerTeamId = homeScore === awayScore ? null : homeScore > awayScore ? homeTeamId : awayTeamId;

  if (hasChampion && winnerTeamId !== championTeamId) {
    return 'El campeon elegido previamente no puede perder ni empatar en esta instancia. Solo podes elegir por cuanto gana.';
  }
  if (hasRunnerUp && match.stage !== 'final' && winnerTeamId !== runnerUpTeamId) {
    return 'El subcampeon elegido previamente no puede perder ni empatar antes de la final. Solo podes elegir por cuanto gana.';
  }
  if (hasChampion && hasRunnerUp && match.stage === 'final' && winnerTeamId !== championTeamId) {
    return 'En la final, tu campeon elegido tiene que ganarle a tu subcampeon.';
  }

  return '';
}

function tutorialSeenKey() {
  const userId = state.me?.user?.id || 'anon';
  return `koi_tutorial_seen_v1_${userId}`;
}

function shouldShowTutorial() {
  return localStorage.getItem(tutorialSeenKey()) !== '1';
}

function markTutorialSeen() {
  localStorage.setItem(tutorialSeenKey(), '1');
}

function openTutorial(step = 0) {
  state.tutorialOpen = true;
  state.tutorialStep = Math.max(0, Math.min(tutorialSteps.length - 1, Number(step) || 0));
  renderApp();
}

function closeTutorial() {
  state.tutorialOpen = false;
  markTutorialSeen();
  renderApp();
}

function setTutorialStep(step) {
  state.tutorialStep = Math.max(0, Math.min(tutorialSteps.length - 1, Number(step) || 0));
  renderApp();
}

function renderTutorialModal() {
  if (!state.tutorialOpen) return '';

  const stepIndex = Math.max(0, Math.min(tutorialSteps.length - 1, Number(state.tutorialStep) || 0));
  const step = tutorialSteps[stepIndex];
  const flow = step.flow || tutorialSteps[0].flow || [];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === tutorialSteps.length - 1;

  return `
    <div class="modal-backdrop tutorial-backdrop" role="presentation">
      <section class="confirm-modal tutorial-modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
        <div class="confirm-modal-head">
          <div>
            <span class="modal-eyebrow">${html(step.eyebrow)}</span>
            <h2 id="tutorial-title">${html(step.title)}</h2>
          </div>
          <button class="icon-button" type="button" data-close-tutorial aria-label="Cerrar">x</button>
        </div>
        <div class="tutorial-progress" aria-label="Progreso del tutorial">
          ${tutorialSteps.map((item, index) => `
            <button class="${index === stepIndex ? 'active' : ''}" type="button" data-tutorial-step="${html(index)}" aria-label="Ir a ${html(item.eyebrow)}">
              <span>${html(index + 1)}</span>
            </button>
          `).join('')}
        </div>
        <div class="tutorial-card">
          <p>${html(step.body)}</p>
          <ul>
            ${step.bullets.map((item) => `<li>${html(item)}</li>`).join('')}
          </ul>
        </div>
        ${flow.length > 0 ? `
          <div class="tutorial-flow count-${html(flow.length)}" aria-hidden="true">
            ${flow.map(([number, title, text]) => tutorialFlowCard(number, title, text)).join('')}
          </div>
        ` : ''}
        <div class="modal-actions tutorial-actions">
          <button class="secondary" type="button" data-tutorial-prev ${isFirst ? 'disabled' : ''}>Anterior</button>
          ${isLast
            ? '<button class="primary" type="button" data-close-tutorial>Entendido</button>'
            : '<button class="primary" type="button" data-tutorial-next>Siguiente</button>'}
        </div>
      </section>
    </div>
  `;
}

function tutorialFlowCard(number, title, text) {
  return `
    <div class="tutorial-flow-card">
      <b>${html(number)}</b>
      <strong>${html(title)}</strong>
      <span>${html(text)}</span>
    </div>
  `;
}

function renderTournamentLockModal() {
  const pending = state.pendingTournamentLock;
  if (!pending) return '';

  const champion = teamById(pending.championTeamId);
  const finalist1 = teamById(pending.finalist1TeamId);
  const finalist2 = teamById(pending.finalist2TeamId);
  const runnerUp = predictedRunnerUp(champion, finalist1, finalist2);
  const currentTier = currentTournamentLockTier();
  const currentRow = tournamentLockRow(currentTier);
  const isClosedForTournament = currentTier === 'closed';

  return `
    <div class="modal-backdrop" role="presentation">
      <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="tournament-lock-title">
        <div class="confirm-modal-head">
          <div>
            <span class="modal-eyebrow">Bloqueo definitivo</span>
            <h2 id="tournament-lock-title">Confirmar campeon y subcampeon</h2>
          </div>
          <button class="icon-button" type="button" data-cancel-tournament-lock aria-label="Cerrar">x</button>
        </div>
        <div class="lock-warning">
          Una vez bloqueada, esta prediccion de torneo no se puede cambiar. Revisala antes de confirmar.
        </div>
        <div class="lock-confirm-teams">
          ${lockedTournamentTeam(champion, 'Campeon', 'champion')}
          ${lockedTournamentTeam(runnerUp, 'Subcampeon', 'finalist')}
        </div>
        <div class="points-table-wrap">
          <table class="points-table">
            <thead>
              <tr>
                <th>Momento de bloqueo</th>
                <th>Campeon correcto</th>
                <th>Cada finalista correcto</th>
              </tr>
            </thead>
            <tbody>
              ${tournamentLockRows.map((row) => `
                <tr class="${row.tier === currentTier ? 'active' : ''}">
                  <td>${html(row.window)}${row.tier === currentTier ? ' - ahora' : ''}</td>
                  <td>${row.champion ? `${html(row.champion)} pts` : 'No permite'}</td>
                  <td>${row.finalist ? `${html(row.finalist)} pts` : 'No permite'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="lock-modal-note">
          ${isClosedForTournament
            ? 'El bloqueo de campeon y finalistas ya esta cerrado.'
            : `Si confirmas ahora, jugas por ${html(currentRow.champion)} pts de campeon y ${html(currentRow.finalist)} pts por cada finalista correcto.`}
        </div>
        <div class="modal-actions">
          <button class="secondary" type="button" data-cancel-tournament-lock>Revisar</button>
          <button class="primary" type="button" data-confirm-tournament-lock ${isClosedForTournament ? 'disabled' : ''}>Confirmar bloqueo</button>
        </div>
      </section>
    </div>
  `;
}

function renderFixtureImportPreviewModal() {
  if (!state.adminImportLoading && !state.adminImportPreview) return '';

  if (state.adminImportLoading) {
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="confirm-modal import-preview-modal" role="dialog" aria-modal="true" aria-labelledby="fixture-import-title">
          <div class="confirm-modal-head">
            <div>
              <span class="modal-eyebrow">Importacion segura</span>
              <h2 id="fixture-import-title">Consultando API del fixture</h2>
            </div>
            <button class="icon-button" type="button" data-cancel-fixture-import aria-label="Cerrar">x</button>
          </div>
          <div class="lock-warning">Todavia no se importo nada. Estoy comparando worldcup26.ir contra lo que tiene la app.</div>
        </section>
      </div>
    `;
  }

  const preview = state.adminImportPreview;
  const summary = preview.summary || {};
  const hasChanges = ['newTeams', 'changedTeams', 'newMatches', 'changedMatches', 'resultUpdates'].some((key) => Number(summary[key] || 0) > 0);
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="confirm-modal import-preview-modal" role="dialog" aria-modal="true" aria-labelledby="fixture-import-title">
        <div class="confirm-modal-head">
          <div>
            <span class="modal-eyebrow">Revision antes de importar</span>
            <h2 id="fixture-import-title">API vs app actual</h2>
          </div>
          <button class="icon-button" type="button" data-cancel-fixture-import aria-label="Cerrar">x</button>
        </div>
        <div class="ranking-public-note">
          Nada de esto se aplico todavia. Si confirmas, se importan equipos/partidos y resultados nuevos que la app no tenga finalizados.
        </div>
        <div class="import-preview-stats">
          ${importPreviewStat(preview.api?.teams, 'Equipos API')}
          ${importPreviewStat(preview.local?.teams, 'Equipos app')}
          ${importPreviewStat(preview.api?.matches, 'Partidos API')}
          ${importPreviewStat(preview.local?.matches, 'Partidos app')}
          ${importPreviewStat(preview.api?.finishedMatches, 'Finalizados API')}
          ${importPreviewStat(preview.local?.finishedMatches, 'Finalizados app')}
        </div>
        <div class="import-preview-stats compact">
          ${importPreviewStat(summary.newTeams, 'Equipos nuevos')}
          ${importPreviewStat(summary.changedTeams, 'Equipos con cambios')}
          ${importPreviewStat(summary.newMatches, 'Partidos nuevos')}
          ${importPreviewStat(summary.changedMatches, 'Partidos con cambios')}
          ${importPreviewStat(summary.resultUpdates, 'Resultados nuevos')}
          ${importPreviewStat(summary.protectedResults, 'Resultados protegidos')}
        </div>
        ${Number(summary.protectedResults || 0) > 0 ? `
          <div class="lock-warning">
            Hay resultados protegidos: la API difiere de partidos que la app ya tiene finalizados. No se pisan automaticamente.
          </div>
        ` : ''}
        <div class="import-preview-sections">
          ${importPreviewList('Resultados que entrarian', preview.matches?.resultUpdates || [], 'No hay resultados nuevos desde la API.')}
          ${importPreviewList('Resultados protegidos', preview.matches?.protectedResults || [], 'No hay conflictos con resultados ya finalizados.')}
          ${importPreviewList('Partidos nuevos', preview.matches?.new || [], 'No hay partidos nuevos.')}
          ${importPreviewList('Partidos con cambios', preview.matches?.changed || [], 'No hay cambios de fixture.')}
          ${importPreviewList('Equipos nuevos', preview.teams?.new || [], 'No hay equipos nuevos.')}
          ${importPreviewList('Equipos con cambios', preview.teams?.changed || [], 'No hay equipos con cambios.')}
        </div>
        <div class="modal-actions">
          <button class="secondary" type="button" data-cancel-fixture-import>Cancelar</button>
          <button class="primary" type="button" data-confirm-fixture-import ${hasChanges ? '' : 'disabled'}>Confirmar importacion</button>
        </div>
      </section>
    </div>
  `;
}

function importPreviewStat(value, label) {
  return `
    <div class="import-preview-stat">
      <strong>${html(value || 0)}</strong>
      <span>${html(label)}</span>
    </div>
  `;
}

function importPreviewList(title, items, emptyText) {
  return `
    <section class="import-preview-list">
      <div class="import-preview-list-head">
        <strong>${html(title)}</strong>
        <span>${html(items.length)} visibles</span>
      </div>
      <div class="import-preview-items">
        ${items.slice(0, 8).map(importPreviewItem).join('') || `<div class="meta">${html(emptyText)}</div>`}
      </div>
    </section>
  `;
}

function importPreviewItem(item) {
  const isTeam = !('matchNumber' in item);
  if (isTeam) {
    return `
      <div class="import-preview-item">
        <strong>${html(item.name || item.externalId)}</strong>
        <span>${html(item.code || '')}${item.group ? ` - Grupo ${html(item.group)}` : ''}</span>
        ${item.fields?.length ? `<small>Cambia: ${html(item.fields.join(', '))}</small>` : ''}
      </div>
    `;
  }

  return `
    <div class="import-preview-item">
      <strong>#${html(item.matchNumber || item.externalId)} ${html(item.homeName || item.homePlaceholder || 'TBD')} vs ${html(item.awayName || item.awayPlaceholder || 'TBD')}</strong>
      <span>${html(stageName(item.stage))}${item.group ? ` - Grupo ${html(item.group)}` : ''} - ${html(item.apiLocalDate || item.kickoff || 'Sin fecha')}</span>
      ${item.finished ? `<small>Resultado API: ${html(item.homeScore)}-${html(item.awayScore)}</small>` : ''}
      ${item.previous ? `<small>App actual: ${html(item.previous.homeScore ?? '-')} - ${html(item.previous.awayScore ?? '-')}</small>` : ''}
      ${item.fields?.length ? `<small>Cambia: ${html(item.fields.join(', '))}</small>` : ''}
    </div>
  `;
}

function lockedTournamentTeam(team, label, variant) {
  const name = team?.name ?? 'TBD';
  const code = team?.code ?? '';
  const flag = team?.flag_url ?? '';
  return `
    <article class="locked-team-card ${variant}">
      <div class="locked-team-role">${html(label)}</div>
      <div class="locked-team-main">
        ${flag ? `<img class="locked-team-flag" src="${html(flag)}" alt="${html(name)}" />` : '<span class="locked-team-flag fallback-flag"></span>'}
        <div>
          <strong>${html(name)}</strong>
          <small>${html(code)}</small>
        </div>
      </div>
    </article>
  `;
}

function lockTierLabel(tier) {
  const labels = {
    early: 'Bloqueo temprano',
    before_r32: 'Bloqueo antes de dieciseisavos',
    before_qf: 'Bloqueo antes de cuartos'
  };
  return labels[tier] ?? `Bloqueo ${tier || 'registrado'}`;
}

function teamPicker(name, value = '', config = {}) {
  const selectedTeam = teamById(value);
  const placeholder = config.placeholder || 'Seleccionar pais';
  const disabled = Boolean(config.disabled);
  const teams = config.teams || state.teams;
  return `
    <div class="team-picker" data-team-picker data-team-field="${name}">
      <input type="hidden" name="${name}" value="${html(value || '')}" />
      <button class="team-picker-trigger" type="button" data-team-picker-toggle ${disabled ? 'disabled' : ''}>
        ${selectedTeam ? teamPickerSelectedMarkup(selectedTeam) : `<span class="team-picker-placeholder">${html(placeholder)}</span>`}
      </button>
      ${teamPickerMenu(teams)}
    </div>
  `;
}

function teamPickerSelectedMarkup(team) {
  return `
    <span class="team-picker-selected">
      ${team.flag_url ? `<img class="team-picker-flag" src="${html(team.flag_url)}" alt="${html(team.name)}" />` : '<span class="team-picker-flag fallback-flag"></span>'}
      <span>
        <strong>${html(team.name)}</strong>
        <small>${html(team.code || '')}</small>
      </span>
    </span>
  `;
}

function teamPickerOption(team) {
  const searchText = normalizeSearchText(`${team.name || ''} ${team.code || ''}`);
  return `
    <button class="team-picker-option" type="button" data-team-option data-team-id="${html(team.id)}" data-team-search-text="${html(searchText)}">
      ${team.flag_url ? `<img class="team-picker-flag" src="${html(team.flag_url)}" alt="${html(team.name)}" />` : '<span class="team-picker-flag fallback-flag"></span>'}
      <span>
        <strong>${html(team.name)}</strong>
        <small>${html(team.code || '')}</small>
      </span>
    </button>
  `;
}

function teamPickerMenu(teams, emptyLabel = 'No hay paises con esa busqueda.') {
  const options = sortedTeamOptions(teams);
  return `
    <div class="team-picker-menu" hidden>
      <label class="team-picker-search">
        <span>Buscar pais</span>
        <input type="search" data-team-search placeholder="Argentina, ARG..." autocomplete="off" />
      </label>
      <div class="team-picker-options">
        ${options.map((team) => teamPickerOption(team)).join('')}
      </div>
      <div class="team-picker-empty" data-team-picker-empty ${options.length > 0 ? 'hidden' : ''}>${html(options.length > 0 ? emptyLabel : 'Todavia no hay equipos habilitados para este cruce.')}</div>
    </div>
  `;
}

function renderFixture() {
  const predictions = new Map(state.predictions.matches.map((prediction) => [Number(prediction.match_id), prediction]));
  const isTournamentStage = state.stage === 'tournament';
  const stageMatches = isTournamentStage ? [] : state.matches.filter((match) => match.stage === state.stage);
  const showFixtureFilters = !isTournamentStage && state.stage !== 'final';
  const matches = showFixtureFilters ? filterFixtureMatches(stageMatches, predictions) : stageMatches;
  const emptyMessage = state.matches.length === 0
    ? 'Todavia no hay fixture importado.'
    : stageMatches.length === 0
      ? 'Sin partidos para esta fase.'
      : showFixtureFilters ? 'No hay partidos que coincidan con la busqueda.' : 'Sin partido final cargado.';
  const stageLabel = stages.find(([key]) => key === state.stage)?.[1] ?? 'Fixture';
  const fixtureMeta = isTournamentStage
    ? tournamentFixtureMeta()
    : `${matches.length} de ${stageMatches.length} partidos`;
  const knockoutVisualStages = ['r16', 'qf', 'sf', 'third', 'final'];
  return `
    <section class="section fixture-section" data-fixture-section>
      <div class="section-head">
        <div>
          <h2 class="section-title">${html(stageLabel)}</h2>
          <div class="meta">${html(fixtureMeta)}</div>
        </div>
      </div>
      ${showFixtureFilters ? renderFixtureFilters(stageMatches.length, matches.length) : ''}
      <div class="stage-tabs">
        ${stages.map(([key, label]) => `<button class="stage-button ${state.stage === key ? 'active' : ''}" data-stage-tab="${key}">${label}</button>`).join('')}
      </div>
      ${isTournamentStage
        ? renderTournament('fixture')
        : knockoutVisualStages.includes(state.stage)
        ? renderBracketStage(matches, predictions, state.stage, emptyMessage)
        : state.stage === 'group'
          ? renderGroupStage(matches, predictions, emptyMessage)
          : renderPlainFixtureStage(matches, predictions, emptyMessage)}
      ${stagesWithScrollTop.includes(state.stage) && matches.length > 0 ? '<button class="scroll-top-button" type="button" data-scroll-fixture-top aria-label="Subir al inicio de la pagina"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 15l6-6 6 6" /></svg></button>' : ''}
    </section>
  `;
}

function tournamentFixtureMeta() {
  const prediction = state.predictions.tournament;
  if (prediction) return `${lockTierLabel(prediction.lock_tier)} confirmado`;

  const row = tournamentLockRow();
  if (row.tier === 'closed') return 'Bloqueo de torneo cerrado';
  return `Bloqueo actual: ${row.champion} pts campeon, ${row.finalist} pts por finalista`;
}

function renderFixtureFilters(total, visible) {
  const search = state.fixtureSearch || '';
  const status = state.fixtureStatusFilter || 'all';
  return `
    <div class="fixture-filters" role="search" aria-label="Buscar partidos del fixture">
      <label class="fixture-search-field">
        <span class="label">Buscar</span>
        <input
          class="input"
          data-fixture-search
          type="search"
          value="${html(search)}"
          placeholder="Partido, fecha, equipo vs equipo"
          autocomplete="off"
          aria-label="Buscar por partido, fecha o equipos"
        />
      </label>
      <label class="fixture-status-field">
        <span class="label">Estado</span>
        <select class="select" data-fixture-status aria-label="Filtrar por estado">
          ${fixtureStatusOption('all', 'Todos', status)}
          ${fixtureStatusOption('open', 'Abiertos', status)}
          ${fixtureStatusOption('locked', 'Bloqueados', status)}
          ${fixtureStatusOption('closed', 'Cerrados', status)}
          ${fixtureStatusOption('finished', 'Finalizados', status)}
        </select>
      </label>
      <div class="fixture-filter-summary">
        <strong>${html(visible)}</strong>
        <span>de ${html(total)}</span>
      </div>
      <button class="secondary compact fixture-clear-filter" type="button" data-fixture-clear ${!search && status === 'all' ? 'disabled' : ''}>Limpiar</button>
    </div>
  `;
}

function fixtureStatusOption(value, label, selected) {
  return `<option value="${html(value)}" ${selected === value ? 'selected' : ''}>${html(label)}</option>`;
}

function renderGroupStage(matches, predictions, emptyMessage) {
  if (matches.length === 0) return `<div class="meta">${emptyMessage}</div>`;

  const groups = new Map();
  for (const match of matches) {
    const key = match.group_name || 'Sin grupo';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
  }

  return `
    <div class="group-fixture-sections">
      ${Array.from(groups.entries())
        .sort(([a], [b]) => groupSortValue(a).localeCompare(groupSortValue(b)))
        .map(([groupName, groupMatches]) => `
          <section class="group-fixture-section">
            <div class="group-fixture-head">
              <div>
                <span>Fase de grupos</span>
                <h3>${html(groupLabel(groupName))}</h3>
              </div>
              <b>${html(groupMatches.length)} partidos</b>
            </div>
            <div class="group-fixture-grid">
              ${groupMatches.map((match) => matchCard(match, predictions.get(Number(match.id)))).join('')}
            </div>
          </section>
        `).join('')}
    </div>
  `;
}

function renderPlainFixtureStage(matches, predictions, emptyMessage) {
  if (matches.length === 0) return `<div class="meta">${emptyMessage}</div>`;
  const isR32 = state.stage === 'r32';
  return `
    <div class="match-list ${isR32 ? 'r32-fixture-grid' : ''}">
      ${matches.map((match) => matchCard(match, predictions.get(Number(match.id)))).join('')}
    </div>
  `;
}

function groupLabel(groupName) {
  const value = String(groupName || '').trim();
  if (!value || value.toLowerCase() === 'sin grupo') return 'Sin grupo';
  const letterMatch = value.match(/(?:group|grupo)?\s*([A-Z])$/i);
  return letterMatch ? `Grupo ${letterMatch[1].toUpperCase()}` : value;
}

function groupSortValue(groupName) {
  const label = groupLabel(groupName);
  const match = label.match(/Grupo ([A-Z])/);
  return match ? match[1] : label;
}

function matchCard(match, prediction) {
  const closed = isClosed(match);
  const finished = Number(match.finished) === 1;
  const gate = stageGate(match.stage);
  const lockedReason = gate.blocked && !closed && !finished ? gate.reason : '';
  const disabled = closed || finished || gate.blocked;
  const isR32 = match.stage === 'r32';
  const isKnockout = match.stage !== 'group';
  const predictedHomeTeam = isKnockout ? teamForPredictionSlot(match, prediction, 'home') : null;
  const predictedAwayTeam = isKnockout ? teamForPredictionSlot(match, prediction, 'away') : null;
  const focused = Number(state.fixtureFocusMatchId) === Number(match.id);
  return `
    <article class="match-card fixture-card ${isR32 ? 'r32-card' : ''} ${focused ? 'fixture-focus-target' : ''}" data-fixture-match-id="${html(match.id)}">
      <div class="fixture-card-head">
        <div class="match-number">${html(match.match_number || match.id)}</div>
        <div class="fixture-card-meta">
          <div class="fixture-date">${html(shortMatchDate(match.kickoff_at || match.api_local_date))}</div>
          <div class="meta">${html(apiDate(match.kickoff_at || match.api_local_date))} | Cierre: ${html(apiDate(match.prediction_closes_at))}</div>
        </div>
        ${statusPill(match, prediction)}
      </div>
      <form class="fixture-score-form" data-form="match" data-match-id="${match.id}" data-stage="${html(match.stage)}">
        <div class="fixture-teams-prediction">
          ${fixtureTeamScore(match, 'home', prediction?.predicted_home_score, disabled, predictedHomeTeam)}
          <span class="fixture-vs">vs</span>
          ${fixtureTeamScore(match, 'away', prediction?.predicted_away_score, disabled, predictedAwayTeam)}
        </div>
        ${saveAction(match.id, 'secondary', disabled, 'Guardar', 'match', lockedReason)}
        ${gate.blocked && !closed && !finished ? stageLockNotice(match.stage, gate) : ''}
        ${gate.autoUnlock && !closed && !finished ? stageAutoUnlockNotice(match.stage, gate) : ''}
      </form>
      ${matchResultBlock(match, prediction)}
    </article>
  `;
}

function fixtureTeamScore(match, side, value, disabled, selectedTeam = null, selectableTeam = false, teamOptions = []) {
  const isHome = side === 'home';
  const name = selectedTeam?.name ?? teamName(match, side);
  const flag = selectedTeam?.flag_url ?? teamFlag(match, side);
  const code = selectedTeam?.code ?? teamCode(match, side);
  const inputName = isHome ? 'homeScore' : 'awayScore';
  const teamInputName = isHome ? 'predictedHomeTeamId' : 'predictedAwayTeamId';
  const selectedTeamId = selectedTeam?.id ?? '';
  const identityMarkup = `
    <span class="fixture-team-identity">
      ${flag ? `<img class="fixture-flag" src="${html(flag)}" alt="${html(name)}" />` : '<span class="fixture-flag fallback-flag"></span>'}
      <span>
        <strong>${html(name)}</strong>
        <small>${html(code || 'Elegir pais')}</small>
      </span>
    </span>
  `;

  if (selectableTeam) {
    const pickerDisabled = disabled || teamOptions.length === 0;
    return `
      <div class="fixture-team-score r32-score-side ${side}-side" data-team-score-side="${side}">
        <div class="team-picker fixture-inline-team-picker" data-team-picker data-team-field="${teamInputName}">
          <input type="hidden" name="${teamInputName}" value="${html(selectedTeamId)}" />
          <button class="fixture-team-pick-button" type="button" data-team-picker-toggle ${pickerDisabled ? 'disabled' : ''} aria-label="Elegir ${html(isHome ? 'equipo 1' : 'equipo 2')}">
            ${identityMarkup}
          </button>
          ${teamPickerMenu(teamOptions)}
        </div>
        <input class="input score-input fixture-score-input" name="${inputName}" type="number" min="0" max="30" value="${html(scoreValue(value))}" ${disabled ? 'disabled' : ''} required />
      </div>
    `;
  }

  return `
    <label class="fixture-team-score" data-team-score-side="${side}">
      ${identityMarkup}
      <input class="input score-input fixture-score-input" name="${inputName}" type="number" min="0" max="30" value="${html(scoreValue(value))}" ${disabled ? 'disabled' : ''} required />
    </label>
  `;
}

function fixtureInlineTeamMarkup(team) {
  return `
    <span class="fixture-team-identity">
      ${team.flag_url ? `<img class="fixture-flag" src="${html(team.flag_url)}" alt="${html(team.name)}" />` : '<span class="fixture-flag fallback-flag"></span>'}
      <span>
        <strong>${html(team.name)}</strong>
        <small>${html(team.code || '')}</small>
      </span>
    </span>
  `;
}

function r32TeamSelectors(match, prediction, disabled) {
  const homeTeam = predictedTeamForSlot(match, prediction, 'home');
  const awayTeam = predictedTeamForSlot(match, prediction, 'away');
  const homeOptions = availableBracketSlotOptions(match, 'home');
  const awayOptions = availableBracketSlotOptions(match, 'away');
  return `
    ${r32TeamPicker('predictedHomeTeamId', 'Elegir equipo 1', homeTeam?.id ?? '', disabled, homeOptions)}
    ${r32TeamPicker('predictedAwayTeamId', 'Elegir equipo 2', awayTeam?.id ?? '', disabled, awayOptions)}
  `;
}

function r32TeamPicker(name, placeholder, value, disabled, options = []) {
  const selectedTeam = teamById(value);
  const pickerDisabled = disabled || options.length === 0;
  return `
    <div class="team-picker r32-team-picker" data-team-picker data-team-field="${name}">
      <input type="hidden" name="${name}" value="${html(value || '')}" />
      <button class="team-picker-trigger" type="button" data-team-picker-toggle ${pickerDisabled ? 'disabled' : ''}>
        ${selectedTeam ? teamPickerSelectedMarkup(selectedTeam) : `<span class="team-picker-placeholder">${html(placeholder)}</span>`}
      </button>
      ${teamPickerMenu(options)}
    </div>
  `;
}

function matchResultBlock(match, prediction) {
  const hasPrediction = Boolean(prediction);
  const autoFilled = isAutoFilledPrediction(prediction);
  const hasRealResult = Number(match.finished) === 1 && match.home_score !== null && match.away_score !== null;
  if (!hasPrediction && !hasRealResult) return '';
  const mismatch = knockoutMatchupMismatch(match, prediction);

  return `
    <div class="result-strip ${hasRealResult ? 'resolved' : ''} ${mismatch ? 'mismatch' : ''}">
      ${mismatch ? '<span class="wide">Cruce incorrecto: tu prediccion no coincide con los paises reales de este partido.</span>' : ''}
      ${hasPrediction ? `<span>${autoFilled ? 'Autocompletado sin puntos' : 'Tu prediccion'}: <strong>${html(prediction.predicted_home_score)}-${html(prediction.predicted_away_score)}</strong></span>` : '<span>Sin prediccion cargada</span>'}
      ${hasRealResult ? `<span>Resultado real: <strong>${html(match.home_score)}-${html(match.away_score)}</strong></span>` : '<span>Resultado real pendiente</span>'}
      ${hasPrediction ? `<span>Puntos: <strong>${html(predictionDisplayPoints(prediction))}</strong></span>` : ''}
    </div>
  `;
}

function knockoutMatchupMismatch(match, prediction) {
  const predictedHomeTeam = match?.stage !== 'group' ? teamForPredictionSlot(match, prediction, 'home') : null;
  const predictedAwayTeam = match?.stage !== 'group' ? teamForPredictionSlot(match, prediction, 'away') : null;
  return Boolean(
    prediction &&
    match?.stage !== 'group' &&
    Number(match?.finished) === 1 &&
    match?.home_team_id &&
    match?.away_team_id &&
    predictedHomeTeam &&
    predictedAwayTeam &&
    (
      Number(predictedHomeTeam.id) !== Number(match.home_team_id) ||
      Number(predictedAwayTeam.id) !== Number(match.away_team_id)
    )
  );
}

function rowKnockoutMatchupMismatch(row) {
  return Boolean(
    row &&
    row.stage !== 'group' &&
    Number(row.finished) === 1 &&
    row.home_team_id &&
    row.away_team_id &&
    row.predicted_home_team_id &&
    row.predicted_away_team_id &&
    (
      Number(row.predicted_home_team_id) !== Number(row.home_team_id) ||
      Number(row.predicted_away_team_id) !== Number(row.away_team_id)
    )
  );
}

function renderBracketStage(matches, predictions, stage, emptyMessage) {
  if (matches.length === 0) {
    return `<div class="meta">${emptyMessage}</div>`;
  }

  if (stage === 'qf') {
    return renderQuarterBracketStage(matches, predictions);
  }
  if (stage === 'sf') {
    return renderSemiBracketStage(matches, predictions);
  }
  if (stage === 'third') {
    return renderThirdPlaceStage(matches, predictions);
  }
  if (stage === 'final') {
    return renderFinalBracketStage(matches, predictions);
  }

  const rankingLimit = stage === 'final' || stage === 'sf' ? 5 : 3;
  return `
    <div class="stage-showcase ${stage}">
      <div class="bracket-board">
        ${stageHero(stage)}
        <div class="bracket-grid">
          ${matches.map((match) => bracketMatchCard(match, predictions.get(Number(match.id)), stage)).join('')}
        </div>
      </div>
      <aside class="ranking-side">
        <h3>Top ${rankingLimit}</h3>
        ${topRanking(rankingLimit)}
      </aside>
    </div>
  `;
}

function sortBracketMatches(matches) {
  return [...matches].sort((a, b) => Number(a.match_number || a.id) - Number(b.match_number || b.id));
}

function renderQuarterBracketStage(matches, predictions) {
  const sortedMatches = sortBracketMatches(matches);
  const leftMatches = sortedMatches.slice(0, 2);
  const rightMatches = sortedMatches.slice(2, 4);

  return `
    <div class="stage-showcase qf qf-showcase">
      <div class="bracket-board qf-bracket-board">
        ${stageHero('qf')}
        <div class="qf-bracket-layout" aria-label="Llave de cuartos de final">
          <div class="qf-bracket-side left">
            ${leftMatches.map((match) => qfBracketNode(match, predictions.get(Number(match.id)))).join('')}
          </div>
          <button class="qf-bracket-center bracket-stage-link" type="button" data-stage-jump="sf" aria-label="Ir a semifinales">
            <span>Avanzan a</span>
            <strong>Semifinales</strong>
          </button>
          <div class="qf-bracket-side right">
            ${rightMatches.map((match) => qfBracketNode(match, predictions.get(Number(match.id)))).join('')}
          </div>
        </div>
      </div>
      <aside class="ranking-side">
        <h3>Top 3</h3>
        ${topRanking(3)}
      </aside>
    </div>
  `;
}

function qfBracketNode(match, prediction) {
  return `
    <div class="qf-bracket-node">
      ${bracketMatchCard(match, prediction, 'qf')}
    </div>
  `;
}

function renderSemiBracketStage(matches, predictions) {
  const sortedMatches = sortBracketMatches(matches);
  const leftMatch = sortedMatches[0];
  const rightMatch = sortedMatches[1];

  return `
    <div class="stage-showcase sf sf-showcase">
      <div class="bracket-board sf-bracket-board">
        ${stageHero('sf')}
        <div class="sf-bracket-layout" aria-label="Llave de semifinales">
          ${leftMatch ? `<div class="sf-bracket-node left">${bracketMatchCard(leftMatch, predictions.get(Number(leftMatch.id)), 'sf')}</div>` : ''}
          <button class="sf-bracket-center bracket-stage-link" type="button" data-stage-jump="final" aria-label="Ir a la final">
            <span>Avanzan a</span>
            <strong>La final</strong>
          </button>
          ${rightMatch ? `<div class="sf-bracket-node right">${bracketMatchCard(rightMatch, predictions.get(Number(rightMatch.id)), 'sf')}</div>` : ''}
        </div>
      </div>
      <aside class="ranking-side">
        <h3>Top 5</h3>
        ${topRanking(5)}
      </aside>
    </div>
  `;
}

function renderThirdPlaceStage(matches, predictions) {
  const match = sortBracketMatches(matches)[0];
  return `
    <div class="stage-showcase third third-showcase">
      <div class="bracket-board third-bracket-board">
        ${stageHero('third')}
        <div class="third-place-layout" aria-label="Partido por el tercer puesto">
          <div class="third-medal-panel">
            <span>Partido opcional</span>
            <strong>Bronce</strong>
            <small>El que lo carga puede sumar puntos extra de partido.</small>
          </div>
          <div class="third-match-node">
            ${match ? bracketMatchCard(match, predictions.get(Number(match.id)), 'third') : ''}
          </div>
        </div>
      </div>
      <aside class="ranking-side">
        <h3>Top 3</h3>
        ${topRanking(3)}
      </aside>
    </div>
  `;
}

function renderFinalBracketStage(matches, predictions) {
  const match = sortBracketMatches(matches)[0];
  return `
    <div class="stage-showcase final final-showcase">
      <div class="bracket-board final-bracket-board">
        ${stageHero('final')}
        <div class="final-bracket-layout" aria-label="Final del Mundial">
          ${finalSpotlight()}
          <div class="final-match-node">
            ${finalTournamentBridge()}
            ${match ? bracketMatchCard(match, predictions.get(Number(match.id)), 'final') : ''}
          </div>
        </div>
      </div>
      <aside class="ranking-side">
        <h3>Top 5</h3>
        ${topRanking(5)}
      </aside>
    </div>
  `;
}

function finalSpotlight() {
  const selection = tournamentFinalSelection();
  if (!selection?.champion) {
    return `
      <div class="final-spotlight">
        <span>Partido decisivo</span>
        <strong>Campeon del prode</strong>
        <small>La prediccion que todos van a mirar.</small>
      </div>
    `;
  }

  return `
    <div class="final-spotlight has-selection">
      <span>${selection.locked ? 'Bloqueo de torneo' : 'Seleccion sin bloquear'}</span>
      <div class="final-champion-pick">
        ${selection.champion.flag_url ? `<img src="${html(selection.champion.flag_url)}" alt="${html(selection.champion.name)}" />` : '<i></i>'}
        <div>
          <small>Campeon elegido</small>
          <strong>${html(selection.champion.name)}</strong>
          <b>${html(selection.champion.code || '')}</b>
        </div>
      </div>
      <small>${selection.locked ? `Ya quedo bloqueado: ${lockTierLabel(selection.lockTier)}.` : 'Todavia falta confirmar el bloqueo en Torneo.'}</small>
    </div>
  `;
}

function finalTournamentBridge() {
  const selection = tournamentFinalSelection();
  if (!selection?.champion || !selection?.runnerUp) return '';

  return `
    <div class="final-tournament-bridge ${selection.locked ? 'locked' : ''}">
      <div>
        <span>${selection.locked ? 'Tu bloqueo de torneo' : 'Seleccion de torneo en curso'}</span>
        <strong>${html(selection.champion.name)} vs ${html(selection.runnerUp.name)}</strong>
        <small>${selection.locked ? 'Estos finalistas ya no se pueden cambiar.' : 'Confirmalo en Torneo para bloquear puntos estrategicos.'}</small>
      </div>
      ${selection.runnerUp ? `<b>Subcampeon: ${html(selection.runnerUp.name)}</b>` : ''}
    </div>
  `;
}

function stageHero(stage) {
  const copy = {
    r16: ['Octavos', 'La llave empieza a tomar forma'],
    qf: ['Cuartos', 'Pocos paises, mucha presion'],
    sf: ['Semifinales', 'A un paso de la gloria'],
    third: ['Tercer puesto', 'Todo es bronca y dolor'],
    final: ['Final', 'La noche mas grande del prode']
  }[stage] ?? ['Llave', ''];

  return `
    <div class="stage-hero ${stage}">
      <span>${html(copy[0])}</span>
      <strong>${html(copy[1])}</strong>
    </div>
  `;
}

function bracketMatchCard(match, prediction, stage) {
  const closed = isClosed(match);
  const finished = Number(match.finished) === 1;
  const gate = stageGate(stage);
  const lockedReason = gate.blocked && !closed && !finished ? gate.reason : '';
  const disabled = closed || finished || gate.blocked;
  const actualHomeTeam = teamForPredictionSlot(match, prediction, 'home');
  const actualAwayTeam = teamForPredictionSlot(match, prediction, 'away');
  const homeTeam = actualHomeTeam ?? (stage === 'final' ? finalTournamentTeamForSide('home') : null);
  const awayTeam = actualAwayTeam ?? (stage === 'final' ? finalTournamentTeamForSide('away') : null);
  const focused = Number(state.fixtureFocusMatchId) === Number(match.id);
  return `
    <article class="bracket-match ${stage} ${focused ? 'fixture-focus-target' : ''}" data-fixture-match-id="${html(match.id)}">
      <form class="score-form bracket-score-form" data-form="match" data-match-id="${match.id}" data-stage="${html(stage)}">
        <div class="bracket-teams">
          ${bracketTeam(match, 'home', prediction?.predicted_home_score, prediction, disabled, homeTeam, actualHomeTeam)}
          <span class="bracket-versus">vs</span>
          ${bracketTeam(match, 'away', prediction?.predicted_away_score, prediction, disabled, awayTeam, actualAwayTeam)}
        </div>
        <input class="input score-input" name="homeScore" type="number" min="0" max="30" value="${html(scoreValue(prediction?.predicted_home_score))}" ${disabled ? 'disabled' : ''} required />
        <input class="input score-input" name="awayScore" type="number" min="0" max="30" value="${html(scoreValue(prediction?.predicted_away_score))}" ${disabled ? 'disabled' : ''} required />
        ${saveAction(match.id, 'secondary', disabled, 'Guardar', 'match', lockedReason)}
        ${gate.blocked && !closed && !finished ? stageLockNotice(stage, gate) : ''}
        ${gate.autoUnlock && !closed && !finished ? stageAutoUnlockNotice(stage, gate) : ''}
      </form>
      <div class="bracket-meta-row">
        <div class="meta">${html(shortMatchDate(match.kickoff_at || match.api_local_date))}</div>
        ${statusPill(match, prediction)}
      </div>
      ${matchResultBlock(match, prediction)}
    </article>
  `;
}

function winnerSelector(match, prediction, disabled, homeTeam = null, awayTeam = null) {
  const homeScore = prediction?.predicted_home_score;
  const awayScore = prediction?.predicted_away_score;
  const winner = Number.isFinite(Number(homeScore)) && Number.isFinite(Number(awayScore)) && Number(homeScore) !== Number(awayScore)
    ? Number(homeScore) > Number(awayScore) ? 'home' : 'away'
    : '';
  const homeName = homeTeam?.name ?? teamName(match, 'home');
  const awayName = awayTeam?.name ?? teamName(match, 'away');
  return `
    <div class="winner-selector" aria-label="Seleccionar ganador">
      <input type="hidden" name="winnerSide" value="${html(winner)}" />
      <button class="winner-option ${winner === 'home' ? 'active' : ''}" type="button" data-winner="home" ${disabled ? 'disabled' : ''}>
        <span>Pasa</span>
        <strong>${html(homeName)}</strong>
      </button>
      <button class="winner-option ${winner === 'away' ? 'active' : ''}" type="button" data-winner="away" ${disabled ? 'disabled' : ''}>
        <span>Pasa</span>
        <strong>${html(awayName)}</strong>
      </button>
    </div>
  `;
}

function bracketTeam(match, side, score, prediction, disabled, selectedTeam = null, inputTeam = selectedTeam) {
  const isHome = side === 'home';
  const placeholder = teamName(match, side);
  return `
    <div class="bracket-team bracket-team-static ${disabled ? 'disabled' : ''}">
      ${bracketSlotMarkup(selectedTeam, placeholder)}
      ${score !== undefined && score !== null ? `<b>${html(score)}</b>` : ''}
    </div>
  `;
}

function bracketSlotMarkup(team, placeholder) {
  const name = team?.name ?? placeholder;
  const code = team?.code ?? 'Elegir pais';
  const flag = team?.flag_url ?? '';
  return `
    ${flag ? `<img class="bracket-flag" src="${html(flag)}" alt="${html(name)}" />` : '<span class="bracket-flag fallback-flag"></span>'}
    <span>
      <strong>${html(name)}</strong>
      <small>${html(code)}</small>
    </span>
  `;
}

function topRanking(limit) {
  return state.ranking.slice(0, limit).map((row, index) => `
    <div class="mini-rank">
      <span>${index + 1}</span>
      <strong>${html(row.first_name)} ${html(row.last_name)}</strong>
      <b>${html(row.total_points)}</b>
    </div>
  `).join('') || '<div class="meta">Sin ranking todavia.</div>';
}

function statusPill(match, prediction = null) {
  const hasPrediction = Boolean(prediction);
  const autoFilled = isAutoFilledPrediction(prediction);
  const closeLabel = apiDate(match.prediction_closes_at);

  if (autoFilled) {
    return statusPillMarkup(
      'Auto',
      'auto',
      `Este partido fue autocompletado por el sistema porque habia cerrado y faltaba para desbloquear fases posteriores. No suma +1 ni puntos por aciertos.`
    );
  }

  if (Number(match.finished) === 1 && !hasPrediction) {
    return statusPillMarkup(
      'Cerrado',
      'closed',
      `No cargaste tu prediccion antes del cierre (${closeLabel}). Este partido ya no acepta votos y no sumaste el +1 por completar.`
    );
  }

  if (Number(match.finished) === 1) {
    return statusPillMarkup(
      'Finalizado',
      'finished',
      'Este partido ya se jugo. Abajo podes revisar el resultado real, tu prediccion y los puntos que sumaste.'
    );
  }

  if (isClosed(match)) {
    if (hasPrediction) {
      return statusPillMarkup(
        'Bloqueado',
        'locked',
        `Tu prediccion ya quedo bloqueada porque el cierre fue ${closeLabel}. No podes cambiar el resultado; cuando se cargue el resultado real suma segun exacto, signo, diferencia y goles.`
      );
    }

    return statusPillMarkup(
      'Cerrado',
      'closed',
      `No cargaste tu prediccion antes del cierre (${closeLabel}). Ya no podes votar este partido y no sumaste el +1 por completar.`
    );
  }

  return statusPillMarkup(
    'Abierto',
    'open',
    `Tenes tiempo hasta ${closeLabel}. Cargar la prediccion suma +1 por completar; despues podes sumar mas por exacto, signo, diferencia y goles.`
  );
}

function tournamentLockedPill() {
  return statusPillMarkup(
    'Bloqueado',
    'locked',
    'Tu prediccion de campeon y finalistas ya fue bloqueada. No se puede editar porque el valor estrategico depende de cuando la confirmaste.'
  );
}

function statusPillMarkup(label, tone, tooltip) {
  return `<span class="status-pill ${html(tone)}" tabindex="0" title="${html(tooltip)}" aria-label="${html(`${label}: ${tooltip}`)}" data-tooltip="${html(tooltip)}">${html(label)}</span>`;
}

function stageName(stage) {
  return stages.find(([key]) => key === stage)?.[1] ?? 'Partido';
}

function renderRanking() {
  return `
    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Ranking general</h2>
          <div class="meta">Toca un participante para ver desglose y predicciones visibles.</div>
        </div>
      </div>
      <div class="ranking-list">
        ${state.ranking.map((row, index) => rankingRow(row, index)).join('') || '<div class="meta">Sin ranking.</div>'}
      </div>
    </section>
  `;
}

function rankingRow(row, index) {
  const userId = Number(row.id);
  const isOpen = Number(state.rankingOpenUserId) === userId;
  const detail = state.rankingDetails[userId];
  const isLoading = Number(state.rankingDetailLoadingId) === userId;
  return `
    <article class="rank-card ${isOpen ? 'open' : ''}">
      <button class="rank-main" type="button" data-ranking-user="${html(userId)}" aria-expanded="${isOpen}">
        <span class="rank-number">${index + 1}</span>
        <span class="rank-person">
          <strong>${html(row.first_name)} ${html(row.last_name)}</strong>
          <small>${html(row.areas || '')}</small>
        </span>
        <span class="rank-score">${html(row.total_points)}</span>
      </button>
      <div class="rank-breakdown">
        ${rankPill(row.match_points, 'Partidos')}
        ${rankPill(row.completion_points, 'Completados')}
        ${rankPill(row.streak_bonus_points, 'Rachas')}
        ${rankPill(row.tournament_points, 'Torneo')}
        ${rankPill(row.exact_count, 'Exactos')}
        ${rankPill(row.outcome_count, 'Aciertos')}
        ${rankPill(row.max_streak, 'Racha max')}
      </div>
      ${isOpen ? `<div class="ranking-detail-shell">${isLoading ? '<div class="meta">Cargando detalle...</div>' : renderRankingDetail(detail)}</div>` : ''}
    </article>
  `;
}

function rankPill(value, label) {
  return `
    <span class="rank-pill">
      <b>${html(value || 0)}</b>
      <small>${html(label)}</small>
    </span>
  `;
}

function renderRankingDetail(detail) {
  if (!detail) return '<div class="meta">Detalle no disponible.</div>';
  if (detail.error) return `<div class="error">${html(detail.error)}</div>`;
  const history = detail.history || [];
  const privacyText = detail.lockedByGroupClose
    ? 'El prode de otros participantes queda oculto hasta que cierre la fase de grupos.'
    : 'Se muestran votos de partidos ya cerrados o finalizados. Los partidos abiertos quedan ocultos para que nadie copie predicciones.';
  return `
    <div class="ranking-detail">
      <div class="ranking-public-note">
        ${html(privacyText)}
      </div>
      ${renderRankingTournament(detail.tournament)}
      <div class="ranking-vote-head">
        <strong>Predicciones visibles</strong>
        <span>${history.length} mostradas${detail.hiddenPredictionCount ? `, ${html(detail.hiddenPredictionCount)} ocultas por cierre pendiente` : ''}</span>
      </div>
      <div class="ranking-predictions">
        ${history.map(rankingPrediction).join('') || '<div class="meta">Todavia no hay predicciones visibles.</div>'}
      </div>
    </div>
  `;
}

function renderRankingTournament(tournament) {
  if (!tournament) {
    return '<div class="ranking-tournament muted-box">Todavia no bloqueo campeon y finalistas.</div>';
  }
  if (!tournament.visible) {
    return `
      <div class="ranking-tournament muted-box">
        <strong>Torneo bloqueado</strong>
        <span>${html(lockTierLabel(tournament.lock_tier))}. Elecciones ocultas hasta que cierre el bloqueo de torneo.</span>
      </div>
    `;
  }
  const champion = {
    name: tournament.champion_name,
    code: tournament.champion_code,
    flag_url: tournament.champion_flag_url
  };
  const finalist1 = {
    name: tournament.finalist1_name,
    code: tournament.finalist1_code,
    flag_url: tournament.finalist1_flag_url
  };
  const finalist2 = {
    name: tournament.finalist2_name,
    code: tournament.finalist2_code,
    flag_url: tournament.finalist2_flag_url
  };
  return `
    <div class="ranking-tournament">
      <div>
        <strong>Torneo</strong>
        <span>${html(lockTierLabel(tournament.lock_tier))} · ${html(tournament.points_awarded || 0)} pts</span>
      </div>
      <div class="ranking-tournament-teams">
        ${rankingTinyTeam(champion, 'Campeon')}
        ${rankingTinyTeam(finalist1, 'Finalista')}
        ${rankingTinyTeam(finalist2, 'Finalista')}
      </div>
    </div>
  `;
}

function rankingPrediction(row) {
  const home = rankingPredictionTeam(row, 'home');
  const away = rankingPredictionTeam(row, 'away');
  const realHome = row.home_team_name || row.home_placeholder || 'TBD';
  const realAway = row.away_team_name || row.away_placeholder || 'TBD';
  const finished = Number(row.finished) === 1 && row.home_score !== null && row.away_score !== null;
  const points = predictionDisplayPoints(row);
  return `
    <article class="ranking-prediction">
      <div class="ranking-prediction-head">
        <span class="match-number">${html(row.match_number || row.match_id)}</span>
        <div>
          <strong>${html(stageName(row.stage))}</strong>
          <small>${html(shortMatchDate(row.kickoff_at))}</small>
        </div>
        <b>${html(points)} pts</b>
      </div>
      <div class="ranking-vote-line">
        ${rankingTinyTeam(home, 'Predijo')}
        <span class="ranking-score">${html(row.predicted_home_score)}-${html(row.predicted_away_score)}</span>
        ${rankingTinyTeam(away, 'Predijo')}
      </div>
      <div class="ranking-result-line">
        ${finished
          ? `Real: ${html(realHome)} ${html(row.home_score)}-${html(row.away_score)} ${html(realAway)}`
          : 'Resultado real pendiente'}
      </div>
      ${finished ? rankingHitTags(row) : rankingPendingTags(row)}
    </article>
  `;
}

function rankingPredictionTeam(row, side) {
  const prefix = side === 'home' ? 'predicted_home' : 'predicted_away';
  const fallbackPrefix = side === 'home' ? 'home' : 'away';
  const placeholder = side === 'home' ? row.home_placeholder : row.away_placeholder;
  return {
    name: row[`${prefix}_team_name`] || row[`${fallbackPrefix}_team_name`] || placeholder || 'TBD',
    code: row[`${prefix}_team_code`] || row[`${fallbackPrefix}_team_code`] || '',
    flag_url: row[`${prefix}_flag_url`] || row[`${fallbackPrefix}_flag_url`] || ''
  };
}

function rankingTinyTeam(team, label) {
  return `
    <span class="ranking-tiny-team">
      ${team.flag_url ? `<img src="${html(team.flag_url)}" alt="${html(team.name)}" />` : '<i></i>'}
      <span>
        <small>${html(label)}</small>
        <strong>${html(team.name || 'TBD')}</strong>
      </span>
    </span>
  `;
}

function rankingHitTags(row) {
  const tags = [];
  if (isAutoFilledPrediction(row)) {
    tags.push('Autocompletado sin puntos');
  } else {
    tags.push('+1 por completar');
  }
  if (rowKnockoutMatchupMismatch(row)) tags.push('Cruce incorrecto');
  if (Number(row.exact_hit)) tags.push('Exacto');
  if (Number(row.outcome_hit)) tags.push('Acierto');
  if (Number(row.difference_hit)) tags.push('Diferencia');
  if (Number(row.home_goals_hit)) tags.push('Goles local');
  if (Number(row.away_goals_hit)) tags.push('Goles visitante');
  if (tags.length === 1) tags.push('Sin acierto de resultado');
  return `<div class="hit-tags">${tags.map((tag) => `<span>${html(tag)}</span>`).join('')}</div>`;
}

function rankingPendingTags(row) {
  return isAutoFilledPrediction(row)
    ? '<div class="hit-tags muted"><span>Autocompletado sin puntos</span><span>Pendiente de resultado</span></div>'
    : '<div class="hit-tags"><span>+1 por completar</span><span>Pendiente de resultado</span></div>';
}

function renderProfile() {
  const user = state.profile?.user || state.me?.user || {};
  const profileAreas = state.profile?.areas || [];
  const score = state.profile?.score || {};
  const history = state.profile?.history || [];
  return `
    <section class="section">
      <div class="profile-hero">
        <div class="profile-avatar">${html(profileInitials(user))}</div>
        <div class="profile-title">
          <span>Perfil</span>
          <h2>${html(user.first_name || user.firstName || '')} ${html(user.last_name || user.lastName || '')}</h2>
          <div class="profile-area-row">${profileAreas.map((area) => `<b>${html(area)}</b>`).join('') || '<b>Sin area</b>'}</div>
        </div>
        <div class="profile-total">
          <strong>${html(score.total_points || 0)}</strong>
          <span>puntos</span>
        </div>
      </div>
      <div class="profile-metric-grid">
        ${profileMetric(score.completion_points || 0, 'Completados', 'Predicciones cargadas')}
        ${profileMetric(score.match_points || 0, 'Partidos', 'Puntos por resultados')}
        ${profileMetric(score.streak_bonus_points || 0, 'Rachas', `Max ${score.max_streak || 0}`)}
        ${profileMetric(score.tournament_points || 0, 'Torneo', `${score.finalist_correct_count || 0} finalistas`)}
        ${profileMetric(score.exact_count || 0, 'Exactos', 'Marcador perfecto')}
        ${profileMetric(score.outcome_count || 0, 'Aciertos', 'Signo correcto')}
      </div>
      ${renderProfileTournament(state.profile?.tournament)}
      <div class="profile-section-head">
        <div>
          <h3>Historial de predicciones</h3>
          <span>${history.length} partidos del fixture</span>
        </div>
      </div>
      <div class="profile-history-list">
        ${history.map(profileHistoryCard).join('') || '<div class="meta">Sin historial.</div>'}
      </div>
    </section>
  `;
}

function profileInitials(user) {
  const first = user.first_name || user.firstName || '';
  const last = user.last_name || user.lastName || '';
  return `${first[0] || ''}${last[0] || ''}`.toUpperCase() || 'KP';
}

function profileMetric(value, label, detail) {
  return `
    <div class="profile-metric">
      <strong>${html(value)}</strong>
      <span>${html(label)}</span>
      <small>${html(detail)}</small>
    </div>
  `;
}

function renderProfileTournament(tournament) {
  if (!tournament) {
    return `
      <div class="profile-tournament muted-box">
        Todavia no bloqueaste campeon y finalistas.
      </div>
    `;
  }

  const champion = {
    name: tournament.champion_name,
    code: tournament.champion_code,
    flag_url: tournament.champion_flag_url
  };
  const finalist1 = {
    name: tournament.finalist1_name,
    code: tournament.finalist1_code,
    flag_url: tournament.finalist1_flag_url
  };
  const finalist2 = {
    name: tournament.finalist2_name,
    code: tournament.finalist2_code,
    flag_url: tournament.finalist2_flag_url
  };
  const runnerUp = Number(tournament.champion_team_id) === Number(tournament.finalist1_team_id) ? finalist2 : finalist1;

  return `
    <div class="profile-tournament">
      <div class="profile-section-head">
        <div>
          <h3>Campeon y subcampeon</h3>
          <span>${html(lockTierLabel(tournament.lock_tier))} · ${html(tournament.points_awarded || 0)} pts</span>
        </div>
        ${tournamentLockedPill()}
      </div>
      <div class="profile-tournament-grid">
        ${lockedTournamentTeam(champion, 'Campeon elegido', 'champion')}
        ${lockedTournamentTeam(runnerUp, 'Subcampeon elegido', 'finalist')}
      </div>
      <div class="lock-note compact-note">Finalistas elegidos: ${html(finalist1.name || 'TBD')} y ${html(finalist2.name || 'TBD')}</div>
    </div>
  `;
}

function profileHistoryCard(row) {
  const hasPrediction = row.predicted_home_score !== null && row.predicted_home_score !== undefined;
  const autoFilled = isAutoFilledPrediction(row);
  const finished = Number(row.finished) === 1 && row.home_score !== null && row.away_score !== null;
  const home = rankingPredictionTeam(row, 'home');
  const away = rankingPredictionTeam(row, 'away');
  const actualHome = {
    name: row.home_team_name || row.home_placeholder || 'TBD',
    code: row.home_team_code || '',
    flag_url: row.home_flag_url || ''
  };
  const actualAway = {
    name: row.away_team_name || row.away_placeholder || 'TBD',
    code: row.away_team_code || '',
    flag_url: row.away_flag_url || ''
  };
  const points = hasPrediction ? predictionDisplayPoints(row) : null;

  return `
    <article class="profile-history-card ${finished ? 'finished' : ''} ${hasPrediction ? '' : 'empty'}">
      <div class="profile-history-head">
        <span class="match-number">${html(row.match_number || row.match_id)}</span>
        <div>
          <strong>${html(stageName(row.stage))}</strong>
          <small>${html(shortMatchDate(row.kickoff_at))}</small>
        </div>
        <div class="profile-points">${points === null ? '-' : html(points)}</div>
      </div>
      <div class="profile-matchup">
        ${rankingTinyTeam(home, hasPrediction ? autoFilled ? 'Automatico' : 'Tu prediccion' : 'Pendiente')}
        <span class="profile-score">${hasPrediction ? `${html(row.predicted_home_score)}-${html(row.predicted_away_score)}` : '--'}</span>
        ${rankingTinyTeam(away, hasPrediction ? autoFilled ? 'Automatico' : 'Tu prediccion' : 'Pendiente')}
      </div>
      <div class="profile-real-result">
        ${finished
          ? `${rankingTinyTeam(actualHome, 'Real')} <span class="profile-score">${html(row.home_score)}-${html(row.away_score)}</span> ${rankingTinyTeam(actualAway, 'Real')}`
          : '<span>Resultado real pendiente</span>'}
      </div>
      ${hasPrediction
        ? finished ? rankingHitTags(row) : rankingPendingTags(row)
        : '<div class="hit-tags muted"><span>Sin prediccion cargada</span></div>'}
    </article>
  `;
}

function renderAdmin() {
  if (state.me.user.role !== 'ADMIN') return '<div class="error">Admin only</div>';
  return `
    <section class="section">
      <h2 class="section-title">Admin</h2>
      <div class="split">
        <div class="panel auth-panel section">
          <h3 class="section-title">Datos</h3>
          <button class="primary" data-admin="import">Importar fixture</button>
          <button class="secondary" data-admin="locks">Recalcular cierres</button>
          <button class="secondary" data-admin="scores">Recalcular ranking</button>
        </div>
        <div class="panel auth-panel section">
          ${renderAdminResultForm()}
        </div>
      </div>
      <div class="panel auth-panel section">
        <h3 class="section-title">Notificacion</h3>
        <form class="form" data-form="notification">
          <input class="input" name="title" placeholder="Titulo" required />
          <textarea class="textarea" name="body" placeholder="Mensaje" required></textarea>
          <div class="two-col">
            <select class="select" name="channel">
              <option value="banner_email">Banner + mail</option>
              <option value="banner">Banner</option>
              <option value="email">Mail</option>
            </select>
            <select class="select" name="targetArea">
              <option value="">Todas las areas</option>
              ${areas.map((area) => `<option value="${area}">${area}</option>`).join('')}
            </select>
          </div>
          <button class="primary" type="submit">Enviar</button>
        </form>
      </div>
      <div class="panel auth-panel section">
        <div class="section-head">
          <div>
            <h3 class="section-title">Banner activo</h3>
            <div class="meta">Al enviar un nuevo banner, reemplaza al anterior.</div>
          </div>
        </div>
        <div class="admin-list">
          ${renderAdminNotifications()}
        </div>
      </div>
    </section>
  `;
}

function renderAdminResultForm() {
  const selectedMatch = state.matches.find((match) => Number(match.id) === Number(state.adminResultMatchId)) ?? null;
  const sortedMatches = adminSortedMatches();
  return `
    <h3 class="section-title">Partido oficial</h3>
    <form class="form admin-result-form" data-form="admin-result">
      <label class="field">
        <span class="label">Partido</span>
        <select class="select" name="matchId" data-admin-result-match required>
          <option value="">Seleccionar</option>
          ${adminMatchSelectOptions(sortedMatches, selectedMatch)}
        </select>
      </label>
      ${adminMatchPickerList(sortedMatches, selectedMatch)}
      ${selectedMatch ? adminSelectedMatchEditor(selectedMatch) : '<div class="meta">Elegi un partido para definir cruce real y resultado.</div>'}
    </form>
  `;
}

function adminSortedMatches() {
  return [...state.matches].sort((a, b) => {
    const aDone = Number(a.finished) === 1 ? 1 : 0;
    const bDone = Number(b.finished) === 1 ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const timeDelta = matchTime(a) - matchTime(b);
    if (timeDelta !== 0) return timeDelta;
    return Number(a.match_number || a.id) - Number(b.match_number || b.id);
  });
}

function nextAdminPendingMatch() {
  return adminSortedMatches().find((match) => Number(match.finished) !== 1) ?? null;
}

function adminMatchSelectOptions(matches, selectedMatch) {
  const pending = matches.filter((match) => Number(match.finished) !== 1);
  const finished = matches.filter((match) => Number(match.finished) === 1);
  return `
    <optgroup label="Faltan completar">
      ${pending.map((match) => adminMatchOption(match, selectedMatch)).join('')}
    </optgroup>
    <optgroup label="Ya definidos">
      ${finished.map((match) => adminMatchOption(match, selectedMatch)).join('')}
    </optgroup>
  `;
}

function adminMatchOption(match, selectedMatch) {
  const status = Number(match.finished) === 1 ? `Definido ${scoreValue(match.home_score)}-${scoreValue(match.away_score)}` : 'Falta resultado';
  const label = `${status} | #${match.match_number || match.id} ${teamName(match, 'home')} - ${teamName(match, 'away')}`;
  return `<option value="${html(match.id)}" ${Number(selectedMatch?.id) === Number(match.id) ? 'selected' : ''}>${html(label)}</option>`;
}

function adminMatchPickerList(matches, selectedMatch) {
  const pending = matches.filter((match) => Number(match.finished) !== 1);
  const finished = matches.filter((match) => Number(match.finished) === 1);
  return `
    <div class="admin-match-picker" aria-label="Partidos oficiales">
      ${adminMatchPickerGroup('Faltan por completar', pending, selectedMatch, 'Todos los partidos oficiales ya tienen resultado cargado.')}
      ${adminMatchPickerGroup('Ya definidos', finished, selectedMatch, 'Todavia no hay partidos definidos.')}
    </div>
  `;
}

function adminMatchPickerGroup(title, matches, selectedMatch, emptyText) {
  return `
    <div class="admin-match-picker-group">
      <div class="admin-match-picker-title">
        <strong>${html(title)}</strong>
        <span>${html(matches.length)}</span>
      </div>
      ${matches.length > 0
        ? `<div class="admin-match-picker-grid">${matches.map((match) => adminMatchPickerCard(match, selectedMatch)).join('')}</div>`
        : `<div class="meta">${html(emptyText)}</div>`}
    </div>
  `;
}

function adminMatchPickerCard(match, selectedMatch) {
  const selected = Number(selectedMatch?.id) === Number(match.id);
  const finished = Number(match.finished) === 1;
  const tone = finished ? 'finished' : isClosed(match) ? 'closed' : 'open';
  return `
    <button class="admin-match-pick ${html(tone)} ${selected ? 'selected' : ''}" type="button" data-admin-match-card="${html(match.id)}">
      <span class="match-number">${html(match.match_number || match.id)}</span>
      <span class="admin-match-pick-main">
        ${adminMatchPickTeam(match, 'home')}
        <span class="admin-match-pick-score">
          ${finished ? `${html(scoreValue(match.home_score))}<small>-</small>${html(scoreValue(match.away_score))}` : 'Pendiente'}
        </span>
        ${adminMatchPickTeam(match, 'away')}
      </span>
      <span class="admin-match-pick-meta">
        <span>${html(stageName(match.stage))}</span>
        <span>${html(shortMatchDate(match.kickoff_at || match.api_local_date))}</span>
      </span>
    </button>
  `;
}

function adminMatchPickTeam(match, side) {
  const team = teamById(side === 'home' ? match.home_team_id : match.away_team_id);
  const name = team?.name || teamName(match, side);
  const code = team?.code || teamCode(match, side);
  const flag = team?.flag_url || teamFlag(match, side);
  return `
    <span class="admin-match-pick-team">
      ${flag ? `<img class="team-picker-flag" src="${html(flag)}" alt="${html(name)}" />` : '<span class="team-picker-flag fallback-flag"></span>'}
      <span>
        <strong>${html(name)}</strong>
        <small>${html(code || '')}</small>
      </span>
    </span>
  `;
}

function adminSelectedMatchEditor(match) {
  const isKnockout = match.stage !== 'group';
  const homeOptions = isKnockout ? adminRealSlotOptions(match, 'home') : [];
  const awayOptions = isKnockout ? adminRealSlotOptions(match, 'away') : [];
  const homeTeam = teamById(match.home_team_id);
  const awayTeam = teamById(match.away_team_id);
  const cannotResolve = isKnockout && (homeOptions.length === 0 || awayOptions.length === 0);
  const disabled = cannotResolve;

  return `
    <div class="admin-match-editor">
      <div class="admin-match-head">
        <span class="match-number">${html(match.match_number || match.id)}</span>
        <div>
          <strong>${html(stageName(match.stage))}</strong>
          <small>${html(shortMatchDate(match.kickoff_at || match.api_local_date))}</small>
        </div>
        ${adminMatchStatusPill(match)}
      </div>
      ${isKnockout
        ? `
          <div class="admin-real-matchup">
            ${adminRealTeamPicker('homeTeamId', 'Equipo real 1', homeTeam?.id ?? '', homeOptions, disabled)}
            <span>vs</span>
            ${adminRealTeamPicker('awayTeamId', 'Equipo real 2', awayTeam?.id ?? '', awayOptions, disabled)}
          </div>
          ${cannotResolve ? adminMatchSourceNotice(match) : '<div class="meta">Este cruce real se usa para comparar todas las predicciones de eliminatorias.</div>'}
        `
        : `
          <div class="admin-real-matchup fixed">
            ${adminFixedTeam(homeTeam, teamName(match, 'home'), teamCode(match, 'home'))}
            <span>vs</span>
            ${adminFixedTeam(awayTeam, teamName(match, 'away'), teamCode(match, 'away'))}
          </div>
        `}
      <div class="two-col">
        <label class="field">
          <span class="label">Goles equipo 1</span>
          <input class="input score-input" name="homeScore" type="number" min="0" max="30" value="${html(scoreValue(match.home_score))}" ${disabled ? 'disabled' : ''} required />
        </label>
        <label class="field">
          <span class="label">Goles equipo 2</span>
          <input class="input score-input" name="awayScore" type="number" min="0" max="30" value="${html(scoreValue(match.away_score))}" ${disabled ? 'disabled' : ''} required />
        </label>
      </div>
      <button class="primary" type="submit" ${disabled ? 'disabled' : ''}>Guardar cruce y resultado</button>
    </div>
  `;
}

function adminMatchStatusPill(match) {
  if (Number(match.finished) === 1) {
    return statusPillMarkup('Finalizado', 'finished', 'Este partido ya tiene cruce oficial y resultado cargado.');
  }
  if (isClosed(match)) {
    return statusPillMarkup('Cerrado', 'closed', 'El tiempo de prediccion ya cerro. Admin puede cargar el cruce oficial y resultado.');
  }
  return statusPillMarkup('Abierto', 'open', `Predicciones abiertas hasta ${apiDate(match.prediction_closes_at)}.`);
}

function adminRealTeamPicker(name, label, value, options, disabled) {
  const selectedTeam = teamById(value);
  return `
    <div class="team-picker admin-team-picker" data-team-picker data-team-field="${name}">
      <input type="hidden" name="${name}" value="${html(value || '')}" />
      <button class="team-picker-trigger" type="button" data-team-picker-toggle ${disabled || options.length === 0 ? 'disabled' : ''}>
        ${selectedTeam ? teamPickerSelectedMarkup(selectedTeam) : `<span class="team-picker-placeholder">${html(label)}</span>`}
      </button>
      ${teamPickerMenu(options)}
    </div>
  `;
}

function adminFixedTeam(team, fallbackName, fallbackCode) {
  const value = team || { name: fallbackName || 'TBD', code: fallbackCode || '', flag_url: '' };
  return `
    <div class="admin-fixed-team">
      ${value.flag_url ? `<img class="team-picker-flag" src="${html(value.flag_url)}" alt="${html(value.name)}" />` : '<span class="team-picker-flag fallback-flag"></span>'}
      <span>
        <strong>${html(value.name || 'TBD')}</strong>
        <small>${html(value.code || '')}</small>
      </span>
    </div>
  `;
}

function adminMatchSourceNotice(match) {
  const placeholders = [match.home_placeholder, match.away_placeholder].filter(Boolean).join(' / ');
  return `
    <div class="stage-lock-note compact-admin-note" role="note">
      <div>
        <strong>Cruce todavia no resoluble</strong>
        <span>Para este partido falta resolver la instancia anterior: ${html(translateMatchPlaceholder(placeholders) || placeholders)}.</span>
      </div>
    </div>
  `;
}

function renderAdminNotifications() {
  return state.adminNotifications.map((item) => `
    <div class="admin-row notification-row">
      <div>
        <strong>${html(item.title)}</strong>
        <div class="meta">${html(item.body)}</div>
        <div class="meta">${html(item.channel)}${item.target_area ? ` | ${html(item.target_area)}` : ' | Todas las areas'}</div>
      </div>
      <button class="danger compact" data-delete-notification="${html(item.id)}">Borrar</button>
    </div>
  `).join('') || '<div class="meta">No hay banners activos.</div>';
}

function bindViewEvents() {
  root.querySelectorAll('[data-stage-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.stage = button.dataset.stageTab;
      renderApp();
    });
  });

  const fixtureSearch = root.querySelector('[data-fixture-search]');
  if (fixtureSearch) {
    fixtureSearch.addEventListener('input', () => updateFixtureSearch(fixtureSearch));
  }

  const fixtureStatus = root.querySelector('[data-fixture-status]');
  if (fixtureStatus) {
    fixtureStatus.addEventListener('change', () => updateFixtureStatusFilter(fixtureStatus));
  }

  const fixtureClear = root.querySelector('[data-fixture-clear]');
  if (fixtureClear) {
    fixtureClear.addEventListener('click', clearFixtureFilters);
  }

  root.querySelectorAll('[data-jump-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.jumpView;
      renderApp();
    });
  });

  root.querySelectorAll('[data-upcoming-match-id]').forEach((card) => {
    card.addEventListener('click', () => jumpToFixtureMatch(Number(card.dataset.upcomingMatchId)));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      jumpToFixtureMatch(Number(card.dataset.upcomingMatchId));
    });
  });

  const scrollFixtureTopButton = root.querySelector('[data-scroll-fixture-top]');
  if (scrollFixtureTopButton) {
    scrollFixtureTopButton.addEventListener('click', scrollFixtureTop);
  }

  root.querySelectorAll('[data-stage-jump]').forEach((button) => {
    button.addEventListener('click', () => jumpToFixtureStage(button.dataset.stageJump));
  });

  root.querySelectorAll('[data-ranking-user]').forEach((button) => {
    button.addEventListener('click', () => toggleRankingDetail(Number(button.dataset.rankingUser)));
  });

  root.querySelectorAll('[data-form="match"]').forEach((form) => {
    form.addEventListener('submit', saveMatchPrediction);
    form.addEventListener('input', () => updateWinnerSelector(form));
    if (form.querySelector('[data-team-field="predictedHomeTeamId"], [data-team-field="predictedAwayTeamId"]')) {
      updateMatchupPicker(form, null);
    }
  });

  const tournament = root.querySelector('[data-form="tournament"]');
  if (tournament) {
    tournament.addEventListener('submit', saveTournamentPrediction);
    updateChampionPicker();
  }

  root.querySelectorAll('[data-cancel-tournament-lock]').forEach((button) => {
    button.addEventListener('click', cancelTournamentLock);
  });

  const confirmTournamentButton = root.querySelector('[data-confirm-tournament-lock]');
  if (confirmTournamentButton) confirmTournamentButton.addEventListener('click', confirmTournamentLock);

  root.querySelectorAll('[data-cancel-fixture-import]').forEach((button) => {
    button.addEventListener('click', cancelFixtureImportPreview);
  });

  const confirmFixtureImportButton = root.querySelector('[data-confirm-fixture-import]');
  if (confirmFixtureImportButton) confirmFixtureImportButton.addEventListener('click', confirmFixtureImport);

  root.querySelectorAll('[data-admin]').forEach((button) => {
    button.addEventListener('click', () => adminAction(button.dataset.admin));
  });

  const adminResult = root.querySelector('[data-form="admin-result"]');
  if (adminResult) adminResult.addEventListener('submit', saveAdminResult);

  const adminResultMatch = root.querySelector('[data-admin-result-match]');
  if (adminResultMatch) {
    adminResultMatch.addEventListener('change', () => {
      state.adminResultMatchId = Number(adminResultMatch.value) || null;
      renderApp();
    });
  }

  root.querySelectorAll('[data-admin-match-card]').forEach((button) => {
    button.addEventListener('click', () => {
      state.adminResultMatchId = Number(button.dataset.adminMatchCard) || null;
      renderApp();
    });
  });

  const notification = root.querySelector('[data-form="notification"]');
  if (notification) notification.addEventListener('submit', sendNotification);

  root.querySelectorAll('[data-delete-notification]').forEach((button) => {
    button.addEventListener('click', () => deleteNotification(button.dataset.deleteNotification));
  });

  root.querySelectorAll('[data-team-picker-toggle]').forEach((button) => {
    button.addEventListener('click', () => toggleTeamPicker(button));
  });

  root.querySelectorAll('[data-team-search]').forEach((input) => {
    input.addEventListener('input', () => applyTeamPickerSearch(input.closest('[data-team-picker]')));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault();
    });
  });

  root.querySelectorAll('[data-team-option]').forEach((button) => {
    button.addEventListener('click', () => selectTeamPickerOption(button));
  });
}

function updateFixtureSearch(input) {
  const cursor = input.selectionStart ?? input.value.length;
  state.fixtureSearch = input.value;
  renderApp();

  const nextInput = root.querySelector('[data-fixture-search]');
  if (!nextInput) return;
  nextInput.focus();
  const nextCursor = Math.min(cursor, nextInput.value.length);
  nextInput.setSelectionRange(nextCursor, nextCursor);
}

function updateFixtureStatusFilter(select) {
  state.fixtureStatusFilter = select.value || 'all';
  renderApp();
  root.querySelector('[data-fixture-status]')?.focus();
}

function clearFixtureFilters() {
  state.fixtureSearch = '';
  state.fixtureStatusFilter = 'all';
  renderApp();
  root.querySelector('[data-fixture-search]')?.focus();
}

function scrollFixtureTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function selectKnockoutWinner(button) {
  if (button.disabled) return;
  const form = button.closest('[data-form="match"]');
  if (!form) return;

  const winnerInput = form.querySelector('[name="winnerSide"]');
  if (winnerInput) winnerInput.value = button.dataset.winner || '';
  updateWinnerSelector(form);
}

function updateWinnerSelector(form) {
  const buttons = form.querySelectorAll('[data-winner]');
  if (buttons.length === 0) return;

  const explicitWinner = form.querySelector('[name="winnerSide"]')?.value || '';
  const homeScore = Number.parseInt(form.querySelector('[name="homeScore"]')?.value ?? '', 10);
  const awayScore = Number.parseInt(form.querySelector('[name="awayScore"]')?.value ?? '', 10);
  const scoreWinner = Number.isInteger(homeScore) && Number.isInteger(awayScore) && homeScore !== awayScore
    ? homeScore > awayScore ? 'home' : 'away'
    : '';
  const winner = explicitWinner || scoreWinner;

  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.winner === winner);
  });
}

async function toggleRankingDetail(userId) {
  if (!userId) return;
  if (Number(state.rankingOpenUserId) === Number(userId)) {
    state.rankingOpenUserId = null;
    renderApp();
    return;
  }

  state.rankingOpenUserId = userId;
  if (state.rankingDetails[userId]) {
    renderApp();
    return;
  }

  state.rankingDetailLoadingId = userId;
  renderApp();
  try {
    state.rankingDetails[userId] = await api(`/api/ranking/${userId}`);
  } catch (error) {
    state.rankingDetails[userId] = { error: error.message };
  } finally {
    if (Number(state.rankingDetailLoadingId) === Number(userId)) {
      state.rankingDetailLoadingId = null;
    }
    renderApp();
  }
}

function closeTeamPickers(exceptPicker = null) {
  root.querySelectorAll('[data-team-picker]').forEach((picker) => {
    if (picker === exceptPicker) return;
    picker?.classList?.remove('open');
    const menu = picker.querySelector('.team-picker-menu');
    if (menu) menu.hidden = true;
  });
}

function resetTeamPickerSearch(picker) {
  const search = picker?.querySelector('[data-team-search]');
  if (search) search.value = '';
  applyTeamPickerSearch(picker);
}

function applyTeamPickerSearch(picker) {
  if (!picker) return;
  const query = normalizeSearchText(picker.querySelector('[data-team-search]')?.value || '');
  let visibleCount = 0;

  picker.querySelectorAll('[data-team-option]').forEach((option) => {
    const matches = !query || String(option.dataset.teamSearchText || '').includes(query);
    option.toggleAttribute('data-search-hidden', !matches);
    if (!option.hidden && matches) visibleCount += 1;
  });

  const empty = picker.querySelector('[data-team-picker-empty]');
  if (empty) empty.hidden = visibleCount > 0;
}

function toggleTeamPicker(button) {
  if (button.disabled) return;
  const picker = button.closest('[data-team-picker]');
  if (!picker) return;
  if (picker.dataset.teamField === 'championTeamId') {
    updateChampionPicker();
  }
  const menu = picker.querySelector('.team-picker-menu');
  const willOpen = !picker?.classList?.contains('open');
  closeTeamPickers(picker);
  picker?.classList?.toggle('open', willOpen);
  if (menu) {
    menu.hidden = !willOpen;
    if (willOpen) {
      resetTeamPickerSearch(picker);
      window.requestAnimationFrame(() => picker.querySelector('[data-team-search]')?.focus());
    }
  }
}

function selectTeamPickerOption(button) {
  const picker = button.closest('[data-team-picker]');
  if (!picker) return;
  const input = picker.querySelector('input[type="hidden"]');
  const trigger = picker.querySelector('[data-team-picker-toggle]');
  const team = state.teams.find((item) => Number(item.id) === Number(button.dataset.teamId));
  if (!input || !trigger || !team) return;

  input.value = team.id;
  trigger.innerHTML = picker?.classList?.contains('bracket-team-picker')
    ? bracketSlotMarkup(team, team.name)
    : picker?.classList?.contains('fixture-inline-team-picker')
      ? fixtureInlineTeamMarkup(team)
      : teamPickerSelectedMarkup(team);
  closeTeamPickers();
  const form = picker.closest('[data-form="match"]');
  if (form && (picker.dataset.teamField === 'predictedHomeTeamId' || picker.dataset.teamField === 'predictedAwayTeamId')) {
    updateMatchupPicker(form, picker);
    return;
  }
  updateChampionPicker();
}

function updateMatchupPicker(form, changedPicker) {
  if (!form) return;
  const homePicker = form.querySelector('[data-team-field="predictedHomeTeamId"]');
  const awayPicker = form.querySelector('[data-team-field="predictedAwayTeamId"]');
  const homeInput = homePicker?.querySelector('[name="predictedHomeTeamId"]');
  const awayInput = awayPicker?.querySelector('[name="predictedAwayTeamId"]');
  if (!homeInput || !awayInput) return;

  if (homeInput.value && awayInput.value && homeInput.value === awayInput.value) {
    const pickerToClear = changedPicker === homePicker ? awayPicker : homePicker;
    const placeholder = pickerToClear === homePicker ? 'Elegir equipo 1' : 'Elegir equipo 2';
    if (pickerToClear) clearTeamPicker(pickerToClear, placeholder);
  }

  updateMatchupPickerOptions(homePicker, awayInput.value);
  updateMatchupPickerOptions(awayPicker, homeInput.value);
  updateTeamScorePreview(form, 'home', teamById(homeInput.value));
  updateTeamScorePreview(form, 'away', teamById(awayInput.value));
  updateWinnerOptionLabels(form);
}

function updateMatchupPickerOptions(picker, blockedTeamId) {
  if (!picker) return;
  picker.querySelectorAll('[data-team-option]').forEach((option) => {
    option.hidden = Boolean(blockedTeamId) && option.dataset.teamId === blockedTeamId;
  });
  applyTeamPickerSearch(picker);
}

function updateTeamScorePreview(form, side, team) {
  const scoreCard = form.querySelector(`[data-team-score-side="${side}"]`);
  if (!scoreCard || !team) return;

  const identity = scoreCard.querySelector('.fixture-team-identity, .team-identity');
  if (!identity) return;
  const flagClass = identity?.classList?.contains('fixture-team-identity') ? 'fixture-flag' : 'team-flag';
  identity.innerHTML = `
    ${team.flag_url ? `<img class="${flagClass}" src="${html(team.flag_url)}" alt="${html(team.name)}" />` : `<span class="${flagClass} fallback-flag"></span>`}
    <span>
      <strong>${html(team.name)}</strong>
      <small>${html(team.code || '')}</small>
    </span>
  `;
}

function updateWinnerOptionLabels(form) {
  const winnerButtons = form.querySelectorAll('[data-winner]');
  if (winnerButtons.length === 0) return;

  winnerButtons.forEach((button) => {
    const side = button.dataset.winner;
    const inputName = side === 'home' ? 'predictedHomeTeamId' : 'predictedAwayTeamId';
    const team = teamById(form.querySelector(`[name="${inputName}"]`)?.value);
    const label = team?.name || form.querySelector(`[data-team-field="${inputName}"] [data-team-picker-toggle] strong`)?.textContent?.trim();
    const strong = button.querySelector('strong');
    if (strong && label) strong.textContent = label;
  });
}

function updateChampionPicker() {
  const form = root.querySelector('[data-form="tournament"]');
  if (!form) return;

  const championId = form.querySelector('[name="championTeamId"]')?.value || '';
  const runnerUpPicker = form.querySelector('[data-team-field="finalist2TeamId"]');
  const runnerUpInput = runnerUpPicker?.querySelector('[name="finalist2TeamId"]');

  updateRunnerUpOptions(runnerUpPicker, championId);

  if (championId && runnerUpInput?.value && tournamentFinalistIssue(championId, runnerUpInput.value)) {
    clearTeamPicker(runnerUpPicker, 'Seleccionar subcampeon');
  }

  syncTournamentDraft(form);
}

function updateRunnerUpOptions(picker, championTeamId) {
  if (!picker) return;
  picker.querySelectorAll('[data-team-option]').forEach((option) => {
    option.hidden = Boolean(championTeamId) && Boolean(tournamentFinalistIssue(championTeamId, option.dataset.teamId));
  });
  applyTeamPickerSearch(picker);
}

function syncTournamentDraft(form = root.querySelector('[data-form="tournament"]')) {
  if (!form) return;
  const championTeamId = form.querySelector('[name="championTeamId"]')?.value || '';
  const runnerUpTeamId = form.querySelector('[name="finalist2TeamId"]')?.value || '';
  state.tournamentDraft = {
    finalist1TeamId: championTeamId,
    finalist2TeamId: runnerUpTeamId,
    championTeamId
  };
}

function clearTeamPicker(picker, placeholder) {
  const input = picker.querySelector('input[type="hidden"]');
  const trigger = picker.querySelector('[data-team-picker-toggle]');
  if (input) input.value = '';
  if (trigger) {
    trigger.innerHTML = `<span class="team-picker-placeholder">${html(placeholder)}</span>`;
  }
}

async function saveMatchPrediction(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const submittedFromQuickCard = Boolean(formElement?.classList?.contains('quick-match-card'));
  const form = new FormData(formElement);
  const matchId = Number(formElement.dataset.matchId);
  const stage = formElement.dataset.stage;
  const homeScore = Number(form.get('homeScore'));
  const awayScore = Number(form.get('awayScore'));
  const isKnockout = Boolean(stage) && stage !== 'group';
  const gate = stageGate(stage);
  if (gate.blocked) {
    renderTemporaryAppMessage(gate.reason, true);
    return;
  }
  if (false) {
    renderTemporaryAppMessage('Elegí los dos equipos del cruce.', true);
    return;
  }
  if (false) {
    renderTemporaryAppMessage('Los equipos del cruce deben ser distintos.', true);
    return;
  }
  if (isKnockout && homeScore === awayScore) {
    renderTemporaryAppMessage('En eliminatorias tenes que seleccionar un ganador.', true);
    return;
  }
  const scoreWinner = homeScore > awayScore ? 'home' : 'away';
  if (false) {
    renderTemporaryAppMessage('El equipo que pasa no coincide con el marcador.', true);
    return;
  }

  const match = state.matches.find((item) => Number(item.id) === Number(matchId));
  const existingPrediction = predictionByMatchId(matchId);
  const tournamentIssue = tournamentLockedTeamIssue(
    match,
    teamForPredictionSlot(match, existingPrediction, 'home'),
    teamForPredictionSlot(match, existingPrediction, 'away'),
    homeScore,
    awayScore
  );
  if (tournamentIssue) {
    renderTemporaryAppMessage(tournamentIssue, true);
    return;
  }

  try {
    await api('/api/predictions/match', {
      method: 'POST',
      body: JSON.stringify({
        matchId,
        homeScore,
        awayScore
      })
    });
    await loadAppData();
    state.pointBurstMatchId = matchId;
    state.quickPointBurst = submittedFromQuickCard;
    renderTemporaryAppMessage('Prediccion guardada. +1 por completar.', false, 2400, () => {
      if (Number(state.pointBurstMatchId) === Number(matchId)) {
        state.pointBurstMatchId = null;
      }
      state.quickPointBurst = false;
    });
  } catch (error) {
    renderApp(error.message, true);
  }
}

async function saveTournamentPrediction(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const championTeamId = form.get('championTeamId');
  const finalist1TeamId = championTeamId;
  const finalist2TeamId = form.get('finalist2TeamId');
  state.tournamentDraft = { championTeamId, finalist1TeamId, finalist2TeamId };
  if (!championTeamId || !finalist1TeamId || !finalist2TeamId) {
    renderApp('Selecciona campeon y subcampeon.', true);
    return;
  }
  if (finalist1TeamId === finalist2TeamId) {
    renderApp('Campeon y subcampeon deben ser distintos.', true);
    return;
  }
  const finalistIssue = tournamentFinalistIssue(championTeamId, finalist2TeamId);
  if (finalistIssue) {
    renderApp(finalistIssue, true);
    return;
  }
  if (currentTournamentLockTier() === 'closed') {
    renderApp('El bloqueo de campeon y finalistas ya esta cerrado.', true);
    return;
  }
  state.pendingTournamentLock = {
    championTeamId: Number(championTeamId),
    finalist1TeamId: Number(finalist1TeamId),
    finalist2TeamId: Number(finalist2TeamId)
  };
  renderApp();
}

function cancelTournamentLock() {
  state.pendingTournamentLock = null;
  renderApp();
}

async function confirmTournamentLock() {
  const pending = state.pendingTournamentLock;
  if (!pending) return;
  try {
    await api('/api/predictions/tournament', {
      method: 'POST',
      body: JSON.stringify({
        championTeamId: pending.championTeamId,
        finalist1TeamId: pending.finalist1TeamId,
        finalist2TeamId: pending.finalist2TeamId
      })
    });
    state.pendingTournamentLock = null;
    state.tournamentDraft = null;
    await loadAppData();
    renderTemporaryAppMessage('Prediccion de torneo bloqueada.');
  } catch (error) {
    state.pendingTournamentLock = null;
    renderApp(error.message, true);
  }
}

async function adminAction(action) {
  if (action === 'import') {
    await previewFixtureImport();
    return;
  }

  const paths = {
    locks: '/api/admin/locks/recalculate',
    scores: '/api/admin/scores/recalculate'
  };
  try {
    const result = await api(paths[action], { method: 'POST' });
    await loadAppData();
    renderApp(JSON.stringify(result));
  } catch (error) {
    renderApp(error.message, true);
  }
}

async function previewFixtureImport() {
  state.adminImportLoading = true;
  state.adminImportPreview = null;
  renderApp();
  try {
    state.adminImportPreview = await api('/api/admin/import/worldcup26/preview', { method: 'POST' });
  } catch (error) {
    state.adminImportLoading = false;
    renderTemporaryAppMessage(error.message, true);
    return;
  } finally {
    if (state.adminImportLoading) {
      state.adminImportLoading = false;
      renderApp();
    }
  }
}

function cancelFixtureImportPreview() {
  state.adminImportLoading = false;
  state.adminImportPreview = null;
  renderApp();
}

async function confirmFixtureImport() {
  try {
    const result = await api('/api/admin/import/worldcup26', { method: 'POST' });
    state.adminImportPreview = null;
    state.adminImportLoading = false;
    await loadAppData();
    renderTemporaryAppMessage(`Fixture importado. Equipos: ${result.teams}. Partidos: ${result.matches}.`);
  } catch (error) {
    renderApp(error.message, true);
  }
}

async function saveAdminResult(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const matchId = Number(form.get('matchId'));
  const homeTeamId = form.get('homeTeamId');
  const awayTeamId = form.get('awayTeamId');
  try {
    await api(`/api/admin/matches/${matchId}/result`, {
      method: 'PATCH',
      body: JSON.stringify({
        homeTeamId: homeTeamId ? Number(homeTeamId) : undefined,
        awayTeamId: awayTeamId ? Number(awayTeamId) : undefined,
        homeScore: Number(form.get('homeScore')),
        awayScore: Number(form.get('awayScore'))
      })
    });
    await api('/api/admin/scores/recalculate', { method: 'POST' });
    await loadAppData();
    const nextMatch = nextAdminPendingMatch();
    state.adminResultMatchId = nextMatch ? Number(nextMatch.id) : matchId;
    renderApp(nextMatch
      ? `Resultado guardado. Siguiente partido: #${nextMatch.match_number || nextMatch.id}.`
      : 'Resultado guardado. Ya no quedan partidos pendientes.');
  } catch (error) {
    renderApp(error.message, true);
  }
}

async function sendNotification(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify({
        title: form.get('title'),
        body: form.get('body'),
        channel: form.get('channel'),
        targetArea: form.get('targetArea') || null
      })
    });
    await loadAppData();
    renderApp(`Notificacion creada. Mail: ${result.emailStatus}`);
  } catch (error) {
    renderApp(error.message, true);
  }
}

async function deleteNotification(id) {
  try {
    await api(`/api/admin/notifications/${id}`, { method: 'DELETE' });
    await loadAppData();
    renderApp('Banner borrado.');
  } catch (error) {
    renderApp(error.message, true);
  }
}

function logout(render = true) {
  state.token = null;
  state.me = null;
  localStorage.removeItem('koi_token');
  if (render) renderAuth();
}

init();
