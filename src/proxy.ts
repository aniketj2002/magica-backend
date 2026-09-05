import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

function applyCors(response: Response, origin: string | null): Response {
  // Reflect any Origin so browser FE hosts (localhost, Vercel previews, etc.) work.
  // Requests use Bearer tokens (no cookies), so we do not set Allow-Credentials.
  response.headers.set("Access-Control-Allow-Origin", origin ?? "*");
  response.headers.set("Vary", "Origin");
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Idempotency-Key",
  );
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

// Do not set authorizedParties — FE and API are different origins; azp allowlisting
// caused 401s when CORS_ALLOWED_ORIGINS omitted the real frontend host.
const handler = clerkMiddleware();

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return applyCors(new NextResponse(null, { status: 204 }), origin);
  }

  const result = await handler(req, ev);
  return applyCors(result ?? NextResponse.next(), origin);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
