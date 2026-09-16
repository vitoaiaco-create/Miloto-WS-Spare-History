"use client"

import { useState } from "react"
import { CameraIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

export function ShareTableButton() {
  const [isSharing, setIsSharing] = useState(false)

  async function handleShare() {
    if (isSharing) return

    const element = document.getElementById("oils-priority-table")
    if (!element) {
      toast.add({
        title: "Share failed",
        description: "Could not find the priority roster table.",
        type: "error",
      })
      return
    }

    setIsSharing(true)

    try {
      // html2canvas-pro (already in the project) understands Tailwind v4
      // color functions such as oklch; the original html2canvas package
      // does not, so screenshots of this UI would fail to render.
      const { default: html2canvas } = await import("html2canvas-pro")

      const canvas = await html2canvas(element, {
        backgroundColor: "#ffffff",
        scale: 2,
        onclone(clonedDoc) {
          // Force the clone into light theme so the WhatsApp image stays
          // readable regardless of the sharer's dark/light preference.
          clonedDoc.documentElement.classList.remove("dark")
        },
      })

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png")
      )
      if (!blob) throw new Error("Could not generate an image of the table.")

      const file = new File([blob], "oils-roster.png", { type: "image/png" })

      if (
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: "Priority Roster",
        })
        return
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "oils-roster.png"
      link.click()
      URL.revokeObjectURL(url)

      toast.add({
        title: "Image downloaded",
        description:
          "Your browser doesn't support sharing files directly, so the image was downloaded instead — attach it to WhatsApp manually.",
        type: "info",
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return

      toast.add({
        title: "Share failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while preparing the image.",
        type: "error",
      })
    } finally {
      setIsSharing(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isSharing}
      onClick={handleShare}
    >
      {isSharing ? (
        <Loader2Icon data-icon="inline-start" className="animate-spin" />
      ) : (
        <CameraIcon data-icon="inline-start" />
      )}
      {isSharing ? "Preparing…" : "Share Roster"}
    </Button>
  )
}
