"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid a hydration mismatch: the resolved theme isn't known until after
  // the client has read it from localStorage/system preference.
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <div className="flex items-center gap-2">
      <Sun className="size-4 text-muted-foreground" strokeWidth={1.75} />
      <Label htmlFor="theme-toggle" className="sr-only">
        Toggle dark mode
      </Label>
      <Switch
        id="theme-toggle"
        checked={isDark}
        disabled={!mounted}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
      />
      <Moon className="size-4 text-muted-foreground" strokeWidth={1.75} />
    </div>
  );
}
