import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (raw && raw.trim().length > 0) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["http://localhost:3000"];
}

function applyCors(response: Response, allowedOrigin: string | null): Response {
  if (allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Idempotency-Key",
  );
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

const allowedOrigins = getAllowedOrigins();

const handler = clerkMiddleware({
  authorizedParties: allowedOrigins,
});

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const origin = req.headers.get("origin");
  const allowed = origin && allowedOrigins.includes(origin) ? origin : null;

  if (req.method === "OPTIONS") {
    return applyCors(new NextResponse(null, { status: 204 }), allowed);
  }

  const result = await handler(req, ev);
  return applyCors(result ?? NextResponse.next(), allowed);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
