import * as XLSX from "xlsx"

import {
  displayMaterialName,
  formatStatementDate,
  formatStatementQty,
  formatStatementUsd,
  groupSparesByAsset,
  statementScopeLabel,
  statementTotals,
  type PartAliasMap,
  type StatementAssetScope,
  type StatementSpareRow,
} from "@/lib/spares-statement"

export type StatementExportMeta = {
  assetType: StatementAssetScope
  assetLabel: string
  periodLabel: string
  dateRangeLabel: string
  aliases: PartAliasMap
}

const COMPANY_NAME = "Zambezi Portland Cement"
const DIVISION_NAME = "Miloto Workshop"
const DOCUMENT_TITLE = "Executive Spare Statement"

function isShareAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function isIOSLike() {
  const ua = navigator.userAgent
  if (/iPhone|iPod|iPad/i.test(ua)) return true
  return navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)
}

function prefersNativeShare() {
  return isIOSLike() || /Android/i.test(navigator.userAgent)
}

async function saveBlob(blob: Blob, fileName: string, mimeType: string) {
  const file = new File([blob], fileName, { type: mimeType })

  try {
    if (
      prefersNativeShare() &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] })
    ) {
      await navigator.share({ files: [file], title: fileName })
      return
    }
  } catch (error) {
    if (isShareAbort(error)) throw error
  }

  const url = URL.createObjectURL(blob)

  if (isIOSLike()) {
    window.open(url, "_blank", "noopener")
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }

  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function fileStem(meta: StatementExportMeta) {
  const asset = meta.assetLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const period = meta.periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `executive-statement-${asset || "fleet"}-${period}`
}

async function loadLogoDataUrl() {
  try {
    const response = await fetch("/zpc-logo.png")
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

type PdfLibs = {
  jsPDF: typeof import("jspdf").jsPDF
  autoTable: typeof import("jspdf-autotable").default
}

let pdfLibs: PdfLibs | null = null
let pdfLibsPromise: Promise<PdfLibs> | null = null

export function preloadStatementPdfLibs() {
  if (!pdfLibsPromise) {
    pdfLibsPromise = Promise.all([import("jspdf"), import("jspdf-autotable")]).then(
      ([jspdf, autotable]) => {
        pdfLibs = {
          jsPDF: jspdf.jsPDF,
          autoTable: autotable.default,
        }
        return pdfLibs
      }
    )
  }

  return pdfLibsPromise
}

export async function exportStatementPdf(
  rows: StatementSpareRow[],
  meta: StatementExportMeta
) {
  const [{ jsPDF, autoTable }, logo] = await Promise.all([
    pdfLibs ?? preloadStatementPdfLibs(),
    loadLogoDataUrl(),
  ])

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  let cursorY = 14

  if (logo) {
    doc.addImage(logo, "PNG", 14, 12, 28, 10)
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.setTextColor(24, 32, 48)
  doc.text(COMPANY_NAME, logo ? 46 : 14, 16)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(`${DIVISION_NAME}  ·  ${DOCUMENT_TITLE}`, logo ? 46 : 14, 22)

  cursorY = 30
  doc.setDrawColor(24, 32, 48)
  doc.setLineWidth(0.4)
  doc.line(14, cursorY, pageWidth - 14, cursorY)

  cursorY += 8
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(24, 32, 48)
  doc.text(DOCUMENT_TITLE, 14, cursorY)

  cursorY += 7
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(50)
  const headerLines = [
    `Asset ID: ${meta.assetLabel}`,
    `Asset group: ${statementScopeLabel(meta.assetType)}`,
    `Period: ${meta.periodLabel}`,
    `Date range: ${meta.dateRangeLabel}`,
  ]
  for (const line of headerLines) {
    doc.text(line, 14, cursorY)
    cursorY += 5
  }

  const groups = groupSparesByAsset(rows)
  const totals = statementTotals(rows)
  const pageHeight = doc.internal.pageSize.getHeight()
  const footerReserve = 14
  const minSectionHeight = 52

  function drawPageChrome() {
    const page = doc.getNumberOfPages()
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(
      `Generated ${new Date().toLocaleString()}  ·  ${COMPANY_NAME}  ·  Page ${page}`,
      14,
      pageHeight - 8
    )
    doc.text(
      `${rows.length} line${rows.length === 1 ? "" : "s"}`,
      pageWidth - 14,
      pageHeight - 8,
      { align: "right" }
    )
  }

  drawPageChrome()

  for (const [index, group] of groups.entries()) {
    if (index > 0) {
      const remaining = pageHeight - cursorY - footerReserve
      if (remaining < minSectionHeight) {
        doc.addPage()
        drawPageChrome()
        cursorY = 16
      } else {
        cursorY += 6
        doc.setDrawColor(24, 32, 48)
        doc.setLineWidth(0.5)
        doc.line(14, cursorY, pageWidth - 14, cursorY)
        cursorY += 5
      }
    } else {
      cursorY += 2
    }

    const body: Array<
      | string[]
      | Array<
          | string
          | {
              content: string
              colSpan?: number
              styles?: Record<string, string | number | number[]>
            }
        >
    > = group.rows.map((row) => [
      formatStatementDate(row.fitmentDate),
      displayMaterialName(row.materialName, meta.aliases),
      row.partNumber,
      formatStatementQty(row.quantity),
      formatStatementUsd(row.amountUsd),
    ])

    body.push([
      {
        content: `${group.name} total`,
        colSpan: 3,
        styles: { fontStyle: "bold", fillColor: [244, 244, 245] },
      },
      {
        content: formatStatementQty(group.totalQuantity),
        styles: { fontStyle: "bold", fillColor: [244, 244, 245] },
      },
      {
        content: formatStatementUsd(group.totalAmount),
        styles: { fontStyle: "bold", fillColor: [244, 244, 245] },
      },
    ])

    autoTable(doc, {
      startY: cursorY,
      head: [
        [
          {
            content: group.name.toUpperCase(),
            colSpan: 5,
            styles: {
              fillColor: [24, 32, 48],
              textColor: 255,
              fontStyle: "bold",
              fontSize: 10,
              halign: "left",
            },
          },
        ],
        ["Date", "Material Name", "Part Number", "Qty", "Amount"],
      ],
      body,
      styles: { fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [39, 39, 42], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 78 },
        2: { cellWidth: 36 },
        3: { cellWidth: 16, halign: "right" },
        4: { cellWidth: 24, halign: "right" },
      },
      didDrawPage: () => {
        drawPageChrome()
      },
    })

    cursorY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
        ?.finalY ?? cursorY + 10
  }

  let totalY = cursorY + 10
  if (totalY > pageHeight - 16) {
    doc.addPage()
    drawPageChrome()
    totalY = 20
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(24, 32, 48)
  doc.text(
    `Grand total    ${formatStatementQty(totals.quantity)}    ${formatStatementUsd(totals.amount)}`,
    14,
    totalY
  )

  await saveBlob(
    doc.output("blob"),
    `${fileStem(meta)}.pdf`,
    "application/pdf"
  )
}

export async function exportStatementExcel(
  rows: StatementSpareRow[],
  meta: StatementExportMeta
) {
  const groups = groupSparesByAsset(rows)
  const totals = statementTotals(rows)
  const aoa: Array<Array<string | number>> = [
    [COMPANY_NAME],
    [`${DIVISION_NAME} — ${DOCUMENT_TITLE}`],
    [`Asset ID: ${meta.assetLabel}`],
    [`Asset group: ${statementScopeLabel(meta.assetType)}`],
    [`Period: ${meta.periodLabel}`],
    [`Date range: ${meta.dateRangeLabel}`],
    [`Generated: ${new Date().toLocaleString()}`],
    [],
    ["Asset ID", "Date", "Material Name", "Part Number", "Quantity", "Amount (USD)"],
  ]

  const pageBreaks: number[] = []

  for (const [index, group] of groups.entries()) {
    if (index > 0) {
      aoa.push([])
      pageBreaks.push(aoa.length)
    }

    aoa.push([group.name.toUpperCase(), "", "", "", "", ""])
    for (const row of group.rows) {
      aoa.push([
        group.name,
        formatStatementDate(row.fitmentDate),
        displayMaterialName(row.materialName, meta.aliases),
        row.partNumber,
        row.quantity,
        row.amountUsd ?? "",
      ])
    }
    aoa.push([
      `${group.name} total`,
      "",
      "",
      "",
      group.totalQuantity,
      group.totalAmount,
    ])
  }

  aoa.push([])
  aoa.push(["GRAND TOTAL", "", "", "", totals.quantity, totals.amount])

  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  sheet["!cols"] = [
    { wch: 18 },
    { wch: 14 },
    { wch: 42 },
    { wch: 18 },
    { wch: 12 },
    { wch: 14 },
  ]
  if (pageBreaks.length > 0) {
    sheet["!rowbreaks"] = pageBreaks
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, "Statement")

  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
  const blob = new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })

  await saveBlob(
    blob,
    `${fileStem(meta)}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
}
