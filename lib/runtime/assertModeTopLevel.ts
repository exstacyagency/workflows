// ⚠️ DO NOT IMPORT THIS IN NEXT.JS FILES
// This is only for node entrypoints (server.ts, worker.ts, etc)
import { requireRuntimeMode } from "./requireMode";

requireRuntimeMode();
