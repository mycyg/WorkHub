param(
  [switch]$SkipBuild,
  [int]$WaitSeconds = 8,
  [int]$FrameCount = 32,
  [int]$IntervalMs = 180,
  [int]$PixelStep = 2,
  [int]$MinFirstFrameOrangePixels = 8000,
  [int]$MinFirstFrameVisualPixels = 12000,
  [string]$OutDir = (Join-Path $env:TEMP "workhub-cuu-tauri-motion"),
  [switch]$UseRealAppData
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "Cuu motion capture QA is Windows-only because it validates Win32 transparent-window behavior."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$srcTauriRoot = Join-Path $repoRoot "client-tauri\src-tauri"
$exePath = Join-Path $srcTauriRoot "target\debug\workhub-client-tauri.exe"

function Invoke-Checked {
  param([string]$FilePath, [string[]]$ArgumentList)
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') exited with code $LASTEXITCODE"
  }
}

function Restore-EnvVar {
  param([string]$Name, [string]$Value)
  if ($null -eq $Value) {
    Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item -Path "Env:$Name" -Value $Value
  }
}

function Test-LocalPort {
  param([int]$Port)
  $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $Port } |
    Select-Object -First 1
  return $null -ne $listener
}

function Start-DesktopWebviewDevServerIfNeeded {
  param([int]$Port = 1420)
  if (Test-LocalPort -Port $Port) {
    return $null
  }

  $pnpm = (Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue).Source
  if (-not $pnpm) {
    $pnpm = (Get-Command "pnpm" -ErrorAction Stop).Source
  }
  $process = Start-Process -FilePath $pnpm -ArgumentList @("--filter", "@workhub/desktop-webview", "dev", "--", "--host", "127.0.0.1") -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(25)
  do {
    if ($process.HasExited) {
      throw "desktop webview dev server exited before opening port $Port."
    }
    Start-Sleep -Milliseconds 500
  } while (-not (Test-LocalPort -Port $Port) -and (Get-Date) -lt $deadline)

  if (-not (Test-LocalPort -Port $Port)) {
    throw "desktop webview dev server did not open port $Port in time."
  }
  return $process
}

if (-not ([System.Management.Automation.PSTypeName]"WorkHubCuuMotionWin32").Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WorkHubCuuMotionWin32
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint flags);

    public const uint PW_RENDERFULLCONTENT = 0x00000002;
}
"@
}

Add-Type -AssemblyName System.Drawing

function New-MotionRect {
  param([WorkHubCuuMotionWin32+RECT]$Rect)
  [pscustomobject]@{
    Left = $Rect.Left
    Top = $Rect.Top
    Right = $Rect.Right
    Bottom = $Rect.Bottom
    Width = $Rect.Right - $Rect.Left
    Height = $Rect.Bottom - $Rect.Top
  }
}

function Get-WorkHubProcessWindows {
  param([int]$TargetProcessId)
  $windows = [System.Collections.Generic.List[object]]::new()
  $callback = [WorkHubCuuMotionWin32+EnumWindowsProc]{
    param([IntPtr]$Hwnd, [IntPtr]$LParam)
    $windowProcessId = [uint32]0
    [void][WorkHubCuuMotionWin32]::GetWindowThreadProcessId($Hwnd, [ref]$windowProcessId)
    if ([int]$windowProcessId -ne $TargetProcessId) {
      return $true
    }

    $titleBuilder = [System.Text.StringBuilder]::new(512)
    [void][WorkHubCuuMotionWin32]::GetWindowText($Hwnd, $titleBuilder, $titleBuilder.Capacity)
    $nativeRect = [WorkHubCuuMotionWin32+RECT]::new()
    [void][WorkHubCuuMotionWin32]::GetWindowRect($Hwnd, [ref]$nativeRect)

    $windows.Add([pscustomobject]@{
      Hwnd = $Hwnd
      Handle = ("0x{0:x}" -f $Hwnd.ToInt64())
      Title = $titleBuilder.ToString()
      Visible = [WorkHubCuuMotionWin32]::IsWindowVisible($Hwnd)
      Rect = New-MotionRect $nativeRect
    }) | Out-Null
    return $true
  }

  [void][WorkHubCuuMotionWin32]::EnumWindows($callback, [IntPtr]::Zero)
  $windows.ToArray()
}

function Select-CuuWindow {
  param([object[]]$Windows)
  $Windows |
    Where-Object { $_.Title -eq "Cuu" } |
    Sort-Object -Property @{ Expression = "Visible"; Descending = $true }, @{ Expression = { $_.Rect.Width * $_.Rect.Height }; Descending = $true } |
    Select-Object -First 1
}

function Wait-ForCuuWindow {
  param([int]$TargetProcessId, [int]$TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $pet = Select-CuuWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $TargetProcessId)
    if ($pet -and $pet.Visible) {
      return $pet
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $null
}

function New-WindowFrame {
  param([object]$Window, [string]$Path)
  $width = [Math]::Max(1, [int]$Window.Rect.Width)
  $height = [Math]::Max(1, [int]$Window.Rect.Height)
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $hdc = $graphics.GetHdc()
    try {
      $captured = [WorkHubCuuMotionWin32]::PrintWindow($Window.Hwnd, $hdc, [WorkHubCuuMotionWin32]::PW_RENDERFULLCONTENT)
    } finally {
      $graphics.ReleaseHdc($hdc)
    }
    if (-not $captured) {
      throw "Win32 PrintWindow capture failed for Cuu."
    }
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Measure-CuuFrameVisualPixels {
  param([string]$Path)

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $step = [Math]::Max(1, [int][Math]::Floor(([Math]::Max($bitmap.Width, $bitmap.Height)) / 360))
    $samples = 0
    $orangePixels = 0
    $creamPixels = 0
    $darkPixels = 0

    for ($y = 0; $y -lt $bitmap.Height; $y += $step) {
      for ($x = 0; $x -lt $bitmap.Width; $x += $step) {
        $color = $bitmap.GetPixel($x, $y)
        $samples += 1

        $isCuuOrange = $color.R -ge 145 -and
          $color.G -ge 65 -and
          $color.G -le 210 -and
          $color.B -le 170 -and
          $color.R -ge ($color.G + 18) -and
          $color.G -ge ($color.B + 4)
        $isCream = $color.R -ge 220 -and
          $color.G -ge 190 -and
          $color.B -ge 145 -and
          $color.R -ge $color.B
        $isDarkDetail = $color.R -le 80 -and
          $color.G -le 80 -and
          $color.B -le 95

        if ($isCuuOrange) {
          $orangePixels += 1
        }
        if ($isCream) {
          $creamPixels += 1
        }
        if ($isDarkDetail) {
          $darkPixels += 1
        }
      }
    }

    $visualPixels = $orangePixels + [Math]::Min($creamPixels, $darkPixels * 4)
    [pscustomobject]@{
      samples = $samples
      orange_pixels = $orangePixels
      cream_pixels = $creamPixels
      dark_pixels = $darkPixels
      visual_pixels = $visualPixels
      sample_step = $step
      width = $bitmap.Width
      height = $bitmap.Height
    }
  } finally {
    $bitmap.Dispose()
  }
}

function Wait-ForCuuVisualWindow {
  param(
    [int]$TargetProcessId,
    [int]$TimeoutSeconds,
    [string]$ProbePath,
    [int]$MinOrangePixels,
    [int]$MinVisualPixels
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastPet = $null
  $lastReport = $null
  $attempt = 0
  do {
    $attempt += 1
    $pet = Select-CuuWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $TargetProcessId)
    if ($pet -and $pet.Visible) {
      New-WindowFrame -Window $pet -Path $ProbePath
      $lastPet = $pet
      $lastReport = Measure-CuuFrameVisualPixels -Path $ProbePath
      if ($lastReport.orange_pixels -ge $MinOrangePixels -and $lastReport.visual_pixels -ge $MinVisualPixels) {
        return [pscustomobject]@{
          Passed = $true
          Pet = $pet
          PixelReport = $lastReport
          Attempts = $attempt
          ProbePath = $ProbePath
        }
      }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  [pscustomobject]@{
    Passed = $false
    Pet = $lastPet
    PixelReport = $lastReport
    Attempts = $attempt
    ProbePath = $ProbePath
  }
}

function Measure-FrameDiff {
  param([string]$BasePath, [string]$Path, [int]$Step)
  $base = [System.Drawing.Bitmap]::FromFile($BasePath)
  $next = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $width = [Math]::Min($base.Width, $next.Width)
    $height = [Math]::Min($base.Height, $next.Height)
    $samples = 0
    $sum = 0.0
    $changed = 0
    for ($y = 0; $y -lt $height; $y += $Step) {
      for ($x = 0; $x -lt $width; $x += $Step) {
        $a = $base.GetPixel($x, $y)
        $b = $next.GetPixel($x, $y)
        $delta = ([Math]::Abs($a.R - $b.R) + [Math]::Abs($a.G - $b.G) + [Math]::Abs($a.B - $b.B)) / 3.0
        $samples += 1
        $sum += $delta
        if ($delta -gt 8) {
          $changed += 1
        }
      }
    }
    [pscustomobject]@{
      mean_abs_delta = if ($samples -gt 0) { [Math]::Round($sum / $samples, 3) } else { 0 }
      changed_pixels_gt8 = $changed
      samples = $samples
    }
  } finally {
    $base.Dispose()
    $next.Dispose()
  }
}

function New-ContactSheet {
  param([string[]]$Frames, [string]$Path)
  $columns = 4
  $thumbW = 194
  $thumbH = 228
  $labelH = 22
  $rows = [Math]::Ceiling($Frames.Count / $columns)
  $sheet = [System.Drawing.Bitmap]::new($columns * $thumbW, [int]$rows * ($thumbH + $labelH))
  $graphics = [System.Drawing.Graphics]::FromImage($sheet)
  $font = [System.Drawing.Font]::new("Segoe UI", 8)
  try {
    $graphics.Clear([System.Drawing.Color]::FromArgb(246, 248, 251))
    for ($i = 0; $i -lt $Frames.Count; $i++) {
      $frame = [System.Drawing.Bitmap]::FromFile($Frames[$i])
      try {
        $col = $i % $columns
        $row = [Math]::Floor($i / $columns)
        $x = $col * $thumbW
        $y = $row * ($thumbH + $labelH)
        $graphics.FillRectangle([System.Drawing.Brushes]::Black, $x, $y, $thumbW, $thumbH)
        $graphics.DrawImage($frame, $x, $y, $thumbW, $thumbH)
        $graphics.DrawString(("frame {0:d3}" -f $i), $font, [System.Drawing.Brushes]::Black, $x + 6, $y + $thumbH + 4)
      } finally {
        $frame.Dispose()
      }
    }
    $sheet.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $font.Dispose()
    $graphics.Dispose()
    $sheet.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$framesDir = Join-Path $OutDir "frames"
New-Item -ItemType Directory -Force -Path $framesDir | Out-Null
Set-Location $repoRoot

if (-not $SkipBuild) {
  Invoke-Checked "pnpm" @("--filter", "@workhub/desktop-webview", "build")
  Invoke-Checked "cargo" @("build", "--manifest-path", "client-tauri\src-tauri\Cargo.toml")
}
if (-not (Test-Path $exePath)) {
  throw "Missing Tauri debug executable. Run without -SkipBuild first."
}

$existingProcessIds = @(
  Get-Process -Name "workhub-client-tauri" -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -ne ([System.Diagnostics.Process]::GetCurrentProcess().Id) } |
    Select-Object -ExpandProperty Id
)
if ($existingProcessIds.Count -gt 0) {
  throw "Close existing workhub-client-tauri process(es) before motion capture: $($existingProcessIds -join ', ')"
}

$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$process = $null
$devServerProcess = $null

try {
  if (-not $UseRealAppData) {
    $isolatedRoot = Join-Path $OutDir "isolated-appdata"
    $isolatedAppData = Join-Path $isolatedRoot "Roaming"
    $isolatedLocalAppData = Join-Path $isolatedRoot "Local"
    New-Item -ItemType Directory -Force -Path $isolatedAppData, $isolatedLocalAppData | Out-Null
    $env:APPDATA = $isolatedAppData
    $env:LOCALAPPDATA = $isolatedLocalAppData
  }

  $devServerProcess = Start-DesktopWebviewDevServerIfNeeded
  $process = Start-Process -FilePath $exePath -WorkingDirectory $srcTauriRoot -PassThru
  $firstFrameProbe = Join-Path $OutDir "first-frame-probe.png"
  $firstFrameGate = Wait-ForCuuVisualWindow -TargetProcessId $process.Id -TimeoutSeconds $WaitSeconds -ProbePath $firstFrameProbe -MinOrangePixels $MinFirstFrameOrangePixels -MinVisualPixels $MinFirstFrameVisualPixels
  if (-not $firstFrameGate.Pet) {
    throw "Cuu pet window was not found by title."
  }
  if (-not $firstFrameGate.Passed) {
    $pixelReport = if ($firstFrameGate.PixelReport) { $firstFrameGate.PixelReport | ConvertTo-Json -Compress } else { "null" }
    throw "Cuu pet first visual frame did not reach pixel thresholds orange>=$MinFirstFrameOrangePixels visual>=$MinFirstFrameVisualPixels after $($firstFrameGate.Attempts) attempt(s). Last pixel report: $pixelReport"
  }
  $pet = $firstFrameGate.Pet

  $frames = [System.Collections.Generic.List[string]]::new()
  $rects = [System.Collections.Generic.List[object]]::new()
  for ($i = 0; $i -lt $FrameCount; $i++) {
    $pet = Select-CuuWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    if (-not $pet) {
      throw "Cuu pet window disappeared during motion capture at frame $i."
    }
    $path = Join-Path $framesDir ("frame-{0:d3}.png" -f $i)
    New-WindowFrame -Window $pet -Path $path
    $frames.Add($path) | Out-Null
    $rects.Add($pet.Rect) | Out-Null
    Start-Sleep -Milliseconds $IntervalMs
  }

  $contactSheet = Join-Path $OutDir "cuu-motion-contact-sheet.png"
  New-ContactSheet -Frames $frames.ToArray() -Path $contactSheet

  $diffs = @()
  for ($i = 0; $i -lt $frames.Count; $i++) {
    $vsFirst = Measure-FrameDiff -BasePath $frames[0] -Path $frames[$i] -Step $PixelStep
    $vsPrevious = if ($i -gt 0) { Measure-FrameDiff -BasePath $frames[$i - 1] -Path $frames[$i] -Step $PixelStep } else { $vsFirst }
    $diffs += [pscustomobject]@{
      frame = $i
      rect = $rects[$i]
      vs_first = $vsFirst
      vs_previous = $vsPrevious
    }
  }

  $report = [pscustomobject]@{
    passed = $true
    process_id = $process.Id
    frame_count = $FrameCount
    interval_ms = $IntervalMs
    frames_dir = $framesDir
    contact_sheet = $contactSheet
    first_frame_gate = [pscustomobject]@{
      passed = $firstFrameGate.Passed
      attempts = $firstFrameGate.Attempts
      probe_path = $firstFrameGate.ProbePath
      min_orange_pixels = $MinFirstFrameOrangePixels
      min_visual_pixels = $MinFirstFrameVisualPixels
      pixel_report = $firstFrameGate.PixelReport
    }
    max_vs_first_mean_abs_delta = ($diffs | ForEach-Object { $_.vs_first.mean_abs_delta } | Measure-Object -Maximum).Maximum
    max_vs_previous_mean_abs_delta = ($diffs | ForEach-Object { $_.vs_previous.mean_abs_delta } | Measure-Object -Maximum).Maximum
    max_vs_first_changed_pixels_gt8 = ($diffs | ForEach-Object { $_.vs_first.changed_pixels_gt8 } | Measure-Object -Maximum).Maximum
    max_vs_previous_changed_pixels_gt8 = ($diffs | ForEach-Object { $_.vs_previous.changed_pixels_gt8 } | Measure-Object -Maximum).Maximum
    frames = $diffs
  }
  $reportPath = Join-Path $OutDir "motion-diff-report.json"
  $report | ConvertTo-Json -Depth 10 | Set-Content -Path $reportPath -Encoding UTF8

  $ffmpeg = Get-Command "ffmpeg" -ErrorAction SilentlyContinue
  $gifPath = $null
  $mp4Path = $null
  if ($ffmpeg) {
    $fps = [Math]::Max(1, [Math]::Round(1000 / $IntervalMs, 2))
    $inputPattern = Join-Path $framesDir "frame-%03d.png"
    $gifPath = Join-Path $OutDir "cuu-motion-printwindow.gif"
    $mp4Path = Join-Path $OutDir "cuu-motion-printwindow.mp4"
    $gifLog = Join-Path $OutDir "ffmpeg-gif.log"
    $mp4Log = Join-Path $OutDir "ffmpeg-mp4.log"
    $gifProcess = Start-Process -FilePath $ffmpeg.Source -ArgumentList @("-y", "-framerate", "$fps", "-i", $inputPattern, $gifPath) -Wait -PassThru -NoNewWindow -RedirectStandardError $gifLog -RedirectStandardOutput (Join-Path $OutDir "ffmpeg-gif.out")
    if ($gifProcess.ExitCode -ne 0 -or -not (Test-Path $gifPath)) {
      $gifPath = $null
    }
    $mp4Process = Start-Process -FilePath $ffmpeg.Source -ArgumentList @("-y", "-framerate", "$fps", "-i", $inputPattern, "-pix_fmt", "yuv420p", $mp4Path) -Wait -PassThru -NoNewWindow -RedirectStandardError $mp4Log -RedirectStandardOutput (Join-Path $OutDir "ffmpeg-mp4.out")
    if ($mp4Process.ExitCode -ne 0 -or -not (Test-Path $mp4Path)) {
      $mp4Path = $null
    }
  }

  [pscustomobject]@{
    passed = $true
    frames_dir = $framesDir
    contact_sheet = $contactSheet
    diff_report = $reportPath
    gif = $gifPath
    mp4 = $mp4Path
  } | ConvertTo-Json -Depth 6
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
  Restore-EnvVar -Name "APPDATA" -Value $originalAppData
  Restore-EnvVar -Name "LOCALAPPDATA" -Value $originalLocalAppData
  if ($devServerProcess -and -not $devServerProcess.HasExited) {
    Stop-Process -Id $devServerProcess.Id -Force
    $devServerProcess.WaitForExit()
  }
}
