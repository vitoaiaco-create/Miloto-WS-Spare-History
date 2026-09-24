import { auth } from "@clerk/nextjs/server"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { DataUploader } from "@/components/data-uploader"
import { MileageUploader } from "@/components/mileage-uploader"
import { OilUploader } from "@/components/oil-uploader"
import { TirePenaltyUploader } from "@/components/tire-penalty-uploader"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

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
          <Tabs defaultValue="spares" className="gap-6">
            <TabsList className="mx-auto h-12 w-full max-w-3xl group-data-horizontal/tabs:h-12">
              <TabsTrigger className="px-6 text-base" value="spares">
                Spares
              </TabsTrigger>
              <TabsTrigger className="px-6 text-base" value="mileage">
                Mileage
              </TabsTrigger>
              <TabsTrigger className="px-6 text-base" value="oils">
                Oils Ingestion
              </TabsTrigger>
              <TabsTrigger className="px-6 text-base" value="tire-penalties">
                Tire Penalties
              </TabsTrigger>
            </TabsList>
            <TabsContent value="spares">
              <DataUploader />
            </TabsContent>
            <TabsContent value="mileage">
              <MileageUploader />
            </TabsContent>
            <TabsContent value="oils">
              <OilUploader />
            </TabsContent>
            <TabsContent value="tire-penalties">
              <TirePenaltyUploader />
            </TabsContent>
          </Tabs>
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
