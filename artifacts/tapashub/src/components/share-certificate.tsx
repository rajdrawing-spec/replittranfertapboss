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

// ── Currency paper palette ─────────────────────────────────────────────────────
const PAPER   = "#fffef0"   // warm ivory — Indian banknote paper colour
const INK     = "#1a1a2e"   // deep navy ink
const BLUE    = "#1d90e8"   // TapasHub accent
const GREEN   = "#1a6b3c"   // RBI-style currency green for outer border
const GOLD    = "#b8860b"   // muted gold for grid dividers

// Guilloche wave pattern — tiled across the background like security printing
const GUILLOCHE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='64'>
  <path d='M0 32 Q55 8 110 32 Q165 56 220 32' stroke='rgba(29,144,232,0.11)' stroke-width='1.1' fill='none'/>
  <path d='M0 32 Q55 56 110 32 Q165 8 220 32' stroke='rgba(29,144,232,0.08)' stroke-width='0.8' fill='none'/>
  <path d='M0 16 Q55 40 110 16 Q165 -8 220 16' stroke='rgba(0,120,55,0.07)' stroke-width='0.65' fill='none'/>
  <path d='M0 48 Q55 24 110 48 Q165 72 220 48' stroke='rgba(0,120,55,0.07)' stroke-width='0.65' fill='none'/>
  <path d='M0 8  Q55 30 110 8  Q165 -14 220 8'  stroke='rgba(29,144,232,0.05)' stroke-width='0.5' fill='none'/>
  <path d='M0 56 Q55 34 110 56 Q165 78 220 56' stroke='rgba(29,144,232,0.05)' stroke-width='0.5' fill='none'/>
</svg>`

// Inline the guilloche as a CSS url() — works in both React and the print window
function guillocheUrl(): string {
  return `url("data:image/svg+xml,${encodeURIComponent(GUILLOCHE_SVG)}")`
}

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

  const guillocheCSS = `url("data:image/svg+xml,${encodeURIComponent(GUILLOCHE_SVG)}")`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Share Certificate – ${esc(data.holderName)}</title>
<style>
${FONT_IMPORT}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  background: #e8e4d8 !important;
  color: ${INK} !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  color-scheme: light;
}
@page { size: A4 landscape; margin: 8mm; }
body { display: flex; justify-content: center; align-items: flex-start; padding: 12px; }
</style>
</head>
<body>
<div style="
  width:794px;
  position:relative;
  background-color:${PAPER};
  background-image:${guillocheCSS};
  background-size:220px 64px;
  font-family:${DOT_MATRIX};
  color:${INK};
  border:4px solid ${GREEN};
  border-radius:4px;
  overflow:hidden;
">

  <!-- inner border ring (decorative double border) -->
  <div style="position:absolute;inset:7px;border:1.5px solid ${BLUE};border-radius:2px;pointer-events:none;z-index:1;"></div>

  <!-- left security thread strip -->
  <div style="position:absolute;top:0;left:14px;bottom:0;width:5px;background:linear-gradient(180deg,${GREEN},${BLUE},${GREEN},${BLUE},${GREEN});opacity:0.18;z-index:1;"></div>

  <!-- right security thread strip -->
  <div style="position:absolute;top:0;right:14px;bottom:0;width:5px;background:linear-gradient(180deg,${BLUE},${GREEN},${BLUE},${GREEN},${BLUE});opacity:0.18;z-index:1;"></div>

  <!-- large ₹ watermark -->
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0;">
    <div style="font-size:280px;color:rgba(29,144,232,0.045);font-family:Georgia,serif;font-weight:900;line-height:1;user-select:none;">₹</div>
  </div>

  <!-- corner ornaments -->
  <div style="position:absolute;top:11px;left:11px;font-size:18px;color:${GOLD};opacity:0.6;line-height:1;z-index:2;">◆</div>
  <div style="position:absolute;top:11px;right:11px;font-size:18px;color:${GOLD};opacity:0.6;line-height:1;z-index:2;">◆</div>
  <div style="position:absolute;bottom:22px;left:11px;font-size:18px;color:${GOLD};opacity:0.6;line-height:1;z-index:2;">◆</div>
  <div style="position:absolute;bottom:22px;right:11px;font-size:18px;color:${GOLD};opacity:0.6;line-height:1;z-index:2;">◆</div>

  <!-- top colour bar -->
  <div style="height:6px;background:linear-gradient(90deg,${GREEN},${BLUE},${GREEN});position:relative;z-index:2;"></div>

  <!-- all content sits above the watermark -->
  <div style="position:relative;z-index:2;">

  <!-- header: 3-col grid keeps logo truly centred regardless of side-column widths -->
  <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:20px 54px 0;">
    <!-- cert no -->
    <div>
      <div style="font-size:8.5px;font-weight:800;letter-spacing:2px;color:#7a6a40;text-transform:uppercase;">Certificate No.</div>
      <div style="font-size:13px;font-weight:700;color:${BLUE};margin-top:2px;font-family:${DOT_MATRIX};">${esc(no)}</div>
    </div>
    <!-- logo + wordmark (centred column) -->
    <div style="text-align:center;">
      <img src="${LOGO_URL}" alt="TapasHub" width="64" height="64"
           style="object-fit:contain;display:block;margin:0 auto;"/>
      <div style="margin-top:4px;">
        <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px;color:${INK};font-family:${DOT_MATRIX};">TAPAS</span>
        <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px;color:${BLUE};margin-left:4px;font-family:${DOT_MATRIX};">HUB</span>
      </div>
      <div style="font-size:8px;font-weight:600;letter-spacing:3px;color:#9a8a60;margin-top:1px;font-family:${DOT_MATRIX};">CONNECT · EMPOWER · GROW</div>
    </div>
    <!-- date (right-aligned) -->
    <div style="text-align:right;">
      <div style="font-size:8.5px;font-weight:800;letter-spacing:2px;color:#7a6a40;text-transform:uppercase;">Date of Issue</div>
      <div style="font-size:13px;font-weight:700;color:${INK};margin-top:2px;font-family:${DOT_MATRIX};">${esc(dateStr)}</div>
    </div>
  </div>

  <!-- divider -->
  <div style="margin:10px 54px 0;height:1px;background:linear-gradient(90deg,transparent,${GOLD},transparent);"></div>

  <!-- title -->
  <div style="text-align:center;margin:14px 0 10px;">
    <div style="display:inline-block;padding:4px 18px;border-top:2px solid ${BLUE};border-bottom:2px solid ${BLUE};">
      <span style="font-size:28px;font-weight:900;letter-spacing:6px;color:${INK};font-family:${DOT_MATRIX};">SHARE </span>
      <span style="font-size:28px;font-weight:900;letter-spacing:6px;color:${BLUE};font-family:${DOT_MATRIX};">CERTIFICATE</span>
    </div>
  </div>

  <!-- certify + holder -->
  <div style="text-align:center;padding:0 54px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#7a6a40;text-transform:uppercase;margin-bottom:8px;font-family:${DOT_MATRIX};">
      This is to certify that
    </div>
    <div style="font-size:34px;font-family:${DOT_MATRIX};color:${INK};border-bottom:1px dashed ${GOLD};padding-bottom:6px;margin-bottom:10px;">
      ${esc(data.holderName)}
    </div>
    <div style="font-size:11px;line-height:1.8;color:#4a3a1a;font-family:${DOT_MATRIX};">
      is the registered shareholder of
      <span style="color:${BLUE};font-weight:700;"> ${esc(data.companyName.toUpperCase())}</span>
      and is hereby allotted the fully paid-up equity shares of the Company${ownershipPct ? `,<br/>holding <span style="font-weight:700;color:${INK};">${ownershipPct}%</span> equity ownership,` : ""}<br/>
      subject to the Memorandum and Articles of Association of the Company.
    </div>
  </div>

  <!-- share details grid -->
  <div style="margin:14px 54px;border:1.5px solid ${GOLD};border-radius:6px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;background:rgba(255,252,220,0.6);">
    ${[
      { label: "NUMBER OF SHARES", value: data.shares.toLocaleString("en-IN"), sub: numToWords(data.shares) },
      { label: "TYPE OF SHARES",   value: shareType,  sub: "", blue: true },
      { label: "FACE VALUE",       value: inr(faceValue),  sub: inrWords(faceValue) },
      { label: "TOTAL VALUE",      value: inr(totalVal),   sub: inrWords(totalVal) },
    ].map((col, i) => `
    <div style="text-align:center;padding:12px 8px;${i < 3 ? `border-right:1px solid ${GOLD};` : ""}">
      <div style="font-size:8px;font-weight:700;letter-spacing:1.5px;color:#7a6a40;text-transform:uppercase;margin-bottom:4px;font-family:${DOT_MATRIX};">${esc(col.label)}</div>
      <div style="font-size:17px;font-weight:900;color:${col.blue ? BLUE : INK};font-family:${DOT_MATRIX};">${esc(col.value)}</div>
      ${col.sub ? `<div style="font-size:7.5px;color:#8a7a50;margin-top:2px;font-family:${DOT_MATRIX};">${esc(col.sub)}</div>` : ""}
    </div>`).join("")}
  </div>

  <!-- divider -->
  <div style="margin:0 54px;height:1px;background:linear-gradient(90deg,transparent,${GOLD},transparent);"></div>

  <!-- seal + approval -->
  <div style="display:flex;align-items:center;justify-content:center;gap:48px;padding:10px 64px 18px;">
    <!-- Approved seal SVG inline -->
    <svg width="108" height="108" viewBox="0 0 108 108" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="54" cy="54" r="52" stroke="${BLUE}" stroke-width="3" fill="rgba(29,144,232,0.07)"/>
      <circle cx="54" cy="54" r="40" stroke="${BLUE}" stroke-width="1.2" stroke-dasharray="4 3" fill="rgba(255,254,240,0.9)"/>
      <path id="sarc" d="M 54,54 m -44,0 a 44,44 0 1,1 88,0" fill="none"/>
      <text font-size="11.3" font-family="Arial, sans-serif" font-weight="800" fill="${BLUE}" letter-spacing="1.5">
        <textPath href="#sarc" startOffset="5%">APPROVED · TAPASHUB ·</textPath>
      </text>
      <g transform="translate(40,36)">
        <path d="M14 2 L26 23 L2 23 Z" fill="${INK}"/>
        <path d="M14 9 L20 20 L8 20 Z" fill="white"/>
        <circle cx="14" cy="13" r="3" fill="${INK}"/>
      </g>
      <text x="54" y="70" text-anchor="middle" font-size="12.4" font-family="Arial, sans-serif" font-weight="900" fill="${INK}">SHARE TEAM</text>
      <text x="54" y="84" text-anchor="middle" font-size="9.7" font-family="Arial, sans-serif" fill="${BLUE}" letter-spacing="2">★ ★ ★</text>
    </svg>

    <!-- TapasHub Team approval -->
    <div style="text-align:center;">
      <div style="font-size:28px;font-family:${DOT_MATRIX};color:${BLUE};border-bottom:1.5px solid ${GOLD};padding-bottom:4px;margin-bottom:6px;">
        TapasHub Team
      </div>
      <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:${INK};text-transform:uppercase;font-family:${DOT_MATRIX};">
        APPROVED BY TAPASHUB TEAM
      </div>
      <div style="font-size:9px;color:#7a6a40;margin-top:2px;font-family:${DOT_MATRIX};">Official Approval</div>
    </div>
  </div>

  </div><!-- end z-index:2 content wrapper -->

  <!-- footer -->
  <div style="background:rgba(26,107,60,0.08);border-top:1px solid ${GOLD};text-align:center;padding:7px 36px;position:relative;z-index:2;">
    <div style="font-size:8.5px;font-weight:700;letter-spacing:2.5px;color:#7a6a40;text-transform:uppercase;font-family:${DOT_MATRIX};">
      THANK YOU FOR BEING A VALUED PART OF OUR JOURNEY. · TAPASHUB.COM
    </div>
  </div>

  <!-- bottom colour bar -->
  <div style="height:6px;background:linear-gradient(90deg,${GREEN},${BLUE},${GREEN});position:relative;z-index:2;"></div>
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

  const certStyle: React.CSSProperties = {
    width: "794px",
    position: "relative",
    backgroundColor: PAPER,
    backgroundImage: guillocheUrl(),
    backgroundSize: "220px 64px",
    fontFamily: DOT_MATRIX,
    color: INK,
    border: `4px solid ${GREEN}`,
    borderRadius: "4px",
    overflow: "hidden",
  }

  return (
    <>
      <style>{FONT_IMPORT}</style>

      <div id="share-cert-root" style={certStyle}>
        {/* Inner border ring */}
        <div style={{ position: "absolute", inset: 7, border: `1.5px solid ${BLUE}`, borderRadius: 2, pointerEvents: "none", zIndex: 1 }} />

        {/* Left security thread */}
        <div style={{ position: "absolute", top: 0, left: 14, bottom: 0, width: 5, background: `linear-gradient(180deg,${GREEN},${BLUE},${GREEN},${BLUE},${GREEN})`, opacity: 0.18, zIndex: 1 }} />
        {/* Right security thread */}
        <div style={{ position: "absolute", top: 0, right: 14, bottom: 0, width: 5, background: `linear-gradient(180deg,${BLUE},${GREEN},${BLUE},${GREEN},${BLUE})`, opacity: 0.18, zIndex: 1 }} />

        {/* Large ₹ watermark */}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 0 }}>
          <div style={{ fontSize: 280, color: "rgba(29,144,232,0.045)", fontFamily: "Georgia,serif", fontWeight: 900, lineHeight: 1, userSelect: "none" }}>₹</div>
        </div>

        {/* Corner ornaments */}
        {[{top:11,left:11},{top:11,right:11},{bottom:22,left:11},{bottom:22,right:11}].map((pos,i) => (
          <div key={i} style={{ position: "absolute", ...pos, fontSize: 18, color: GOLD, opacity: 0.6, lineHeight: 1, zIndex: 2 }}>◆</div>
        ))}

        {/* Top colour bar */}
        <div style={{ height: 6, background: `linear-gradient(90deg,${GREEN},${BLUE},${GREEN})`, position: "relative", zIndex: 2 }} />

        {/* ── All content above the watermark ── */}
        <div style={{ position: "relative", zIndex: 2 }}>

          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "20px 54px 0" }}>
            <div>
              <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 2, color: "#7a6a40", textTransform: "uppercase" }}>Certificate No.</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: BLUE, marginTop: 2 }}>{no}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <img src={LOGO_URL} alt="TapasHub" width={64} height={64} style={{ objectFit: "contain", display: "block", margin: "0 auto" }} />
              <div style={{ marginTop: 4 }}>
                <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: INK }}>TAPAS</span>
                <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: BLUE, marginLeft: 4 }}>HUB</span>
              </div>
              <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: 3, color: "#9a8a60", marginTop: 1 }}>CONNECT · EMPOWER · GROW</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 2, color: "#7a6a40", textTransform: "uppercase" }}>Date of Issue</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginTop: 2 }}>{dateStr}</div>
            </div>
          </div>

          {/* Gold divider */}
          <div style={{ margin: "10px 54px 0", height: 1, background: `linear-gradient(90deg,transparent,${GOLD},transparent)` }} />

          {/* Title */}
          <div style={{ textAlign: "center", margin: "14px 0 10px" }}>
            <div style={{ display: "inline-block", padding: "4px 18px", borderTop: `2px solid ${BLUE}`, borderBottom: `2px solid ${BLUE}` }}>
              <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: INK }}>SHARE </span>
              <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: BLUE }}>CERTIFICATE</span>
            </div>
          </div>

          {/* Certify + holder */}
          <div style={{ textAlign: "center", padding: "0 54px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#7a6a40", textTransform: "uppercase", marginBottom: 8 }}>
              This is to certify that
            </div>
            <div style={{ fontSize: 34, color: INK, borderBottom: `1px dashed ${GOLD}`, paddingBottom: 6, marginBottom: 10 }}>
              {data.holderName}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.8, color: "#4a3a1a" }}>
              is the registered shareholder of{" "}
              <span style={{ color: BLUE, fontWeight: 700 }}>{data.companyName.toUpperCase()}</span>
              {" "}and is hereby allotted the fully paid-up equity shares of the Company
              {ownershipPct && (
                <>, <br/>holding <span style={{ fontWeight: 700, color: INK }}>{ownershipPct}%</span> equity ownership,</>
              )}
              <br/>subject to the Memorandum and Articles of Association of the Company.
            </div>
          </div>

          {/* Share details grid */}
          <div style={{ margin: "14px 54px", border: `1.5px solid ${GOLD}`, borderRadius: 6, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", background: "rgba(255,252,220,0.6)" }}>
            {[
              { label: "NUMBER OF SHARES", value: data.shares.toLocaleString("en-IN"), sub: numToWords(data.shares) },
              { label: "TYPE OF SHARES",   value: shareType, sub: "", blue: true },
              { label: "FACE VALUE",       value: inr(faceValue), sub: inrWords(faceValue) },
              { label: "TOTAL VALUE",      value: inr(totalVal),  sub: inrWords(totalVal) },
            ].map((col, i) => (
              <div key={i} style={{ textAlign: "center", padding: "12px 8px", borderRight: i < 3 ? `1px solid ${GOLD}` : "none" }}>
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: "#7a6a40", textTransform: "uppercase", marginBottom: 4 }}>{col.label}</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: col.blue ? BLUE : INK }}>{col.value}</div>
                {col.sub && <div style={{ fontSize: 7.5, color: "#8a7a50", marginTop: 2 }}>{col.sub}</div>}
              </div>
            ))}
          </div>

          {/* Gold divider */}
          <div style={{ margin: "0 54px", height: 1, background: `linear-gradient(90deg,transparent,${GOLD},transparent)` }} />

          {/* Seal + approval */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 48, padding: "10px 64px 18px" }}>
            <ApprovedSeal size={108} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, color: BLUE, borderBottom: `1.5px solid ${GOLD}`, paddingBottom: 4, marginBottom: 6 }}>
                TapasHub Team
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: INK, textTransform: "uppercase" }}>
                APPROVED BY TAPASHUB TEAM
              </div>
              <div style={{ fontSize: 9, color: "#7a6a40", marginTop: 2 }}>Official Approval</div>
            </div>
          </div>

        </div>{/* end content wrapper */}

        {/* Footer */}
        <div style={{ background: "rgba(26,107,60,0.08)", borderTop: `1px solid ${GOLD}`, textAlign: "center", padding: "7px 36px", position: "relative", zIndex: 2 }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 2.5, color: "#7a6a40", textTransform: "uppercase" }}>
            THANK YOU FOR BEING A VALUED PART OF OUR JOURNEY. · TAPASHUB.COM
          </div>
        </div>

        {/* Bottom colour bar */}
        <div style={{ height: 6, background: `linear-gradient(90deg,${GREEN},${BLUE},${GREEN})`, position: "relative", zIndex: 2 }} />
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
