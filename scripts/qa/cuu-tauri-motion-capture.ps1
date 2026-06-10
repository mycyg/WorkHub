param(
  [switch]$SkipBuild,
  [int]$WaitSeconds = 8,
  [int]$FrameCount = 32,
  [int]$IntervalMs = 180,
  [int]$PixelStep = 2,
  [int]$MinFirstFrameVisualPixels = 12000,
  [int]$MinBusinessCardVisualPixelsAtScale100 = 54000,
  [double]$MinLongRunVisualRatio = 0.7,
  [int]$MinLongRunChangedFrames = 3,
  [int]$MinMotionChangedPixelsGt8 = 60,
  [int]$MinMotionChangedFramesSmoke = 2,
  [int]$MinMotionChangedFramesFormal = 6,
  [int]$MinMotionFrameCountForFormal = 32,
  [int]$MaxStableRectDriftPx = 2,
  [ValidateSet("idle", "idle-long-run", "input-handfeel", "look-avoidance", "look-only", "drag-smoothing", "hide-on-hover", "launcher", "clarify", "approval", "search", "sync", "done", "offline")]
  [string]$Scenario = "idle",
  [ValidateSet(75, 100, 125, 150)]
  [int]$PetScalePercent = 100,
  [ValidateSet(60, 80, 100)]
  [int]$PetOpacityPercent = 100,
  [ValidateSet("cuu-hijiki-live2d-cubism2", "cuu-tororo-live2d-cubism2")]
  [string]$ModelPackId = "cuu-hijiki-live2d-cubism2",
  [ValidateSet("zh-CN", "en-US")]
  [string]$Locale = "zh-CN",
  [switch]$PetPassThrough,
  [switch]$PetHideOnHover,
  [switch]$DisableSse,
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
$qaScenarios = @("launcher", "clarify", "approval", "search", "sync", "done", "offline")
$businessScenarios = @("clarify", "approval", "search", "sync", "done", "offline")
$script:cuuCdpWebSocketUrl = $null
$script:cuuCdpCommandId = 1

function Invoke-Checked {
  param([string]$FilePath, [string[]]$ArgumentList)
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') exited with code $LASTEXITCODE"
  }
}

function Get-PnpmCommandSpec {
  $pnpm = (Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue).Source
  if (-not $pnpm) {
    $pnpm = (Get-Command "pnpm" -ErrorAction SilentlyContinue).Source
  }
  if ($pnpm) {
    return [pscustomobject]@{
      FilePath = $pnpm
      ArgumentPrefix = @()
    }
  }
  $corepack = (Get-Command "corepack.cmd" -ErrorAction SilentlyContinue).Source
  if (-not $corepack) {
    $corepack = (Get-Command "corepack" -ErrorAction SilentlyContinue).Source
  }
  if ($corepack) {
    return [pscustomobject]@{
      FilePath = $corepack
      ArgumentPrefix = @("pnpm")
    }
  }
  throw "Neither pnpm nor corepack is available for starting the desktop webview dev server."
}

function Invoke-PnpmChecked {
  param([string[]]$ArgumentList)
  $commandSpec = Get-PnpmCommandSpec
  $arguments = @()
  $arguments += $commandSpec.ArgumentPrefix
  $arguments += $ArgumentList
  Invoke-Checked $commandSpec.FilePath $arguments
}

function New-CuuCdpDebugPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Wait-CuuCdpPetWebSocketUrl {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 8
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2
      $pet = $targets |
        Where-Object { $_.url -like "*/pet.html*" -or $_.title -eq "Cuu" } |
        Select-Object -First 1
      if ($pet -and $pet.webSocketDebuggerUrl) {
        return $pet.webSocketDebuggerUrl
      }
    } catch {
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Invoke-CuuCdpCommand {
  param(
    [string]$WebSocketUrl,
    [string]$Method,
    [hashtable]$Params
  )
  $id = $script:cuuCdpCommandId
  $script:cuuCdpCommandId += 1
  $lastError = $null
  for ($attempt = 1; $attempt -le 6; $attempt += 1) {
    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $socket.Options.Proxy = $null
    try {
      $socket.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
      $payload = @{
        id = $id
        method = $Method
        params = $Params
      } | ConvertTo-Json -Depth 10 -Compress
      $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
      $socket.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
      $buffer = New-Object byte[] 1048576
      $stream = [System.IO.MemoryStream]::new()
      do {
        $result = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        if ($result.Count -gt 0) {
          $stream.Write($buffer, 0, $result.Count)
        }
      } while (-not $result.EndOfMessage)
      $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
      if ($message.PSObject.Properties.Name -contains "error") {
        throw "CDP $Method failed: $($message.error.message)"
      }
      return $message
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Milliseconds (160 * $attempt)
    } finally {
      $socket.Dispose()
    }
  }
  throw "Unable to send CDP command $Method after retries: $lastError"
}

function Invoke-CuuCdpMouseClick {
  param(
    [string]$WebSocketUrl,
    [int]$X,
    [int]$Y
  )
  Invoke-CuuCdpCommand -WebSocketUrl $WebSocketUrl -Method "Input.dispatchMouseEvent" -Params @{
    type = "mouseMoved"
    x = $X
    y = $Y
    button = "none"
    buttons = 0
  } | Out-Null
  Invoke-CuuCdpCommand -WebSocketUrl $WebSocketUrl -Method "Input.dispatchMouseEvent" -Params @{
    type = "mousePressed"
    x = $X
    y = $Y
    button = "left"
    buttons = 1
    clickCount = 1
  } | Out-Null
  Invoke-CuuCdpCommand -WebSocketUrl $WebSocketUrl -Method "Input.dispatchMouseEvent" -Params @{
    type = "mouseReleased"
    x = $X
    y = $Y
    button = "left"
    buttons = 0
    clickCount = 1
  } | Out-Null
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

  $commandSpec = Get-PnpmCommandSpec
  $arguments = @()
  $arguments += $commandSpec.ArgumentPrefix
  $arguments += @("--filter", "@workhub/desktop-webview", "dev")
  $devServerStdoutPath = Join-Path $OutDir "desktop-webview-dev-stdout.log"
  $devServerStderrPath = Join-Path $OutDir "desktop-webview-dev-stderr.log"
  Remove-Item -LiteralPath $devServerStdoutPath, $devServerStderrPath -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $commandSpec.FilePath -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $devServerStdoutPath -RedirectStandardError $devServerStderrPath -PassThru
  $deadline = (Get-Date).AddSeconds(25)
  do {
    if ($process.HasExited) {
      $stderrTail = if (Test-Path -LiteralPath $devServerStderrPath) { (Get-Content -LiteralPath $devServerStderrPath -Tail 40 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
      $stdoutTail = if (Test-Path -LiteralPath $devServerStdoutPath) { (Get-Content -LiteralPath $devServerStdoutPath -Tail 40 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
      throw "desktop webview dev server exited before opening port $Port. Exit code: $($process.ExitCode). stderr: $stderrTail stdout: $stdoutTail"
    }
    Start-Sleep -Milliseconds 500
  } while (-not (Test-LocalPort -Port $Port) -and (Get-Date) -lt $deadline)

  if (-not (Test-LocalPort -Port $Port)) {
    throw "desktop webview dev server did not open port $Port in time."
  }
  return $process
}

function Test-CuuBusinessScenario {
  param([string]$ScenarioName)
  return $businessScenarios -contains $ScenarioName
}

function Test-CuuQaScenario {
  param([string]$ScenarioName)
  return $qaScenarios -contains $ScenarioName
}

function Get-CuuExpectedBehaviorForScenario {
  param([string]$ScenarioName)
  switch ($ScenarioName) {
    "launcher" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "asking_approval"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "asking_approval_bounce"
        data_cuu_live2d_renderer_state = "mtn/01.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    "clarify" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "asking_approval"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "asking_approval_bounce"
        data_cuu_live2d_renderer_state = "mtn/01.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    "approval" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "asking_approval"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "asking_approval_bounce"
        data_cuu_live2d_renderer_state = "mtn/01.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    "search" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "searching_evidence"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "searching_evidence_peek"
        data_cuu_live2d_renderer_state = "mtn/04.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    "sync" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "syncing_files"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "syncing_files_spin"
        data_cuu_live2d_renderer_state = "mtn/04.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    "done" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "celebrating"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "celebrating_jump"
        data_cuu_live2d_renderer_state = "mtn/06.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "tip"
        data_pet_window_mode = "card"
      }
    }
    "offline" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "offline"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "worried_ears"
        data_cuu_live2d_renderer_state = "mtn/08.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    default {
      return [pscustomobject]@{
        data_cuu_behavior_state = "idle"
        data_cuu_behavior_phase = "idle_random"
        data_cuu_live2d_motion = $null
        data_cuu_live2d_renderer_state = "mtn/00_idle.mtn"
        data_cuu_behavior_expected_window_mode = "body_only"
        data_cuu_behavior_expected_bubble_mode = "none"
        data_pet_window_mode = "body_only"
      }
    }
  }
}

function Test-CuuActualDomMatchesExpected {
  param(
    [object]$Expected,
    [object]$Actual,
    [string]$ExpectedModelPackId,
    [string]$Scenario,
    [string]$ExpectedLocale = "zh-CN"
  )
  if (-not $Expected -or -not $Actual -or -not $Actual.surface -or -not $Actual.surface.data) {
    return $false
  }
  foreach ($property in $Expected.PSObject.Properties) {
    if ($null -eq $property.Value) {
      continue
    }
    $actualProperty = $Actual.surface.data.PSObject.Properties[$property.Name]
    $actualValue = if ($actualProperty) { $actualProperty.Value } else { $null }
    if ($actualValue -ne $property.Value) {
      return $false
    }
  }
  if (-not $Actual.live2d -or -not $Actual.live2d.present -or -not $Actual.live2d.data) {
    return $false
  }
  $requiredLive2D = @{
    data_cuu_live2d_runtime = "live2d_cubism2_cat"
    data_cuu_live2d_framing = "transparent_full_body"
    data_cuu_live2d_status = "approved_cat_option"
    data_cuu_model_pack = $ExpectedModelPackId
  }
  foreach ($entry in $requiredLive2D.GetEnumerator()) {
    $actualProperty = $Actual.live2d.data.PSObject.Properties[$entry.Key]
    $actualValue = if ($actualProperty) { $actualProperty.Value } else { $null }
    if ($actualValue -ne $entry.Value) {
      return $false
    }
  }
  foreach ($property in $Expected.PSObject.Properties) {
    if ($null -eq $property.Value -or -not $property.Name.StartsWith("data_cuu_", [System.StringComparison]::Ordinal)) {
      continue
    }
    $actualProperty = $Actual.live2d.data.PSObject.Properties[$property.Name]
    $actualValue = if ($actualProperty) { $actualProperty.Value } else { $null }
    if ($actualValue -ne $property.Value) {
      return $false
    }
  }
  if ($Expected.data_cuu_behavior_expected_bubble_mode -ne "none") {
    if (-not $Actual.bubble -or -not $Actual.bubble.present -or -not $Actual.bubble.data) {
      return $false
    }
    if ($Actual.bubble.data.data_pet_bubble -ne "true") {
      return $false
    }
    if ([string]::IsNullOrWhiteSpace([string]$Actual.bubble.data.data_cuu_card_id) -or [string]::IsNullOrWhiteSpace([string]$Actual.bubble.data.data_pet_bubble_kind)) {
      return $false
    }
    if (-not (Test-CuuBubbleRectNearLive2D -Actual $Actual)) {
      return $false
    }
  }
  $expectedActionByScenario = @{
    launcher = "start_agent_from_cuu"
    approval = "approve"
    clarify = "submit_option"
    search = "use_for_current_task"
    sync = "open_sync"
    done = "view_replay"
  }
  if ($expectedActionByScenario.ContainsKey($Scenario)) {
    if (-not $Actual.primary_action -or -not $Actual.primary_action.present -or -not $Actual.primary_action.data) {
      return $false
    }
    if ($Actual.primary_action.data.data_cuu_action_id -ne $expectedActionByScenario[$Scenario]) {
      return $false
    }
  }
  $expectedCardByScenario = @{
    launcher = "cuu-agent-launcher"
  }
  if ($expectedCardByScenario.ContainsKey($Scenario)) {
    if (-not $Actual.bubble -or -not $Actual.bubble.present -or -not $Actual.bubble.data) {
      return $false
    }
    if ($Actual.bubble.data.data_cuu_card_id -ne $expectedCardByScenario[$Scenario]) {
      return $false
    }
  }
  $expectedChipByScenario = @{
    launcher = "document-draft"
  }
  if ($expectedChipByScenario.ContainsKey($Scenario)) {
    if (-not $Actual.primary_chip -or -not $Actual.primary_chip.present -or -not $Actual.primary_chip.data) {
      return $false
    }
    if ($Actual.primary_chip.data.data_pet_option_id -ne $expectedChipByScenario[$Scenario]) {
      return $false
    }
  }
  if ($Scenario -eq "launcher" -and $Actual.bubble -and $Actual.bubble.text) {
    $expectedTitle = if ($ExpectedLocale -eq "en-US") { "What should Cuu do?" } else { "要让 Cuu 做什么" }
    if (-not ([string]$Actual.bubble.text).Contains($expectedTitle)) {
      return $false
    }
  }
  return $true
}

function Read-CuuDomRectNumber {
  param([object]$Rect, [string]$Name)
  if (-not $Rect) {
    return $null
  }
  $property = $Rect.PSObject.Properties[$Name]
  if (-not $property) {
    return $null
  }
  $value = $property.Value
  if ($value -is [int] -or $value -is [double] -or $value -is [decimal]) {
    return [double]$value
  }
  $parsed = 0.0
  if ([double]::TryParse([string]$value, [ref]$parsed)) {
    return $parsed
  }
  return $null
}

function Test-CuuBubbleRectNearLive2D {
  param([object]$Actual)

  $surface = $Actual.surface.rect
  $live2d = $Actual.live2d.rect
  $bubble = $Actual.bubble.rect
  foreach ($rect in @($surface, $live2d, $bubble)) {
    if (-not $rect) {
      return $false
    }
  }

  $surfaceRight = Read-CuuDomRectNumber $surface "right"
  $live2dX = Read-CuuDomRectNumber $live2d "x"
  $live2dY = Read-CuuDomRectNumber $live2d "y"
  $bubbleX = Read-CuuDomRectNumber $bubble "x"
  $bubbleRight = Read-CuuDomRectNumber $bubble "right"
  $bubbleBottom = Read-CuuDomRectNumber $bubble "bottom"
  foreach ($value in @($surfaceRight, $live2dX, $live2dY, $bubbleX, $bubbleRight, $bubbleBottom)) {
    if ($null -eq $value) {
      return $false
    }
  }

  $notLeftDetached = $bubbleX -ge ($live2dX - 48)
  $notRightClipped = $bubbleRight -le ($surfaceRight - 8)
  $notCoveringCatBody = $bubbleBottom -le ($live2dY + 96)
  return $notLeftDetached -and $notRightClipped -and $notCoveringCatBody
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

if (-not ([System.Management.Automation.PSTypeName]"WorkHubCuuInputWin32").Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class WorkHubCuuInputWin32
{
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
"@
}

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
    $background = $bitmap.GetPixel(0, 0)
    $samples = 0
    $foregroundPixels = 0
    $lightPixels = 0
    $darkPixels = 0

    for ($y = 0; $y -lt $bitmap.Height; $y += $step) {
      for ($x = 0; $x -lt $bitmap.Width; $x += $step) {
        $color = $bitmap.GetPixel($x, $y)
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
      if ($lastReport.visual_pixels -ge $MinVisualPixels) {
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

function Get-CuuRectDriftFrames {
  param(
    [object[]]$Rects,
    [int]$MaxDriftPx
  )
  if (-not $Rects -or $Rects.Count -eq 0) {
    return @()
  }
  $firstRect = $Rects[0]
  $driftFrames = @()
  for ($i = 0; $i -lt $Rects.Count; $i++) {
    $rect = $Rects[$i]
    $drift = [Math]::Abs($rect.Left - $firstRect.Left) +
      [Math]::Abs($rect.Top - $firstRect.Top) +
      [Math]::Abs($rect.Width - $firstRect.Width) +
      [Math]::Abs($rect.Height - $firstRect.Height)
    if ($drift -gt $MaxDriftPx) {
      $driftFrames += $i
    }
  }
  return $driftFrames
}

function New-CuuMotionLivenessReport {
  param(
    [string]$ScenarioName,
    [object[]]$Diffs,
    [object[]]$Rects,
    [int]$FrameCount,
    [int]$ChangedPixelsThreshold,
    [int]$MinChangedFramesSmoke,
    [int]$MinChangedFramesFormal,
    [int]$FormalFrameCount,
    [int]$MaxRectDriftPx,
    [bool]$IsBusinessScenario
  )

  $interactionScenarios = @("idle-long-run", "input-handfeel", "look-avoidance", "look-only", "drag-smoothing", "hide-on-hover", "launcher")
  $enabled = $IsBusinessScenario -or ($interactionScenarios -contains $ScenarioName)
  $quality = if ($FrameCount -ge $FormalFrameCount) { "formal_32" } else { "smoke" }
  $minChangedFrames = if ($quality -eq "formal_32") { $MinChangedFramesFormal } else { $MinChangedFramesSmoke }
  [object[]]$changedFrames = @($Diffs | Where-Object {
    $_.frame -gt 0 -and $_.vs_previous.changed_pixels_gt8 -ge $ChangedPixelsThreshold
  })
  $requiresStableRect = $ScenarioName -ne "drag-smoothing" -and $ScenarioName -ne "launcher"
  [object[]]$rectDriftFrames = if ($requiresStableRect) {
    @(Get-CuuRectDriftFrames -Rects $Rects -MaxDriftPx $MaxRectDriftPx)
  } else {
    @()
  }
  $changedFrameCount = ($changedFrames | Measure-Object).Count
  $rectDriftFrameCount = ($rectDriftFrames | Measure-Object).Count
  $passed = -not $enabled -or (
    $changedFrameCount -ge $minChangedFrames -and
    (-not $requiresStableRect -or $rectDriftFrameCount -eq 0)
  )

  [pscustomobject]@{
    enabled = $enabled
    passed = $passed
    quality = $quality
    min_formal_frame_count = $FormalFrameCount
    changed_pixels_gt8_threshold = $ChangedPixelsThreshold
    changed_frames_gt8_count = $changedFrameCount
    changed_frames = @($changedFrames | ForEach-Object { $_.frame })
    min_changed_frames = $minChangedFrames
    requires_stable_rect = $requiresStableRect
    max_rect_drift_px = $MaxRectDriftPx
    rect_drift_frames = $rectDriftFrames
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

function Set-CuuCursorPosition {
  param([int]$X, [int]$Y)
  if (-not [WorkHubCuuInputWin32]::SetCursorPos($X, $Y)) {
    throw "Unable to move cursor to $X,$Y for Cuu input scenario."
  }
}

function Invoke-CuuMouse {
  param([ValidateSet("down", "up")][string]$Action)
  if ($Action -eq "down") {
    [WorkHubCuuInputWin32]::mouse_event([WorkHubCuuInputWin32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  } else {
    [WorkHubCuuInputWin32]::mouse_event([WorkHubCuuInputWin32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  }
}

function Invoke-CuuInteractionScenarioFrame {
  param(
    [string]$ScenarioName,
    [int]$FrameIndex,
    [object]$Window
  )

  if ($ScenarioName -ne "input-handfeel" -and $ScenarioName -ne "look-avoidance" -and $ScenarioName -ne "look-only" -and $ScenarioName -ne "drag-smoothing" -and $ScenarioName -ne "hide-on-hover" -and $ScenarioName -ne "launcher") {
    return $null
  }

  $isLookAvoidance = $ScenarioName -eq "look-avoidance"
  $isLookOnly = $ScenarioName -eq "look-only"
  $isDragSmoothing = $ScenarioName -eq "drag-smoothing"
  $isHideOnHover = $ScenarioName -eq "hide-on-hover"
  $isLauncher = $ScenarioName -eq "launcher"
  $centerX = [int][Math]::Round(($Window.Rect.Left + $Window.Rect.Right) / 2)
  $centerY = [int][Math]::Round(($Window.Rect.Top + $Window.Rect.Bottom) / 2)
  $nearLeftX = [int]($Window.Rect.Left - 36)
  $nearRightX = [int]($Window.Rect.Right + 36)
  $nearY = $centerY
  $hoverX = if ($isLookAvoidance -or $isDragSmoothing -or $isHideOnHover) { [int][Math]::Round($centerX + [Math]::Min(42, $Window.Rect.Width * 0.24)) } else { $centerX }
  $hoverY = if ($isLookAvoidance -or $isDragSmoothing -or $isHideOnHover) { [int][Math]::Round($centerY - [Math]::Min(34, $Window.Rect.Height * 0.2)) } else { $centerY }
  $leaveX = [int]($Window.Rect.Right + 160)
  $leaveY = [int]($Window.Rect.Bottom + 80)
  $dragX = [int]($centerX - 48)
  $dragY = [int]($centerY - 28)
  $dragX2 = [int]($centerX - 86)
  $dragY2 = [int]($centerY - 52)

  $action = $null
  $x = $centerX
  $y = $centerY

  if ($isLauncher) {
    if ($FrameIndex -ne 2) {
      return $null
    }
    $action = "tap_body_open_launcher"
    Set-CuuCursorPosition -X $x -Y $y
    $inputDriver = "win32_mouse_event"
    $localX = [int][Math]::Round($Window.Rect.Width / 2)
    $localY = [int][Math]::Round($Window.Rect.Height / 2)
    if ($script:cuuCdpWebSocketUrl) {
      Invoke-CuuCdpMouseClick -WebSocketUrl $script:cuuCdpWebSocketUrl -X $localX -Y $localY
      $inputDriver = "webview2_cdp"
    } else {
      Invoke-CuuMouse -Action "down"
      Start-Sleep -Milliseconds 60
      Invoke-CuuMouse -Action "up"
    }
    Start-Sleep -Milliseconds 460
    return [pscustomobject]@{
      frame = $FrameIndex
      action = $action
      input_driver = $inputDriver
      cursor = [pscustomobject]@{
        x = $x
        y = $y
      }
      webview_point = [pscustomobject]@{
        x = $localX
        y = $localY
      }
      window_rect = $Window.Rect
    }
  }

  if ($isLookOnly) {
    switch ($FrameIndex) {
      1 {
        $action = "cursor_near_left_outside"
        $x = $nearLeftX
        $y = $nearY
        Set-CuuCursorPosition -X $x -Y $y
      }
      4 {
        $action = "cursor_near_right_outside"
        $x = $nearRightX
        $y = $nearY
        Set-CuuCursorPosition -X $x -Y $y
      }
      7 {
        $action = "hover_top_right_inside"
        $x = $hoverX
        $y = $hoverY
        Set-CuuCursorPosition -X $x -Y $y
      }
      12 {
        $action = "cursor_leave"
        $x = $leaveX
        $y = $leaveY
        Set-CuuCursorPosition -X $x -Y $y
      }
      16 {
        $action = "hover_inside_again"
        $x = $hoverX
        $y = $hoverY
        Set-CuuCursorPosition -X $x -Y $y
      }
      21 {
        $action = "cursor_leave_recover"
        $x = $leaveX
        $y = $leaveY
        Set-CuuCursorPosition -X $x -Y $y
      }
    }

    if (-not $action) {
      return $null
    }

    $postDelayMs = if ($action.StartsWith("hover") -or $action.StartsWith("cursor_near")) { 320 } else { 180 }
    Start-Sleep -Milliseconds $postDelayMs
    return [pscustomobject]@{
      frame = $FrameIndex
      action = $action
      cursor = [pscustomobject]@{
        x = $x
        y = $y
      }
      window_rect = $Window.Rect
    }
  }

  if ($isHideOnHover) {
    switch ($FrameIndex) {
      1 {
        $action = "cursor_near_left_outside"
        $x = $nearLeftX
        $y = $nearY
        Set-CuuCursorPosition -X $x -Y $y
      }
      4 {
        $action = "hover_top_right_inside_soft_hide"
        $x = $hoverX
        $y = $hoverY
        Set-CuuCursorPosition -X $x -Y $y
      }
      9 {
        $action = "hover_inside_hold"
        $x = $centerX
        $y = $centerY
        Set-CuuCursorPosition -X $x -Y $y
      }
      14 {
        $action = "cursor_leave_recover"
        $x = $leaveX
        $y = $leaveY
        Set-CuuCursorPosition -X $x -Y $y
      }
      18 {
        $action = "hover_inside_again"
        $x = $hoverX
        $y = $hoverY
        Set-CuuCursorPosition -X $x -Y $y
      }
    }

    if (-not $action) {
      return $null
    }

    $postDelayMs = if ($action.StartsWith("hover")) { 360 } else { 180 }
    Start-Sleep -Milliseconds $postDelayMs
    return [pscustomobject]@{
      frame = $FrameIndex
      action = $action
      cursor = [pscustomobject]@{
        x = $x
        y = $y
      }
      window_rect = $Window.Rect
    }
  }

  switch ($FrameIndex) {
    1 {
      $action = if ($isLookAvoidance -or $isDragSmoothing) { "cursor_near_left_outside" } else { "cursor_near_outside" }
      $x = $nearLeftX
      $y = $nearY
      Set-CuuCursorPosition -X $x -Y $y
    }
    3 {
      if (-not $isDragSmoothing) {
        break
      }
      $action = "cursor_near_right_outside"
      $x = $nearRightX
      $y = $nearY
      Set-CuuCursorPosition -X $x -Y $y
    }
    5 {
      if (-not $isDragSmoothing) {
        break
      }
      $action = "cursor_near_left_outside_again"
      $x = $nearLeftX
      $y = $nearY
      Set-CuuCursorPosition -X $x -Y $y
    }
    4 {
      if (-not $isLookAvoidance) {
        break
      }
      $action = "cursor_near_right_outside"
      $x = $nearRightX
      $y = $nearY
      Set-CuuCursorPosition -X $x -Y $y
    }
    7 {
      $action = if ($isLookAvoidance -or $isDragSmoothing) { "hover_top_right_inside" } else { "hover_inside" }
      $x = $hoverX
      $y = $hoverY
      Set-CuuCursorPosition -X $x -Y $y
    }
    11 {
      $action = "tap_body"
      Set-CuuCursorPosition -X $x -Y $y
      Invoke-CuuMouse -Action "down"
      Start-Sleep -Milliseconds 60
      Invoke-CuuMouse -Action "up"
    }
    15 {
      $action = "drag_start"
      Set-CuuCursorPosition -X $x -Y $y
      Invoke-CuuMouse -Action "down"
    }
    16 {
      $action = "drag_move"
      $x = $dragX
      $y = $dragY
      Set-CuuCursorPosition -X $x -Y $y
    }
    17 {
      if (-not $isDragSmoothing) {
        break
      }
      $action = "drag_move_second"
      $x = $dragX2
      $y = $dragY2
      Set-CuuCursorPosition -X $x -Y $y
    }
    18 {
      $action = "drag_release"
      $x = if ($isDragSmoothing) { $dragX2 } else { $dragX }
      $y = if ($isDragSmoothing) { $dragY2 } else { $dragY }
      Set-CuuCursorPosition -X $x -Y $y
      Invoke-CuuMouse -Action "up"
    }
  }

  if (-not $action) {
    return $null
  }

  $postDelayMs = if (($isLookAvoidance -or $isDragSmoothing) -and $action.StartsWith("cursor_near")) { 320 } else { 110 }
  Start-Sleep -Milliseconds $postDelayMs
  [pscustomobject]@{
    frame = $FrameIndex
    action = $action
    cursor = [pscustomobject]@{
      x = $x
      y = $y
    }
    window_rect = $Window.Rect
  }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$framesDir = Join-Path $OutDir "frames"
New-Item -ItemType Directory -Force -Path $framesDir | Out-Null
$domReportPath = Join-Path $OutDir "cuu-tauri-dom-report.json"
Remove-Item -LiteralPath $domReportPath -ErrorAction SilentlyContinue
Set-Location $repoRoot

if (-not $SkipBuild) {
  Invoke-PnpmChecked @("--filter", "@workhub/desktop-webview", "build")
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
$originalDisableSse = $env:WORKHUB_DISABLE_SSE
$originalCuuQaHideOnHover = $env:WORKHUB_CUU_QA_HIDE_ON_HOVER
$originalCuuQaPetScalePercent = $env:WORKHUB_CUU_QA_PET_SCALE_PERCENT
$originalCuuQaPetOpacityPercent = $env:WORKHUB_CUU_QA_PET_OPACITY_PERCENT
$originalCuuQaPetPassThrough = $env:WORKHUB_CUU_QA_PET_PASS_THROUGH
$originalCuuQaModelPackId = $env:WORKHUB_CUU_QA_MODEL_PACK_ID
$originalCuuQaScenario = $env:WORKHUB_CUU_QA_SCENARIO
$originalCuuQaLocale = $env:WORKHUB_CUU_QA_LOCALE
$originalCuuQaDomReportPath = $env:WORKHUB_CUU_QA_DOM_REPORT_PATH
$originalWebView2AdditionalBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$process = $null
$devServerProcess = $null
$isolatedRoot = $null
$cuuCdpDebugPort = $null

try {
  if (-not $UseRealAppData) {
    $isolatedRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("workhub-cuu-tauri-motion-appdata-{0}" -f [System.Guid]::NewGuid().ToString("N"))
    $isolatedAppData = Join-Path $isolatedRoot "Roaming"
    $isolatedLocalAppData = Join-Path $isolatedRoot "Local"
    New-Item -ItemType Directory -Force -Path $isolatedAppData, $isolatedLocalAppData | Out-Null
    $env:APPDATA = $isolatedAppData
    $env:LOCALAPPDATA = $isolatedLocalAppData
  }

  $sseDisabledForScenario = $false
  if ($Scenario -ne "idle" -or $DisableSse) {
    $env:WORKHUB_DISABLE_SSE = "1"
    $sseDisabledForScenario = $true
  }
  $expectedBehavior = Get-CuuExpectedBehaviorForScenario -ScenarioName $Scenario
  $isBusinessScenario = Test-CuuBusinessScenario -ScenarioName $Scenario
  $isQaScenario = Test-CuuQaScenario -ScenarioName $Scenario
  if ($isQaScenario) {
    $env:WORKHUB_CUU_QA_SCENARIO = $Scenario
  } else {
    Remove-Item -Path "Env:WORKHUB_CUU_QA_SCENARIO" -ErrorAction SilentlyContinue
  }
  $env:WORKHUB_CUU_QA_PET_SCALE_PERCENT = "$PetScalePercent"
  $env:WORKHUB_CUU_QA_PET_OPACITY_PERCENT = "$PetOpacityPercent"
  $env:WORKHUB_CUU_QA_MODEL_PACK_ID = $ModelPackId
  $env:WORKHUB_CUU_QA_LOCALE = $Locale
  $env:WORKHUB_CUU_QA_DOM_REPORT_PATH = $domReportPath
  if ($PetPassThrough) {
    $env:WORKHUB_CUU_QA_PET_PASS_THROUGH = "1"
  } else {
    Remove-Item -Path "Env:WORKHUB_CUU_QA_PET_PASS_THROUGH" -ErrorAction SilentlyContinue
  }
  $cuuQaHideOnHover = $false
  if ($Scenario -eq "hide-on-hover" -or $PetHideOnHover) {
    $env:WORKHUB_CUU_QA_HIDE_ON_HOVER = "1"
    $cuuQaHideOnHover = $true
    Set-CuuCursorPosition -X 120 -Y 120
  }
  if ($Scenario -eq "idle-long-run") {
    Set-CuuCursorPosition -X 120 -Y 120
  }
  if ($Scenario -eq "launcher") {
    $cuuCdpDebugPort = New-CuuCdpDebugPort
    $remoteDebugArgument = "--remote-debugging-port=$cuuCdpDebugPort"
    if ([string]::IsNullOrWhiteSpace($originalWebView2AdditionalBrowserArguments)) {
      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $remoteDebugArgument
    } else {
      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "$originalWebView2AdditionalBrowserArguments $remoteDebugArgument"
    }
  }

  $firstFrameMinVisualPixels = $MinFirstFrameVisualPixels
  if ($Scenario -eq "launcher") {
    $firstFrameMinVisualPixels = 0
  }
  $firstFrameUsesBusinessCardGate = $isBusinessScenario -and $expectedBehavior.data_pet_window_mode -eq "card"
  if ($firstFrameUsesBusinessCardGate) {
    $scaleRatioForGate = $PetScalePercent / 100.0
    $firstFrameMinVisualPixels = [Math]::Max(
      $MinFirstFrameVisualPixels,
      [int][Math]::Round($MinBusinessCardVisualPixelsAtScale100 * $scaleRatioForGate * $scaleRatioForGate)
    )
  }

  $devServerProcess = Start-DesktopWebviewDevServerIfNeeded
  $tauriStdoutPath = Join-Path $OutDir "tauri-stdout.log"
  $tauriStderrPath = Join-Path $OutDir "tauri-stderr.log"
  Remove-Item -LiteralPath $tauriStdoutPath, $tauriStderrPath -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $exePath -WorkingDirectory $srcTauriRoot -RedirectStandardOutput $tauriStdoutPath -RedirectStandardError $tauriStderrPath -PassThru
  $firstFrameProbe = Join-Path $OutDir "first-frame-probe.png"
  $firstFrameGate = Wait-ForCuuVisualWindow -TargetProcessId $process.Id -TimeoutSeconds $WaitSeconds -ProbePath $firstFrameProbe -MinVisualPixels $firstFrameMinVisualPixels
  if (-not $firstFrameGate.Pet) {
    $process.Refresh()
    $stderrTail = if (Test-Path -LiteralPath $tauriStderrPath) { (Get-Content -LiteralPath $tauriStderrPath -Tail 40 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
    $stdoutTail = if (Test-Path -LiteralPath $tauriStdoutPath) { (Get-Content -LiteralPath $tauriStdoutPath -Tail 40 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
    if ($process.HasExited) {
      throw "Tauri app exited before Cuu pet window appeared. Exit code: $($process.ExitCode). stderr: $stderrTail stdout: $stdoutTail"
    }
    $windowSummary = @(Get-WorkHubProcessWindows -TargetProcessId $process.Id) |
      Select-Object -Property Handle, Title, Visible, Rect
    $windowJson = if ($windowSummary.Count -gt 0) { $windowSummary | ConvertTo-Json -Compress -Depth 6 } else { "[]" }
    throw "Cuu pet window was not found by title. Process id: $($process.Id). Windows: $windowJson stderr: $stderrTail stdout: $stdoutTail"
  }
  if (-not $firstFrameGate.Passed) {
    $pixelReport = if ($firstFrameGate.PixelReport) { $firstFrameGate.PixelReport | ConvertTo-Json -Compress } else { "null" }
    throw "Cuu pet first visual frame did not reach pixel threshold visual>=$firstFrameMinVisualPixels after $($firstFrameGate.Attempts) attempt(s). Last pixel report: $pixelReport"
  }
  $pet = $firstFrameGate.Pet
  if ($Scenario -eq "launcher" -and $cuuCdpDebugPort) {
    $script:cuuCdpWebSocketUrl = Wait-CuuCdpPetWebSocketUrl -Port $cuuCdpDebugPort -TimeoutSeconds $WaitSeconds
  }
  if ($Scenario -eq "look-only") {
    Start-Sleep -Milliseconds 700
    $stabilizedPet = Select-CuuWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    if ($stabilizedPet) {
      $pet = $stabilizedPet
    }
  }

  $frames = [System.Collections.Generic.List[string]]::new()
  $rects = [System.Collections.Generic.List[object]]::new()
  $scenarioEvents = [System.Collections.Generic.List[object]]::new()
  for ($i = 0; $i -lt $FrameCount; $i++) {
    $pet = Select-CuuWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    if (-not $pet) {
      throw "Cuu pet window disappeared during motion capture at frame $i."
    }
    $scenarioEvent = Invoke-CuuInteractionScenarioFrame -ScenarioName $Scenario -FrameIndex $i -Window $pet
    if ($scenarioEvent) {
      $scenarioEvents.Add($scenarioEvent) | Out-Null
      $pet = Select-CuuWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
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
  $framePixelReports = @()
  for ($i = 0; $i -lt $frames.Count; $i++) {
    $framePixelReport = Measure-CuuFrameVisualPixels -Path $frames[$i]
    $vsFirst = Measure-FrameDiff -BasePath $frames[0] -Path $frames[$i] -Step $PixelStep
    $vsPrevious = if ($i -gt 0) { Measure-FrameDiff -BasePath $frames[$i - 1] -Path $frames[$i] -Step $PixelStep } else { $vsFirst }
    $framePixelReports += [pscustomobject]@{
      frame = $i
      pixel_report = $framePixelReport
    }
    $diffs += [pscustomobject]@{
      frame = $i
      rect = $rects[$i]
      vs_first = $vsFirst
      vs_previous = $vsPrevious
    }
  }

  $longRunReport = $null
  if ($Scenario -eq "idle-long-run") {
    $baselinePixels = $firstFrameGate.PixelReport
    $minLongRunVisualPixels = [Math]::Floor($baselinePixels.visual_pixels * $MinLongRunVisualRatio)
    $lowVisualFrames = @($framePixelReports | Where-Object {
      $_.pixel_report.visual_pixels -lt $minLongRunVisualPixels
    })
    $rectDriftFrames = @(Get-CuuRectDriftFrames -Rects $rects.ToArray() -MaxDriftPx $MaxStableRectDriftPx)
    $changedFrames = @($diffs | Where-Object {
      $_.frame -gt 0 -and $_.vs_previous.changed_pixels_gt8 -ge $MinMotionChangedPixelsGt8
    })
    $longRunPassed = $lowVisualFrames.Count -eq 0 -and
      $rectDriftFrames.Count -eq 0 -and
      $changedFrames.Count -ge $MinLongRunChangedFrames
    $longRunReport = [pscustomobject]@{
      enabled = $true
      passed = $longRunPassed
      min_visual_ratio = $MinLongRunVisualRatio
      min_visual_pixels = $minLongRunVisualPixels
      low_visual_frames = @($lowVisualFrames | ForEach-Object { $_.frame })
      rect_drift_frames = $rectDriftFrames
      max_rect_drift_px = $MaxStableRectDriftPx
      changed_frames_gt8_threshold = $MinMotionChangedPixelsGt8
      changed_frames_gt8_count = $changedFrames.Count
      min_changed_frames = $MinLongRunChangedFrames
      min_frame_visual_pixels = ($framePixelReports | ForEach-Object { $_.pixel_report.visual_pixels } | Measure-Object -Minimum).Minimum
    }
  }

  $actualDomReport = $null
  $actualDomReportAvailable = Test-Path -LiteralPath $domReportPath
  if ($actualDomReportAvailable) {
    try {
      $actualDomReport = Get-Content -LiteralPath $domReportPath -Raw | ConvertFrom-Json
    } catch {
      $actualDomReport = [pscustomobject]@{
        parse_error = $_.Exception.Message
        raw_path = $domReportPath
      }
    }
  }
  $actualDomMatchesExpected = Test-CuuActualDomMatchesExpected -Expected $expectedBehavior -Actual $actualDomReport -ExpectedModelPackId $ModelPackId -Scenario $Scenario -ExpectedLocale $Locale

  $motionLivenessReport = New-CuuMotionLivenessReport `
    -ScenarioName $Scenario `
    -Diffs $diffs `
    -Rects $rects.ToArray() `
    -FrameCount $FrameCount `
    -ChangedPixelsThreshold $MinMotionChangedPixelsGt8 `
    -MinChangedFramesSmoke $MinMotionChangedFramesSmoke `
    -MinChangedFramesFormal $MinMotionChangedFramesFormal `
    -FormalFrameCount $MinMotionFrameCountForFormal `
    -MaxRectDriftPx $MaxStableRectDriftPx `
    -IsBusinessScenario $isBusinessScenario
  $motionGatePassed = $motionLivenessReport.passed -and (($null -eq $longRunReport) -or $longRunReport.passed)
  $capturePassed = $motionGatePassed -and $actualDomReportAvailable -and $actualDomMatchesExpected

  $report = [pscustomobject]@{
    passed = $capturePassed
    scenario = $Scenario
    business_scenario = $isBusinessScenario
    sse_disabled_for_scenario = $sseDisabledForScenario
    cuu_qa_hide_on_hover = $cuuQaHideOnHover
    expected_behavior_contract = $expectedBehavior
    motion_gate_passed = $motionGatePassed
    actual_dom_report_path = if ($actualDomReportAvailable) { $domReportPath } else { $null }
    actual_dom_matches_expected = $actualDomMatchesExpected
    actual_dom_report = $actualDomReport
    cuu_qa_preferences = [pscustomobject]@{
      pet_scale_percent = $PetScalePercent
      pet_opacity_percent = $PetOpacityPercent
      pet_pass_through = [bool]$PetPassThrough
      pet_hide_on_hover = $cuuQaHideOnHover
      pet_model_pack_id = $ModelPackId
      pet_locale = $Locale
      pet_qa_scenario = if ($isQaScenario) { $Scenario } else { $null }
      webview2_cdp_enabled = [bool]$script:cuuCdpWebSocketUrl
    }
    scenario_events = $scenarioEvents.ToArray()
    process_id = $process.Id
    frame_count = $FrameCount
    interval_ms = $IntervalMs
    frames_dir = $framesDir
    contact_sheet = $contactSheet
    first_frame_gate = [pscustomobject]@{
      passed = $firstFrameGate.Passed
      attempts = $firstFrameGate.Attempts
      probe_path = $firstFrameGate.ProbePath
      min_visual_pixels = $firstFrameMinVisualPixels
      business_card_gate = $firstFrameUsesBusinessCardGate
      pixel_report = $firstFrameGate.PixelReport
    }
    max_vs_first_mean_abs_delta = ($diffs | ForEach-Object { $_.vs_first.mean_abs_delta } | Measure-Object -Maximum).Maximum
    max_vs_previous_mean_abs_delta = ($diffs | ForEach-Object { $_.vs_previous.mean_abs_delta } | Measure-Object -Maximum).Maximum
    max_vs_first_changed_pixels_gt8 = ($diffs | ForEach-Object { $_.vs_first.changed_pixels_gt8 } | Measure-Object -Maximum).Maximum
    max_vs_previous_changed_pixels_gt8 = ($diffs | ForEach-Object { $_.vs_previous.changed_pixels_gt8 } | Measure-Object -Maximum).Maximum
    frame_pixel_reports = $framePixelReports
    motion_liveness = $motionLivenessReport
    long_run = $longRunReport
    frames = $diffs
  }
  $reportPath = Join-Path $OutDir "motion-diff-report.json"
  $report | ConvertTo-Json -Depth 10 | Set-Content -Path $reportPath -Encoding UTF8
  if (-not $capturePassed) {
    throw "Cuu motion capture failed. See $reportPath"
  }

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
    passed = $capturePassed
    scenario = $Scenario
    business_scenario = $isBusinessScenario
    sse_disabled_for_scenario = $sseDisabledForScenario
    cuu_qa_hide_on_hover = $cuuQaHideOnHover
    expected_behavior_contract = $expectedBehavior
    motion_gate_passed = $motionGatePassed
    actual_dom_report_path = if ($actualDomReportAvailable) { $domReportPath } else { $null }
    actual_dom_matches_expected = $actualDomMatchesExpected
    cuu_qa_preferences = [pscustomobject]@{
      pet_scale_percent = $PetScalePercent
      pet_opacity_percent = $PetOpacityPercent
      pet_pass_through = [bool]$PetPassThrough
      pet_hide_on_hover = $cuuQaHideOnHover
      pet_model_pack_id = $ModelPackId
      pet_locale = $Locale
      pet_qa_scenario = if ($isQaScenario) { $Scenario } else { $null }
      webview2_cdp_enabled = [bool]$script:cuuCdpWebSocketUrl
    }
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
  Restore-EnvVar -Name "WORKHUB_DISABLE_SSE" -Value $originalDisableSse
  Restore-EnvVar -Name "WORKHUB_CUU_QA_HIDE_ON_HOVER" -Value $originalCuuQaHideOnHover
  Restore-EnvVar -Name "WORKHUB_CUU_QA_PET_SCALE_PERCENT" -Value $originalCuuQaPetScalePercent
  Restore-EnvVar -Name "WORKHUB_CUU_QA_PET_OPACITY_PERCENT" -Value $originalCuuQaPetOpacityPercent
  Restore-EnvVar -Name "WORKHUB_CUU_QA_PET_PASS_THROUGH" -Value $originalCuuQaPetPassThrough
  Restore-EnvVar -Name "WORKHUB_CUU_QA_MODEL_PACK_ID" -Value $originalCuuQaModelPackId
  Restore-EnvVar -Name "WORKHUB_CUU_QA_SCENARIO" -Value $originalCuuQaScenario
  Restore-EnvVar -Name "WORKHUB_CUU_QA_LOCALE" -Value $originalCuuQaLocale
  Restore-EnvVar -Name "WORKHUB_CUU_QA_DOM_REPORT_PATH" -Value $originalCuuQaDomReportPath
  Restore-EnvVar -Name "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS" -Value $originalWebView2AdditionalBrowserArguments
  if ($isolatedRoot) {
    $resolvedIsolatedRoot = [System.IO.Path]::GetFullPath($isolatedRoot)
    $resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedIsolatedRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedIsolatedRoot)) {
      Remove-Item -LiteralPath $resolvedIsolatedRoot -Recurse -Force
    }
  }
  if ($devServerProcess -and -not $devServerProcess.HasExited) {
    Stop-Process -Id $devServerProcess.Id -Force
    $devServerProcess.WaitForExit()
  }
}
