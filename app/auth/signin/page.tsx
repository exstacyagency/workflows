import { redirect } from "next/navigation";

type SignInPageProps = {
  searchParams?: Promise<{
    callbackUrl?: string;
    registered?: string;
    error?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const resolvedSearchParams: {
    callbackUrl?: string;
    registered?: string;
    error?: string;
  } = await (searchParams ?? Promise.resolve({}));
  const { callbackUrl, registered, error } = resolvedSearchParams;

  const resolvedCallbackUrl =
    typeof callbackUrl === "string" && callbackUrl.length > 0
      ? callbackUrl
      : "/studio";

  const params = new URLSearchParams({ callbackUrl: resolvedCallbackUrl });
  if (typeof registered === "string" && registered.length > 0) {
    params.set("registered", registered);
  }
  if (typeof error === "string" && error.length > 0) {
    params.set("error", error);
  }

  redirect(`/api/auth/signin?${params.toString()}`);
}
