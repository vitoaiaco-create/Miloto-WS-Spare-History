import { SignInButton, Show, UserButton } from "@clerk/nextjs";

import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="flex h-16 w-full items-center border-b border-border">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 sm:px-10 lg:px-16">
        <span className="text-base font-semibold tracking-tight">
          Miloto WS Spare History
        </span>
        <div className="flex items-center gap-3">
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
