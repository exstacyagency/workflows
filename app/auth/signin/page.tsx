import { redirect } from "next/navigation";

type SignInPageProps = {
  searchParams?: {
    callbackUrl?: string;
    registered?: string;
    error?: string;
  };
};

export default function SignInPage({ searchParams }: SignInPageProps) {
  const callbackUrl =
    typeof searchParams?.callbackUrl === "string" && searchParams.callbackUrl.length > 0
      ? searchParams.callbackUrl
      : "/studio";

  const params = new URLSearchParams({ callbackUrl });
  if (typeof searchParams?.registered === "string" && searchParams.registered.length > 0) {
    params.set("registered", searchParams.registered);
  }
  if (typeof searchParams?.error === "string" && searchParams.error.length > 0) {
    params.set("error", searchParams.error);
  }

  redirect(`/api/auth/signin?${params.toString()}`);
}
