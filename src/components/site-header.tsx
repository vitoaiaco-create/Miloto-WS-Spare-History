import { SignInButton, Show, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export async function SiteHeader() {
  const { userId, sessionClaims } = await auth();
  const role = sessionClaims?.metadata?.role;
  const isOilsOnly = role === "oils_only";
  const allowedModules = sessionClaims?.metadata?.modules || [];
  const isAdmin = role === "admin";
  const homeHref = isOilsOnly ? "/oils-and-servicing" : "/";

  const showSparesHistory =
    Boolean(userId) &&
    !isOilsOnly &&
    allowedModules.includes("spares_history");
  const showOilsAndServicing =
    Boolean(userId) &&
    (isOilsOnly || allowedModules.includes("oils_servicing"));
  const showDataIngestion = Boolean(userId) && !isOilsOnly && isAdmin;

  return (
    <header className="flex h-16 w-full items-center border-b border-border">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 sm:px-10 lg:px-16">
        <Link href={homeHref} className="flex items-center gap-3">
          <Image
            src="/zpc-logo.png"
            alt="Zambezi Portland Cement"
            width={420}
            height={145}
            className="h-8 w-auto"
            priority
          />
          <span className="text-base font-semibold tracking-tight">
            Miloto WS Spare History
          </span>
        </Link>
        <div className="flex items-center gap-3">
          {userId ? (
            <nav className="hidden items-center gap-1 sm:flex">
              {showSparesHistory ? (
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/spares-history" />}
                >
                  Spares History
                </Button>
              ) : null}
              {showOilsAndServicing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/oils-and-servicing" />}
                >
                  Oils &amp; Servicing
                </Button>
              ) : null}
              {showDataIngestion ? (
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/data-ingestion" />}
                >
                  Data Ingestion
                </Button>
              ) : null}
            </nav>
          ) : null}
          <Show when="signed-out">
            <SignInButton>
              <Button size="sm">Sign in</Button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}
