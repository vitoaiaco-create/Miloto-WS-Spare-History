import { auth } from "@clerk/nextjs/server";
import { BarChart3, Droplets, PackageSearch } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function Home() {
  const { userId, sessionClaims } = await auth();

  console.log("sessionClaims:", JSON.stringify(sessionClaims, null, 2));

  if (!userId) {
    redirect("/sign-in");
  }

  const allowedModules = sessionClaims?.metadata?.modules || [];

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section className="mx-auto flex w-full max-w-7xl flex-col items-start gap-4 px-6 py-16 sm:px-10 lg:px-16">
        <div className="flex w-full items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
            Central Hub
          </h1>
          <ThemeToggle />
        </div>
        <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Jump into the modules assigned to your account.
        </p>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-24 sm:px-10 lg:px-16">
        {allowedModules.length === 0 ? (
          <Alert>
            <AlertTitle>No modules assigned</AlertTitle>
            <AlertDescription>
              You haven&apos;t been assigned any modules yet. Please contact
              an administrator to get access.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {allowedModules.includes("spares_history") && (
              <Link href="/spares-history">
                <Card className="h-full transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  <CardHeader>
                    <PackageSearch
                      className="mb-2 size-6 text-foreground"
                      strokeWidth={1.75}
                    />
                    <CardTitle className="text-lg">Spares History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm leading-relaxed">
                      Search and browse the full spare parts catalog and
                      service history for every asset in the fleet.
                    </CardDescription>
                  </CardContent>
                </Card>
              </Link>
            )}

            {allowedModules.includes("workshop_analytics") && (
              <Link href="/workshop-analytics">
                <Card className="h-full transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  <CardHeader>
                    <BarChart3
                      className="mb-2 size-6 text-foreground"
                      strokeWidth={1.75}
                    />
                    <CardTitle className="text-lg">
                      Workshop Analytics
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm leading-relaxed">
                      Explore trends, costs, and performance metrics across
                      the workshop.
                    </CardDescription>
                  </CardContent>
                </Card>
              </Link>
            )}

            {allowedModules.includes("oils_servicing") && (
              <Link href="/oils-and-servicing">
                <Card className="h-full transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  <CardHeader>
                    <Droplets
                      className="mb-2 size-6 text-foreground"
                      strokeWidth={1.75}
                    />
                    <CardTitle className="text-lg">
                      Oils &amp; Servicing
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm leading-relaxed">
                      Track oil changes, servicing schedules, and maintenance
                      intervals across the fleet.
                    </CardDescription>
                  </CardContent>
                </Card>
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
