// app/api/auth/[...nextauth]/route.ts
export const runtime = "nodejs";

import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";


import { NextResponse } from "next/server";

function patchRequestForNextAuth(req: NextRequest) {
	// Emulate req.query.nextauth for NextAuth internals
	// NextAuth expects req.query.nextauth for dynamic routes, but App Router does not provide it
	// Patch: add a dummy nextauth param
	(req as any).query = { nextauth: ["callback", "credentials"] };
	return req;
}

const nextAuthHandler = NextAuth(authOptions);

// Custom POST handler to prevent redirect for test session auth in test/beta/dev
import type { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
	try {
		const patchedReq = patchRequestForNextAuth(req);
		const cookie = patchedReq.headers?.get?.("cookie") || "";
		const isTestSession = cookie.includes("test_session=");
		const { MODE, nodeEnv, isDev } = require("@/lib/config").cfg;
		let response;
		if (isTestSession && (isDev || MODE === "test" || MODE === "beta" || nodeEnv === "development")) {
			let errorCaught = false;
			try {
				const res = await nextAuthHandler(patchedReq);
				if (res.status === 302 || res.headers.get("location")) {
					// Forward all set-cookie headers from NextAuth response
					const setCookie = res.headers.get("set-cookie");
					response = NextResponse.json({ success: true, testSession: true });
					if (setCookie) {
						response.headers.set("set-cookie", setCookie);
					} else {
						response.headers.set("set-cookie", cookie);
					}
				} else {
					response = res;
				}
			} catch (err) {
				errorCaught = true;
				response = NextResponse.json({ error: "NextAuth error", details: String(err) }, { status: 500 });
			}
			// Fallback: if response is not JSON, always return JSON for test session
			if (errorCaught || !response || response.headers.get("content-type")?.includes("text/html")) {
				response = NextResponse.json({ error: "Test session fallback: always JSON" }, { status: 500 });
			}
		} else {
			try {
				response = await nextAuthHandler(patchedReq);
			} catch (err) {
				response = NextResponse.json({ error: "NextAuth error", details: String(err) }, { status: 500 });
			}
		}
		return response;
	} catch (fatal) {
		// Top-level catch: always return JSON for test session
		return NextResponse.json({ error: "Fatal error in POST handler", details: String(fatal) }, { status: 500 });
	}
}


export { nextAuthHandler as GET };
