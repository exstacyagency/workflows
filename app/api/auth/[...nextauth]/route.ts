// app/api/auth/[...nextauth]/route.ts
import { NextRequest, NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

async function handler(req: NextRequest, context: { params: { nextauth: string[] } }) {
  const nextauthParams = context?.params?.nextauth || [];
  
  const protocol = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const baseUrl = process.env.NEXTAUTH_URL || `${protocol}://${host}`;
  
  const cookieHeader = req.headers.get("cookie") || "";
  const requestCookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...valueParts] = cookie.split("=");
    if (name && valueParts.length) {
      const cookieName = name.trim();
      let cookieValue = valueParts.join("=").trim();
      
      if (cookieName === "next-auth.callback-url" || cookieName === "__Secure-next-auth.callback-url") {
        try {
          cookieValue = decodeURIComponent(cookieValue);
        } catch (e) {}
      }
      
      requestCookies[cookieName] = cookieValue;
    }
  });
  
  const url = new URL(req.url);
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryParams[key] = key === "callbackUrl" ? decodeURIComponent(value) : value;
  });
  
  let body: Record<string, any> | undefined = undefined;
  if (req.method === "POST") {
    try {
      const contentType = req.headers.get("content-type") || "";
      
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const text = await req.text();
        const params = new URLSearchParams(text);
        body = {};
        params.forEach((value, key) => {
          body![key] = value;
        });
      } else if (contentType.includes("application/json")) {
        body = await req.json();
      }
    } catch (e) {
      console.error("[auth] Failed to parse request body:", e);
    }
  }
  
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  
  const parsedBase = new URL(baseUrl);
  headers["host"] = parsedBase.host;
  headers["x-forwarded-proto"] = parsedBase.protocol.replace(":", "");
  headers["x-forwarded-host"] = parsedBase.host;
  
  const headersWithGet = {
    ...headers,
    get: (key: string) => headers[key.toLowerCase()] || null,
  };
  
  const mutableReq: any = {
    method: req.method,
    headers: headersWithGet,
    cookies: requestCookies,
    query: { nextauth: nextauthParams, ...queryParams },
  };
  
  if (body !== undefined) {
    mutableReq.body = body;
  }
  
  let responseStatus = 200;
  const responseHeaders: Record<string, string | string[]> = {};
  let responseBody: any = null;
  const responseCookies: string[] = [];
  
  const mockRes = {
    status: (code: number) => {
      responseStatus = code;
      return mockRes;
    },
    setHeader: (key: string, value: string | string[]) => {
      if (key.toLowerCase() === "set-cookie") {
        const cookies = Array.isArray(value) ? value : [value];
        // Decode callback-url cookies that NextAuth encodes
        const processed = cookies.map(cookie => {
          if (cookie.includes("next-auth.callback-url=") || cookie.includes("__Secure-next-auth.callback-url=")) {
            return cookie.replace(/=(http%3A%2F%2F[^;]+)/, (match, encoded) => {
              try {
                return `=${decodeURIComponent(encoded)}`;
              } catch {
                return match;
              }
            });
          }
          return cookie;
        });
        responseCookies.push(...processed);
      } else {
        responseHeaders[key] = value;
      }
      return mockRes;
    },
    getHeader: (key: string) => {
      if (key.toLowerCase() === "set-cookie") {
        return responseCookies.length > 0 ? responseCookies : undefined;
      }
      return responseHeaders[key];
    },
    json: (data: any) => {
      responseBody = data;
      return mockRes;
    },
    send: (data: any) => {
      responseBody = data;
      return mockRes;
    },
    redirect: (statusOrUrl: number | string, url?: string) => {
      if (typeof statusOrUrl === "number") {
        responseStatus = statusOrUrl;
        responseHeaders["Location"] = url || "";
      } else {
        responseStatus = 302;
        responseHeaders["Location"] = statusOrUrl;
      }
      return mockRes;
    },
    end: () => mockRes,
  };
  
  try {
    const authHandler = NextAuth(authOptions);
    await authHandler(mutableReq, mockRes as any);
    
    const headers = new Headers();
    Object.entries(responseHeaders).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach(v => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    });
    
    responseCookies.forEach(cookie => {
      headers.append("Set-Cookie", cookie);
    });
    
    if (responseHeaders["Location"]) {
      return NextResponse.redirect(responseHeaders["Location"] as string, {
        status: responseStatus,
        headers,
      });
    }
    
    return NextResponse.json(responseBody || {}, {
      status: responseStatus,
      headers,
    });
  } catch (error: any) {
    console.error("[auth] NextAuth handler error:", error);
    return NextResponse.json(
      { error: "Authentication error", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest, context: { params: { nextauth: string[] } }) {
  return handler(req, context);
}

export async function POST(req: NextRequest, context: { params: { nextauth: string[] } }) {
  return handler(req, context);
}