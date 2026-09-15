import { auth } from "@clerk/nextjs/server"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { DataUploader } from "@/components/data-uploader"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export default async function DataIngestionPage() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const isAdmin = sessionClaims?.metadata?.role === "admin"

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-16 sm:px-10 lg:px-16">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          nativeButton={false}
          render={<Link href="/" />}
        >
          <ArrowLeft data-icon="inline-start" />
          Central Hub
        </Button>

        <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
          Data Ingestion
        </h1>

        {isAdmin ? (
          <DataUploader />
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Access denied</AlertTitle>
            <AlertDescription>
              You do not have permission to access the data ingestion module
            </AlertDescription>
          </Alert>
        )}
      </section>
    </main>
  )
}
