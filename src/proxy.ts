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

export default clerkMiddleware(async (auth, req) => {
  if (isDataIngestionRoute(req)) {
    await auth.protect();
  }

  const { sessionClaims } = await auth();
  const role = sessionClaims?.metadata?.role;

  if (
    role === "oils_only" &&
    !isOilsOnlyAllowedRoute(req) &&
    !isAuthRoute(req) &&
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
