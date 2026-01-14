import { resetDb } from "@/lib/test/resetDb";
import { seedDb } from "@/lib/test/seedDb";

export async function resetAndSeedDatabase() {
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NODE_ENV === "production") {
    throw new Error("resetAndSeedDatabase is not allowed in production");
  }

  await resetDb();
  return seedDb();
}