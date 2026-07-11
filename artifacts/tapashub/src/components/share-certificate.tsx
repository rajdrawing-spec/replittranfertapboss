/**
 * ShareCertificate — printable share certificate
 * Approved by TapasHub Share Team. Dot-matrix font. Print via new window (no dark-page issue).
 */
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Printer, X } from "lucide-react"

export interface ShareCertificateData {
  id:               number
  holderName:       string
  companyName:      string
  shares:           number
  sharePrice:       number
  investmentAmount: number
  shareType?:       string
  ownershipPercent?: number
  joinedDate?:      string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ONES = ["","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE",
  "TEN","ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN",
  "EIGHTEEN","NINETEEN"]
const TENS = ["","","TWENTY","THIRTY","FORTY","FIFTY","SIXTY","SEVENTY","EIGHTY","NINETY"]
function numToWords(n: number): string {
  if (n === 0) return "ZERO"
  if (n < 0)   return "MINUS " + numToWords(-n)
  if (n < 20)  return ONES[n]
  if (n < 100) return TENS[Math.floor(n/10)] + (n % 10 ? " " + ONES[n % 10] : "")
  if (n < 1000) return ONES[Math.floor(n/100)] + " HUNDRED" + (n % 100 ? " " + numToWords(n % 100) : "")
  if (n < 100000) return numToWords(Math.floor(n/1000)) + " THOUSAND" + (n % 1000 ? " " + numToWords(n % 1000) : "")
  if (n < 10000000) return numToWords(Math.floor(n/100000)) + " LAKH" + (n % 100000 ? " " + numToWords(n % 100000) : "")
  return numToWords(Math.floor(n/10000000)) + " CRORE" + (n % 10000000 ? " " + numToWords(n % 10000000) : "")
}
const inr = (n: number) => `\u20B9${Math.round(n).toLocaleString("en-IN")}`
const inrWords = (n: number) => numToWords(Math.round(n)) + " RUPEES ONLY"

function certNo(id: number, date: Date) {
  return `TAPAB/SH/${date.getFullYear()}/${String(id).padStart(5, "0")}`
}

// Base path from Vite (e.g. "/tapashub/") — resolved at build time.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")
const LOGO_URL = `${BASE}/tapashub-logo.png`

// Dot-matrix font stack — VT323 gives a clean dot-matrix terminal look.
// Loaded inline so it works both in the app and in the print window.
const DOT_MATRIX = `'VT323', 'Share Tech Mono', 'Courier New', monospace`
const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');`

// ── Approved seal ─────────────────────────────────────────────────────────────
function ApprovedSeal({ size = 110 }: { size?: number }) {
  const r = size / 2
  const innerR = r - 14
  const textR  = r - 10
  const arcPath = `M ${r},${r} m -${textR},0 a ${textR},${textR} 0 1,1 ${2 * textR},0`
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx={r} cy={r} r={r - 2} stroke="#1d90e8" strokeWidth="3" fill="#f0f7ff"/>
      <circle cx={r} cy={r} r={innerR} stroke="#1d90e8" strokeWidth="1.2" strokeDasharray="4 3" fill="white"/>
      <path id="seal-top-arc" d={arcPath} fill="none"/>
      <text fontSize={size * 0.105} fontFamily="Arial, sans-serif" fontWeight="800" fill="#1d90e8" letterSpacing="1.5">
        <textPath href="#seal-top-arc" startOffset="5%">APPROVED · TAPASHUB ·</textPath>
      </text>
      <g transform={`translate(${r - 14}, ${r - 18})`}>
        <path d="M14 2 L26 23 L2 23 Z" fill="#1a1a2e"/>
        <path d="M14 9 L20 20 L8 20 Z" fill="white"/>
        <circle cx="14" cy="13" r="3" fill="#1a1a2e"/>
      </g>
      <text x={r} y={r + 16} textAnchor="middle" fontSize={size * 0.115} fontFamily="Arial, sans-serif" fontWeight="900" fill="#1a1a2e">SHARE TEAM</text>
      <text x={r} y={r + 30} textAnchor="middle" fontSize={size * 0.09} fontFamily="Arial, sans-serif" fill="#1d90e8" letterSpacing="2">★ ★ ★</text>
    </svg>
  )
}

// ── Certificate HTML as a static string (used for new-window print) ───────────
// Build inline styles that reference all values so the print window is self-contained.
function buildCertHTML(data: ShareCertificateData): string {
  const issueDate = data.joinedDate ? new Date(data.joinedDate) : new Date()
  const no        = certNo(data.id, issueDate)
  const dateStr   = issueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
  const shareType = data.shareType ?? "EQUITY SHARES"
  const faceValue = data.sharePrice && data.sharePrice > 0 ? data.sharePrice : 10
  // If investmentAmount is missing or zero, derive it from shares × face value
  const totalVal  = data.investmentAmount && data.investmentAmount > 0
    ? data.investmentAmount
    : data.shares * faceValue
  const ownershipPct = data.ownershipPercent != null ? data.ownershipPercent.toFixed(2) : null

  // Escape helper
  const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Share Certificate – ${esc(data.holderName)}</title>
<style>
${FONT_IMPORT}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  background: white !important;
  color: #1a1a2e !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  color-scheme: light;
}
@page { size: A4 landscape; margin: 10mm; }
body { display: flex; justify-content: center; align-items: flex-start; padding: 16px; }
</style>
</head>
<body>
<div style="
  width:794px;
  background:white;
  font-family:${DOT_MATRIX};
  color:#1a1a2e;
  border:2.5px solid #1d90e8;
  border-radius:6px;
  overflow:hidden;
  position:relative;
">

  <!-- top bar -->
  <div style="height:6px;background:linear-gradient(90deg,#1a1a2e,#1d90e8,#1a1a2e);"></div>

  <!-- header: 3-col grid keeps logo truly centred regardless of side-column widths -->
  <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:20px 44px 0;">
    <!-- cert no -->
    <div>
      <div style="font-size:8.5px;font-weight:800;letter-spacing:2px;color:#888;text-transform:uppercase;">Certificate No.</div>
      <div style="font-size:13px;font-weight:700;color:#1d90e8;margin-top:2px;font-family:${DOT_MATRIX};">${esc(no)}</div>
    </div>
    <!-- logo + wordmark (centred column) -->
    <div style="text-align:center;">
      <img src="${LOGO_URL}" alt="TapasHub" width="64" height="64"
           style="object-fit:contain;display:block;margin:0 auto;"/>
      <div style="margin-top:4px;">
        <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px;color:#1a1a2e;font-family:${DOT_MATRIX};">TAPAS</span>
        <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px;color:#1d90e8;margin-left:4px;font-family:${DOT_MATRIX};">HUB</span>
      </div>
      <div style="font-size:8px;font-weight:600;letter-spacing:3px;color:#aaa;margin-top:1px;font-family:${DOT_MATRIX};">CONNECT · EMPOWER · GROW</div>
    </div>
    <!-- date (right-aligned) -->
    <div style="text-align:right;">
      <div style="font-size:8.5px;font-weight:800;letter-spacing:2px;color:#888;text-transform:uppercase;">Date of Issue</div>
      <div style="font-size:13px;font-weight:700;color:#1a1a2e;margin-top:2px;font-family:${DOT_MATRIX};">${esc(dateStr)}</div>
    </div>
  </div>

  <!-- title -->
  <div style="text-align:center;margin:16px 0 12px;">
    <div style="display:inline-block;padding:4px 0;border-top:2px solid #1d90e8;border-bottom:2px solid #1d90e8;">
      <span style="font-size:28px;font-weight:900;letter-spacing:6px;color:#1a1a2e;font-family:${DOT_MATRIX};">SHARE </span>
      <span style="font-size:28px;font-weight:900;letter-spacing:6px;color:#1d90e8;font-family:${DOT_MATRIX};">CERTIFICATE</span>
    </div>
  </div>

  <!-- certify + holder -->
  <div style="text-align:center;padding:0 44px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:8px;font-family:${DOT_MATRIX};">
      This is to certify that
    </div>
    <div style="font-size:34px;font-family:${DOT_MATRIX};color:#1a1a2e;border-bottom:1px dashed #bbb;padding-bottom:6px;margin-bottom:10px;">
      ${esc(data.holderName)}
    </div>
    <div style="font-size:11px;line-height:1.8;color:#444;font-family:${DOT_MATRIX};">
      is the registered shareholder of
      <span style="color:#1d90e8;font-weight:700;"> ${esc(data.companyName.toUpperCase())}</span>
      and is hereby allotted the fully paid-up equity shares of the Company${ownershipPct ? `,<br/>holding <span style="font-weight:700;color:#1a1a2e;">${ownershipPct}%</span> equity ownership,` : ""}<br/>
      subject to the Memorandum and Articles of Association of the Company.
    </div>
  </div>

  <!-- share details grid -->
  <div style="margin:16px 44px;border:1.5px solid #1d90e8;border-radius:8px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;">
    ${[
      { label: "NUMBER OF SHARES", value: data.shares.toLocaleString("en-IN"), sub: numToWords(data.shares) },
      { label: "TYPE OF SHARES",   value: shareType,  sub: "", blue: true },
      { label: "FACE VALUE",       value: inr(faceValue),  sub: inrWords(faceValue) },
      { label: "TOTAL VALUE",      value: inr(totalVal),   sub: inrWords(totalVal) },
    ].map((col, i) => `
    <div style="text-align:center;padding:12px 8px;${i < 3 ? "border-right:1px solid #1d90e8;" : ""}">
      <div style="font-size:8px;font-weight:700;letter-spacing:1.5px;color:#888;text-transform:uppercase;margin-bottom:4px;font-family:${DOT_MATRIX};">${esc(col.label)}</div>
      <div style="font-size:16px;font-weight:900;color:${col.blue ? "#1d90e8" : "#1a1a2e"};font-family:${DOT_MATRIX};">${esc(col.value)}</div>
      ${col.sub ? `<div style="font-size:7.5px;color:#888;margin-top:2px;font-family:${DOT_MATRIX};">${esc(col.sub)}</div>` : ""}
    </div>`).join("")}
  </div>

  <!-- seal + approval (left removed, seal centre-left, approval right) -->
  <div style="display:flex;align-items:center;justify-content:center;gap:48px;padding:8px 64px 20px;">
    <!-- Approved seal SVG inline -->
    <svg width="108" height="108" viewBox="0 0 108 108" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="54" cy="54" r="52" stroke="#1d90e8" stroke-width="3" fill="#f0f7ff"/>
      <circle cx="54" cy="54" r="40" stroke="#1d90e8" stroke-width="1.2" stroke-dasharray="4 3" fill="white"/>
      <path id="sarc" d="M 54,54 m -44,0 a 44,44 0 1,1 88,0" fill="none"/>
      <text font-size="11.3" font-family="Arial, sans-serif" font-weight="800" fill="#1d90e8" letter-spacing="1.5">
        <textPath href="#sarc" startOffset="5%">APPROVED · TAPASHUB ·</textPath>
      </text>
      <g transform="translate(40,36)">
        <path d="M14 2 L26 23 L2 23 Z" fill="#1a1a2e"/>
        <path d="M14 9 L20 20 L8 20 Z" fill="white"/>
        <circle cx="14" cy="13" r="3" fill="#1a1a2e"/>
      </g>
      <text x="54" y="70" text-anchor="middle" font-size="12.4" font-family="Arial, sans-serif" font-weight="900" fill="#1a1a2e">SHARE TEAM</text>
      <text x="54" y="84" text-anchor="middle" font-size="9.7" font-family="Arial, sans-serif" fill="#1d90e8" letter-spacing="2">★ ★ ★</text>
    </svg>

    <!-- TapasHub Team approval -->
    <div style="text-align:center;">
      <div style="font-size:28px;font-family:${DOT_MATRIX};color:#1d90e8;border-bottom:1.5px solid #bbb;padding-bottom:4px;margin-bottom:6px;">
        TapasHub Team
      </div>
      <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#1a1a2e;text-transform:uppercase;font-family:${DOT_MATRIX};">
        APPROVED BY TAPASHUB TEAM
      </div>
      <div style="font-size:9px;color:#666;margin-top:2px;font-family:${DOT_MATRIX};">Official Approval</div>
    </div>
  </div>

  <!-- footer -->
  <div style="background:#f0f7ff;border-top:1px solid #c8dff8;text-align:center;padding:8px 36px;">
    <div style="font-size:9px;font-weight:700;letter-spacing:2px;color:#666;text-transform:uppercase;font-family:${DOT_MATRIX};">
      THANK YOU FOR BEING A VALUED PART OF OUR JOURNEY. · TAPASHUB.COM
    </div>
  </div>

  <!-- bottom bar -->
  <div style="height:6px;background:linear-gradient(90deg,#1a1a2e,#1d90e8,#1a1a2e);"></div>
</div>
</body>
</html>`
}

// ── Certificate body (screen preview) ────────────────────────────────────────
function CertificateBody({ data }: { data: ShareCertificateData }) {
  const issueDate = data.joinedDate ? new Date(data.joinedDate) : new Date()
  const no        = certNo(data.id, issueDate)
  const dateStr   = issueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
  const shareType = data.shareType ?? "EQUITY SHARES"
  const faceValue = data.sharePrice && data.sharePrice > 0 ? data.sharePrice : 10
  // If investmentAmount is missing or zero, derive it from shares × face value
  const totalVal  = data.investmentAmount && data.investmentAmount > 0
    ? data.investmentAmount
    : data.shares * faceValue
  const ownershipPct = data.ownershipPercent != null ? data.ownershipPercent.toFixed(2) : null

  const cert: React.CSSProperties = {
    width: "794px",
    background: "white",
    fontFamily: DOT_MATRIX,
    color: "#1a1a2e",
    border: "2.5px solid #1d90e8",
    borderRadius: "6px",
    overflow: "hidden",
    position: "relative",
  }

  return (
    <>
      {/* Load VT323 dot-matrix font for the preview */}
      <style>{FONT_IMPORT}</style>

      <div id="share-cert-root" style={cert}>
        {/* Top bar */}
        <div style={{ height: 6, background: "linear-gradient(90deg, #1a1a2e, #1d90e8, #1a1a2e)" }} />

        {/* Header — 3-col grid: true centre for logo regardless of side widths */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "20px 44px 0" }}>
          {/* Cert no */}
          <div>
            <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Certificate No.</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1d90e8", marginTop: 2 }}>{no}</div>
          </div>

          {/* Logo + wordmark — auto-width column, always centred */}
          <div style={{ textAlign: "center" }}>
            <img
              src={LOGO_URL}
              alt="TapasHub"
              width={64} height={64}
              style={{ objectFit: "contain", display: "block", margin: "0 auto" }}
            />
            <div style={{ marginTop: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: "#1a1a2e" }}>TAPAS</span>
              <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: "#1d90e8", marginLeft: 4 }}>HUB</span>
            </div>
            <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: 3, color: "#aaa", marginTop: 1 }}>CONNECT · EMPOWER · GROW</div>
          </div>

          {/* Date */}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Date of Issue</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", marginTop: 2 }}>{dateStr}</div>
          </div>
        </div>

        {/* Title */}
        <div style={{ textAlign: "center", margin: "16px 0 12px" }}>
          <div style={{ display: "inline-block", padding: "4px 0", borderTop: "2px solid #1d90e8", borderBottom: "2px solid #1d90e8" }}>
            <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#1a1a2e" }}>SHARE </span>
            <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#1d90e8" }}>CERTIFICATE</span>
          </div>
        </div>

        {/* Certify + holder */}
        <div style={{ textAlign: "center", padding: "0 44px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#666", textTransform: "uppercase", marginBottom: 8 }}>
            This is to certify that
          </div>
          <div style={{ fontSize: 34, color: "#1a1a2e", borderBottom: "1px dashed #bbb", paddingBottom: 6, marginBottom: 10 }}>
            {data.holderName}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.8, color: "#444" }}>
            is the registered shareholder of{" "}
            <span style={{ color: "#1d90e8", fontWeight: 700 }}>{data.companyName.toUpperCase()}</span>
            {" "}and is hereby allotted the fully paid-up equity shares of the Company
            {ownershipPct && (
              <>, <br/>holding <span style={{ fontWeight: 700, color: "#1a1a2e" }}>{ownershipPct}%</span> equity ownership,</>
            )}
            <br/>subject to the Memorandum and Articles of Association of the Company.
          </div>
        </div>

        {/* Share details grid */}
        <div style={{ margin: "16px 44px", border: "1.5px solid #1d90e8", borderRadius: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
          {[
            { label: "NUMBER OF SHARES", value: data.shares.toLocaleString("en-IN"), sub: numToWords(data.shares) },
            { label: "TYPE OF SHARES",   value: shareType, sub: "", blue: true },
            { label: "FACE VALUE",       value: inr(faceValue),  sub: inrWords(faceValue) },
            { label: "TOTAL VALUE",      value: inr(totalVal),   sub: inrWords(totalVal) },
          ].map((col, i) => (
            <div key={i} style={{ textAlign: "center", padding: "12px 8px", borderRight: i < 3 ? "1px solid #1d90e8" : "none" }}>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: "#888", textTransform: "uppercase", marginBottom: 4 }}>{col.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: col.blue ? "#1d90e8" : "#1a1a2e" }}>{col.value}</div>
              {col.sub && <div style={{ fontSize: 7.5, color: "#888", marginTop: 2 }}>{col.sub}</div>}
            </div>
          ))}
        </div>

        {/* Seal + approval only (left signature removed) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 48, padding: "8px 64px 20px" }}>
          <ApprovedSeal size={108} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, color: "#1d90e8", borderBottom: "1.5px solid #bbb", paddingBottom: 4, marginBottom: 6 }}>
              TapasHub Team
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: "#1a1a2e", textTransform: "uppercase" }}>
              APPROVED BY TAPASHUB TEAM
            </div>
            <div style={{ fontSize: 9, color: "#666", marginTop: 2 }}>Official Approval</div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: "#f0f7ff", borderTop: "1px solid #c8dff8", textAlign: "center", padding: "8px 36px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>
            THANK YOU FOR BEING A VALUED PART OF OUR JOURNEY. · TAPASHUB.COM
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{ height: 6, background: "linear-gradient(90deg, #1a1a2e, #1d90e8, #1a1a2e)" }} />
      </div>
    </>
  )
}

// ── Print via new window — avoids dark-theme black-page issue entirely ────────
function printCertificate(data: ShareCertificateData) {
  const html = buildCertHTML(data)
  const win = window.open("", "_blank", "width=960,height=720")
  if (!win) { window.alert("Please allow pop-ups to print the certificate."); return; }
  win.document.open()
  win.document.write(html)
  win.document.close()
  // Give fonts & images a moment to load before triggering print
  win.onload = () => { win.focus(); setTimeout(() => { win.print(); }, 400) }
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
export function ShareCertificateModal({
  data,
  open,
  onClose,
}: {
  data: ShareCertificateData | null
  open: boolean
  onClose: () => void
}) {
  if (!data) return null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="p-0 overflow-hidden max-w-[880px] bg-gray-100"
        style={{ maxHeight: "92vh", overflowY: "auto" }}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 bg-white border-b">
          <div>
            <div className="font-semibold text-sm">Share Certificate</div>
            <div className="text-xs text-muted-foreground">{data.holderName} · {data.companyName}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => printCertificate(data)}
              className="gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <Printer className="w-4 h-4" />
              Print / Save PDF
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Certificate preview */}
        <div className="flex justify-center p-6 bg-gray-100">
          <CertificateBody data={data} />
        </div>

        <div className="text-center text-xs text-muted-foreground pb-4">
          Click "Print / Save PDF" to open a clean print window.
        </div>
      </DialogContent>
    </Dialog>
  )
}
