"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function getErrorMessage(error: string | null): string | null {
  if (!error) return null;
  if (error === "CredentialsSignin") {
    return "Invalid email or password.";
  }
  return "Sign in failed. Please try again.";
}

export default function ApiSignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const callbackUrl = searchParams.get("callbackUrl") || "/studio";
  const registered = searchParams.get("registered");
  const initialError = getErrorMessage(searchParams.get("error"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const showRegistered = useMemo(() => registered === "1", [registered]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        callbackUrl,
        redirect: false,
      });

      if (!result || result.error) {
        setError(getErrorMessage(result?.error ?? "CredentialsSignin"));
        return;
      }

      router.push(result.url || callbackUrl);
    } catch {
      setError("Sign in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="max-w-md mx-auto rounded-xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {showRegistered && (
          <p className="text-sm text-emerald-300">
            Account created. You can sign in now.
          </p>
        )}
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-sky-500 hover:bg-sky-400 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign in with Credentials"}
          </button>
          <Link
            href="/auth/signup"
            className="block w-full rounded-md border border-slate-700 bg-slate-950 hover:bg-slate-900 px-4 py-2 text-center text-sm font-medium text-slate-100"
          >
            Create Account
          </Link>
        </form>
      </div>
    </main>
  );
}
