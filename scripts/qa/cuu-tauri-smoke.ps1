param(
  [switch]$SkipBuild,
  [int]$WaitSeconds = 8,
  [int]$ContentWaitSeconds = 20,
  [int]$MaxEdgeGapPx = 120,
  [int]$MinCuuVisualPixels = 180,
  [string]$OutDir = (Join-Path $env:TEMP "workhub-cuu-tauri-smoke"),
  [switch]$UseRealAppData
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "Cuu Tauri smoke QA is Windows-only because it validates Win32 transparent-window behavior."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$srcTauriRoot = Join-Path $repoRoot "client-tauri\src-tauri"
$exePath = Join-Path $srcTauriRoot "target\debug\workhub-client-tauri.exe"

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') exited with code $LASTEXITCODE"
  }
}

function Assert-Smoke {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Restore-EnvVar {
  param(
    [string]$Name,
    [string]$Value
  )

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

if (-not ([System.Management.Automation.PSTypeName]"WorkHubCuuSmokeWin32").Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WorkHubCuuSmokeWin32
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

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint flags);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hdc, IntPtr h);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int w, int h, IntPtr hdcSrc, int xSrc, int ySrc, int rop);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);

    public const int GWL_EXSTYLE = -20;
    public const int SW_HIDE = 0;
    public const int WS_EX_TOPMOST = 0x00000008;
    public const int SRCCOPY = 0x00CC0020;
    public const int CAPTUREBLT = 0x40000000;
    public const uint PW_RENDERFULLCONTENT = 0x00000002;
}
"@
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function New-SmokeRect {
  param([WorkHubCuuSmokeWin32+RECT]$Rect)

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
  $callback = [WorkHubCuuSmokeWin32+EnumWindowsProc]{
    param([IntPtr]$Hwnd, [IntPtr]$LParam)

    $windowProcessId = [uint32]0
    [void][WorkHubCuuSmokeWin32]::GetWindowThreadProcessId($Hwnd, [ref]$windowProcessId)
    if ([int]$windowProcessId -ne $TargetProcessId) {
      return $true
    }

    $titleBuilder = [System.Text.StringBuilder]::new(512)
    [void][WorkHubCuuSmokeWin32]::GetWindowText($Hwnd, $titleBuilder, $titleBuilder.Capacity)

    $nativeRect = [WorkHubCuuSmokeWin32+RECT]::new()
    [void][WorkHubCuuSmokeWin32]::GetWindowRect($Hwnd, [ref]$nativeRect)
    $exStyle = [WorkHubCuuSmokeWin32]::GetWindowLong($Hwnd, [WorkHubCuuSmokeWin32]::GWL_EXSTYLE)

    $windows.Add([pscustomobject]@{
      Hwnd = $Hwnd
      Handle = ("0x{0:x}" -f $Hwnd.ToInt64())
      Title = $titleBuilder.ToString()
      Visible = [WorkHubCuuSmokeWin32]::IsWindowVisible($Hwnd)
      TopMost = (($exStyle -band [WorkHubCuuSmokeWin32]::WS_EX_TOPMOST) -ne 0)
      Rect = New-SmokeRect $nativeRect
      ExStyle = $exStyle
    }) | Out-Null

    return $true
  }

  [void][WorkHubCuuSmokeWin32]::EnumWindows($callback, [IntPtr]::Zero)
  $windows.ToArray()
}

function Select-SmokeWindow {
  param(
    [object[]]$Windows,
    [string]$Title
  )

  $Windows |
    Where-Object { $_.Title -eq $Title } |
    Sort-Object -Property @{ Expression = "Visible"; Descending = $true }, @{ Expression = { $_.Rect.Width * $_.Rect.Height }; Descending = $true } |
    Select-Object -First 1
}

function Wait-ForWorkHubWindows {
  param(
    [int]$TargetProcessId,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $windows = @(Get-WorkHubProcessWindows -TargetProcessId $TargetProcessId)
    $pet = Select-SmokeWindow -Windows $windows -Title "Cuu"
    $main = Select-SmokeWindow -Windows $windows -Title "WorkHub"
    if ($pet -and $pet.Visible -and $main) {
      return [pscustomobject]@{
        Windows = $windows
        Pet = $pet
        Main = $main
      }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  [pscustomobject]@{
    Windows = @(Get-WorkHubProcessWindows -TargetProcessId $TargetProcessId)
    Pet = $null
    Main = $null
  }
}

function Test-RectInsideVirtualScreen {
  param(
    [object]$Rect,
    [System.Drawing.Rectangle]$Bounds
  )

  return $Rect.Left -ge $Bounds.Left -and
    $Rect.Top -ge $Bounds.Top -and
    $Rect.Right -le $Bounds.Right -and
    $Rect.Bottom -le $Bounds.Bottom
}

function Test-RectNearAnyWorkingAreaBottomRight {
  param(
    [object]$Rect,
    [int]$MaxGap
  )

  foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
    $workArea = $screen.WorkingArea
    $rightGap = [Math]::Abs($workArea.Right - $Rect.Right)
    $bottomGap = [Math]::Abs($workArea.Bottom - $Rect.Bottom)
    if ($rightGap -le $MaxGap -and $bottomGap -le $MaxGap) {
      return $true
    }
  }

  return $false
}

function New-DesktopScreenshot {
  param([string]$Path)

  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $screenDc = [IntPtr]::Zero
  $memoryDc = [IntPtr]::Zero
  $hBitmap = [IntPtr]::Zero
  $oldBitmap = [IntPtr]::Zero
  $bitmap = $null
  try {
    $screenDc = [WorkHubCuuSmokeWin32]::GetDC([IntPtr]::Zero)
    $memoryDc = [WorkHubCuuSmokeWin32]::CreateCompatibleDC($screenDc)
    $hBitmap = [WorkHubCuuSmokeWin32]::CreateCompatibleBitmap($screenDc, $bounds.Width, $bounds.Height)
    $oldBitmap = [WorkHubCuuSmokeWin32]::SelectObject($memoryDc, $hBitmap)
    $rasterOp = [WorkHubCuuSmokeWin32]::SRCCOPY -bor [WorkHubCuuSmokeWin32]::CAPTUREBLT
    $captured = [WorkHubCuuSmokeWin32]::BitBlt($memoryDc, 0, 0, $bounds.Width, $bounds.Height, $screenDc, $bounds.Left, $bounds.Top, $rasterOp)
    if (-not $captured) {
      throw "Win32 BitBlt desktop capture failed."
    }
    $bitmap = [System.Drawing.Image]::FromHbitmap($hBitmap)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    if ($bitmap) {
      $bitmap.Dispose()
    }
    if ($memoryDc -ne [IntPtr]::Zero -and $oldBitmap -ne [IntPtr]::Zero) {
      [void][WorkHubCuuSmokeWin32]::SelectObject($memoryDc, $oldBitmap)
    }
    if ($hBitmap -ne [IntPtr]::Zero) {
      [void][WorkHubCuuSmokeWin32]::DeleteObject($hBitmap)
    }
    if ($memoryDc -ne [IntPtr]::Zero) {
      [void][WorkHubCuuSmokeWin32]::DeleteDC($memoryDc)
    }
    if ($screenDc -ne [IntPtr]::Zero) {
      [void][WorkHubCuuSmokeWin32]::ReleaseDC([IntPtr]::Zero, $screenDc)
    }
  }

  return $bounds
}

function New-WindowScreenshot {
  param(
    [object]$Window,
    [string]$Path
  )

  $width = [Math]::Max(1, [int]$Window.Rect.Width)
  $height = [Math]::Max(1, [int]$Window.Rect.Height)
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $hdc = $graphics.GetHdc()
    try {
      $captured = [WorkHubCuuSmokeWin32]::PrintWindow($Window.Hwnd, $hdc, [WorkHubCuuSmokeWin32]::PW_RENDERFULLCONTENT)
    } finally {
      $graphics.ReleaseHdc($hdc)
    }
    if (-not $captured) {
      throw "Win32 PrintWindow capture failed for $($Window.Title)."
    }
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  return [System.Drawing.Rectangle]::new(0, 0, $width, $height)
}

function Measure-CuuVisualPixels {
  param(
    [string]$Path,
    [object]$Rect,
    [System.Drawing.Rectangle]$VirtualBounds
  )

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $left = [Math]::Max($Rect.Left, $VirtualBounds.Left)
    $top = [Math]::Max($Rect.Top, $VirtualBounds.Top)
    $right = [Math]::Min($Rect.Right, $VirtualBounds.Right)
    $bottom = [Math]::Min($Rect.Bottom, $VirtualBounds.Bottom)
    if ($right -le $left -or $bottom -le $top) {
      return [pscustomobject]@{
        samples = 0
        foreground_pixels = 0
        light_pixels = 0
        dark_pixels = 0
        visual_pixels = 0
        sample_step = 1
      }
    }

    $width = $right - $left
    $height = $bottom - $top
    $step = [Math]::Max(1, [int][Math]::Floor(([Math]::Max($width, $height)) / 360))
    $background = $bitmap.GetPixel(0, 0)
    $samples = 0
    $foregroundPixels = 0
    $lightPixels = 0
    $darkPixels = 0

    for ($screenY = $top; $screenY -lt $bottom; $screenY += $step) {
      for ($screenX = $left; $screenX -lt $right; $screenX += $step) {
        $color = $bitmap.GetPixel($screenX - $VirtualBounds.Left, $screenY - $VirtualBounds.Top)
        $samples += 1

        $distanceFromBackground = [Math]::Abs($color.R - $background.R) +
          [Math]::Abs($color.G - $background.G) +
          [Math]::Abs($color.B - $background.B)
        $isForeground = $distanceFromBackground -ge 30
        $isLightDetail = $color.R -ge 180 -and
          $color.G -ge 180 -and
          $color.B -ge 155
        $isDarkDetail = $color.R -le 80 -and
          $color.G -le 80 -and
          $color.B -le 95

        if ($isForeground) {
          $foregroundPixels += 1
        }
        if ($isLightDetail) {
          $lightPixels += 1
        }
        if ($isDarkDetail) {
          $darkPixels += 1
        }
      }
    }

    [pscustomobject]@{
      samples = $samples
      foreground_pixels = $foregroundPixels
      light_pixels = $lightPixels
      dark_pixels = $darkPixels
      visual_pixels = $foregroundPixels
      sample_step = $step
    }
  } finally {
    $bitmap.Dispose()
  }
}

function Wait-ForCuuVisualPixels {
  param(
    [int]$TargetProcessId,
    [int]$TimeoutSeconds,
    [string]$ScreenshotPath,
    [int]$MinVisualPixels
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastReport = $null
  $lastPet = $null
  $attempt = 0
  do {
    $attempt += 1
    $windows = @(Get-WorkHubProcessWindows -TargetProcessId $TargetProcessId)
    $pet = Select-SmokeWindow -Windows $windows -Title "Cuu"
    if ($pet -and $pet.Visible) {
      $bounds = New-WindowScreenshot -Window $pet -Path $ScreenshotPath
      $windowRect = [pscustomobject]@{
        Left = 0
        Top = 0
        Right = $bounds.Width
        Bottom = $bounds.Height
        Width = $bounds.Width
        Height = $bounds.Height
      }
      $lastReport = Measure-CuuVisualPixels -Path $ScreenshotPath -Rect $windowRect -VirtualBounds $bounds
      $lastPet = $pet
      if ($lastReport.visual_pixels -ge $MinVisualPixels) {
        return [pscustomobject]@{
          Pet = $pet
          PixelReport = $lastReport
          Attempts = $attempt
        }
      }
    }
    Start-Sleep -Milliseconds 750
  } while ((Get-Date) -lt $deadline)

  [pscustomobject]@{
    Pet = $lastPet
    PixelReport = $lastReport
    Attempts = $attempt
  }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Set-Location $repoRoot

if (-not $SkipBuild) {
  Write-Host "Building desktop webview and Tauri debug executable..."
  Invoke-Checked "pnpm" @("--filter", "@workhub/desktop-webview", "build")
  Invoke-Checked "cargo" @("build", "--manifest-path", "client-tauri\src-tauri\Cargo.toml")
}

Assert-Smoke (Test-Path $exePath) "Missing Tauri debug executable. Run without -SkipBuild first."

$existingProcessIds = @(
  Get-Process -Name "workhub-client-tauri" -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -ne ([System.Diagnostics.Process]::GetCurrentProcess().Id) } |
    Select-Object -ExpandProperty Id
)
Assert-Smoke ($existingProcessIds.Count -eq 0) "Close existing workhub-client-tauri process(es) before smoke QA: $($existingProcessIds -join ', ')"

$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$process = $null
$devServerProcess = $null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$screenshotPath = Join-Path $OutDir "cuu-tauri-smoke-$timestamp.png"

try {
  if (-not $UseRealAppData) {
    $isolatedRoot = Join-Path $OutDir "isolated-appdata"
    $isolatedAppData = Join-Path $isolatedRoot "Roaming"
    $isolatedLocalAppData = Join-Path $isolatedRoot "Local"
    New-Item -ItemType Directory -Force -Path $isolatedAppData, $isolatedLocalAppData | Out-Null
    $env:APPDATA = $isolatedAppData
    $env:LOCALAPPDATA = $isolatedLocalAppData
  }

  Write-Host "Launching WorkHub Tauri debug app..."
  $devServerProcess = Start-DesktopWebviewDevServerIfNeeded
  $process = Start-Process -FilePath $exePath -WorkingDirectory $srcTauriRoot -PassThru
  $snapshot = Wait-ForWorkHubWindows -TargetProcessId $process.Id -TimeoutSeconds $WaitSeconds

  if ($process.HasExited) {
    throw "Tauri app exited before smoke QA could inspect windows. Exit code: $($process.ExitCode)"
  }

  $pet = $snapshot.Pet
  $main = $snapshot.Main
  Assert-Smoke ($null -ne $pet) "Cuu pet window was not found by title."
  Assert-Smoke ($null -ne $main) "WorkHub main window was not found by title."
  Assert-Smoke $pet.Visible "Cuu pet window exists but is not visible."
  Assert-Smoke $pet.TopMost "Cuu pet window is not topmost."

  $virtualBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  Assert-Smoke (Test-RectInsideVirtualScreen -Rect $pet.Rect -Bounds $virtualBounds) "Cuu pet window is outside the virtual screen bounds."
  Assert-Smoke (Test-RectNearAnyWorkingAreaBottomRight -Rect $pet.Rect -MaxGap $MaxEdgeGapPx) "Cuu pet window is not anchored near a working area's bottom-right edge."

  Write-Host "Hiding main WorkHub window and checking Cuu remains alive..."
  [void][WorkHubCuuSmokeWin32]::ShowWindow($main.Hwnd, [WorkHubCuuSmokeWin32]::SW_HIDE)
  Start-Sleep -Milliseconds 900

  $windowsAfterHide = @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
  $petAfterHide = Select-SmokeWindow -Windows $windowsAfterHide -Title "Cuu"
  $mainAfterHide = Select-SmokeWindow -Windows $windowsAfterHide -Title "WorkHub"

  Assert-Smoke ($null -ne $petAfterHide) "Cuu pet window disappeared after the main window was hidden."
  Assert-Smoke $petAfterHide.Visible "Cuu pet window became hidden after the main window was hidden."
  Assert-Smoke $petAfterHide.TopMost "Cuu pet window lost topmost state after the main window was hidden."
  if ($mainAfterHide) {
    Assert-Smoke (-not $mainAfterHide.Visible) "WorkHub main window did not hide during smoke QA."
  }

  $visualCapture = Wait-ForCuuVisualPixels -TargetProcessId $process.Id -TimeoutSeconds $ContentWaitSeconds -ScreenshotPath $screenshotPath -MinVisualPixels $MinCuuVisualPixels
  Assert-Smoke ($null -ne $visualCapture.PixelReport) "Cuu pet window could not be captured after the main window was hidden."
  Assert-Smoke ($visualCapture.PixelReport.visual_pixels -ge $MinCuuVisualPixels) "Cuu visual pixels were below threshold in the pet window screenshot."

  [pscustomobject]@{
    passed = $true
    process_id = $process.Id
    screenshot = $screenshotPath
    isolated_app_data = (-not $UseRealAppData)
    pet_before_hide = [pscustomobject]@{
      handle = $pet.Handle
      visible = $pet.Visible
      topmost = $pet.TopMost
      rect = $pet.Rect
    }
    pet_after_hide = [pscustomobject]@{
      handle = $petAfterHide.Handle
      visible = $petAfterHide.Visible
      topmost = $petAfterHide.TopMost
      rect = $visualCapture.Pet.Rect
    }
    main_hidden = if ($mainAfterHide) { -not $mainAfterHide.Visible } else { $true }
    visual_attempts = $visualCapture.Attempts
    pixel_report = $visualCapture.PixelReport
  } | ConvertTo-Json -Depth 8
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
