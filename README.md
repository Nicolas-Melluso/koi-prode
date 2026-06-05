# Koi Prode

Internal World Cup 2026 prediction app for company employees.

## Stack

- Backend: NestJS
- Frontend: static HTML/CSS/JS
- DB: MySQL
- External source: `worldcup26.ir`

## Setup

```powershell
cd koi-prode
npm install
Copy-Item .env.example .env
```

Create the database and tables:

```powershell
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS koi_prode CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p koi_prode < database/schema.sql
```

Local Docker alternative:

```powershell
docker compose up -d mysql
```

That local Docker profile publishes MySQL on `localhost:3307`, matching `.env.example`.

Seed the first admin. Set `ADMIN_PASSWORD` in your local environment or `.env`.

```powershell
$env:ADMIN_PASSWORD="your-local-admin-password"
npm run db:seed:admin
```

Run the app:

```powershell
npm run start:dev
```

Open `http://localhost:3000`.

## Important

Do not commit real admin passwords. The seed script reads them from local environment variables.

## Scoring

Per finished match:

- Exact score: 10 points.
- Correct outcome/sign: 5 points, only when not exact.
- Correct goal difference: 3 extra points.
- Correct goals for each team: 1 point per side.
- Max score per match: 15 points.

Streak bonuses:

- 3 outcome hits in a row: +3.
- 5 in a row: +6.
- 8 in a row: +10.

Tournament predictions:

- Champion early: 40 points.
- Champion before Round of 32: 25 points.
- Champion before quarterfinals: 15 points.
- Each finalist early: 20 points.
- Each finalist before Round of 32: 12 points.
- Each finalist before quarterfinals: 8 points.
