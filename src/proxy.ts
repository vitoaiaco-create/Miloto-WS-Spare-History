import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// The Central Hub's data ingestion tools are admin-only (see
// src/actions/ingestion.ts and src/app/data-ingestion/page.tsx for the
// role check); this strictly gates the route itself, redirecting signed-out
// visitors straight to sign-in before the page ever renders.
const isDataIngestionRoute = createRouteMatcher(["/data-ingestion(.*)"]);

const isOilsOnlyAllowedRoute = createRouteMatcher([
  "/oils-and-servicing(.*)",
  "/oils-servicing(.*)",
]);

const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// Server Actions POST to the current page (and Next.js may also hit /api).
// Redirecting those requests would convert the mutation into a GET and
// surface a generic Vercel error for `oils_only` users.
const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isDataIngestionRoute(req)) {
    await auth.protect();
  }

  const { sessionClaims } = await auth();
  const role = sessionClaims?.metadata?.role;
  const isServerAction = req.headers.has("next-action");

  if (
    role === "oils_only" &&
    !isOilsOnlyAllowedRoute(req) &&
    !isAuthRoute(req) &&
    !isApiRoute(req) &&
    !isServerAction &&
    !req.nextUrl.pathname.startsWith("/__clerk")
  ) {
    return NextResponse.redirect(new URL("/oils-and-servicing", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
