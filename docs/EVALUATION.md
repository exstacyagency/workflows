# Buyer Evaluation Checklist (Deterministic)

## 1) Clone & install
```bash
npm ci
```

## 2) Configure env
Create `.env.local` with:
- `DATABASE_URL=...`
- `NEXTAUTH_SECRET=...`
- `NEXTAUTH_URL=http://localhost:3000` (or `APP_URL=...`)
- `DEBUG_ADMIN_TOKEN=...`

## 3) Run deterministic E2E + golden compare
```bash
SECURITY_SWEEP=1 npm run golden:run
```
Expected result: exits 0 and prints `[golden] OK`.

## 4) Confirm freeze contract enforcement
Attempt to modify a contract file (example: baseline summary) in a PR:
- CI should fail unless `FREEZE_OVERRIDE=1` is explicitly enabled for that PR/run.

## 5) Confirm required PR checks exist
On GitHub PR:
- CodeQL
- freeze-check
- golden-e2e
- security-sweep
