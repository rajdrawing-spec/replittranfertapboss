/**
 * ShareCertificate — printable share certificate
 * Signed and approved by the TapasHub Share Team.
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
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`
const inrWords = (n: number) => numToWords(Math.round(n)) + " RUPEES ONLY"

function certNo(id: number, date: Date) {
  return `TAPAB/SH/${date.getFullYear()}/${String(id).padStart(5, "0")}`
}

// ── TapasHub triangle logo ────────────────────────────────────────────────────
function TapasHubLogo({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M40 5 L74 65 L6 65 Z" fill="#1a1a2e"/>
      <path d="M40 24 L57 55 L23 55 Z" fill="white"/>
      <circle cx="40" cy="36" r="7" fill="#1a1a2e"/>
    </svg>
  )
}

// ── Approved seal ─────────────────────────────────────────────────────────────
function ApprovedSeal({ size = 110 }: { size?: number }) {
  const r = size / 2
  const innerR = r - 14
  const textR  = r - 10
  // arc path for curved text
  const arcPath = `M ${r},${r} m -${textR},0 a ${textR},${textR} 0 1,1 ${2 * textR},0`
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer ring */}
      <circle cx={r} cy={r} r={r - 2} stroke="#1d90e8" strokeWidth="3" fill="#f0f7ff"/>
      {/* Dashed inner ring */}
      <circle cx={r} cy={r} r={innerR} stroke="#1d90e8" strokeWidth="1.2" strokeDasharray="4 3" fill="white"/>

      {/* Arc text: APPROVED · TAPASHUB · */}
      <path id="seal-top-arc" d={arcPath} fill="none"/>
      <text fontSize={size * 0.105} fontFamily="Arial, sans-serif" fontWeight="800" fill="#1d90e8" letterSpacing="1.5">
        <textPath href="#seal-top-arc" startOffset="5%">APPROVED · TAPASHUB ·</textPath>
      </text>

      {/* Inner logo */}
      <g transform={`translate(${r - 14}, ${r - 18})`}>
        <path d="M14 2 L26 23 L2 23 Z" fill="#1a1a2e"/>
        <path d="M14 9 L20 20 L8 20 Z" fill="white"/>
        <circle cx="14" cy="13" r="3" fill="#1a1a2e"/>
      </g>

      {/* SHARE TEAM */}
      <text x={r} y={r + 16} textAnchor="middle" fontSize={size * 0.115} fontFamily="Arial, sans-serif" fontWeight="900" fill="#1a1a2e">SHARE TEAM</text>

      {/* Stars bottom */}
      <text x={r} y={r + 30} textAnchor="middle" fontSize={size * 0.09} fontFamily="Arial, sans-serif" fill="#1d90e8" letterSpacing="2">★ ★ ★</text>
    </svg>
  )
}

// ── Certificate body (printable) ──────────────────────────────────────────────
function CertificateBody({ data }: { data: ShareCertificateData }) {
  const issueDate = data.joinedDate ? new Date(data.joinedDate) : new Date()
  const no        = certNo(data.id, issueDate)
  const dateStr   = issueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
  const shareType = data.shareType ?? "EQUITY SHARES"
  const faceValue = data.sharePrice ?? 10
  const totalVal  = data.investmentAmount ?? (data.shares * faceValue)

  return (
    <div id="share-cert-root" style={{
      width: "794px",
      background: "white",
      fontFamily: "Arial, Helvetica, sans-serif",
      color: "#1a1a2e",
      border: "2.5px solid #1d90e8",
      borderRadius: "6px",
      overflow: "hidden",
      position: "relative",
    }}>

      {/* Top gradient bar */}
      <div style={{ height: 6, background: "linear-gradient(90deg, #1a1a2e, #1d90e8, #1a1a2e)" }} />

      {/* Corner triangles */}
      {([
        { pos: { top: 0,    left: 0   } as React.CSSProperties, rotate: 0 },
        { pos: { top: 0,    right: 0  } as React.CSSProperties, rotate: 90 },
        { pos: { bottom: 0, right: 0  } as React.CSSProperties, rotate: 180 },
        { pos: { bottom: 0, left: 0   } as React.CSSProperties, rotate: 270 },
      ]).map((corner, i) => (
        <div key={i} style={{ position: "absolute", width: 48, height: 48, overflow: "hidden", ...corner.pos }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none"
            style={{ transform: `rotate(${corner.rotate}deg)` }}>
            <path d="M0 0 L48 0 L0 48 Z" fill="#1a1a2e" opacity="0.8"/>
          </svg>
        </div>
      ))}

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 44px 0" }}>
        {/* Cert no */}
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Certificate No.</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1d90e8", marginTop: 2, fontFamily: "monospace" }}>{no}</div>
        </div>

        {/* Logo + wordmark */}
        <div style={{ textAlign: "center" }}>
          <TapasHubLogo size={60} />
          <div style={{ marginTop: 5 }}>
            <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: "#1a1a2e" }}>TAPAS</span>
            <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: "#1d90e8", marginLeft: 4 }}>HUB</span>
          </div>
          <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: 3, color: "#aaa", marginTop: 1 }}>CONNECT · EMPOWER · GROW</div>
        </div>

        {/* Date */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Date of Issue</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1a1a2e", marginTop: 2 }}>{dateStr}</div>
        </div>
      </div>

      {/* ── Title ── */}
      <div style={{ textAlign: "center", margin: "16px 0 12px" }}>
        <div style={{ display: "inline-block", padding: "4px 0", borderTop: "2px solid #1d90e8", borderBottom: "2px solid #1d90e8" }}>
          <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: 4, color: "#1a1a2e" }}>SHARE </span>
          <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: 4, color: "#1d90e8" }}>CERTIFICATE</span>
        </div>
      </div>

      {/* ── Certify + holder ── */}
      <div style={{ textAlign: "center", padding: "0 44px" }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 2, color: "#666", textTransform: "uppercase", marginBottom: 8 }}>
          This is to certify that
        </div>
        <div style={{
          fontSize: 32, fontFamily: "Georgia, 'Times New Roman', serif",
          fontStyle: "italic", color: "#1a1a2e",
          borderBottom: "1px dashed #bbb", paddingBottom: 6, marginBottom: 10,
        }}>
          {data.holderName}
        </div>
        <div style={{ fontSize: 10.5, lineHeight: 1.8, color: "#444" }}>
          is the registered shareholder of{" "}
          <span style={{ color: "#1d90e8", fontWeight: 700 }}>{data.companyName.toUpperCase()}</span>
          {" "}and is hereby allotted the fully paid-up equity shares of the Company
          <br/>subject to the Memorandum and Articles of Association of the Company.
        </div>
      </div>

      {/* ── Share details grid ── */}
      <div style={{
        margin: "16px 44px",
        border: "1.5px solid #1d90e8",
        borderRadius: 8,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
      }}>
        {[
          { label: "NUMBER OF SHARES", value: data.shares.toLocaleString("en-IN"), sub: numToWords(data.shares) },
          { label: "TYPE OF SHARES",   value: shareType,                            sub: "",        blue: true },
          { label: "FACE VALUE",       value: inr(faceValue),                       sub: inrWords(faceValue) },
          { label: "TOTAL VALUE",      value: inr(totalVal),                        sub: inrWords(totalVal) },
        ].map((col, i) => (
          <div key={i} style={{
            textAlign: "center", padding: "12px 8px",
            borderRight: i < 3 ? "1px solid #1d90e8" : "none",
          }}>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: "#888", textTransform: "uppercase", marginBottom: 4 }}>{col.label}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: col.blue ? "#1d90e8" : "#1a1a2e" }}>{col.value}</div>
            {col.sub && <div style={{ fontSize: 7.5, color: "#888", marginTop: 2 }}>{col.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Signature + Seal row ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        padding: "4px 64px 16px",
        gap: 24,
      }}>
        {/* Left: Signed by TapasHub Share Team */}
        <div style={{ textAlign: "center" }}>
          {/* Signature flourish */}
          <div style={{
            fontSize: 26,
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: "#1a1a2e",
            letterSpacing: 1,
            borderBottom: "1.5px solid #bbb",
            paddingBottom: 4,
            marginBottom: 6,
          }}>
            TapasHub Share Team
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 2, color: "#1a1a2e", textTransform: "uppercase" }}>
            SIGNED BY TAPASHUB SHARE TEAM
          </div>
          <div style={{ fontSize: 8.5, color: "#666", marginTop: 2 }}>Authorised Signatory</div>
        </div>

        {/* Centre: Approved seal */}
        <div style={{ textAlign: "center" }}>
          <ApprovedSeal size={108} />
        </div>

        {/* Right: Approved by TapasHub Team */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: 26,
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: "#1d90e8",
            letterSpacing: 1,
            borderBottom: "1.5px solid #bbb",
            paddingBottom: 4,
            marginBottom: 6,
          }}>
            TapasHub Team
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 2, color: "#1a1a2e", textTransform: "uppercase" }}>
            APPROVED BY TAPASHUB TEAM
          </div>
          <div style={{ fontSize: 8.5, color: "#666", marginTop: 2 }}>Official Approval</div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ background: "#f0f7ff", borderTop: "1px solid #c8dff8", textAlign: "center", padding: "8px 36px" }}>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>
          Thank you for being a valued part of our journey. · tapashub.com
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ height: 6, background: "linear-gradient(90deg, #1a1a2e, #1d90e8, #1a1a2e)" }} />
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

          {/* Certificate preview */}
          <div className="flex justify-center p-6 print:p-0 bg-gray-100 print:bg-white">
            <CertificateBody data={data} />
          </div>

          <div className="text-center text-xs text-muted-foreground pb-4 print:hidden">
            Click "Print / Save PDF" to download as a PDF document.
          </div>
        </DialogContent>
      </Dialog>

      {/* Print styles — visibility trick so Radix portal (direct body child) stays visible */}
      <style>{`
        @media print {
          body { visibility: hidden !important; }
          #share-cert-root,
          #share-cert-root * { visibility: visible !important; }
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
