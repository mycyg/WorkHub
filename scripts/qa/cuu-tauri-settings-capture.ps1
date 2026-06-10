param(
  [switch]$SkipBuild,
  [int]$WaitSeconds = 10,
  [string]$OutDir = "docs/workhub/05-clients/assets/audit/2026-06-08-cuu-live2d-cat-settings",
  [switch]$UseRealAppData
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "Cuu settings capture QA is Windows-only because it validates the real Tauri transparent pet window."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$motionScript = Join-Path $scriptRoot "cuu-tauri-motion-capture.ps1"
$resolvedOutDir = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $repoRoot $OutDir }

Add-Type -AssemblyName System.Drawing

function Invoke-Checked {
  param([string]$FilePath, [string[]]$ArgumentList)
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') exited with code $LASTEXITCODE"
  }
}

function New-SettingsContactSheet {
  param(
    [object[]]$CaseReports,
    [string]$Path
  )

  $items = @($CaseReports | Where-Object { Test-Path -LiteralPath $_.first_frame })
  if ($items.Count -eq 0) {
    throw "No settings frames were produced for contact sheet."
  }

  $loaded = @()
  try {
    foreach ($item in $items) {
      $bitmap = [System.Drawing.Bitmap]::FromFile($item.first_frame)
      $loaded += [pscustomobject]@{
        case = $item
        bitmap = $bitmap
      }
    }

    $maxWidth = ($loaded | ForEach-Object { $_.bitmap.Width } | Measure-Object -Maximum).Maximum
    $maxHeight = ($loaded | ForEach-Object { $_.bitmap.Height } | Measure-Object -Maximum).Maximum
    $cols = 3
    $rows = [Math]::Ceiling($loaded.Count / $cols)
    $cellWidth = [int]($maxWidth + 32)
    $cellHeight = [int]($maxHeight + 42)
    $sheet = [System.Drawing.Bitmap]::new($cellWidth * $cols, $cellHeight * $rows)
    $graphics = [System.Drawing.Graphics]::FromImage($sheet)
    try {
      $graphics.Clear([System.Drawing.Color]::FromArgb(245, 247, 250))
      $font = [System.Drawing.Font]::new("Segoe UI", 10)
      $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(34, 43, 56))
      try {
        for ($i = 0; $i -lt $loaded.Count; $i++) {
          $entry = $loaded[$i]
          $col = $i % $cols
          $row = [Math]::Floor($i / $cols)
          $x = $col * $cellWidth
          $y = $row * $cellHeight
          $modelLabel = if ($entry.case.settings.pet_model_pack_id -eq "cuu-tororo-live2d-cubism2") { "white" } else { "black" }
          $label = "{0}  {1} / {2}% / {3}% / pass:{4} / hide:{5}" -f $entry.case.id, $modelLabel, $entry.case.settings.pet_scale_percent, $entry.case.settings.pet_opacity_percent, $entry.case.settings.pet_pass_through, $entry.case.settings.pet_hide_on_hover
          $graphics.DrawString($label, $font, $brush, [single]($x + 8), [single]($y + 8))
          $imageX = $x + [Math]::Floor(($cellWidth - $entry.bitmap.Width) / 2)
          $imageY = $y + 32 + [Math]::Floor(($maxHeight - $entry.bitmap.Height) / 2)
          $graphics.DrawImage($entry.bitmap, [int]$imageX, [int]$imageY, $entry.bitmap.Width, $entry.bitmap.Height)
        }
      } finally {
        $font.Dispose()
        $brush.Dispose()
      }
      $sheet.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $sheet.Dispose()
    }
  } finally {
    foreach ($entry in $loaded) {
      $entry.bitmap.Dispose()
    }
  }
}

function Remove-SettingsCaptureTransientFiles {
  param([string]$Root)

  $resolvedRoot = [System.IO.Path]::GetFullPath($Root)
  $resolvedRepo = [System.IO.Path]::GetFullPath($repoRoot)
  if (-not $resolvedRoot.StartsWith($resolvedRepo, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean transient files outside repo: $resolvedRoot"
  }

  Get-ChildItem -Path $resolvedRoot -Recurse -File -Include "ffmpeg-*.log", "ffmpeg-*.out", "tauri-stdout.log", "tauri-stderr.log" |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
  Get-ChildItem -Path $resolvedRoot -Recurse -File -Include "*.gif", "*.mp4" |
    Where-Object { $_.Length -le 0 } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
  Get-ChildItem -Path $resolvedRoot -Recurse -Directory -Filter "frames" |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
}

function Test-SettingsFirstFrameBounds {
  param(
    [string]$Path,
    [int]$MinTopMarginPx = 8,
    [int]$MinBottomMarginPx = 2,
    [int]$MinSideMarginPx = 4
  )

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $background = $bitmap.GetPixel(0, 0)
    $minX = $bitmap.Width
    $minY = $bitmap.Height
    $maxX = -1
    $maxY = -1
    $foregroundPixels = 0

    for ($y = 0; $y -lt $bitmap.Height; $y += 1) {
      for ($x = 0; $x -lt $bitmap.Width; $x += 1) {
        $color = $bitmap.GetPixel($x, $y)
        $distanceFromBackground = [Math]::Abs($color.R - $background.R) +
          [Math]::Abs($color.G - $background.G) +
          [Math]::Abs($color.B - $background.B)
        if ($distanceFromBackground -ge 30) {
          $foregroundPixels += 1
          if ($x -lt $minX) {
            $minX = $x
          }
          if ($y -lt $minY) {
            $minY = $y
          }
          if ($x -gt $maxX) {
            $maxX = $x
          }
          if ($y -gt $maxY) {
            $maxY = $y
          }
        }
      }
    }

    if ($foregroundPixels -eq 0) {
      return [pscustomobject]@{
        passed = $false
        reason = "no_foreground_pixels"
        width = $bitmap.Width
        height = $bitmap.Height
        foreground_pixels = 0
        min_top_margin_px = $MinTopMarginPx
        min_bottom_margin_px = $MinBottomMarginPx
        min_side_margin_px = $MinSideMarginPx
      }
    }

    $leftMargin = $minX
    $topMargin = $minY
    $rightMargin = $bitmap.Width - 1 - $maxX
    $bottomMargin = $bitmap.Height - 1 - $maxY
    $passed = $topMargin -ge $MinTopMarginPx -and
      $bottomMargin -ge $MinBottomMarginPx -and
      $leftMargin -ge $MinSideMarginPx -and
      $rightMargin -ge $MinSideMarginPx

    [pscustomobject]@{
      passed = $passed
      width = $bitmap.Width
      height = $bitmap.Height
      foreground_pixels = $foregroundPixels
      bounds = [pscustomobject]@{
        left = $minX
        top = $minY
        right = $maxX
        bottom = $maxY
        width = $maxX - $minX + 1
        height = $maxY - $minY + 1
      }
      margins = [pscustomobject]@{
        left = $leftMargin
        top = $topMargin
        right = $rightMargin
        bottom = $bottomMargin
      }
      min_top_margin_px = $MinTopMarginPx
      min_bottom_margin_px = $MinBottomMarginPx
      min_side_margin_px = $MinSideMarginPx
    }
  } finally {
    $bitmap.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $resolvedOutDir | Out-Null
Set-Location $repoRoot

if (-not $SkipBuild) {
  Invoke-Checked "pnpm" @("--filter", "@workhub/desktop-webview", "build")
  Invoke-Checked "cargo" @("build", "--manifest-path", "client-tauri\src-tauri\Cargo.toml")
}

$cases = @(
  [pscustomobject]@{ id = "default"; modelPack = "cuu-hijiki-live2d-cubism2"; scale = 100; opacity = 100; pass = $false; hide = $false; scenario = "idle"; frames = 4; interval = 240; minVisual = 12000 },
  [pscustomobject]@{ id = "white-cat"; modelPack = "cuu-tororo-live2d-cubism2"; scale = 100; opacity = 100; pass = $false; hide = $false; scenario = "idle"; frames = 4; interval = 240; minVisual = 12000 },
  [pscustomobject]@{ id = "scale-75"; modelPack = "cuu-hijiki-live2d-cubism2"; scale = 75; opacity = 100; pass = $false; hide = $false; scenario = "idle"; frames = 4; interval = 240; minVisual = 6500 },
  [pscustomobject]@{ id = "scale-150"; modelPack = "cuu-hijiki-live2d-cubism2"; scale = 150; opacity = 100; pass = $false; hide = $false; scenario = "idle"; frames = 4; interval = 240; minVisual = 12000 },
  [pscustomobject]@{ id = "opacity-60"; modelPack = "cuu-hijiki-live2d-cubism2"; scale = 100; opacity = 60; pass = $false; hide = $false; scenario = "idle"; frames = 4; interval = 240; minVisual = 500 },
  [pscustomobject]@{ id = "pass-through"; modelPack = "cuu-hijiki-live2d-cubism2"; scale = 100; opacity = 100; pass = $true; hide = $false; scenario = "idle"; frames = 4; interval = 240; minVisual = 12000 },
  [pscustomobject]@{ id = "hide-on-hover"; modelPack = "cuu-hijiki-live2d-cubism2"; scale = 100; opacity = 100; pass = $false; hide = $true; scenario = "hide-on-hover"; frames = 20; interval = 180; minVisual = 12000 },
  [pscustomobject]@{ id = "combo-125-80-pass-hide"; modelPack = "cuu-hijiki-live2d-cubism2"; scale = 125; opacity = 80; pass = $true; hide = $true; scenario = "idle"; frames = 4; interval = 240; minVisual = 1600 }
)

$caseReports = @()
foreach ($case in $cases) {
  $caseOutDir = Join-Path $resolvedOutDir $case.id
  $params = @{
    WaitSeconds = $WaitSeconds
    FrameCount = $case.frames
    IntervalMs = $case.interval
    Scenario = $case.scenario
    PetScalePercent = $case.scale
    PetOpacityPercent = $case.opacity
    ModelPackId = $case.modelPack
    MinFirstFrameVisualPixels = $case.minVisual
    OutDir = $caseOutDir
    DisableSse = $true
  }
  $params.SkipBuild = $true
  if ($UseRealAppData) {
    $params.UseRealAppData = $true
  }
  if ($case.pass) {
    $params.PetPassThrough = $true
  }
  if ($case.hide) {
    $params.PetHideOnHover = $true
  }

  $raw = & $motionScript @params
  $capture = ($raw -join "`n") | ConvertFrom-Json
  $motionReport = Get-Content -Raw -Path $capture.diff_report | ConvertFrom-Json
  if (-not $capture.passed) {
    throw "Settings capture case '$($case.id)' failed motion capture."
  }
  if (-not $motionReport.passed) {
    throw "Settings capture case '$($case.id)' failed motion report gate."
  }
  if (-not $motionReport.motion_gate_passed) {
    throw "Settings capture case '$($case.id)' failed motion liveness gate."
  }
  if ($motionReport.right_edge_clip_gate -and -not $motionReport.right_edge_clip_gate.passed) {
    throw "Settings capture case '$($case.id)' failed right-edge clip gate."
  }
  $firstFrameProbe = Join-Path $caseOutDir "first-frame-probe.png"
  $firstFrame = if (Test-Path -LiteralPath $firstFrameProbe) {
    $firstFrameProbe
  } else {
    Join-Path $capture.frames_dir "frame-000.png"
  }
  $firstFrameBoundsGate = Test-SettingsFirstFrameBounds -Path $firstFrame
  if (-not $firstFrameBoundsGate.passed) {
    throw "Settings capture case '$($case.id)' failed first-frame bounds gate: $($firstFrameBoundsGate | ConvertTo-Json -Compress -Depth 6)"
  }
  $caseReports += [pscustomobject]@{
    id = $case.id
    settings = [pscustomobject]@{
      pet_scale_percent = $case.scale
      pet_opacity_percent = $case.opacity
      pet_pass_through = [bool]$case.pass
      pet_hide_on_hover = [bool]$case.hide
      pet_model_pack_id = $case.modelPack
    }
    scenario = $case.scenario
    min_first_frame_visual_pixels = $case.minVisual
    first_frame = $firstFrame
    contact_sheet = $capture.contact_sheet
    gif = $capture.gif
    mp4 = $capture.mp4
    diff_report = $capture.diff_report
    first_rect = $motionReport.frames[0].rect
    first_frame_gate = $motionReport.first_frame_gate
    first_frame_bounds_gate = $firstFrameBoundsGate
    right_edge_clip_gate = $motionReport.right_edge_clip_gate
    scenario_events = $motionReport.scenario_events
  }
}

$contactSheet = Join-Path $resolvedOutDir "cuu-settings-contact-sheet.png"
New-SettingsContactSheet -CaseReports $caseReports -Path $contactSheet

$reportPath = Join-Path $resolvedOutDir "settings-capture-report.json"
$report = [pscustomobject]@{
  passed = $true
  cases = $caseReports
  contact_sheet = $contactSheet
}
$report | ConvertTo-Json -Depth 12 | Set-Content -Path $reportPath -Encoding UTF8
Remove-SettingsCaptureTransientFiles -Root $resolvedOutDir

[pscustomobject]@{
  passed = $true
  contact_sheet = $contactSheet
  report = $reportPath
  cases = @($caseReports | ForEach-Object { $_.id })
} | ConvertTo-Json -Depth 6
