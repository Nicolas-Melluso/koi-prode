# Koi Prode MVP SDD

## 1. Problem and user-visible goal

Build an internal company World Cup 2026 prediction web app for about 60 employees.
Users register with the company code, predict match scores plus champion/finalists,
see a general ranking, profile history, hit streaks, banners, and email-ready notices.

## 2. Scope

In this slice:

- NestJS backend with MySQL persistence.
- Static HTML/CSS/JS frontend served by the backend.
- Registration/login using email or username, password, and code `KOIPRODE123`.
- Multiple user areas: `LABS`, `TECH`, `ECOSYSTEM`, `GERENCIA`.
- Fixture/team import from `worldcup26.ir`.
- Match predictions, tournament predictions, lock windows, scoring, ranking.
- Admin endpoints for import, manual results, score recalculation, notifications, users, audit.
- MySQL schema and admin seed script.

Out of scope:

- Password recovery flow.
- Slack/Teams integration.
- Prize management.
- Official FIFA branding or real-money gambling mechanics.
- Fully hosted deployment config.

## 3. Product constraints

- No real-money gambling.
- No premium currency.
- All prediction mechanics are workplace/game mechanics only.
- External API data must be cached locally and manually correctable.
- Once champion/finalists are locked, they cannot be edited.

## 4. Implementation notes

- New isolated subproject under `koi-prode/`; the TIMBA root app remains untouched.
- Backend uses NestJS, raw `mysql2/promise`, bcrypt password hashing, JWT auth.
- Frontend is mobile-first static HTML/CSS/JS.
- `worldcup26.ir` is the first fixture/results source.
- Admin password is seeded from environment variables, never committed.

## 5. Validation plan

Exact commands:

```powershell
cd koi-prode
npm install
npm run build
npm run db:seed:admin
npm run start:dev
```

Manual checks:

- Open `http://localhost:3000`.
- Register with code `KOIPRODE123`.
- Login with email or username.
- Import fixture as admin.
- Submit match predictions before close.
- Submit champion/finalists once.
- Enter a result as admin and recalculate scores.
- Confirm ranking and profile history update.

## 6. Acceptance criteria

- App starts with NestJS and serves the frontend.
- MySQL schema creates all required tables.
- Admin can be seeded from env vars.
- External fixture import stores 104 matches and 48 teams when API is available.
- Scoring follows the agreed MVP rules.
- Locked tournament predictions cannot be edited.
- Admin result changes create audit logs.

## 7. Roadmap/checkpoint impact

This is a separate `koi-prode/` MVP and does not change the TIMBA roadmap.

## Fixture experience checkpoint

Problem and goal: make the fixture page useful after predictions are submitted, especially for knockout rounds.

Scope in:

- Show each user's prediction plus the real match result when a match is finished.
- Award the existing completion point visibly with a small `+1 pts` animation after saving.
- Let users choose both competing teams for Round of 32 predictions.
- Render Octavos, Cuartos, Semis, Tercer puesto, and Final as visual bracket-style sections with country flags when available.
- Show a compact top ranking next to knockout brackets on wider screens.
- Keep only one active banner visible at a time and let admins delete active banners.

Scope out:

- Full admin UI for assigning knockout teams manually.
- New scoring categories for correctly predicting Round of 32 teams.

Validation:

- `npm run build`
- Open `http://localhost:3000`, save a prediction, and confirm the `+1 pts` animation.
- Visit Fixture stages and confirm Round of 32 selectors plus bracket visuals.
- Enter a result as admin, recalculate scores, and confirm the real result appears under the user's prediction.
