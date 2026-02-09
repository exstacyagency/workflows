import { redirect } from "next/navigation";

export default function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  const callbackUrl =
    typeof searchParams?.callbackUrl === "string" && searchParams.callbackUrl.length > 0
      ? searchParams.callbackUrl
      : "/";
  const encoded = encodeURIComponent(callbackUrl);
  redirect(`/api/auth/signin?callbackUrl=${encoded}`);
}
