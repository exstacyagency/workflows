export async function createUser(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/test/create-user`, {
    method: "POST",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create-user failed ${res.status}: ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  if (!body?.token) throw new Error("No test token");

  const testSessionCookie = `test_session=${body.token}`;

  const authRes = await fetch(`${baseUrl}/api/test/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: testSessionCookie,
    },
    body: `token=${encodeURIComponent(body.token)}`,
    redirect: "manual",
  });

  if (!authRes.ok) {
    const text = await authRes.text();
    throw new Error(`auth failed ${authRes.status}: ${text.slice(0, 300)}`);
  }

  const authSetCookie = authRes.headers.get("set-cookie");
  if (!authSetCookie) throw new Error("No auth cookie");

  return { cookie: `${testSessionCookie}; ${authSetCookie.split(";")[0]}` };
}