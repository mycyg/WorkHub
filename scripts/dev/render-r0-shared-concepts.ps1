param(
  [string]$Root = (Resolve-Path ".").Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$assetRoot = Join-Path $Root "docs\workhub\05-clients\assets"
$sharedRoot = Join-Path $assetRoot "shared"
$hijikiPath = Join-Path $assetRoot "audit\2026-06-08-cuu-live2d-model-preview\hijiki\pet-hijiki-live2d-model-cdp-frame-1600.png"
$tororoPath = Join-Path $assetRoot "audit\2026-06-08-cuu-live2d-model-preview\tororo\pet-tororo-live2d-model-cdp-frame-1600.png"

if (-not (Test-Path -LiteralPath $hijikiPath)) { throw "Missing Hijiki frame: $hijikiPath" }
if (-not (Test-Path -LiteralPath $tororoPath)) { throw "Missing Tororo frame: $tororoPath" }

$script:Hijiki = [System.Drawing.Image]::FromFile($hijikiPath)
$script:Tororo = [System.Drawing.Image]::FromFile($tororoPath)

function Color-Hex([string]$hex) {
  $text = $hex.TrimStart("#")
  if ($text.Length -eq 6) {
    return [System.Drawing.Color]::FromArgb(
      [Convert]::ToInt32($text.Substring(0, 2), 16),
      [Convert]::ToInt32($text.Substring(2, 2), 16),
      [Convert]::ToInt32($text.Substring(4, 2), 16)
    )
  }
  if ($text.Length -eq 8) {
    # Accept RRGGBBAA because callers append alpha to ordinary web hex colors.
    return [System.Drawing.Color]::FromArgb(
      [Convert]::ToInt32($text.Substring(6, 2), 16),
      [Convert]::ToInt32($text.Substring(0, 2), 16),
      [Convert]::ToInt32($text.Substring(2, 2), 16),
      [Convert]::ToInt32($text.Substring(4, 2), 16)
    )
  }
  throw "Unsupported color: $hex"
}

function New-Font([float]$size, [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular) {
  return [System.Drawing.Font]::new("Arial", $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

function New-Canvas([int]$width = 1600, [int]$height = 1000) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $graphics.Clear([System.Drawing.Color]::White)
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Path-RoundRect([System.Drawing.RectangleF]$rect, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-RoundRect($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r, [string]$fill, [string]$stroke = "#D7DEE9") {
  $rect = [System.Drawing.RectangleF]::new($x, $y, $w, $h)
  $path = Path-RoundRect $rect $r
  $brush = [System.Drawing.SolidBrush]::new((Color-Hex $fill))
  $pen = [System.Drawing.Pen]::new((Color-Hex $stroke), 1.4)
  $g.FillPath($brush, $path)
  $g.DrawPath($pen, $path)
  $brush.Dispose()
  $pen.Dispose()
  $path.Dispose()
}

function Draw-Text($g, [string]$text, [float]$size, [string]$color, [float]$x, [float]$y, [float]$w, [float]$h, [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular, [string]$align = "Near") {
  $font = New-Font $size $style
  $brush = [System.Drawing.SolidBrush]::new((Color-Hex $color))
  $format = [System.Drawing.StringFormat]::new()
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $format.Alignment = [System.Drawing.StringAlignment]::$align
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
  $g.DrawString($text, $font, $brush, [System.Drawing.RectangleF]::new($x, $y, $w, $h), $format)
  $format.Dispose()
  $brush.Dispose()
  $font.Dispose()
}

function Draw-LineArrow($g, [float]$x1, [float]$y1, [float]$x2, [float]$y2, [string]$color = "#2563EB") {
  $pen = [System.Drawing.Pen]::new((Color-Hex $color), 2.4)
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::ArrowAnchor
  $g.DrawLine($pen, $x1, $y1, $x2, $y2)
  $pen.Dispose()
}

function Draw-Header($g, [string]$title, [string]$subtitle) {
  Fill-RoundRect $g 32 20 76 76 16 "#15264D" "#15264D"
  Draw-Text $g "WH" 24 "#FFFFFF" 32 40 76 40 ([System.Drawing.FontStyle]::Bold) "Center"
  Draw-Text $g $title 46 "#0F1B3D" 126 28 1180 60 ([System.Drawing.FontStyle]::Bold)
  Draw-Text $g $subtitle 21 "#63708A" 128 84 1180 42
  Draw-Text $g "WorkHub" 26 "#0F1B3D" 1370 44 170 40 ([System.Drawing.FontStyle]::Bold)
}

function Draw-SectionTitle($g, [string]$title, [float]$x, [float]$y, [float]$w, [string]$accent = "#2563EB") {
  Fill-RoundRect $g $x $y 34 34 10 $accent $accent
  Draw-Text $g $title 22 "#0F1B3D" ($x + 48) ($y + 2) ($w - 48) 34 ([System.Drawing.FontStyle]::Bold)
}

function Draw-Card($g, [string]$title, [string]$body, [float]$x, [float]$y, [float]$w, [float]$h, [string]$accent = "#2563EB", [string]$fill = "#FFFFFF") {
  Fill-RoundRect $g $x $y $w $h 14 $fill "#D7DEE9"
  Fill-RoundRect $g ($x + 18) ($y + 18) 44 44 12 ($accent + "18") ($accent + "55")
  Draw-Text $g $title 19 "#17213C" ($x + 78) ($y + 18) ($w - 96) 28 ([System.Drawing.FontStyle]::Bold)
  Draw-Text $g $body 15 "#63708A" ($x + 78) ($y + 48) ($w - 96) ($h - 56)
}

function Draw-Pill($g, [string]$text, [float]$x, [float]$y, [string]$fill, [string]$color = "#17213C") {
  $w = 30 + ($text.Length * 9.4)
  Fill-RoundRect $g $x $y $w 28 12 $fill $fill
  Draw-Text $g $text 13 $color ($x + 9) ($y + 5) ($w - 18) 20 ([System.Drawing.FontStyle]::Bold) "Center"
}

function Draw-CroppedCat($g, [System.Drawing.Image]$img, [float]$x, [float]$y, [float]$w, [float]$h) {
  $src = [System.Drawing.RectangleF]::new($img.Width * 0.12, $img.Height * 0.27, $img.Width * 0.76, $img.Height * 0.58)
  $dest = [System.Drawing.RectangleF]::new($x, $y, $w, $h)
  $g.DrawImage($img, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
}

function Draw-CatWindow($g, [System.Drawing.Image]$img, [float]$x, [float]$y, [float]$w, [float]$h, [string]$label, [string]$caption) {
  Fill-RoundRect $g $x $y $w $h 16 "#FFFFFF" "#D7DEE9"
  Fill-RoundRect $g ($x + 16) ($y + 16) ($w - 32) 36 10 "#F8FAFC" "#E2E8F0"
  Draw-Text $g $label 15 "#0F1B3D" ($x + 28) ($y + 24) ($w - 56) 22 ([System.Drawing.FontStyle]::Bold)
  Draw-CroppedCat $g $img ($x + ($w * 0.15)) ($y + 56) ($w * 0.7) ($h - 98)
  Draw-Text $g $caption 14 "#63708A" ($x + 20) ($y + $h - 42) ($w - 40) 24
}

function Draw-SmallCat($g, [System.Drawing.Image]$img, [float]$x, [float]$y, [float]$w, [float]$h) {
  Draw-CroppedCat $g $img $x $y $w $h
}

function Save-Canvas($canvas, [string]$path) {
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Dispose()
}

function Render-RuntimeConcept {
  $c = New-Canvas 1600 1000
  $g = $c.Graphics
  Draw-Header $g "WorkHub TS-first Runtime" "TypeScript-first, AI-native product architecture after R0 review correction"

  Fill-RoundRect $g 34 132 360 740 20 "#F8FBFF" "#9DB7F5"
  Draw-SectionTitle $g "Client surfaces" 58 154 300 "#2563EB"
  Draw-Card $g "Web app" "React browser UI. Serious work surface; no Cuu body." 62 218 302 118 "#2563EB"
  Draw-Card $g "Tauri webview" "Desktop main window for one decision, evidence, settings." 62 362 302 118 "#0EA5A3"
  Draw-Card $g "Rust shell" "Tray, notifications, local sync, device token, pet window." 62 506 302 118 "#334155"
  Draw-CatWindow $g $script:Hijiki 62 650 302 184 "Cuu pet window" "Independent transparent window"

  Fill-RoundRect $g 512 132 620 740 20 "#FBFAFF" "#B8A7F0"
  Draw-SectionTitle $g "TypeScript core" 540 154 540 "#6D5BD0"
  Draw-Card $g "apps/api" "Hono daemon. OpenAPI, auth, routes, SSE." 552 218 490 82 "#6D5BD0"
  Draw-Card $g "contracts" "Page VM, CuuState, schemas, errors." 552 326 230 86 "#6D5BD0"
  Draw-Card $g "events" "Typed WorkHubEvent and lifecycle routing." 806 326 230 86 "#0EA5A3"
  Draw-Card $g "agent" "AgentLoop, manifest builder, replay trace." 552 438 230 86 "#2563EB"
  Draw-Card $g "tools" "ToolRegistry, snapshot gate, sandbox hooks." 806 438 230 86 "#334155"
  Draw-Card $g "proposals" "Manifest -> review -> merge." 552 550 230 86 "#7C3AED"
  Draw-Card $g "approvals" "Policy ask/deny/allow, approver routing." 806 550 230 86 "#E11D48"
  Draw-Card $g "cost" "UsageRecord, BudgetDecision, ledger." 552 662 230 86 "#0F766E"
  Draw-Card $g "Cuu adapters" "CuuState, AttentionItem, pet card bridge." 806 662 230 86 "#475569"

  Fill-RoundRect $g 1210 132 348 740 20 "#F8FFFD" "#A4D9CE"
  Draw-SectionTitle $g "Infrastructure" 1236 154 292 "#0F766E"
  Draw-Card $g "PostgreSQL" "Primary state: work items, runs, proposals, audit." 1240 218 288 110 "#0F766E"
  Draw-Card $g "Redis" "Broker, presence, future multi-worker event fanout." 1240 354 288 110 "#DC2626"
  Draw-Card $g "Object storage" "Files, generated deliverables, screenshots." 1240 490 288 110 "#0F766E"
  Draw-Card $g "Optional worker" "Document jobs and external processing only." 1240 626 288 110 "#D97706"

  Draw-LineArrow $g 394 274 512 274 "#2563EB"
  Draw-LineArrow $g 394 418 512 418 "#0EA5A3"
  Draw-LineArrow $g 394 562 512 562 "#334155"
  Draw-LineArrow $g 394 736 512 736 "#0F766E"
  Draw-LineArrow $g 1132 270 1210 270 "#2563EB"
  Draw-LineArrow $g 1132 405 1210 405 "#DC2626"
  Draw-LineArrow $g 1132 542 1210 542 "#0F766E"

  Fill-RoundRect $g 46 902 1508 58 16 "#FFFFFF" "#D7DEE9"
  Draw-Pill $g "REST / OpenAPI" 76 916 "#EAF1FF" "#1D4ED8"
  Draw-Pill $g "SSE / WorkHubEvent" 244 916 "#E7F8F3" "#047857"
  Draw-Pill $g "DB" 448 916 "#F3E8FF" "#6D5BD0"
  Draw-Pill $g "Pub/Sub" 520 916 "#FEE2E2" "#B91C1C"
  Draw-Text $g "R0: main windows stay serious; Cuu lives only in the independent pet window." 16 "#63708A" 680 918 820 28

  Save-Canvas $c (Join-Path $sharedRoot "ts-first-runtime-concept.png")
}

function Render-EndpointAlignment {
  $c = New-Canvas 1600 1040
  $g = $c.Graphics
  Draw-Header $g "WorkHub Endpoint -> Page -> Cuu Alignment" "Backend endpoint, returned payload, serious page, and independent CuuState are mapped separately."

  $headers = @(
    @{ t = "Module"; x = 36; w = 220; c = "#6D5BD0" },
    @{ t = "Endpoint"; x = 286; w = 260; c = "#2563EB" },
    @{ t = "Return payload"; x = 586; w = 260; c = "#0F766E" },
    @{ t = "Page / surface"; x = 886; w = 280; c = "#2563EB" },
    @{ t = "CuuState / pet"; x = 1210; w = 330; c = "#475569" }
  )
  foreach ($h in $headers) {
    Fill-RoundRect $g $h.x 140 $h.w 64 14 ($h.c + "14") ($h.c + "55")
    Draw-Text $g $h.t 20 "#0F1B3D" ($h.x + 22) 160 ($h.w - 44) 28 ([System.Drawing.FontStyle]::Bold) "Center"
  }

  $rows = @(
    @("Clarify", "/api/sessions", "QuestionCard", "Option wizard", "asking_approval", "Options in pet bubble"),
    @("Approval", "/api/permissions/ask", "AttentionItem", "Approval center", "asking_approval", "Approve / reject / open"),
    @("Proposal", "/api/proposals/:id", "DeliverableChangeManifest", "Proposal detail", "carrying_document", "PR-like summary"),
    @("Knowledge", "/api/knowledge/search", "EvidenceBubble", "Evidence panel", "searching_evidence", "Find files / cite sources"),
    @("Sync", "/api/sync/conflicts", "ConflictChoice", "Conflict resolver", "syncing_files", "Resolve or deep-link"),
    @("Agent run", "/api/agent-runs/:id", "ReplayTraceVM", "Live trace", "thinking", "Status cards")
  )

  for ($i = 0; $i -lt $rows.Count; $i++) {
    $y = 224 + ($i * 126)
    Fill-RoundRect $g 36 $y 220 96 14 "#FFFFFF" "#D7DEE9"
    Draw-Text $g $rows[$i][0] 22 "#17213C" 70 ($y + 31) 160 32 ([System.Drawing.FontStyle]::Bold)
    Fill-RoundRect $g 286 $y 260 96 14 "#FFFFFF" "#D7DEE9"
    Draw-Text $g $rows[$i][1] 21 "#0B3B8F" 306 ($y + 31) 220 32 ([System.Drawing.FontStyle]::Bold) "Center"
    Fill-RoundRect $g 586 $y 260 96 14 "#F8FFFD" "#D7EEE8"
    Draw-Text $g $rows[$i][2] 20 "#0F5C4B" 606 ($y + 31) 220 32 ([System.Drawing.FontStyle]::Bold) "Center"
    Fill-RoundRect $g 886 $y 280 96 14 "#F8FBFF" "#D7DEE9"
    Draw-Text $g $rows[$i][3] 20 "#17213C" 908 ($y + 28) 236 42 ([System.Drawing.FontStyle]::Bold) "Center"
    Fill-RoundRect $g 1210 $y 330 96 14 "#FFFFFF" "#D7DEE9"
    $cat = if ($i % 2 -eq 0) { $script:Hijiki } else { $script:Tororo }
    Draw-SmallCat $g $cat 1220 ($y + 16) 76 76
    Draw-Text $g $rows[$i][4] 17 "#17213C" 1306 ($y + 20) 204 24 ([System.Drawing.FontStyle]::Bold)
    Draw-Text $g $rows[$i][5] 14 "#63708A" 1306 ($y + 48) 206 30
    Draw-LineArrow $g 256 ($y + 48) 286 ($y + 48) "#2563EB"
    Draw-LineArrow $g 546 ($y + 48) 586 ($y + 48) "#2563EB"
    Draw-LineArrow $g 846 ($y + 48) 886 ($y + 48) "#2563EB"
    Draw-LineArrow $g 1166 ($y + 48) 1210 ($y + 48) "#2563EB"
  }

  Fill-RoundRect $g 46 976 1508 44 14 "#FFFFFF" "#D7DEE9"
  Draw-Text $g "Rule: CuuState mirrors context in the pet window. Page / surface never means embedding Cuu body into the main window." 16 "#63708A" 70 988 1460 22
  Save-Canvas $c (Join-Path $sharedRoot "endpoint-page-cuu-alignment.png")
}

function Render-GapMap {
  $c = New-Canvas 1600 900
  $g = $c.Graphics
  Draw-Header $g "WorkHub PRD / Concept Reproduction Gap Map" "Current main after Claude review intake: real slices landed, remaining gaps stay explicit."

  $cols = @(
    @{ title = "1. Built foundation"; x = 40; c = "#2563EB"; fill = "#F8FBFF"; items = @(
      "TS contracts and Page VMs",
      "PostgreSQL migrations",
      "Auth, permissions, audit, snapshots",
      "Provider single exit and budget checks",
      "DB-backed Proposal review / merge",
      "R1 PG smoke: run -> proposal -> merge -> replay"
    ) },
    @{ title = "2. Partial real slices"; x = 510; c = "#0F766E"; fill = "#F8FFFD"; items = @(
      "AgentRun write-through DB, but queue claim still in-process",
      "Gold-path fixture moved out of production routes",
      "Cuu black / white Live2D runtime exists",
      "Rust pet window and settings recovery exist",
      "Web surfaces exist, but still need true data breadth"
    ) },
    @{ title = "3. Still missing"; x = 980; c = "#DC2626"; fill = "#FFFBFB"; items = @(
      "sessions / workitems / knowledge / workitem page services",
      "CostLedger default persistence",
      "PG SKIP LOCKED queue claim and multi-worker pump",
      "Full approval center, physical merge, conflict resolution",
      "Cuu outbound Agent entry (FR-PET-002)",
      "Web four states, i18n coverage, cross-platform packaging",
      "Commercial authorization or original replacement model"
    ) }
  )

  foreach ($col in $cols) {
    Fill-RoundRect $g $col.x 148 430 650 20 $col.fill "#D7DEE9"
    Draw-SectionTitle $g $col.title ($col.x + 24) 174 370 $col.c
    $y = 246
    foreach ($item in $col.items) {
      Fill-RoundRect $g ($col.x + 28) $y 374 62 14 "#FFFFFF" "#E2E8F0"
      Fill-RoundRect $g ($col.x + 46) ($y + 18) 28 28 9 ($col.c + "18") ($col.c + "44")
      Draw-Text $g $item 16 "#17213C" ($col.x + 88) ($y + 15) 300 36
      $y += 78
    }
  }

  Draw-CatWindow $g $script:Hijiki 1198 614 178 162 "Hijiki" "default"
  Draw-CatWindow $g $script:Tororo 1382 614 178 162 "Tororo" "option"
  Fill-RoundRect $g 44 818 1512 46 14 "#FFFFFF" "#D7DEE9"
  Draw-Text $g "R0 correction: old orange screenshots are failure evidence; current concept assets use black / white Live2D and keep Cuu outside main windows." 16 "#63708A" 70 830 1460 24

  Save-Canvas $c (Join-Path $sharedRoot "prd-concept-gap-map.png")
}

function Render-ComponentAtlas {
  $c = New-Canvas 1600 1000
  $g = $c.Graphics
  Draw-Header $g "WorkHub Component Atlas" "Shared UI components after R0 boundary correction. Main-window components stay serious; pet components are separate."

  $cards = @(
    @("One Thing Card", "A single work item needing attention.", "#2563EB"),
    @("Approval Card", "Decision, evidence, due time, approve / reject.", "#DC2626"),
    @("Evidence Chip", "Cited file, meeting, run, or snapshot.", "#0F766E"),
    @("Option Card", "Recommended choice, not long text first.", "#6D5BD0"),
    @("Pet Bubble", "External Cuu card, never a main-window body.", "#475569"),
    @("File Row", "PPTX / DOCX / XLSX / image / folder diff.", "#D97706"),
    @("Risk Badge", "low / medium / high with human wording.", "#0F766E"),
    @("Rollback Panel", "Preview and revert from snapshots.", "#334155"),
    @("Sync Progress", "Queued, syncing, synced, error.", "#2563EB"),
    @("Conflict Choice", "Apply AI merge, keep mine, keep remote.", "#6D5BD0"),
    @("Tray Notification", "System event with deep-link.", "#475569"),
    @("Empty State", "No work yet; create request or wait.", "#2563EB")
  )

  for ($i = 0; $i -lt $cards.Count; $i++) {
    $col = $i % 4
    $row = [math]::Floor($i / 4)
    $x = 36 + ($col * 390)
    $y = 144 + ($row * 222)
    Fill-RoundRect $g $x $y 350 180 18 "#FFFFFF" "#D7DEE9"
    Draw-Text $g (($i + 1).ToString() + ". " + $cards[$i][0]) 19 "#17213C" ($x + 22) ($y + 18) 310 28 ([System.Drawing.FontStyle]::Bold)
    if ($cards[$i][0] -eq "Pet Bubble") {
      Draw-SmallCat $g $script:Hijiki ($x + 26) ($y + 52) 92 92
      Fill-RoundRect $g ($x + 126) ($y + 58) 202 64 18 "#F8FAFC" "#E2E8F0"
      Draw-Text $g "Evidence found. Want to use it?" 15 "#17213C" ($x + 144) ($y + 74) 160 36
      Draw-Pill $g "Use" ($x + 132) ($y + 132) "#EAF1FF" "#1D4ED8"
      Draw-Pill $g "Open" ($x + 190) ($y + 132) "#F8FAFC" "#334155"
    } else {
      Fill-RoundRect $g ($x + 24) ($y + 62) 300 54 14 ($cards[$i][2] + "12") ($cards[$i][2] + "44")
      Draw-Text $g $cards[$i][1] 15 "#63708A" ($x + 36) ($y + 132) 300 42
    }
  }

  Fill-RoundRect $g 36 826 1530 96 18 "#FFFFFF" "#D7DEE9"
  Draw-Pill $g "Primary" 64 848 "#EAF1FF" "#1D4ED8"
  Draw-Pill $g "Success" 156 848 "#E7F8F3" "#047857"
  Draw-Pill $g "Warning" 252 848 "#FEF3C7" "#92400E"
  Draw-Pill $g "Danger" 350 848 "#FEE2E2" "#B91C1C"
  Draw-Pill $g "Neutral" 444 848 "#F1F5F9" "#475569"
  Draw-Text $g "Buttons, chips, tabs, menus, and page states use the same tokens across Web, Tauri webview, and Cuu pet cards." 16 "#63708A" 64 886 1180 28
  Draw-Text $g "No orange pet. No Cuu in main windows." 16 "#0F1B3D" 1140 886 480 28 ([System.Drawing.FontStyle]::Bold)

  Save-Canvas $c (Join-Path $sharedRoot "shared-component-atlas.png")
}

try {
  Render-RuntimeConcept
  Render-EndpointAlignment
  Render-GapMap
  Render-ComponentAtlas
}
finally {
  if ($script:Hijiki) { $script:Hijiki.Dispose() }
  if ($script:Tororo) { $script:Tororo.Dispose() }
}

Write-Output "Rendered R0 shared concept PNG assets into $sharedRoot"
