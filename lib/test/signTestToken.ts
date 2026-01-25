import jwt from "jsonwebtoken";
import { cfg } from "@/lib/config";

type TestTokenPayload = {
  userId: string;
};

export function signTestToken(payload: TestTokenPayload): string {
  // Allow in production only if MODE is 'beta' or 'test'
  if (
    cfg.nodeEnv === "production" &&
    cfg.mode !== "beta" &&
    cfg.mode !== "test"
  ) {
    throw new Error("Test token signing is not allowed in production unless MODE is 'beta' or 'test'");
  }

  if (!cfg.authTestSecret) {
    throw new Error("AUTH_TEST_SECRET must be set for auth isolation tests");
  }

  return jwt.sign(payload, cfg.authTestSecret, {
    expiresIn: "15m",
    issuer: "auth-isolation-test",
  });
}
