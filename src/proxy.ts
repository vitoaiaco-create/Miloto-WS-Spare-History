import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The Central Hub's data ingestion tools are admin-only (see
// src/actions/ingestion.ts and src/app/data-ingestion/page.tsx for the
// role check); this strictly gates the route itself, redirecting signed-out
// visitors straight to sign-in before the page ever renders.
const isDataIngestionRoute = createRouteMatcher(["/data-ingestion(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isDataIngestionRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
