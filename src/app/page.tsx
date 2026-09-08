import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { History, PackageSearch, ShieldCheck, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    icon: PackageSearch,
    title: "Spare parts catalog",
    description:
      "Search and browse every spare part used across the workshop, with full specs and stock context at a glance.",
  },
  {
    icon: History,
    title: "Full service history",
    description:
      "See exactly which part was replaced, when, on which job, and by whom — a complete audit trail over time.",
  },
  {
    icon: Wrench,
    title: "Faster diagnostics",
    description:
      "Cross-reference past repairs to spot recurring issues and speed up future troubleshooting.",
  },
  {
    icon: ShieldCheck,
    title: "Reliable records",
    description:
      "Centralized, access-controlled data so your team always works from a single source of truth.",
  },
];

export default function Home() {
  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section className="mx-auto flex w-full max-w-7xl flex-col items-start gap-6 px-6 py-20 sm:px-10 md:py-28 lg:px-16">
        <Badge variant="secondary" className="text-xs">
          Workshop Spare Parts Management
        </Badge>
        <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-tight text-black sm:text-5xl md:text-6xl dark:text-zinc-50">
          Track every spare part and every service, all in one place.
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-600 sm:text-xl dark:text-zinc-400">
          Miloto WS Spare History keeps a complete, searchable record of the
          parts your workshop installs — so your team always knows what was
          used, when, and why.
        </p>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <Show when="signed-out">
            <SignUpButton>
              <Button size="lg" className="h-12 px-8 text-base">
                Get started
              </Button>
            </SignUpButton>
            <SignInButton>
              <Button size="lg" variant="outline" className="h-12 px-8 text-base">
                Sign in
              </Button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <Button size="lg" className="h-12 px-8 text-base">
              Go to dashboard
            </Button>
          </Show>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-24 sm:px-10 lg:px-16">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <Card key={feature.title} className="h-full">
              <CardHeader>
                <feature.icon
                  className="mb-2 size-6 text-foreground"
                  strokeWidth={1.75}
                />
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
