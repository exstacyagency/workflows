export function isE2ERequest(req: Request): boolean {
  if (process.env.NODE_ENV === "test") return true;

  const key = req.headers.get("x-e2e-reset-key");
  return key === process.env.E2E_RESET_KEY;
}