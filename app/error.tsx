"use client";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  console.error(error);

  return (
    <html>
      <body>
        <h1>Application error</h1>
      </body>
    </html>
  );
}
