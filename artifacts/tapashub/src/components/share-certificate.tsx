/**
 * ShareCertificate — beautiful printable share certificate
 * matching the TapasHub reference design (TAPAB/SH/YYYY/NNNNN format).
 *
 * Usage: render <ShareCertificate ... /> in a modal, then call window.print().
 * Print-specific styles hide everything except #share-cert-root.
 */
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Printer, X } from "lucide-react"

export interface ShareCertificateData {
  id:                 number
  holderName:         string
  companyName:        string
  shares:             number
  sharePrice:         number        // face value per share
  investmentAmount:   number        // total value
  shareType?:         string        // "EQUITY SHARES" default
  joinedDate?:        string | null // ISO date for "Date of Issue"
}

// number words for "ONE HUNDRED" etc.
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

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`
const inrWords = (n: number) => numToWords(Math.round(n)) + " RUPEES"

function CertNo({ id, date }: { id: number; date: Date }) {
  const y = date.getFullYear()
  const seq = String(id).padStart(5, "0")
  return `TAPAB/SH/${y}/${seq}`
}

// ── SVG Logo ──────────────────────────────────────────────────────────────────
function TapasHubLogo({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M40 5 L74 65 L6 65 Z" fill="#1a1a2e" strokeWidth="0"/>
      <path d="M40 24 L57 55 L23 55 Z" fill="white"/>
      <circle cx="40" cy="36" r="7" fill="#1a1a2e"/>
    </svg>
  )
}

// ── Circular Seal SVG ─────────────────────────────────────────────────────────
function TapasHubSeal({ size = 96 }: { size?: number }) {
  const r = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer ring */}
      <circle cx={r} cy={r} r={r - 2} stroke="#1d90e8" strokeWidth="2.5" fill="white"/>
      <circle cx={r} cy={r} r={r - 8} stroke="#1d90e8" strokeWidth="1.2" fill="none" strokeDasharray="3 2"/>
      {/* Text on arc — TRUST · GROWTH · SUCCESS */}
      <path id="seal-arc" d={`M ${r},${r} m -${r-14},0 a ${r-14},${r-14} 0 1,1 ${2*(r-14)},0`} fill="none"/>
      <text fontSize={size * 0.115} fontFamily="Arial, sans-serif" fontWeight="700" fill="#1d90e8" letterSpacing="2">
        <textPath href="#seal-arc" startOffset="8%">TRUST · GROWTH · SUCCESS</textPath>
      </text>
      {/* Inner logo */}
      <g transform={`translate(${r - 14}, ${r - 13})`}>
        <path d="M14 2 L26 23 L2 23 Z" fill="#1a1a2e"/>
        <path d="M14 9 L20 20 L8 20 Z" fill="white"/>
        <circle cx="14" cy="13" r="3" fill="#1a1a2e"/>
      </g>
      {/* TAPAS HUB text */}
      <text x={r} y={r + 16} textAnchor="middle" fontSize={size * 0.115} fontFamily="Arial, sans-serif" fontWeight="800" fill="#1a1a2e">TAPAS HUB</text>
      {/* EST. 2025 */}
      <text x={r} y={r + 26} textAnchor="middle" fontSize={size * 0.09} fontFamily="Arial, sans-serif" fill="#1d90e8" letterSpacing="1">★ EST. 2025 ★</text>
    </svg>
  )
}

// ── Certificate content (the printable part) ──────────────────────────────────
function CertificateBody({ data }: { data: ShareCertificateData }) {
  const issueDate = data.joinedDate ? new Date(data.joinedDate) : new Date()
  const certNo    = CertNo({ id: data.id, date: issueDate })
  const dateStr   = issueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
  const shareType = data.shareType ?? "EQUITY SHARES"
  const faceValue = data.sharePrice ?? 10
  const totalVal  = data.investmentAmount ?? (data.shares * faceValue)

  return (
    <div id="share-cert-root" style={{
      width: "794px", minHeight: "562px",
      background: "white",
      position: "relative",
      fontFamily: "Arial, Helvetica, sans-serif",
      color: "#1a1a2e",
      overflow: "hidden",
      border: "2.5px solid #1d90e8",
      borderRadius: "4px",
    }}>

      {/* Corner decorations */}
      {([
        { style: { top: 0,    left: 0    } as React.CSSProperties, rotate: 0 },
        { style: { top: 0,    right: 0   } as React.CSSProperties, rotate: 90 },
        { style: { bottom: 0, right: 0   } as React.CSSProperties, rotate: 180 },
        { style: { bottom: 0, left: 0    } as React.CSSProperties, rotate: 270 },
      ] as const).map((pos, i) => (
        <div key={i} style={{
          position: "absolute", width: 52, height: 52, overflow: "hidden", ...pos.style,
        }}>
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none"
            style={{ transform: `rotate(${pos.rotate}deg)` }}>
            <path d="M0 0 L52 0 L0 52 Z" fill="#1a1a2e" opacity="0.85"/>
          </svg>
        </div>
      ))}

      {/* Top thin blue bar */}
      <div style={{ height: 5, background: "linear-gradient(90deg, #1d90e8, #0052a3)", margin: "0 0 0 0" }} />

      {/* Header row: cert no | logo | date */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "18px 36px 0" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>Certificate No.</div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#1d90e8", marginTop: 2, fontFamily: "monospace" }}>{certNo}</div>
        </div>

        {/* Centre: logo + brand */}
        <div style={{ textAlign: "center", flex: 1 }}>
          <TapasHubLogo size={64} />
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: "#1a1a2e", letterSpacing: -0.5 }}>TAPAS</span>
            <span style={{ fontSize: 20, fontWeight: 900, color: "#1d90e8", letterSpacing: -0.5, marginLeft: 4 }}>HUB</span>
          </div>
          <div style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: 3, color: "#888", marginTop: 2 }}>CONNECT · EMPOWER · GROW</div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>Date of Issue</div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#1a1a2e", marginTop: 2 }}>{dateStr}</div>
        </div>
      </div>

      {/* SHARE CERTIFICATE title */}
      <div style={{ textAlign: "center", margin: "14px 0 8px" }}>
        <div style={{ display: "inline-block", borderBottom: "2px solid #1d90e8", borderTop: "2px solid #1d90e8", padding: "3px 0" }}>
          <span style={{ fontSize: 28, fontWeight: 900, color: "#1a1a2e", letterSpacing: 3 }}>SHARE </span>
          <span style={{ fontSize: 28, fontWeight: 900, color: "#1d90e8", letterSpacing: 3 }}>CERTIFICATE</span>
        </div>
      </div>

      {/* Body + seal row */}
      <div style={{ display: "flex", alignItems: "flex-start", padding: "0 36px" }}>
        <div style={{ flex: 1 }}>
          {/* Certify text */}
          <div style={{ textAlign: "center", fontSize: 9.5, fontWeight: 700, letterSpacing: 2, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>
            This is to certify that
          </div>

          {/* Holder name */}
          <div style={{
            textAlign: "center",
            fontSize: 30,
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontStyle: "italic",
            fontWeight: 400,
            color: "#1a1a2e",
            borderBottom: "1px dashed #bbb",
            paddingBottom: 6,
            marginBottom: 10,
            letterSpacing: 0.5,
          }}>
            {data.holderName}
          </div>

          {/* Body text */}
          <div style={{ textAlign: "center", fontSize: 10.5, lineHeight: 1.7, color: "#333" }}>
            is the registered shareholder of{" "}
            <span style={{ color: "#1d90e8", fontWeight: 700 }}>{data.companyName.toUpperCase()}</span>
            <br />
            and is hereby allotted the fully paid-up equity shares of the Company
            <br />
            subject to the Memorandum and Articles of Association of the Company.
          </div>
        </div>

        {/* Seal */}
        <div style={{ marginLeft: 18, marginTop: 4, flexShrink: 0 }}>
          <TapasHubSeal size={88} />
        </div>
      </div>

      {/* Share details box */}
      <div style={{
        margin: "14px 36px",
        border: "1.5px solid #1d90e8",
        borderRadius: 8,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
      }}>
        {[
          {
            icon: (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1d90e8" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
              </svg>
            ),
            label: "NUMBER OF SHARES",
            value: data.shares.toLocaleString("en-IN"),
            sub: `(${numToWords(data.shares)})`,
          },
          {
            icon: (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1d90e8" strokeWidth="2">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
              </svg>
            ),
            label: "TYPE OF SHARES",
            value: shareType,
            sub: "",
            blue: true,
          },
          {
            icon: (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1d90e8" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v2m0 8v2M8.5 9.5C8.5 8.1 10.1 7 12 7s3.5 1.1 3.5 2.5-1.6 2.5-3.5 2.5-3.5 1.1-3.5 2.5S9.9 17 12 17s3.5-1.1 3.5-2.5"/>
              </svg>
            ),
            label: "FACE VALUE",
            value: inr(faceValue),
            sub: `(${inrWords(faceValue)})`,
          },
          {
            icon: (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1d90e8" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
              </svg>
            ),
            label: "TOTAL VALUE",
            value: inr(totalVal),
            sub: `(${inrWords(totalVal)})`,
          },
        ].map((col, i) => (
          <div key={i} style={{
            textAlign: "center", padding: "10px 6px",
            borderRight: i < 3 ? "1px solid #1d90e8" : "none",
          }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>{col.icon}</div>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: "#888", textTransform: "uppercase", marginBottom: 3 }}>{col.label}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: col.blue ? "#1d90e8" : "#1a1a2e" }}>{col.value}</div>
            {col.sub && <div style={{ fontSize: 8, color: "#888", marginTop: 1 }}>{col.sub}</div>}
          </div>
        ))}
      </div>

      {/* Signatures row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "4px 56px 10px", gap: 16 }}>
        {/* Left signature */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontFamily: "Georgia, serif", fontStyle: "italic", color: "#1a1a2e", borderBottom: "1.5px solid #bbb", paddingBottom: 2, marginBottom: 4 }}>
            Harish Sainoju
          </div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "#1a1a2e", textTransform: "uppercase" }}>HARISH SAINOJU</div>
          <div style={{ fontSize: 9, color: "#666", marginTop: 1 }}>Managing Director</div>
        </div>

        {/* Centre emblem */}
        <div style={{ textAlign: "center" }}>
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="26" cy="26" r="24" stroke="#1d90e8" strokeWidth="2" fill="white"/>
            <circle cx="26" cy="26" r="18" stroke="#1a1a2e" strokeWidth="1.5" fill="none"/>
            <path d="M26 10 L40 34 L12 34 Z" fill="#1a1a2e"/>
            <path d="M26 20 L33 33 L19 33 Z" fill="white"/>
            <circle cx="26" cy="24" r="4" fill="#1a1a2e"/>
            {/* Small stars / laurels */}
            {[0,60,120,180,240,300].map((deg, i) => (
              <circle key={i} cx={26 + 20 * Math.cos((deg - 90) * Math.PI / 180)}
                cy={26 + 20 * Math.sin((deg - 90) * Math.PI / 180)} r="1.5" fill="#1d90e8"/>
            ))}
          </svg>
        </div>

        {/* Right signature */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontFamily: "Georgia, serif", fontStyle: "italic", color: "#1a1a2e", borderBottom: "1.5px solid #bbb", paddingBottom: 2, marginBottom: 4 }}>
            Hari Nancharla
          </div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "#1a1a2e", textTransform: "uppercase" }}>HARI NANCHARLA</div>
          <div style={{ fontSize: 9, color: "#666", marginTop: 1 }}>Director</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0", textAlign: "center", padding: "7px 36px" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>
          Thank you for being a valued part of our journey.
        </div>
      </div>

      {/* Bottom blue bar */}
      <div style={{ height: 5, background: "linear-gradient(90deg, #1d90e8, #0052a3)" }} />
    </div>
  )
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
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent
          className="p-0 overflow-hidden max-w-[880px] bg-gray-100"
          style={{ maxHeight: "92vh", overflowY: "auto" }}
        >
          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-3 bg-white border-b print:hidden">
            <div>
              <div className="font-semibold text-sm">Share Certificate</div>
              <div className="text-xs text-muted-foreground">{data.holderName} · {data.companyName}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => window.print()}
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

          {/* Certificate */}
          <div className="flex justify-center p-6 print:p-0 bg-gray-100 print:bg-white">
            <CertificateBody data={data} />
          </div>

          <div className="text-center text-xs text-muted-foreground pb-4 print:hidden">
            Click "Print / Save PDF" to save as a PDF document.
          </div>
        </DialogContent>
      </Dialog>

      {/* Print styles — use visibility trick so the Radix dialog portal (a direct body child)
           is never hidden by an ancestor display:none that would suppress its subtree. */}
      <style>{`
        @media print {
          /* Hide everything via visibility so descendants can opt back in */
          body { visibility: hidden !important; }

          /* The certificate root and all its children become visible */
          #share-cert-root,
          #share-cert-root * {
            visibility: visible !important;
          }

          /* Place the certificate at the top-left of the printed page */
          #share-cert-root {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </>
  )
}
