import { assertRuntimeModeAllowed } from "@/lib/runtimeMode";

assertRuntimeModeAllowed();

export default function NotFound() {
  return (
    <html>
      <body>
        <h1>Not found</h1>
      </body>
    </html>
  );
}
