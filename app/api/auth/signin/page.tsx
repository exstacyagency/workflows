"use client";

import Link from "next/link";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function getErrorMessage(error: string | null): string | null {
  if (!error) return null;
  if (error === "CredentialsSignin") {
    return "Invalid email or password.";
  }
  return "Sign in failed. Please try again.";
}

function ApiSignInPageInner() {
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
    <main className="min-h-screen bg-bg text-white px-4 py-10 selection:bg-accent/30">
      <div className="max-w-md mx-auto rounded-card border border-line bg-panel p-6 space-y-4 shadow-panel backdrop-blur-panel">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {showRegistered && (
          <p className="text-sm text-success font-mono uppercase tracking-tight">
            Account created. You can sign in now.
          </p>
        )}
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            className="w-full rounded-pill bg-black/40 border border-line px-4 py-2 text-sm text-white placeholder:text-muted/40 outline-none focus:border-accent/40 transition-colors"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-pill bg-black/40 border border-line px-4 py-2 text-sm text-white placeholder:text-muted/40 outline-none focus:border-accent/40 transition-colors"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-danger font-mono">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full"
          >
            {submitting ? "Signing in..." : "Sign in with Credentials"}
          </button>
          <Link
            href="/auth/signup"
            className="btn btn-secondary w-full"
          >
            Create Account
          </Link>
        </form>
      </div>
    </main>
  );
}

export default function ApiSignInPage() {
  return (
    <Suspense fallback={null}>
      <ApiSignInPageInner />
    </Suspense>
  );
}
