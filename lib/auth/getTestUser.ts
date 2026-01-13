export function getTestUser(
  headers: Headers | Record<string, string | string[] | undefined>
) {
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NODE_ENV !== "test") return null;

  const raw =
    headers instanceof Headers
      ? headers.get("x-test-user-id")
      : (headers["x-test-user-id"] as string | undefined);

  if (!raw) return null;

  return {
    id: raw,
    email: `${raw}@test.local`,
    role: "admin",
  };
}
