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
  [int]$MaxRightEdgeLightPixels = 2,
  [ValidateSet("idle", "idle-long-run", "input-handfeel", "look-avoidance", "look-only", "drag-smoothing", "hide-on-hover", "launcher", "settings-menu", "settings-menu-model-switch", "settings-menu-hover-sync", "pass-through-recovery-settings", "pass-through-recovery-tray", "pass-through-recovery-tray-physical", "clarify", "approval", "search", "sync", "done", "run-stream", "run-failure", "reload-session", "reload-active-run", "reload-terminal-run", "permission-401", "permission-403", "generic-runtime-error", "stream-offline", "offline")]
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

function Normalize-ProcessEnvironmentKeys {
  $groups = @{}
  $variables = [System.Environment]::GetEnvironmentVariables("Process")
  foreach ($keyObject in $variables.Keys) {
    $key = [string]$keyObject
    $normalKey = $key.ToUpperInvariant()
    if (-not $groups.ContainsKey($normalKey)) {
      $groups[$normalKey] = New-Object System.Collections.Generic.List[string]
    }
    $groups[$normalKey].Add($key)
  }

  foreach ($normalKey in $groups.Keys) {
    $keys = @($groups[$normalKey].ToArray())
    if ($keys.Count -le 1) {
      continue
    }
    $canonicalKey = if ($normalKey -eq "PATH") { "Path" } else { $keys[0] }
    $canonicalValue = [System.Environment]::GetEnvironmentVariable($canonicalKey, "Process")
    if ($null -eq $canonicalValue) {
      foreach ($key in $keys) {
        $candidateValue = [System.Environment]::GetEnvironmentVariable($key, "Process")
        if ($null -ne $candidateValue) {
          $canonicalValue = $candidateValue
          break
        }
      }
    }
    foreach ($key in $keys) {
      [System.Environment]::SetEnvironmentVariable($key, $null, "Process")
    }
    if ($null -ne $canonicalValue) {
      [System.Environment]::SetEnvironmentVariable($canonicalKey, $canonicalValue, "Process")
    }
  }
}

Normalize-ProcessEnvironmentKeys

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "Cuu motion capture QA is Windows-only because it validates Win32 transparent-window behavior."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$srcTauriRoot = Join-Path $repoRoot "client-tauri\src-tauri"
$exePath = Join-Path $srcTauriRoot "target\debug\workhub-client-tauri.exe"
$qaScenarios = @("launcher", "settings-menu", "settings-menu-model-switch", "settings-menu-hover-sync", "pass-through-recovery-settings", "pass-through-recovery-tray", "pass-through-recovery-tray-physical", "clarify", "approval", "search", "sync", "done", "run-stream", "run-failure", "reload-session", "reload-active-run", "reload-terminal-run", "permission-401", "permission-403", "generic-runtime-error", "stream-offline", "offline")
$businessScenarios = @("clarify", "approval", "search", "sync", "done", "run-stream", "run-failure", "reload-session", "reload-active-run", "reload-terminal-run", "permission-401", "permission-403", "generic-runtime-error", "stream-offline", "offline")
$reloadRestoreScenarios = @("reload-session", "reload-active-run", "reload-terminal-run")
$script:cuuCdpWebSocketUrl = $null
$script:cuuMainCdpWebSocketUrl = $null
$script:cuuCdpCommandId = 1

function Invoke-Checked {
  param([string]$FilePath, [string[]]$ArgumentList)
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') exited with code $LASTEXITCODE"
  }
}

function Get-PnpmCommandSpec {
  $pnpmCommand = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
  $pnpm = if ($pnpmCommand) { $pnpmCommand.Source } else { $null }
  if (-not $pnpm) {
    $pnpmCommand = Get-Command "pnpm" -ErrorAction SilentlyContinue
    $pnpm = if ($pnpmCommand) { $pnpmCommand.Source } else { $null }
  }
  if ($pnpm) {
    return [pscustomobject]@{
      FilePath = $pnpm
      ArgumentPrefix = @()
    }
  }
  $corepackCommand = Get-Command "corepack.cmd" -ErrorAction SilentlyContinue
  $corepack = if ($corepackCommand) { $corepackCommand.Source } else { $null }
  if (-not $corepack) {
    $corepackCommand = Get-Command "corepack" -ErrorAction SilentlyContinue
    $corepack = if ($corepackCommand) { $corepackCommand.Source } else { $null }
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

function Wait-CuuCdpMainWebSocketUrl {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 8
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2
      $main = $targets |
        Where-Object {
          $_.webSocketDebuggerUrl -and
          ($_.title -eq "WorkHub" -or $_.url -like "http://127.0.0.1:1420/*" -or $_.url -like "tauri://localhost/*") -and
          $_.url -notlike "*/pet.html*"
        } |
        Select-Object -First 1
      if ($main -and $main.webSocketDebuggerUrl) {
        return $main.webSocketDebuggerUrl
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
    [int]$Y,
    [ValidateSet("left", "right")]
    [string]$Button = "left"
  )
  $buttons = if ($Button -eq "right") { 2 } else { 1 }
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
    button = $Button
    buttons = $buttons
    clickCount = 1
  } | Out-Null
  Invoke-CuuCdpCommand -WebSocketUrl $WebSocketUrl -Method "Input.dispatchMouseEvent" -Params @{
    type = "mouseReleased"
    x = $X
    y = $Y
    button = $Button
    buttons = 0
    clickCount = 1
  } | Out-Null
}

function Invoke-CuuCdpJsonExpression {
  param(
    [string]$WebSocketUrl,
    [string]$Expression
  )
  $message = Invoke-CuuCdpCommand -WebSocketUrl $WebSocketUrl -Method "Runtime.evaluate" -Params @{
    expression = $Expression
    returnByValue = $true
    awaitPromise = $true
  }
  if ($message.result.PSObject.Properties.Name -contains "exceptionDetails") {
    $exceptionText = $message.result.exceptionDetails.text
    if ($message.result.exceptionDetails.exception -and $message.result.exceptionDetails.exception.description) {
      $exceptionText = $message.result.exceptionDetails.exception.description
    }
    throw "CDP Runtime.evaluate failed: $exceptionText"
  }
  $resultObject = $message.result.result
  if (-not $resultObject) {
    return $null
  }
  $valueProperty = $resultObject.PSObject.Properties["value"]
  $value = if ($valueProperty) { $valueProperty.Value } else { $null }
  if ($null -eq $value) {
    $descriptionProperty = $resultObject.PSObject.Properties["description"]
    if ($descriptionProperty) {
      $value = $descriptionProperty.Value
    }
  }
  if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
    return $null
  }
  return ([string]$value | ConvertFrom-Json)
}

function Invoke-CuuCdpClickSelector {
  param(
    [string]$WebSocketUrl,
    [string]$Selector
  )
  $selectorJson = $Selector | ConvertTo-Json -Compress
  $point = Invoke-CuuCdpJsonExpression -WebSocketUrl $WebSocketUrl -Expression @"
(async () => {
  const target = document.querySelector($selectorJson);
  if (!target) {
    return JSON.stringify({ found: false });
  }
  target.scrollIntoView({ block: "center", inline: "center" });
  await new Promise((resolve) => setTimeout(resolve, 90));
  const rect = target.getBoundingClientRect();
  return JSON.stringify({
    found: true,
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  });
})()
"@
  if (-not $point -or -not $point.found) {
    throw "Unable to find Cuu CDP selector: $Selector"
  }
  Invoke-CuuCdpMouseClick -WebSocketUrl $WebSocketUrl -X ([int]$point.x) -Y ([int]$point.y)
  return $point
}

function Invoke-CuuCdpRestorePetInteractionCommand {
  param([string]$WebSocketUrl)
  Invoke-CuuCdpJsonExpression -WebSocketUrl $WebSocketUrl -Expression @"
(async () => {
  const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!invoke) {
    return JSON.stringify({ ok: false, error: "missing_tauri_invoke" });
  }
  const result = await invoke("restore_pet_window_interaction");
  return JSON.stringify({ ok: true, result });
})()
"@
}

function Invoke-CuuCdpPetSettingsSnapshot {
  param([string]$WebSocketUrl)
  Invoke-CuuCdpJsonExpression -WebSocketUrl $WebSocketUrl -Expression @"
(() => {
  const surface = document.querySelector("[data-wh-surface='pet']");
  const menu = document.querySelector("[data-pet-settings-menu]");
  return JSON.stringify({
    url: location.href,
    surface: surface ? {
      present: true,
      data_pet_pass_through: surface.dataset.petPassThrough || "",
      data_pet_hide_on_hover: surface.dataset.petHideOnHover || "",
      data_pet_opacity_percent: surface.dataset.petOpacityPercent || "",
      data_pet_scale_percent: surface.dataset.petScalePercent || "",
      data_pet_menu_open: surface.dataset.petMenuOpen || ""
    } : { present: false },
    settings_menu: menu ? {
      present: true,
      hidden: menu.hidden === true,
      text: menu.textContent || ""
    } : { present: false }
  });
})()
"@
}

function Invoke-CuuCdpSeedCuuPreferenceStorage {
  param(
    [string]$WebSocketUrl,
    [ValidateSet(75, 100, 125, 150)]
    [int]$ScalePercent = 100,
    [ValidateSet(60, 80, 100)]
    [int]$OpacityPercent = 100,
    [bool]$PassThrough = $false,
    [bool]$HideOnHover = $false,
    [ValidateSet("cuu-hijiki-live2d-cubism2", "cuu-tororo-live2d-cubism2")]
    [string]$ModelPackId = "cuu-hijiki-live2d-cubism2",
    [switch]$Reload
  )
  $preferences = [ordered]@{
    attention_mode = "normal"
    sound_mode = "on"
    reduced_motion = $false
    queue_limit = 5
    pet_scale_percent = $ScalePercent
    pet_opacity_percent = $OpacityPercent
    pet_pass_through = $PassThrough
    pet_hide_on_hover = $HideOnHover
    pet_model_pack_id = $ModelPackId
  }
  $preferencesJson = ($preferences | ConvertTo-Json -Compress) | ConvertTo-Json -Compress
  $reloadJson = if ($Reload) { "true" } else { "false" }
  Invoke-CuuCdpJsonExpression -WebSocketUrl $WebSocketUrl -Expression @"
(() => {
  const preferencesJson = $preferencesJson;
  window.localStorage.setItem("workhub_cuu_preferences", preferencesJson);
  if ($reloadJson) {
    window.location.reload();
  }
  return JSON.stringify({ seeded: true, reloaded: $reloadJson });
})()
"@
}

function Wait-CuuCdpPetSettingsState {
  param(
    [string]$WebSocketUrl,
    [bool]$ExpectedPassThrough,
    [bool]$ExpectedHideOnHover = $false,
    [int]$ExpectedOpacityPercent = 100,
    [int]$TimeoutSeconds = 8
  )
  $expectedPassThroughText = if ($ExpectedPassThrough) { "true" } else { "false" }
  $expectedHideOnHoverText = if ($ExpectedHideOnHover) { "true" } else { "false" }
  $expectedOpacityText = [string]$ExpectedOpacityPercent
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastSnapshot = $null
  $lastErrorMessage = $null
  do {
    try {
      $snapshot = Invoke-CuuCdpPetSettingsSnapshot -WebSocketUrl $WebSocketUrl
      $lastSnapshot = $snapshot
      if (
        $snapshot -and
        $snapshot.surface -and
        $snapshot.surface.present -and
        [string]$snapshot.surface.data_pet_pass_through -eq $expectedPassThroughText -and
        [string]$snapshot.surface.data_pet_hide_on_hover -eq $expectedHideOnHoverText -and
        [string]$snapshot.surface.data_pet_opacity_percent -eq $expectedOpacityText
      ) {
        return $snapshot
      }
    } catch {
      $lastErrorMessage = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  $lastSnapshotJson = if ($lastSnapshot) { $lastSnapshot | ConvertTo-Json -Compress -Depth 10 } else { "null" }
  throw "Cuu pet settings state did not reach pass_through=$expectedPassThroughText hide_on_hover=$expectedHideOnHoverText opacity=$expectedOpacityText. Last snapshot: $lastSnapshotJson Last error: $lastErrorMessage"
}

function Invoke-CuuCdpMainSettingsSnapshot {
  param([string]$WebSocketUrl)
  Invoke-CuuCdpJsonExpression -WebSocketUrl $WebSocketUrl -Expression @"
(() => {
  const rectOf = (element) => {
    if (!element) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom)
    };
  };
  const visibleText = (document.body && document.body.innerText) || "";
  const panel = document.querySelector("[data-wh-panel='settings']");
  const desktopPanel = document.querySelector("[data-desktop-pet-settings]");
  const state = document.querySelector("[data-cuu-pet-settings-state]");
  const restore = document.querySelector("[data-cuu-pet-restore-interaction]");
  const pass = document.querySelector("[data-cuu-pet-pass-through]");
  const hide = document.querySelector("[data-cuu-pet-hide-on-hover]");
  const offenders = Array.from(document.querySelectorAll("body *"))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const text = (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
      return {
        tag: element.tagName.toLowerCase(),
        class_name: String(element.className || ""),
        text,
        client_width: element.clientWidth || 0,
        scroll_width: element.scrollWidth || 0,
        rect_width: Math.round(rect.width)
      };
    })
    .filter((entry) => entry.text && entry.client_width > 0 && entry.scroll_width > entry.client_width + 2)
    .slice(0, 12);
  const forbiddenSelector = [
    "[data-cuu-model-pack-id]",
    "[data-cuu-settings-model-pack-id]",
    "[data-cuu-live2d-runtime]",
    "[data-cuu-live2d-model]",
    "[data-cuu-model-pack]",
    "iframe[src*='cuu/live2d']",
    ".wh-cuu-cat"
  ].join(",");
  return JSON.stringify({
    url: location.href,
    hash: location.hash,
    lang: document.documentElement.lang || "",
    title: document.title || "",
    body_text: visibleText,
    viewport: {
      client_width: document.documentElement.clientWidth,
      scroll_width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
      global_horizontal_overflow: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) > document.documentElement.clientWidth + 1
    },
    settings_panel: {
      present: !!panel,
      hidden: panel ? panel.hidden === true : null,
      rect: rectOf(panel),
      text: panel ? panel.textContent || "" : ""
    },
    desktop_pet_settings: {
      present: !!desktopPanel,
      rect: rectOf(desktopPanel),
      text: desktopPanel ? desktopPanel.textContent || "" : ""
    },
    pet_settings: {
      state: state ? state.getAttribute("data-cuu-pet-settings-state") || "" : "",
      state_text: state ? state.textContent || "" : "",
      restore_present: !!restore,
      pass_checked: pass ? pass.checked === true : null,
      hide_checked: hide ? hide.checked === true : null,
      selected_scale: (document.querySelector("[data-cuu-pet-scale][aria-pressed='true']") || {}).dataset?.cuuPetScale || "",
      selected_opacity: (document.querySelector("[data-cuu-pet-opacity][aria-pressed='true']") || {}).dataset?.cuuPetOpacity || ""
    },
    forbidden: {
      visual_selector_present: !!document.querySelector(forbiddenSelector),
      model_choice_text_present: /(Black cat|White cat|黑猫|白猫|Live2D|Cuu settings|Cuu 设置)/u.test(visibleText)
    },
    overflow: {
      offenders
    }
  });
})()
"@
}

function Wait-CuuCdpMainSettingsPanel {
  param(
    [string]$WebSocketUrl,
    [ValidateSet("zh-CN", "en-US")]
    [string]$ExpectedLocale,
    [int]$TimeoutSeconds = 8
  )
  $localeJson = $ExpectedLocale | ConvertTo-Json -Compress
  $localeResult = Invoke-CuuCdpJsonExpression -WebSocketUrl $WebSocketUrl -Expression @"
(() => {
  const expectedLocale = $localeJson;
  const current = window.localStorage.getItem("workhub.locale");
  if (current !== expectedLocale || document.documentElement.lang !== expectedLocale) {
    window.localStorage.setItem("workhub.locale", expectedLocale);
    window.location.hash = "";
    window.location.reload();
    return JSON.stringify({ reloaded: true, locale: expectedLocale });
  }
  return JSON.stringify({ reloaded: false, locale: expectedLocale });
})()
"@
  if ($localeResult -and $localeResult.reloaded) {
    Start-Sleep -Milliseconds 1600
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastSnapshot = $null
  $lastNavigation = $null
  $lastErrorMessage = $null
  do {
    try {
      $navigation = Invoke-CuuCdpJsonExpression -WebSocketUrl $WebSocketUrl -Expression @"
(async () => {
  const isReady = () => {
    const panel = document.querySelector("[data-wh-panel='settings']");
    const desktopPanel = document.querySelector("[data-desktop-pet-settings]");
    const restore = document.querySelector("[data-cuu-pet-restore-interaction]");
    return !!panel && panel.hidden !== true && !!desktopPanel && !!restore;
  };
  const forceSettingsPanel = () => {
    const panel = document.querySelector("[data-wh-panel='settings']");
    if (!panel) {
      return false;
    }
    for (const candidate of document.querySelectorAll("[data-wh-panel]")) {
      candidate.hidden = candidate.getAttribute("data-wh-panel") !== "settings";
    }
    for (const candidate of document.querySelectorAll("[data-wh-page-key]")) {
      candidate.setAttribute("aria-current", candidate.getAttribute("data-wh-page-key") === "settings" ? "page" : "false");
    }
    window.history.replaceState(null, "", "#/settings");
    return true;
  };
  let method = "none";
  const link = document.querySelector("[data-wh-page-key='settings']");
  if (link) {
    method = "click";
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  } else {
    method = "hash";
    window.location.hash = "#/settings";
  }
  await new Promise((resolve) => setTimeout(resolve, 320));
  if (!isReady()) {
    method = method + "+hashchange";
    window.location.hash = "#/settings";
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  if (!isReady() && forceSettingsPanel()) {
    method = method + "+qa-panel";
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return JSON.stringify({
    ready: isReady(),
    method,
    hash: window.location.hash,
    has_app_root: !!document.querySelector(".wh-app-root"),
    has_boot_error: !!document.querySelector("[data-boot-tone='error']")
  });
})()
"@
      $lastNavigation = $navigation
      $lastSnapshot = Invoke-CuuCdpMainSettingsSnapshot -WebSocketUrl $WebSocketUrl
      if ($navigation -and $navigation.ready) {
        return $lastSnapshot
      }
    } catch {
      $lastErrorMessage = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  if ($lastSnapshot) {
    return $lastSnapshot
  }
  try {
    $debug = [pscustomobject]@{
      last_navigation = $lastNavigation
      last_error = $lastErrorMessage
      captured_at_iso = (Get-Date).ToUniversalTime().ToString("o")
    }
    $debug | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $OutDir "main-settings-cdp-debug.json") -Encoding utf8
  } catch {
  }
  throw "Main settings panel did not become ready through CDP."
}

function Wait-CuuCdpMainSettingsState {
  param(
    [string]$WebSocketUrl,
    [ValidateSet("zh-CN", "en-US")]
    [string]$ExpectedLocale,
    [bool]$ExpectedPassThrough,
    [bool]$ExpectedHideOnHover = $false,
    [ValidateSet(60, 80, 100)]
    [int]$ExpectedOpacityPercent = 100,
    [int]$TimeoutSeconds = 8
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastSnapshot = $null
  $lastErrorMessage = ""
  do {
    try {
      $snapshot = Wait-CuuCdpMainSettingsPanel -WebSocketUrl $WebSocketUrl -ExpectedLocale $ExpectedLocale -TimeoutSeconds 2
      $lastSnapshot = $snapshot
      if (
        $snapshot -and
        $snapshot.pet_settings -and
        [bool]$snapshot.pet_settings.pass_checked -eq $ExpectedPassThrough -and
        [bool]$snapshot.pet_settings.hide_checked -eq $ExpectedHideOnHover -and
        [string]$snapshot.pet_settings.selected_opacity -eq ([string]$ExpectedOpacityPercent)
      ) {
        return $snapshot
      }
    } catch {
      $lastErrorMessage = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  $lastSnapshotJson = if ($lastSnapshot) { $lastSnapshot | ConvertTo-Json -Compress -Depth 10 } else { "null" }
  throw "Main settings state did not reach pass_through=$ExpectedPassThrough hide_on_hover=$ExpectedHideOnHover opacity=$ExpectedOpacityPercent. Last snapshot: $lastSnapshotJson Last error: $lastErrorMessage"
}

function Invoke-CuuCdpScrollMainPetSettingsIntoView {
  param([string]$WebSocketUrl)
  Invoke-CuuCdpJsonExpression -WebSocketUrl $WebSocketUrl -Expression @"
(async () => {
  const target = document.querySelector("[data-desktop-pet-settings]") || document.querySelector("[data-cuu-pet-settings-state]");
  if (!target) {
    return JSON.stringify({ scrolled: false, reason: "missing_desktop_pet_settings" });
  }
  target.scrollIntoView({ block: "center", inline: "nearest" });
  await new Promise((resolve) => setTimeout(resolve, 220));
  const rect = target.getBoundingClientRect();
  return JSON.stringify({
    scrolled: true,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom)
    },
    scroll_y: Math.round(window.scrollY || document.documentElement.scrollTop || 0)
  });
})()
"@
}

function New-CuuMainSettingsLayoutGate {
  param(
    [object]$Snapshot,
    [ValidateSet("zh-CN", "en-US")]
    [string]$ExpectedLocale,
    [bool]$AfterRestore = $false
  )
  if (-not $Snapshot) {
    return [pscustomobject]@{
      enabled = $true
      passed = $false
      reason = "missing_main_settings_snapshot"
    }
  }
  $bodyText = [string]$Snapshot.body_text
  $expectedTitle = if ($ExpectedLocale -eq "en-US") { "App settings" } else { "应用设置" }
  $expectedDesktop = if ($ExpectedLocale -eq "en-US") { "Desktop client" } else { "桌面客户端" }
  $expectedRestore = if ($ExpectedLocale -eq "en-US") { "Restore interaction" } else { "恢复可交互" }
  $localeOk = [string]$Snapshot.lang -eq $ExpectedLocale
  $panelReady = $Snapshot.settings_panel.present -and -not $Snapshot.settings_panel.hidden -and $Snapshot.desktop_pet_settings.present -and $Snapshot.pet_settings.restore_present
  $copyOk = $bodyText.Contains($expectedTitle) -and $bodyText.Contains($expectedDesktop) -and $bodyText.Contains($expectedRestore)
  $noGlobalOverflow = -not [bool]$Snapshot.viewport.global_horizontal_overflow
  $noForbiddenVisual = -not [bool]$Snapshot.forbidden.visual_selector_present
  $noForbiddenModelText = -not [bool]$Snapshot.forbidden.model_choice_text_present
  $restoreStateOk = -not $AfterRestore -or (
    [string]$Snapshot.pet_settings.state -eq "interactive" -and
    [bool]$Snapshot.pet_settings.pass_checked -eq $false -and
    [bool]$Snapshot.pet_settings.hide_checked -eq $false -and
    [string]$Snapshot.pet_settings.selected_opacity -eq "100"
  )
  $passed = $localeOk -and $panelReady -and $copyOk -and $noGlobalOverflow -and $noForbiddenVisual -and $noForbiddenModelText -and $restoreStateOk
  [pscustomobject]@{
    enabled = $true
    passed = $passed
    reason = if ($passed) { "main_settings_panel_in_bounds" } else { "main_settings_panel_failed" }
    expected_locale = $ExpectedLocale
    locale_ok = $localeOk
    panel_ready = $panelReady
    copy_ok = $copyOk
    no_global_horizontal_overflow = $noGlobalOverflow
    no_forbidden_visual = $noForbiddenVisual
    no_forbidden_model_text = $noForbiddenModelText
    restore_state_ok = $restoreStateOk
    viewport = $Snapshot.viewport
    pet_settings = $Snapshot.pet_settings
    overflow = $Snapshot.overflow
  }
}

function New-CuuPassThroughRecoveryGate {
  param(
    [string]$Scenario,
    [object]$InitialPetSnapshot,
    [object]$MainBefore,
    [object]$MainAfter,
    [object]$FinalPetDomReport
  )
  $enabled = $Scenario -eq "pass-through-recovery-settings" -or $Scenario -eq "pass-through-recovery-tray" -or $Scenario -eq "pass-through-recovery-tray-physical"
  if (-not $enabled) {
    return [pscustomobject]@{
      enabled = $false
      passed = $true
      reason = "not_pass_through_recovery_scenario"
    }
  }
  $initialPassThrough = $InitialPetSnapshot -and
    $InitialPetSnapshot.surface -and
    [string]$InitialPetSnapshot.surface.data_pet_pass_through -eq "true"
  $mainBeforePassed = $MainBefore -and $MainBefore.layout_gate -and [bool]$MainBefore.layout_gate.passed
  $mainAfterPassed = $MainAfter -and $MainAfter.layout_gate -and [bool]$MainAfter.layout_gate.passed
  $finalPassThroughOff = $FinalPetDomReport -and
    $FinalPetDomReport.surface -and
    $FinalPetDomReport.surface.data -and
    [string]$FinalPetDomReport.surface.data.data_pet_pass_through -eq "false"
  $finalHideOff = $FinalPetDomReport -and
    $FinalPetDomReport.surface -and
    $FinalPetDomReport.surface.data -and
    [string]$FinalPetDomReport.surface.data.data_pet_hide_on_hover -eq "false"
  $finalOpacityRestored = $FinalPetDomReport -and
    $FinalPetDomReport.surface -and
    $FinalPetDomReport.surface.data -and
    [string]$FinalPetDomReport.surface.data.data_pet_opacity_percent -eq "100"
  $finalMenuUsable = $FinalPetDomReport -and
    $FinalPetDomReport.settings_menu -and
    [bool]$FinalPetDomReport.settings_menu.present -and
    $FinalPetDomReport.settings_menu.rect -and
    [double]$FinalPetDomReport.settings_menu.rect.width -gt 0 -and
    [double]$FinalPetDomReport.settings_menu.rect.height -gt 0 -and
    ([string]$FinalPetDomReport.settings_menu.text).Length -gt 0
  $passed = $initialPassThrough -and $mainBeforePassed -and $mainAfterPassed -and $finalPassThroughOff -and $finalHideOff -and $finalOpacityRestored -and $finalMenuUsable
  [pscustomobject]@{
    enabled = $true
    passed = $passed
    reason = if ($passed) { "pass_through_restored_and_menu_usable" } else { "pass_through_recovery_failed" }
    initial_pet_pass_through = $initialPassThrough
    main_before_passed = $mainBeforePassed
    main_after_passed = $mainAfterPassed
    final_pet_pass_through_off = $finalPassThroughOff
    final_pet_hide_off = $finalHideOff
    final_pet_opacity_restored = $finalOpacityRestored
    final_menu_usable = $finalMenuUsable
  }
}

function New-CuuSettingsMenuHoverSyncGate {
  param(
    [string]$Scenario,
    [object]$MainBefore,
    [object]$MainAfter,
    [object]$FinalPetDomReport
  )
  $enabled = $Scenario -eq "settings-menu-hover-sync"
  if (-not $enabled) {
    return [pscustomobject]@{
      enabled = $false
      passed = $true
      reason = "not_settings_menu_hover_sync_scenario"
    }
  }
  $mainBeforePassed = $MainBefore -and $MainBefore.layout_gate -and [bool]$MainBefore.layout_gate.passed
  $mainAfterPassed = $MainAfter -and $MainAfter.layout_gate -and [bool]$MainAfter.layout_gate.passed
  $mainBeforeHoverOff = $MainBefore -and
    $MainBefore.snapshot -and
    $MainBefore.snapshot.pet_settings -and
    [bool]$MainBefore.snapshot.pet_settings.pass_checked -eq $false -and
    [bool]$MainBefore.snapshot.pet_settings.hide_checked -eq $false
  $mainAfterHoverOn = $MainAfter -and
    $MainAfter.snapshot -and
    $MainAfter.snapshot.pet_settings -and
    [bool]$MainAfter.snapshot.pet_settings.pass_checked -eq $false -and
    [bool]$MainAfter.snapshot.pet_settings.hide_checked -eq $true
  $finalPetHoverOn = $FinalPetDomReport -and
    $FinalPetDomReport.surface -and
    $FinalPetDomReport.surface.data -and
    [string]$FinalPetDomReport.surface.data.data_pet_pass_through -eq "false" -and
    [string]$FinalPetDomReport.surface.data.data_pet_hide_on_hover -eq "true"
  $finalMenuUsable = $FinalPetDomReport -and
    $FinalPetDomReport.settings_menu -and
    [bool]$FinalPetDomReport.settings_menu.present -and
    $FinalPetDomReport.settings_menu.rect -and
    [double]$FinalPetDomReport.settings_menu.rect.width -gt 0 -and
    [double]$FinalPetDomReport.settings_menu.rect.height -gt 0 -and
    ([string]$FinalPetDomReport.settings_menu.text).Length -gt 0
  $passed = $mainBeforePassed -and $mainAfterPassed -and $mainBeforeHoverOff -and $mainAfterHoverOn -and $finalPetHoverOn -and $finalMenuUsable
  [pscustomobject]@{
    enabled = $true
    passed = $passed
    reason = if ($passed) { "pet_menu_hover_synced_to_main_settings" } else { "settings_menu_hover_sync_failed" }
    main_before_passed = $mainBeforePassed
    main_after_passed = $mainAfterPassed
    main_before_hover_off = $mainBeforeHoverOff
    main_after_hover_on = $mainAfterHoverOn
    final_pet_hover_on = $finalPetHoverOn
    final_menu_usable = $finalMenuUsable
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

function Get-LocalPortListenerProcessId {
  param([int]$Port)
  $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $Port } |
    Select-Object -First 1
  if (-not $listener) {
    return $null
  }
  return [int]$listener.OwningProcess
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

function Test-CuuR3RunStreamApiServer {
  param(
    [int]$Port = 8787,
    [ValidateSet("succeeded", "failed")]
    [string]$RunOutcome = "succeeded",
    [ValidateSet("none", "permission-401", "permission-403", "generic-502", "stream-offline")]
    [string]$ApiFault = "none"
  )
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    return $health.service -eq "workhub-cuu-r3-tauri-run-stream" -and $health.run_outcome -eq $RunOutcome -and $health.api_fault -eq $ApiFault
  } catch {
    return $false
  }
}

function Get-CuuR3RunStreamApiServerHealth {
  param([int]$Port = 8787)
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
  } catch {
    return $null
  }
}

function Stop-CuuR3RunStreamApiServerIfOwned {
  param([int]$Port = 8787)
  $health = Get-CuuR3RunStreamApiServerHealth -Port $Port
  if (-not $health -or $health.service -ne "workhub-cuu-r3-tauri-run-stream") {
    return $false
  }
  $processId = Get-LocalPortListenerProcessId -Port $Port
  if (-not $processId) {
    return $false
  }
  Stop-Process -Id $processId -Force
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    if (-not (Test-LocalPort -Port $Port)) {
      return $true
    }
    Start-Sleep -Milliseconds 100
  }
  return -not (Test-LocalPort -Port $Port)
}

function Start-CuuR3RunStreamApiServerIfNeeded {
  param(
    [int]$Port = 8787,
    [ValidateSet("succeeded", "failed")]
    [string]$RunOutcome = "succeeded",
    [ValidateSet("none", "permission-401", "permission-403", "generic-502", "stream-offline")]
    [string]$ApiFault = "none"
  )
  if (Test-LocalPort -Port $Port) {
    if (Test-CuuR3RunStreamApiServer -Port $Port -RunOutcome $RunOutcome -ApiFault $ApiFault) {
      return $null
    }
    $health = Get-CuuR3RunStreamApiServerHealth -Port $Port
    if (-not $health -or $health.service -ne "workhub-cuu-r3-tauri-run-stream") {
      throw "Port $Port is already in use, but it is not the Cuu R3 Tauri run-stream QA server for outcome $RunOutcome and api fault $ApiFault."
    }
    if (-not (Stop-CuuR3RunStreamApiServerIfOwned -Port $Port)) {
      throw "Port $Port is held by a stale Cuu R3 Tauri run-stream QA server that could not be stopped."
    }
  }

  if (Test-LocalPort -Port $Port) {
    throw "Port $Port is still in use after stale Cuu R3 Tauri run-stream QA server cleanup."
  }

  $env:WORKHUB_CUU_QA_RUN_OUTCOME = $RunOutcome
  $env:WORKHUB_CUU_QA_API_FAULT = $ApiFault
  $commandSpec = Get-PnpmCommandSpec
  $arguments = @()
  $arguments += $commandSpec.ArgumentPrefix
  $arguments += @("--filter", "@workhub/api", "qa:cuu-r3-tauri-run-stream-server")
  $apiStdoutPath = Join-Path $OutDir "cuu-r3-api-stdout.log"
  $apiStderrPath = Join-Path $OutDir "cuu-r3-api-stderr.log"
  Remove-Item -LiteralPath $apiStdoutPath, $apiStderrPath -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $commandSpec.FilePath -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $apiStdoutPath -RedirectStandardError $apiStderrPath -PassThru
  $deadline = (Get-Date).AddSeconds(25)
  do {
    if ($process.HasExited) {
      $stderrTail = if (Test-Path -LiteralPath $apiStderrPath) { (Get-Content -LiteralPath $apiStderrPath -Tail 40 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
      $stdoutTail = if (Test-Path -LiteralPath $apiStdoutPath) { (Get-Content -LiteralPath $apiStdoutPath -Tail 40 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
      throw "Cuu R3 run-stream API server exited before health check. Exit code: $($process.ExitCode). stderr: $stderrTail stdout: $stdoutTail"
    }
    Start-Sleep -Milliseconds 500
  } while (-not (Test-CuuR3RunStreamApiServer -Port $Port -RunOutcome $RunOutcome -ApiFault $ApiFault) -and (Get-Date) -lt $deadline)

  if (-not (Test-CuuR3RunStreamApiServer -Port $Port -RunOutcome $RunOutcome -ApiFault $ApiFault)) {
    throw "Cuu R3 run-stream API server did not pass /api/health in time for outcome $RunOutcome and api fault $ApiFault."
  }
  return $process
}

function New-CuuR3ReloadRestoreSeed {
  param(
    [string]$ScenarioName,
    [ValidateSet("zh-CN", "en-US")]
    [string]$SeedLocale,
    [int]$Port = 8787
  )
  $body = @{
    kind = $ScenarioName
    locale = $SeedLocale
  } | ConvertTo-Json -Compress
  $headers = @{
    "Content-Type" = "application/json"
    "X-WorkHub-Client-Token" = "cuu-r3-local-client-token"
    "X-YQGL-Client-Token" = "cuu-r3-local-client-token"
  }
  Add-Type -AssemblyName System.Net.Http
  $httpClient = [System.Net.Http.HttpClient]::new()
  try {
    $httpClient.Timeout = [TimeSpan]::FromSeconds(15)
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "http://127.0.0.1:$Port/api/qa/cuu-r3-restore-seed")
    foreach ($header in $headers.GetEnumerator()) {
      if ($header.Key -ne "Content-Type") {
        $request.Headers.TryAddWithoutValidation($header.Key, [string]$header.Value) | Out-Null
      }
    }
    $request.Content = [System.Net.Http.StringContent]::new($body, [System.Text.Encoding]::UTF8, "application/json")
    $responseMessage = $httpClient.SendAsync($request).GetAwaiter().GetResult()
    $bytes = $responseMessage.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $responseText = [System.Text.Encoding]::UTF8.GetString($bytes)
    if (-not $responseMessage.IsSuccessStatusCode) {
      throw "Cuu R3 reload restore seed endpoint returned HTTP $([int]$responseMessage.StatusCode): $responseText"
    }
    $response = $responseText | ConvertFrom-Json
  } finally {
    $httpClient.Dispose()
  }
  if (-not $response.ok -or -not $response.data -or -not $response.data.restore_state) {
    throw "Cuu R3 reload restore seed endpoint returned an invalid response for $ScenarioName."
  }
  return $response.data
}

function Get-CuuObjectPropertyValue {
  param(
    [object]$InputObject,
    [string]$Name
  )
  if (-not $InputObject) {
    return $null
  }
  $property = $InputObject.PSObject.Properties[$Name]
  if (-not $property) {
    return $null
  }
  return $property.Value
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
    "run-stream" {
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
    "run-failure" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "worried"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "worried_ears"
        data_cuu_live2d_renderer_state = "mtn/08.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    "reload-session" {
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
    "reload-active-run" {
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
    "reload-terminal-run" {
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
    "permission-401" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "worried"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "worried_ears"
        data_cuu_live2d_renderer_state = "mtn/08.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    "permission-403" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "worried"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "worried_ears"
        data_cuu_live2d_renderer_state = "mtn/08.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    "generic-runtime-error" {
      return [pscustomobject]@{
        data_cuu_behavior_state = "worried"
        data_cuu_behavior_phase = "loop"
        data_cuu_live2d_motion = "worried_ears"
        data_cuu_live2d_renderer_state = "mtn/08.mtn"
        data_cuu_behavior_expected_window_mode = "card"
        data_cuu_behavior_expected_bubble_mode = "card"
        data_pet_window_mode = "card"
      }
    }
    "stream-offline" {
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
    "run-stream" = "view_replay"
    "run-failure" = "view_replay"
    "reload-session" = "submit_option"
    "reload-active-run" = "view_replay"
    "reload-terminal-run" = "view_replay"
    "permission-401" = "view_replay"
    "permission-403" = "view_replay"
    "generic-runtime-error" = "view_replay"
    "stream-offline" = "view_replay"
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
  if (@("permission-401", "permission-403", "generic-runtime-error", "stream-offline", "reload-session", "reload-active-run", "reload-terminal-run") -contains $Scenario) {
    if (-not $Actual.bubble -or -not $Actual.bubble.data) {
      return $false
    }
    $expectedPayloadType = if ($Scenario -eq "reload-session") { "session" } else { "agent_run" }
    if ($Actual.bubble.data.data_pet_payload_ref_entity_type -ne $expectedPayloadType) {
      return $false
    }
    if ([string]::IsNullOrWhiteSpace([string]$Actual.bubble.data.data_pet_payload_ref_entity_id)) {
      return $false
    }
    if ([string]::IsNullOrWhiteSpace([string]$Actual.bubble.data.data_pet_payload_ref_href)) {
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
  $live2dRight = Read-CuuDomRectNumber $live2d "right"
  $bubbleX = Read-CuuDomRectNumber $bubble "x"
  $bubbleRight = Read-CuuDomRectNumber $bubble "right"
  $bubbleBottom = Read-CuuDomRectNumber $bubble "bottom"
  foreach ($value in @($surfaceRight, $live2dX, $live2dY, $live2dRight, $bubbleX, $bubbleRight, $bubbleBottom)) {
    if ($null -eq $value) {
      return $false
    }
  }

  $live2dCenterX = ($live2dX + $live2dRight) / 2
  $bubbleCenterX = ($bubbleX + $bubbleRight) / 2
  $horizontallyAnchored = [Math]::Abs($bubbleCenterX - $live2dCenterX) -le 96
  $notRightClipped = $bubbleRight -le ($surfaceRight - 8)
  $notCoveringCatBody = $bubbleBottom -le ($live2dY + 96)
  return $horizontallyAnchored -and $notRightClipped -and $notCoveringCatBody
}

function New-CuuSettingsMenuLayoutGate {
  param(
    [string]$Scenario,
    [object]$Actual,
    [string]$ExpectedLocale = "zh-CN"
  )

  $enabled = @("settings-menu", "settings-menu-model-switch", "settings-menu-hover-sync", "pass-through-recovery-settings", "pass-through-recovery-tray", "pass-through-recovery-tray-physical") -contains $Scenario
  if (-not $enabled) {
    return [pscustomobject]@{
      enabled = $false
      passed = $true
      reason = "not_settings_menu_scenario"
    }
  }

  if (-not $Actual -or -not $Actual.surface -or -not $Actual.surface.rect) {
    return [pscustomobject]@{
      enabled = $true
      passed = $false
      reason = "missing_surface_rect"
    }
  }

  $surfaceWidth = Read-CuuDomRectNumber $Actual.surface.rect "width"
  $surfaceHeight = Read-CuuDomRectNumber $Actual.surface.rect "height"
  if ($null -eq $surfaceWidth -or $null -eq $surfaceHeight) {
    return [pscustomobject]@{
      enabled = $true
      passed = $false
      reason = "invalid_surface_rect"
    }
  }

  if ($Scenario -eq "settings-menu" -or $Scenario -eq "settings-menu-hover-sync" -or $Scenario -eq "pass-through-recovery-settings" -or $Scenario -eq "pass-through-recovery-tray" -or $Scenario -eq "pass-through-recovery-tray-physical") {
    if (-not $Actual.settings_menu -or -not $Actual.settings_menu.present -or -not $Actual.settings_menu.rect) {
      return [pscustomobject]@{
        enabled = $true
        passed = $false
        reason = "missing_settings_menu"
      }
    }
    $menuX = Read-CuuDomRectNumber $Actual.settings_menu.rect "x"
    $menuY = Read-CuuDomRectNumber $Actual.settings_menu.rect "y"
    $menuWidth = Read-CuuDomRectNumber $Actual.settings_menu.rect "width"
    $menuHeight = Read-CuuDomRectNumber $Actual.settings_menu.rect "height"
    $menuRight = Read-CuuDomRectNumber $Actual.settings_menu.rect "right"
    $menuBottom = Read-CuuDomRectNumber $Actual.settings_menu.rect "bottom"
    foreach ($value in @($menuX, $menuY, $menuWidth, $menuHeight, $menuRight, $menuBottom)) {
      if ($null -eq $value) {
        return [pscustomobject]@{
          enabled = $true
          passed = $false
          reason = "invalid_settings_menu_rect"
        }
      }
    }
    $menuText = [string]$Actual.settings_menu.text
    $expectedTitle = if ($ExpectedLocale -eq "en-US") { "Cuu settings" } else { "Cuu 设置" }
    $passed = $menuWidth -ge 140 -and
      $menuHeight -ge 180 -and
      $menuX -ge 0 -and
      $menuY -ge 0 -and
      $menuRight -le $surfaceWidth -and
      $menuBottom -le $surfaceHeight -and
      -not [string]::IsNullOrWhiteSpace($menuText) -and
      $menuText.Contains($expectedTitle) -and
      -not ($menuText -match "pass[- ]?through|点击穿透|穿透")
    return [pscustomobject]@{
      enabled = $true
      passed = $passed
      reason = if ($passed) { "settings_menu_rect_in_surface" } else { "settings_menu_rect_or_text_failed" }
      surface = [pscustomobject]@{
        width = $surfaceWidth
        height = $surfaceHeight
      }
      settings_menu = [pscustomobject]@{
        x = $menuX
        y = $menuY
        width = $menuWidth
        height = $menuHeight
        right = $menuRight
        bottom = $menuBottom
        text = $menuText
      }
    }
  }

  if (-not $Actual.bubble -or -not $Actual.bubble.present -or -not $Actual.bubble.rect) {
    return [pscustomobject]@{
      enabled = $true
      passed = $false
      reason = "missing_model_switch_status_bubble"
    }
  }
  $bubbleX = Read-CuuDomRectNumber $Actual.bubble.rect "x"
  $bubbleY = Read-CuuDomRectNumber $Actual.bubble.rect "y"
  $bubbleWidth = Read-CuuDomRectNumber $Actual.bubble.rect "width"
  $bubbleHeight = Read-CuuDomRectNumber $Actual.bubble.rect "height"
  $bubbleRight = Read-CuuDomRectNumber $Actual.bubble.rect "right"
  $bubbleBottom = Read-CuuDomRectNumber $Actual.bubble.rect "bottom"
  foreach ($value in @($bubbleX, $bubbleY, $bubbleWidth, $bubbleHeight, $bubbleRight, $bubbleBottom)) {
    if ($null -eq $value) {
      return [pscustomobject]@{
        enabled = $true
        passed = $false
        reason = "invalid_model_switch_status_bubble_rect"
      }
    }
  }
  $bubbleText = [string]$Actual.bubble.text
  $expectedStatus = if ($ExpectedLocale -eq "en-US") { "Cuu look updated." } else { "Cuu 形象已更新。" }
  $bubblePassed = $bubbleWidth -ge 120 -and
    $bubbleHeight -ge 28 -and
    $bubbleX -ge 0 -and
    $bubbleY -ge 0 -and
    $bubbleRight -le $surfaceWidth -and
    $bubbleBottom -le $surfaceHeight -and
    -not [string]::IsNullOrWhiteSpace($bubbleText) -and
    $bubbleText.Contains($expectedStatus)
  return [pscustomobject]@{
    enabled = $true
    passed = $bubblePassed
    reason = if ($bubblePassed) { "model_switch_status_bubble_in_surface" } else { "model_switch_status_bubble_failed" }
    surface = [pscustomobject]@{
      width = $surfaceWidth
      height = $surfaceHeight
    }
    bubble = [pscustomobject]@{
      x = $bubbleX
      y = $bubbleY
      width = $bubbleWidth
      height = $bubbleHeight
      right = $bubbleRight
      bottom = $bubbleBottom
      text = $bubbleText
    }
  }
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
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

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
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
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

function Select-WorkHubMainWindow {
  param([object[]]$Windows)
  $Windows |
    Where-Object { $_.Title -eq "WorkHub" } |
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
      throw "Win32 PrintWindow capture failed for $($Window.Title)."
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

function Measure-CuuFrameRightEdgeLightPixels {
  param([string]$Path)

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $x = $bitmap.Width - 1
    $lightPixels = 0
    for ($y = 0; $y -lt $bitmap.Height; $y += 1) {
      $color = $bitmap.GetPixel($x, $y)
      if ($color.R -ge 180 -and $color.G -ge 180 -and $color.B -ge 155) {
        $lightPixels += 1
      }
    }
    [pscustomobject]@{
      width = $bitmap.Width
      height = $bitmap.Height
      right_edge_light_pixels = $lightPixels
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

  $interactionScenarios = @("idle-long-run", "input-handfeel", "look-avoidance", "look-only", "drag-smoothing", "hide-on-hover", "launcher", "pass-through-recovery-settings", "pass-through-recovery-tray", "pass-through-recovery-tray-physical")
  $enabled = $IsBusinessScenario -or ($interactionScenarios -contains $ScenarioName)
  $quality = if ($FrameCount -ge $FormalFrameCount) { "formal_32" } else { "smoke" }
  $minChangedFrames = if ($quality -eq "formal_32") { $MinChangedFramesFormal } else { $MinChangedFramesSmoke }
  if ($ScenarioName -eq "pass-through-recovery-settings" -or $ScenarioName -eq "pass-through-recovery-tray" -or $ScenarioName -eq "pass-through-recovery-tray-physical") {
    $minChangedFrames = 1
  }
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

function Invoke-CuuMouseClick {
  param([ValidateSet("left", "right")][string]$Button = "left")
  if ($Button -eq "right") {
    [WorkHubCuuInputWin32]::mouse_event([WorkHubCuuInputWin32]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    [WorkHubCuuInputWin32]::mouse_event([WorkHubCuuInputWin32]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
  } else {
    [WorkHubCuuInputWin32]::mouse_event([WorkHubCuuInputWin32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    [WorkHubCuuInputWin32]::mouse_event([WorkHubCuuInputWin32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  }
}

function New-CuuDesktopScreenshot {
  param([string]$Path)

  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  [pscustomobject]@{
    path = $Path
    virtual_screen = [pscustomobject]@{
      x = $bounds.Left
      y = $bounds.Top
      width = $bounds.Width
      height = $bounds.Height
      right = $bounds.Right
      bottom = $bounds.Bottom
    }
  }
}

function Get-CuuUiaRect {
  param([System.Windows.Automation.AutomationElement]$Element)

  $rect = $Element.Current.BoundingRectangle
  try {
    $x = [double]$rect.X
  } catch {
    try { $x = [double]$rect.Left } catch { $x = 0.0 }
  }
  try {
    $y = [double]$rect.Y
  } catch {
    try { $y = [double]$rect.Top } catch { $y = 0.0 }
  }
  try { $width = [double]$rect.Width } catch { $width = 0.0 }
  try { $height = [double]$rect.Height } catch { $height = 0.0 }
  try { $right = [double]$rect.Right } catch { $right = $x + $width }
  try { $bottom = [double]$rect.Bottom } catch { $bottom = $y + $height }
  try { $empty = [bool]$rect.IsEmpty } catch { $empty = $width -le 0 -or $height -le 0 }
  [pscustomobject]@{
    x = [Math]::Round($x, 2)
    y = [Math]::Round($y, 2)
    width = [Math]::Round($width, 2)
    height = [Math]::Round($height, 2)
    right = [Math]::Round($right, 2)
    bottom = [Math]::Round($bottom, 2)
    empty = $empty
  }
}

function New-CuuUiaElementSummary {
  param([System.Windows.Automation.AutomationElement]$Element)

  if (-not $Element) {
    return $null
  }
  $current = $Element.Current
  [pscustomobject]@{
    name = $current.Name
    automation_id = $current.AutomationId
    class_name = $current.ClassName
    framework_id = $current.FrameworkId
    process_id = $current.ProcessId
    control_type = if ($current.ControlType) { $current.ControlType.ProgrammaticName } else { $null }
    bounding_rect = Get-CuuUiaRect -Element $Element
  }
}

function Test-CuuUiaRectInTrayRegion {
  param([object]$Rect)

  if (-not $Rect -or [bool]$Rect.empty) {
    return $false
  }
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $minX = $bounds.Right - [Math]::Min(760, [int][Math]::Floor($bounds.Width * 0.55))
  $minY = $bounds.Bottom - [Math]::Min(640, [int][Math]::Floor($bounds.Height * 0.65))
  return [double]$Rect.x -ge $minX -and
    [double]$Rect.y -ge $minY -and
    [double]$Rect.right -le ($bounds.Right + 16) -and
    [double]$Rect.bottom -le ($bounds.Bottom + 16)
}

function Find-CuuUiaElementByName {
  param(
    [string[]]$Names,
    [System.Windows.Automation.ControlType]$ControlType,
    [int]$TimeoutSeconds = 8,
    [switch]$RequireNonEmptyRect,
    [switch]$RequireTrayRegion
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    foreach ($name in $Names) {
      $nameCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        $name
      )
      $typeCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        $ControlType
      )
      $condition = [System.Windows.Automation.AndCondition]::new($nameCondition, $typeCondition)
      $element = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $condition
      )
      if ($element) {
        $rect = Get-CuuUiaRect -Element $element
        $rectOk = (-not $RequireNonEmptyRect -or (-not $rect.empty -and $rect.width -gt 0 -and $rect.height -gt 0))
        $regionOk = (-not $RequireTrayRegion -or (Test-CuuUiaRectInTrayRegion -Rect $rect))
        if ($rectOk -and $regionOk) {
          return $element
        }
      }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  return $null
}

function Find-CuuUiaElementByNamePattern {
  param(
    [string]$Pattern,
    [System.Windows.Automation.ControlType]$ControlType,
    [int]$TimeoutSeconds = 8,
    [switch]$RequireNonEmptyRect,
    [switch]$RequireTrayRegion
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $typeCondition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      $ControlType
    )
    $elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      $typeCondition
    )
    foreach ($element in $elements) {
      $name = [string]$element.Current.Name
      if ($name -match $Pattern) {
        $rect = Get-CuuUiaRect -Element $element
        $rectOk = (-not $RequireNonEmptyRect -or (-not $rect.empty -and $rect.width -gt 0 -and $rect.height -gt 0))
        $regionOk = (-not $RequireTrayRegion -or (Test-CuuUiaRectInTrayRegion -Rect $rect))
        if ($rectOk -and $regionOk) {
          return $element
        }
      }
    }
    Start-Sleep -Milliseconds 350
  } while ((Get-Date) -lt $deadline)

  return $null
}

function Invoke-CuuUiaElementMouseClick {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [ValidateSet("left", "right")][string]$Button = "left"
  )

  $rect = Get-CuuUiaRect -Element $Element
  if ($rect.empty -or $rect.width -le 0 -or $rect.height -le 0) {
    throw "Cannot click UIAutomation element with empty bounding rectangle."
  }
  $x = [int][Math]::Round($rect.x + ($rect.width / 2))
  $y = [int][Math]::Round($rect.y + ($rect.height / 2))
  Set-CuuCursorPosition -X $x -Y $y
  Start-Sleep -Milliseconds 90
  Invoke-CuuMouseClick -Button $Button
  [pscustomobject]@{
    button = $Button
    x = $x
    y = $y
    rect = $rect
  }
}

function Invoke-CuuOpenTrayOverflow {
  $overflow = Find-CuuUiaElementByNamePattern `
    -Pattern "Show hidden icons|Hidden icons|Notification Chevron|System tray overflow|显示隐藏|隐藏的图标" `
    -ControlType ([System.Windows.Automation.ControlType]::Button) `
    -TimeoutSeconds 2 `
    -RequireNonEmptyRect `
    -RequireTrayRegion
  if (-not $overflow) {
    return $null
  }
  $click = Invoke-CuuUiaElementMouseClick -Element $overflow -Button "left"
  Start-Sleep -Milliseconds 450
  [pscustomobject]@{
    button = New-CuuUiaElementSummary -Element $overflow
    click = $click
  }
}

function Invoke-CuuWindowsTrayRestoreInteraction {
  param(
    [string]$OutDir,
    [int]$TimeoutSeconds = 8
  )

  $beforePath = Join-Path $OutDir "windows-tray-before-menu.png"
  $overflowPath = Join-Path $OutDir "windows-tray-overflow-opened.png"
  $menuPath = Join-Path $OutDir "windows-tray-menu-before-restore.png"
  $afterPath = Join-Path $OutDir "windows-tray-after-restore.png"
  $beforeScreenshot = New-CuuDesktopScreenshot -Path $beforePath

  $trayIcon = Find-CuuUiaElementByName `
    -Names @("WorkHub - Cuu is ready") `
    -ControlType ([System.Windows.Automation.ControlType]::Button) `
    -TimeoutSeconds ([Math]::Max(2, [int][Math]::Floor($TimeoutSeconds / 2))) `
    -RequireNonEmptyRect `
    -RequireTrayRegion
  $overflow = $null
  $overflowScreenshot = $null
  if (-not $trayIcon) {
    $overflow = Invoke-CuuOpenTrayOverflow
    if ($overflow) {
      $overflowScreenshot = New-CuuDesktopScreenshot -Path $overflowPath
      $trayIcon = Find-CuuUiaElementByNamePattern `
        -Pattern "WorkHub - Cuu is ready|Cuu is ready|WorkHub|Cuu" `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -TimeoutSeconds $TimeoutSeconds `
        -RequireNonEmptyRect `
        -RequireTrayRegion
    }
  }
  if (-not $trayIcon) {
    throw "Unable to find WorkHub tray icon through Windows UIAutomation."
  }

  $trayIconSummary = New-CuuUiaElementSummary -Element $trayIcon
  $trayClick = Invoke-CuuUiaElementMouseClick -Element $trayIcon -Button "right"
  Start-Sleep -Milliseconds 650
  $menuScreenshot = New-CuuDesktopScreenshot -Path $menuPath
  $restoreItem = Find-CuuUiaElementByName `
    -Names @("Restore Cuu interaction") `
    -ControlType ([System.Windows.Automation.ControlType]::MenuItem) `
    -TimeoutSeconds $TimeoutSeconds `
    -RequireNonEmptyRect
  if (-not $restoreItem) {
    throw "Unable to find Restore Cuu interaction in the native tray menu."
  }

  $restoreItemSummary = New-CuuUiaElementSummary -Element $restoreItem
  $restoreClick = Invoke-CuuUiaElementMouseClick -Element $restoreItem -Button "left"
  Start-Sleep -Milliseconds 900
  $afterScreenshot = New-CuuDesktopScreenshot -Path $afterPath

  [pscustomobject]@{
    ok = $true
    source = "windows_tray_ui_automation_mouse"
    command_fallback_used = $false
    before_screenshot = $beforeScreenshot
    overflow = $overflow
    overflow_screenshot = $overflowScreenshot
    tray_icon = $trayIconSummary
    tray_click = $trayClick
    menu_screenshot = $menuScreenshot
    restore_menu_item = $restoreItemSummary
    restore_click = $restoreClick
    after_screenshot = $afterScreenshot
  }
}

function New-CuuPhysicalTrayRecoveryGate {
  param(
    [string]$Scenario,
    [object]$RestorePoint
  )

  $enabled = $Scenario -eq "pass-through-recovery-tray-physical"
  if (-not $enabled) {
    return [pscustomobject]@{
      enabled = $false
      passed = $true
      reason = "not_physical_tray_recovery_scenario"
    }
  }

  $trayClicked = $RestorePoint -and $RestorePoint.tray_click -and
    [string]$RestorePoint.tray_click.button -eq "right"
  $restoreClicked = $RestorePoint -and $RestorePoint.restore_click -and
    [string]$RestorePoint.restore_click.button -eq "left"
  $hasScreenshots = $RestorePoint -and
    $RestorePoint.before_screenshot -and
    $RestorePoint.menu_screenshot -and
    $RestorePoint.after_screenshot -and
    (Test-Path -LiteralPath $RestorePoint.before_screenshot.path) -and
    (Test-Path -LiteralPath $RestorePoint.menu_screenshot.path) -and
    (Test-Path -LiteralPath $RestorePoint.after_screenshot.path)
  $passed = [bool]$RestorePoint.ok -and
    [string]$RestorePoint.source -eq "windows_tray_ui_automation_mouse" -and
    [bool]$RestorePoint.command_fallback_used -eq $false -and
    $trayClicked -and
    $restoreClicked -and
    $hasScreenshots

  [pscustomobject]@{
    enabled = $true
    passed = $passed
    reason = if ($passed) { "physical_tray_menu_item_clicked" } else { "physical_tray_menu_item_click_failed" }
    tray_icon_right_clicked = $trayClicked
    restore_menu_item_left_clicked = $restoreClicked
    command_fallback_used = if ($RestorePoint) { [bool]$RestorePoint.command_fallback_used } else { $null }
    has_desktop_screenshots = $hasScreenshots
    source = if ($RestorePoint) { $RestorePoint.source } else { $null }
  }
}

function New-CuuPetCardTextOverflowGate {
  param(
    [string]$Scenario,
    [object]$Actual
  )

  $enabled = @("run-stream", "run-failure", "permission-401", "permission-403", "generic-runtime-error", "stream-offline") -contains $Scenario
  if (-not $enabled) {
    return [pscustomobject]@{
      enabled = $false
      passed = $true
      reason = "not_pet_card_text_overflow_scenario"
    }
  }

  $bubble = if ($Actual) { Get-CuuObjectPropertyValue -InputObject $Actual -Name "bubble" } else { $null }
  $bubbleLayout = if ($bubble) { Get-CuuObjectPropertyValue -InputObject $bubble -Name "layout" } else { $null }
  $bubbleOffenderValue = if ($bubble) { Get-CuuObjectPropertyValue -InputObject $bubble -Name "overflow_offenders" } else { $null }
  [object[]]$bubbleOffenders = if ($bubbleOffenderValue) { @($bubbleOffenderValue) } else { @() }
  $primaryAction = if ($Actual) { Get-CuuObjectPropertyValue -InputObject $Actual -Name "primary_action" } else { $null }
  $primaryActionLayout = if ($primaryAction) { Get-CuuObjectPropertyValue -InputObject $primaryAction -Name "layout" } else { $null }
  $bubblePresent = $bubble -and [bool](Get-CuuObjectPropertyValue -InputObject $bubble -Name "present")
  $bubbleHasLayout = $null -ne $bubbleLayout
  $bubbleNoHorizontalOverflow = $bubbleHasLayout -and -not [bool](Get-CuuObjectPropertyValue -InputObject $bubbleLayout -Name "horizontal_overflow")
  $bubbleNoVerticalOverflow = $bubbleHasLayout -and -not [bool](Get-CuuObjectPropertyValue -InputObject $bubbleLayout -Name "vertical_overflow")
  $primaryActionPresent = $primaryAction -and [bool](Get-CuuObjectPropertyValue -InputObject $primaryAction -Name "present")
  $primaryActionNoHorizontalOverflow = -not $primaryActionPresent -or (
    $primaryActionLayout -and -not [bool](Get-CuuObjectPropertyValue -InputObject $primaryActionLayout -Name "horizontal_overflow")
  )
  $primaryActionNoVerticalOverflow = -not $primaryActionPresent -or (
    $primaryActionLayout -and -not [bool](Get-CuuObjectPropertyValue -InputObject $primaryActionLayout -Name "vertical_overflow")
  )
  $spatialSafety = if ($Actual) { Get-CuuObjectPropertyValue -InputObject $Actual -Name "spatial_safety" } else { $null }
  $bubbleWithinSurfaceVertical = $false
  $bubbleWithinSurfaceHorizontal = $false
  $bubbleClearOfLive2d = $false
  if ($spatialSafety) {
    $bubbleWithinSurfaceVertical = (Get-CuuObjectPropertyValue -InputObject $spatialSafety -Name "bubble_within_surface_vertical") -eq $true
    $bubbleWithinSurfaceHorizontal = (Get-CuuObjectPropertyValue -InputObject $spatialSafety -Name "bubble_within_surface_horizontal") -eq $true
    $bubbleClearOfLive2d = (Get-CuuObjectPropertyValue -InputObject $spatialSafety -Name "bubble_overlaps_live2d") -eq $false
  }
  $bubbleOffenderCount = ($bubbleOffenders | Where-Object { $null -ne $_ } | Measure-Object).Count
  $passed = $bubblePresent `
    -and $bubbleNoHorizontalOverflow `
    -and $bubbleNoVerticalOverflow `
    -and $bubbleOffenderCount -eq 0 `
    -and $primaryActionNoHorizontalOverflow `
    -and $primaryActionNoVerticalOverflow `
    -and $bubbleWithinSurfaceVertical `
    -and $bubbleWithinSurfaceHorizontal `
    -and $bubbleClearOfLive2d

  [pscustomobject]@{
    enabled = $true
    passed = $passed
    reason = if ($passed) { "pet_card_text_and_frame_in_bounds" } else { "pet_card_text_or_frame_overflow_detected" }
    bubble_present = $bubblePresent
    bubble_has_layout = $bubbleHasLayout
    bubble_layout = $bubbleLayout
    spatial_safety = $spatialSafety
    bubble_no_vertical_overflow = $bubbleNoVerticalOverflow
    bubble_within_surface_vertical = $bubbleWithinSurfaceVertical
    bubble_within_surface_horizontal = $bubbleWithinSurfaceHorizontal
    bubble_clear_of_live2d = $bubbleClearOfLive2d
    primary_action_layout = $primaryActionLayout
    primary_action_no_horizontal_overflow = $primaryActionNoHorizontalOverflow
    primary_action_no_vertical_overflow = $primaryActionNoVerticalOverflow
    overflow_offender_count = $bubbleOffenderCount
    overflow_offenders = $bubbleOffenders
  }
}

function Invoke-CuuInteractionScenarioFrame {
  param(
    [string]$ScenarioName,
    [int]$FrameIndex,
    [object]$Window
  )

  if ($ScenarioName -ne "input-handfeel" -and $ScenarioName -ne "look-avoidance" -and $ScenarioName -ne "look-only" -and $ScenarioName -ne "drag-smoothing" -and $ScenarioName -ne "hide-on-hover" -and $ScenarioName -ne "launcher" -and $ScenarioName -ne "settings-menu" -and $ScenarioName -ne "settings-menu-model-switch" -and $ScenarioName -ne "settings-menu-hover-sync" -and $ScenarioName -ne "pass-through-recovery-settings" -and $ScenarioName -ne "pass-through-recovery-tray" -and $ScenarioName -ne "pass-through-recovery-tray-physical") {
    return $null
  }

  $isLookAvoidance = $ScenarioName -eq "look-avoidance"
  $isLookOnly = $ScenarioName -eq "look-only"
  $isDragSmoothing = $ScenarioName -eq "drag-smoothing"
  $isHideOnHover = $ScenarioName -eq "hide-on-hover"
  $isLauncher = $ScenarioName -eq "launcher"
  $isSettingsMenu = $ScenarioName -eq "settings-menu" -or $ScenarioName -eq "settings-menu-model-switch" -or $ScenarioName -eq "settings-menu-hover-sync" -or $ScenarioName -eq "pass-through-recovery-settings" -or $ScenarioName -eq "pass-through-recovery-tray" -or $ScenarioName -eq "pass-through-recovery-tray-physical"
  $isSettingsMenuModelSwitch = $ScenarioName -eq "settings-menu-model-switch"
  $isSettingsMenuHoverSync = $ScenarioName -eq "settings-menu-hover-sync"
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

  if ($isSettingsMenu) {
    if ($FrameIndex -eq 1) {
      if (-not $script:cuuCdpWebSocketUrl) {
        throw "settings menu capture requires WebView2 CDP."
      }
      $localX = [int][Math]::Round($Window.Rect.Width / 2)
      $localY = [int][Math]::Round($Window.Rect.Height / 2)
      Invoke-CuuCdpMouseClick -WebSocketUrl $script:cuuCdpWebSocketUrl -X $localX -Y $localY -Button "right"
      Start-Sleep -Milliseconds 420
      return [pscustomobject]@{
        frame = $FrameIndex
        action = "right_click_open_settings_menu"
        input_driver = "webview2_cdp"
        webview_point = [pscustomobject]@{
          x = $localX
          y = $localY
        }
        window_rect = $Window.Rect
      }
    }
    if ($isSettingsMenuModelSwitch -and $FrameIndex -eq 2) {
      if (-not $script:cuuCdpWebSocketUrl) {
        throw "settings menu model-switch capture requires WebView2 CDP."
      }
      $point = Invoke-CuuCdpClickSelector -WebSocketUrl $script:cuuCdpWebSocketUrl -Selector "[data-pet-menu-model='cuu-tororo-live2d-cubism2']"
      Start-Sleep -Milliseconds 820
      return [pscustomobject]@{
        frame = $FrameIndex
        action = "click_white_cat_menu_item"
        input_driver = "webview2_cdp"
        webview_point = $point
        window_rect = $Window.Rect
      }
    }
    if ($isSettingsMenuHoverSync -and $FrameIndex -eq 2) {
      if (-not $script:cuuCdpWebSocketUrl) {
        throw "settings menu hover-sync capture requires WebView2 CDP."
      }
      $point = Invoke-CuuCdpClickSelector -WebSocketUrl $script:cuuCdpWebSocketUrl -Selector "[data-pet-menu-toggle-hover]"
      Start-Sleep -Milliseconds 820
      return [pscustomobject]@{
        frame = $FrameIndex
        action = "click_hide_on_hover_menu_item"
        input_driver = "webview2_cdp"
        webview_point = $point
        window_rect = $Window.Rect
      }
    }
    if ($isSettingsMenuHoverSync -and $FrameIndex -eq 4) {
      if (-not $script:cuuCdpWebSocketUrl) {
        throw "settings menu hover-sync capture requires WebView2 CDP."
      }
      $localX = [int][Math]::Round($Window.Rect.Width / 2)
      $localY = [int][Math]::Round($Window.Rect.Height / 2)
      Invoke-CuuCdpMouseClick -WebSocketUrl $script:cuuCdpWebSocketUrl -X $localX -Y $localY -Button "right"
      Start-Sleep -Milliseconds 420
      return [pscustomobject]@{
        frame = $FrameIndex
        action = "right_click_reopen_settings_menu_after_hover_toggle"
        input_driver = "webview2_cdp"
        webview_point = [pscustomobject]@{
          x = $localX
          y = $localY
        }
        window_rect = $Window.Rect
      }
    }
    return $null
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
$originalCuuQaClientToken = $env:WORKHUB_CUU_QA_CLIENT_TOKEN
$originalCuuQaRestoreState = $env:WORKHUB_CUU_QA_RESTORE_STATE
$originalCuuQaRunOutcome = $env:WORKHUB_CUU_QA_RUN_OUTCOME
$originalCuuQaApiFault = $env:WORKHUB_CUU_QA_API_FAULT
$originalWorkHubClientToken = $env:WORKHUB_CLIENT_TOKEN
$originalWebView2AdditionalBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$process = $null
$devServerProcess = $null
$apiServerProcess = $null
$apiServerStartedForCapture = $false
$isolatedRoot = $null
$cuuCdpDebugPort = $null
$reloadRestoreSeed = $null
$initialPetSettingsSnapshot = $null
$mainSettingsBeforeRestore = $null
$mainSettingsAfterRestore = $null
$mainSettingsBeforeHoverSync = $null
$mainSettingsAfterHoverSync = $null
$physicalTrayRestorePoint = $null

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
  $isRunStreamScenario = @("run-stream", "run-failure", "permission-401", "permission-403", "generic-runtime-error", "stream-offline") -contains $Scenario
  $isReloadRestoreScenario = $reloadRestoreScenarios -contains $Scenario
  $usesCommandTrayRecoveryCapture = $Scenario -eq "pass-through-recovery-tray"
  $usesPhysicalTrayRecoveryCapture = $Scenario -eq "pass-through-recovery-tray-physical"
  $usesPassThroughRecoveryCapture = $Scenario -eq "pass-through-recovery-settings" -or $usesCommandTrayRecoveryCapture -or $usesPhysicalTrayRecoveryCapture
  $usesHoverSyncCapture = $Scenario -eq "settings-menu-hover-sync"
  $usesMainSettingsCapture = $usesPassThroughRecoveryCapture -or $usesHoverSyncCapture
  $usesCuuR3ApiServer = $isRunStreamScenario -or $isReloadRestoreScenario -or $usesMainSettingsCapture
  if (($Scenario -ne "idle" -and -not $usesCuuR3ApiServer) -or $DisableSse) {
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
  if ($usesCuuR3ApiServer) {
    $env:WORKHUB_CUU_QA_CLIENT_TOKEN = "cuu-r3-local-client-token"
    $env:WORKHUB_CLIENT_TOKEN = "cuu-r3-local-client-token"
  } else {
    Remove-Item -Path "Env:WORKHUB_CUU_QA_CLIENT_TOKEN" -ErrorAction SilentlyContinue
  }
  if ($Scenario -eq "run-failure") {
    $env:WORKHUB_CUU_QA_RUN_OUTCOME = "failed"
  } elseif ($usesCuuR3ApiServer) {
    $env:WORKHUB_CUU_QA_RUN_OUTCOME = "succeeded"
  } else {
    Remove-Item -Path "Env:WORKHUB_CUU_QA_RUN_OUTCOME" -ErrorAction SilentlyContinue
  }
  if ($Scenario -eq "generic-runtime-error") {
    $env:WORKHUB_CUU_QA_API_FAULT = "generic-502"
  } elseif (@("permission-401", "permission-403", "stream-offline") -contains $Scenario) {
    $env:WORKHUB_CUU_QA_API_FAULT = $Scenario
  } elseif ($usesCuuR3ApiServer) {
    $env:WORKHUB_CUU_QA_API_FAULT = "none"
  } else {
    Remove-Item -Path "Env:WORKHUB_CUU_QA_API_FAULT" -ErrorAction SilentlyContinue
  }
  Remove-Item -Path "Env:WORKHUB_CUU_QA_RESTORE_STATE" -ErrorAction SilentlyContinue
  $initialPetPassThrough = [bool]$PetPassThrough -or $usesPassThroughRecoveryCapture
  if ($initialPetPassThrough) {
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
  if ($Scenario -eq "launcher" -or $Scenario -eq "settings-menu" -or $Scenario -eq "settings-menu-model-switch" -or $usesMainSettingsCapture) {
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

  if ($usesCuuR3ApiServer) {
    $apiServerProcess = Start-CuuR3RunStreamApiServerIfNeeded -RunOutcome $env:WORKHUB_CUU_QA_RUN_OUTCOME -ApiFault $env:WORKHUB_CUU_QA_API_FAULT
    $apiServerStartedForCapture = $null -ne $apiServerProcess
  }
  if ($isReloadRestoreScenario) {
    $reloadRestoreSeed = New-CuuR3ReloadRestoreSeed -ScenarioName $Scenario -SeedLocale $Locale
    $env:WORKHUB_CUU_QA_RESTORE_STATE = $reloadRestoreSeed.restore_state | ConvertTo-Json -Depth 12 -Compress
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
  if (($Scenario -eq "launcher" -or $Scenario -eq "settings-menu" -or $Scenario -eq "settings-menu-model-switch" -or $usesMainSettingsCapture) -and $cuuCdpDebugPort) {
    $script:cuuCdpWebSocketUrl = Wait-CuuCdpPetWebSocketUrl -Port $cuuCdpDebugPort -TimeoutSeconds $WaitSeconds
  }
  if ($usesMainSettingsCapture -and -not $script:cuuCdpWebSocketUrl) {
    throw "main settings capture requires pet WebView2 CDP."
  }
  if ($usesMainSettingsCapture -and $cuuCdpDebugPort) {
    $script:cuuMainCdpWebSocketUrl = Wait-CuuCdpMainWebSocketUrl -Port $cuuCdpDebugPort -TimeoutSeconds $WaitSeconds
    if (-not $script:cuuMainCdpWebSocketUrl) {
      throw "main settings capture requires main WebView2 CDP."
    }
  }
  if ($Scenario -eq "look-only") {
    Start-Sleep -Milliseconds 700
    $stabilizedPet = Select-CuuWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    if ($stabilizedPet) {
      $pet = $stabilizedPet
    }
  }

  if ($usesPassThroughRecoveryCapture) {
    if ($initialPetPassThrough) {
      Invoke-CuuCdpSeedCuuPreferenceStorage `
        -WebSocketUrl $script:cuuMainCdpWebSocketUrl `
        -ScalePercent $PetScalePercent `
        -OpacityPercent 100 `
        -PassThrough $true `
        -HideOnHover $false `
        -ModelPackId $ModelPackId `
        -Reload | Out-Null
      Invoke-CuuCdpSeedCuuPreferenceStorage `
        -WebSocketUrl $script:cuuCdpWebSocketUrl `
        -ScalePercent $PetScalePercent `
        -OpacityPercent 100 `
        -PassThrough $true `
        -HideOnHover $false `
        -ModelPackId $ModelPackId `
        -Reload | Out-Null
      Start-Sleep -Milliseconds 1600
      $initialPetSettingsSnapshot = Wait-CuuCdpPetSettingsState `
        -WebSocketUrl $script:cuuCdpWebSocketUrl `
        -ExpectedPassThrough $true `
        -ExpectedHideOnHover $false `
        -ExpectedOpacityPercent 100 `
        -TimeoutSeconds $WaitSeconds
    } else {
      $initialPetSettingsSnapshot = Invoke-CuuCdpPetSettingsSnapshot -WebSocketUrl $script:cuuCdpWebSocketUrl
    }
    $beforeSnapshot = Wait-CuuCdpMainSettingsState `
      -WebSocketUrl $script:cuuMainCdpWebSocketUrl `
      -ExpectedLocale $Locale `
      -ExpectedPassThrough $true `
      -ExpectedHideOnHover $false `
      -ExpectedOpacityPercent 100 `
      -TimeoutSeconds $WaitSeconds
    $mainBeforeWindow = Select-WorkHubMainWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    if (-not $mainBeforeWindow) {
      throw "WorkHub main window was not found for settings screenshot before restore."
    }
    Invoke-CuuCdpScrollMainPetSettingsIntoView -WebSocketUrl $script:cuuMainCdpWebSocketUrl | Out-Null
    Start-Sleep -Milliseconds 180
    $mainBeforeWindow = Select-WorkHubMainWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    $mainBeforeScreenshot = Join-Path $OutDir "main-settings-before-restore.png"
    New-WindowFrame -Window $mainBeforeWindow -Path $mainBeforeScreenshot
    $mainSettingsBeforeRestore = [pscustomobject]@{
      screenshot = $mainBeforeScreenshot
      snapshot = $beforeSnapshot
      layout_gate = New-CuuMainSettingsLayoutGate -Snapshot $beforeSnapshot -ExpectedLocale $Locale -AfterRestore $false
    }

    if ($usesCommandTrayRecoveryCapture) {
      $restorePoint = Invoke-CuuCdpRestorePetInteractionCommand -WebSocketUrl $script:cuuCdpWebSocketUrl
      if (-not $restorePoint -or -not $restorePoint.ok) {
        $restoreError = if ($restorePoint) { $restorePoint.error } else { "no_restore_result" }
        throw "Tray restore command failed: $restoreError"
      }
    } elseif ($usesPhysicalTrayRecoveryCapture) {
      $restorePoint = Invoke-CuuWindowsTrayRestoreInteraction -OutDir $OutDir -TimeoutSeconds $WaitSeconds
      $physicalTrayRestorePoint = $restorePoint
    } else {
      $restorePoint = Invoke-CuuCdpClickSelector -WebSocketUrl $script:cuuMainCdpWebSocketUrl -Selector "[data-cuu-pet-restore-interaction]"
    }
    Start-Sleep -Milliseconds 900
    $afterSnapshot = Wait-CuuCdpMainSettingsState `
      -WebSocketUrl $script:cuuMainCdpWebSocketUrl `
      -ExpectedLocale $Locale `
      -ExpectedPassThrough $false `
      -ExpectedHideOnHover $false `
      -ExpectedOpacityPercent 100 `
      -TimeoutSeconds $WaitSeconds
    $mainAfterWindow = Select-WorkHubMainWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    if (-not $mainAfterWindow) {
      throw "WorkHub main window was not found for settings screenshot after restore."
    }
    Invoke-CuuCdpScrollMainPetSettingsIntoView -WebSocketUrl $script:cuuMainCdpWebSocketUrl | Out-Null
    Start-Sleep -Milliseconds 180
    $mainAfterWindow = Select-WorkHubMainWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    $mainAfterScreenshot = Join-Path $OutDir "main-settings-after-restore.png"
    New-WindowFrame -Window $mainAfterWindow -Path $mainAfterScreenshot
    $mainSettingsAfterRestore = [pscustomobject]@{
      screenshot = $mainAfterScreenshot
      restore_click = $restorePoint
      snapshot = $afterSnapshot
      layout_gate = New-CuuMainSettingsLayoutGate -Snapshot $afterSnapshot -ExpectedLocale $Locale -AfterRestore $true
    }
    if (-not $mainSettingsBeforeRestore.layout_gate.passed -or -not $mainSettingsAfterRestore.layout_gate.passed) {
      $layoutDebug = [pscustomobject]@{
        before = $mainSettingsBeforeRestore
        after = $mainSettingsAfterRestore
        captured_at_iso = (Get-Date).ToUniversalTime().ToString("o")
      }
      $layoutDebugPath = Join-Path $OutDir "main-settings-layout-gate-debug.json"
      $layoutDebug | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $layoutDebugPath -Encoding utf8
      $beforeGate = $mainSettingsBeforeRestore.layout_gate | ConvertTo-Json -Compress -Depth 8
      $afterGate = $mainSettingsAfterRestore.layout_gate | ConvertTo-Json -Compress -Depth 8
      throw "Main settings layout gate failed before pet menu recovery capture. Debug: $layoutDebugPath Before: $beforeGate After: $afterGate"
    }
  } elseif ($usesHoverSyncCapture) {
    Invoke-CuuCdpSeedCuuPreferenceStorage `
      -WebSocketUrl $script:cuuMainCdpWebSocketUrl `
      -ScalePercent $PetScalePercent `
      -OpacityPercent $PetOpacityPercent `
      -PassThrough $false `
      -HideOnHover $false `
      -ModelPackId $ModelPackId `
      -Reload | Out-Null
    Invoke-CuuCdpSeedCuuPreferenceStorage `
      -WebSocketUrl $script:cuuCdpWebSocketUrl `
      -ScalePercent $PetScalePercent `
      -OpacityPercent $PetOpacityPercent `
      -PassThrough $false `
      -HideOnHover $false `
      -ModelPackId $ModelPackId `
      -Reload | Out-Null
    Start-Sleep -Milliseconds 1600
    $initialPetSettingsSnapshot = Wait-CuuCdpPetSettingsState `
      -WebSocketUrl $script:cuuCdpWebSocketUrl `
      -ExpectedPassThrough $false `
      -ExpectedHideOnHover $false `
      -ExpectedOpacityPercent $PetOpacityPercent `
      -TimeoutSeconds $WaitSeconds
    $beforeSnapshot = Wait-CuuCdpMainSettingsState `
      -WebSocketUrl $script:cuuMainCdpWebSocketUrl `
      -ExpectedLocale $Locale `
      -ExpectedPassThrough $false `
      -ExpectedHideOnHover $false `
      -ExpectedOpacityPercent $PetOpacityPercent `
      -TimeoutSeconds $WaitSeconds
    $mainBeforeWindow = Select-WorkHubMainWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    if (-not $mainBeforeWindow) {
      throw "WorkHub main window was not found for settings screenshot before hover sync."
    }
    Invoke-CuuCdpScrollMainPetSettingsIntoView -WebSocketUrl $script:cuuMainCdpWebSocketUrl | Out-Null
    Start-Sleep -Milliseconds 180
    $mainBeforeWindow = Select-WorkHubMainWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    $mainBeforeScreenshot = Join-Path $OutDir "main-settings-before-hover-sync.png"
    New-WindowFrame -Window $mainBeforeWindow -Path $mainBeforeScreenshot
    $mainSettingsBeforeHoverSync = [pscustomobject]@{
      screenshot = $mainBeforeScreenshot
      snapshot = $beforeSnapshot
      layout_gate = New-CuuMainSettingsLayoutGate -Snapshot $beforeSnapshot -ExpectedLocale $Locale -AfterRestore $false
    }
    if (-not $mainSettingsBeforeHoverSync.layout_gate.passed) {
      $layoutDebugPath = Join-Path $OutDir "main-settings-hover-sync-before-gate-debug.json"
      $mainSettingsBeforeHoverSync | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $layoutDebugPath -Encoding utf8
      $beforeGate = $mainSettingsBeforeHoverSync.layout_gate | ConvertTo-Json -Compress -Depth 8
      throw "Main settings layout gate failed before hover sync capture. Debug: $layoutDebugPath Gate: $beforeGate"
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

  if ($usesHoverSyncCapture) {
    $afterPetSettingsSnapshot = Wait-CuuCdpPetSettingsState `
      -WebSocketUrl $script:cuuCdpWebSocketUrl `
      -ExpectedPassThrough $false `
      -ExpectedHideOnHover $true `
      -ExpectedOpacityPercent $PetOpacityPercent `
      -TimeoutSeconds $WaitSeconds
    $afterSnapshot = Wait-CuuCdpMainSettingsState `
      -WebSocketUrl $script:cuuMainCdpWebSocketUrl `
      -ExpectedLocale $Locale `
      -ExpectedPassThrough $false `
      -ExpectedHideOnHover $true `
      -ExpectedOpacityPercent $PetOpacityPercent `
      -TimeoutSeconds $WaitSeconds
    $mainAfterWindow = Select-WorkHubMainWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    if (-not $mainAfterWindow) {
      throw "WorkHub main window was not found for settings screenshot after hover sync."
    }
    Invoke-CuuCdpScrollMainPetSettingsIntoView -WebSocketUrl $script:cuuMainCdpWebSocketUrl | Out-Null
    Start-Sleep -Milliseconds 180
    $mainAfterWindow = Select-WorkHubMainWindow -Windows @(Get-WorkHubProcessWindows -TargetProcessId $process.Id)
    $mainAfterScreenshot = Join-Path $OutDir "main-settings-after-hover-sync.png"
    New-WindowFrame -Window $mainAfterWindow -Path $mainAfterScreenshot
    $mainSettingsAfterHoverSync = [pscustomobject]@{
      screenshot = $mainAfterScreenshot
      pet_snapshot = $afterPetSettingsSnapshot
      snapshot = $afterSnapshot
      layout_gate = New-CuuMainSettingsLayoutGate -Snapshot $afterSnapshot -ExpectedLocale $Locale -AfterRestore $false
    }
    if (-not $mainSettingsAfterHoverSync.layout_gate.passed) {
      $layoutDebugPath = Join-Path $OutDir "main-settings-hover-sync-after-gate-debug.json"
      $mainSettingsAfterHoverSync | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $layoutDebugPath -Encoding utf8
      $afterGate = $mainSettingsAfterHoverSync.layout_gate | ConvertTo-Json -Compress -Depth 8
      throw "Main settings layout gate failed after hover sync capture. Debug: $layoutDebugPath Gate: $afterGate"
    }
  }

  $contactSheet = Join-Path $OutDir "cuu-motion-contact-sheet.png"
  New-ContactSheet -Frames $frames.ToArray() -Path $contactSheet

  $diffs = @()
  $framePixelReports = @()
  $rightEdgeReports = @()
  for ($i = 0; $i -lt $frames.Count; $i++) {
    $framePixelReport = Measure-CuuFrameVisualPixels -Path $frames[$i]
    $rightEdgeReport = Measure-CuuFrameRightEdgeLightPixels -Path $frames[$i]
    $vsFirst = Measure-FrameDiff -BasePath $frames[0] -Path $frames[$i] -Step $PixelStep
    $vsPrevious = if ($i -gt 0) { Measure-FrameDiff -BasePath $frames[$i - 1] -Path $frames[$i] -Step $PixelStep } else { $vsFirst }
    $framePixelReports += [pscustomobject]@{
      frame = $i
      pixel_report = $framePixelReport
    }
    $rightEdgeReports += [pscustomobject]@{
      frame = $i
      right_edge = $rightEdgeReport
    }
    $diffs += [pscustomobject]@{
      frame = $i
      rect = $rects[$i]
      vs_first = $vsFirst
      vs_previous = $vsPrevious
    }
  }

  $rightEdgeClipGateEnabled = $expectedBehavior.data_cuu_behavior_expected_bubble_mode -ne "none" -and $expectedBehavior.data_pet_window_mode -eq "card"
  $rightEdgeClippedFrames = @()
  if ($rightEdgeClipGateEnabled) {
    $rightEdgeClippedFrames = @($rightEdgeReports | Where-Object {
      $_.right_edge.right_edge_light_pixels -gt $MaxRightEdgeLightPixels
    })
  }
  $rightEdgeClipGate = [pscustomobject]@{
    enabled = $rightEdgeClipGateEnabled
    passed = (-not $rightEdgeClipGateEnabled) -or $rightEdgeClippedFrames.Count -eq 0
    max_right_edge_light_pixels = if ($rightEdgeReports.Count -gt 0) { ($rightEdgeReports | ForEach-Object { $_.right_edge.right_edge_light_pixels } | Measure-Object -Maximum).Maximum } else { 0 }
    max_allowed_right_edge_light_pixels = $MaxRightEdgeLightPixels
    clipped_frames = @($rightEdgeClippedFrames | ForEach-Object { $_.frame })
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
  $expectedModelPackIdForDom = if ($Scenario -eq "settings-menu-model-switch") { "cuu-tororo-live2d-cubism2" } else { $ModelPackId }
  $actualDomMatchesExpected = Test-CuuActualDomMatchesExpected -Expected $expectedBehavior -Actual $actualDomReport -ExpectedModelPackId $expectedModelPackIdForDom -Scenario $Scenario -ExpectedLocale $Locale
  $settingsMenuLayoutGate = New-CuuSettingsMenuLayoutGate -Scenario $Scenario -Actual $actualDomReport -ExpectedLocale $Locale
  $passThroughRecoveryGate = New-CuuPassThroughRecoveryGate -Scenario $Scenario -InitialPetSnapshot $initialPetSettingsSnapshot -MainBefore $mainSettingsBeforeRestore -MainAfter $mainSettingsAfterRestore -FinalPetDomReport $actualDomReport
  $settingsMenuHoverSyncGate = New-CuuSettingsMenuHoverSyncGate -Scenario $Scenario -MainBefore $mainSettingsBeforeHoverSync -MainAfter $mainSettingsAfterHoverSync -FinalPetDomReport $actualDomReport
  $physicalTrayRecoveryGate = New-CuuPhysicalTrayRecoveryGate -Scenario $Scenario -RestorePoint $physicalTrayRestorePoint
  $petCardTextOverflowGate = New-CuuPetCardTextOverflowGate -Scenario $Scenario -Actual $actualDomReport

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
  $capturePassed = $motionGatePassed -and $actualDomReportAvailable -and $actualDomMatchesExpected -and $rightEdgeClipGate.passed -and $settingsMenuLayoutGate.passed -and $passThroughRecoveryGate.passed -and $settingsMenuHoverSyncGate.passed -and $physicalTrayRecoveryGate.passed -and $petCardTextOverflowGate.passed

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
    reload_restore_seed = if ($reloadRestoreSeed) {
      $seedRun = Get-CuuObjectPropertyValue -InputObject $reloadRestoreSeed -Name "run"
      [pscustomobject]@{
        kind = $reloadRestoreSeed.kind
        locale = $reloadRestoreSeed.locale
        session_id = Get-CuuObjectPropertyValue -InputObject $reloadRestoreSeed -Name "session_id"
        work_item_id = Get-CuuObjectPropertyValue -InputObject $reloadRestoreSeed -Name "work_item_id"
        run_id = if ($seedRun) { $seedRun.run_id } else { $null }
        restore_entity_type = $reloadRestoreSeed.restore_state.entity_type
        restore_entity_id = $reloadRestoreSeed.restore_state.entity_id
      }
    } else {
      $null
    }
    right_edge_clip_gate = $rightEdgeClipGate
    settings_menu_layout_gate = $settingsMenuLayoutGate
    pass_through_recovery_gate = $passThroughRecoveryGate
    settings_menu_hover_sync_gate = $settingsMenuHoverSyncGate
    physical_tray_recovery_gate = $physicalTrayRecoveryGate
    pet_card_text_overflow_gate = $petCardTextOverflowGate
    physical_tray_restore = $physicalTrayRestorePoint
    main_settings_before_restore = $mainSettingsBeforeRestore
    main_settings_after_restore = $mainSettingsAfterRestore
    main_settings_before_hover_sync = $mainSettingsBeforeHoverSync
    main_settings_after_hover_sync = $mainSettingsAfterHoverSync
    initial_pet_settings_snapshot = $initialPetSettingsSnapshot
    cuu_qa_preferences = [pscustomobject]@{
      pet_scale_percent = $PetScalePercent
      pet_opacity_percent = $PetOpacityPercent
      pet_pass_through = $initialPetPassThrough
      pet_hide_on_hover = $cuuQaHideOnHover
      pet_model_pack_id = $ModelPackId
      expected_dom_model_pack_id = $expectedModelPackIdForDom
      pet_locale = $Locale
      pet_qa_scenario = if ($isQaScenario) { $Scenario } else { $null }
      webview2_cdp_enabled = [bool]$script:cuuCdpWebSocketUrl
      main_webview2_cdp_enabled = [bool]$script:cuuMainCdpWebSocketUrl
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
    if ($gifProcess.ExitCode -ne 0 -or -not (Test-Path $gifPath) -or (Get-Item -LiteralPath $gifPath).Length -le 0) {
      Remove-Item -LiteralPath $gifPath -ErrorAction SilentlyContinue
      $gifPath = $null
    }
    $mp4Process = Start-Process -FilePath $ffmpeg.Source -ArgumentList @("-y", "-framerate", "$fps", "-i", $inputPattern, "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p", $mp4Path) -Wait -PassThru -NoNewWindow -RedirectStandardError $mp4Log -RedirectStandardOutput (Join-Path $OutDir "ffmpeg-mp4.out")
    if ($mp4Process.ExitCode -ne 0 -or -not (Test-Path $mp4Path) -or (Get-Item -LiteralPath $mp4Path).Length -le 0) {
      Remove-Item -LiteralPath $mp4Path -ErrorAction SilentlyContinue
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
    settings_menu_layout_gate = $settingsMenuLayoutGate
    pass_through_recovery_gate = $passThroughRecoveryGate
    settings_menu_hover_sync_gate = $settingsMenuHoverSyncGate
    physical_tray_recovery_gate = $physicalTrayRecoveryGate
    pet_card_text_overflow_gate = $petCardTextOverflowGate
    physical_tray_restore = if ($physicalTrayRestorePoint) {
      [pscustomobject]@{
        source = $physicalTrayRestorePoint.source
        command_fallback_used = $physicalTrayRestorePoint.command_fallback_used
        before_screenshot = if ($physicalTrayRestorePoint.before_screenshot) { $physicalTrayRestorePoint.before_screenshot.path } else { $null }
        overflow_screenshot = if ($physicalTrayRestorePoint.overflow_screenshot) { $physicalTrayRestorePoint.overflow_screenshot.path } else { $null }
        menu_screenshot = if ($physicalTrayRestorePoint.menu_screenshot) { $physicalTrayRestorePoint.menu_screenshot.path } else { $null }
        after_screenshot = if ($physicalTrayRestorePoint.after_screenshot) { $physicalTrayRestorePoint.after_screenshot.path } else { $null }
        tray_icon = $physicalTrayRestorePoint.tray_icon
        restore_menu_item = $physicalTrayRestorePoint.restore_menu_item
      }
    } else { $null }
    main_settings_before_restore = if ($mainSettingsBeforeRestore) {
      [pscustomobject]@{
        screenshot = $mainSettingsBeforeRestore.screenshot
        layout_gate = $mainSettingsBeforeRestore.layout_gate
      }
    } else { $null }
    main_settings_after_restore = if ($mainSettingsAfterRestore) {
      [pscustomobject]@{
        screenshot = $mainSettingsAfterRestore.screenshot
        layout_gate = $mainSettingsAfterRestore.layout_gate
      }
    } else { $null }
    main_settings_before_hover_sync = if ($mainSettingsBeforeHoverSync) {
      [pscustomobject]@{
        screenshot = $mainSettingsBeforeHoverSync.screenshot
        layout_gate = $mainSettingsBeforeHoverSync.layout_gate
      }
    } else { $null }
    main_settings_after_hover_sync = if ($mainSettingsAfterHoverSync) {
      [pscustomobject]@{
        screenshot = $mainSettingsAfterHoverSync.screenshot
        layout_gate = $mainSettingsAfterHoverSync.layout_gate
      }
    } else { $null }
    reload_restore_seed = if ($reloadRestoreSeed) {
      $seedRun = Get-CuuObjectPropertyValue -InputObject $reloadRestoreSeed -Name "run"
      [pscustomobject]@{
        kind = $reloadRestoreSeed.kind
        locale = $reloadRestoreSeed.locale
        session_id = Get-CuuObjectPropertyValue -InputObject $reloadRestoreSeed -Name "session_id"
        work_item_id = Get-CuuObjectPropertyValue -InputObject $reloadRestoreSeed -Name "work_item_id"
        run_id = if ($seedRun) { $seedRun.run_id } else { $null }
        restore_entity_type = $reloadRestoreSeed.restore_state.entity_type
        restore_entity_id = $reloadRestoreSeed.restore_state.entity_id
      }
    } else {
      $null
    }
    cuu_qa_preferences = [pscustomobject]@{
      pet_scale_percent = $PetScalePercent
      pet_opacity_percent = $PetOpacityPercent
      pet_pass_through = $initialPetPassThrough
      pet_hide_on_hover = $cuuQaHideOnHover
      pet_model_pack_id = $ModelPackId
      expected_dom_model_pack_id = $expectedModelPackIdForDom
      pet_locale = $Locale
      pet_qa_scenario = if ($isQaScenario) { $Scenario } else { $null }
      webview2_cdp_enabled = [bool]$script:cuuCdpWebSocketUrl
      main_webview2_cdp_enabled = [bool]$script:cuuMainCdpWebSocketUrl
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
  Restore-EnvVar -Name "WORKHUB_CUU_QA_CLIENT_TOKEN" -Value $originalCuuQaClientToken
  Restore-EnvVar -Name "WORKHUB_CUU_QA_RESTORE_STATE" -Value $originalCuuQaRestoreState
  Restore-EnvVar -Name "WORKHUB_CUU_QA_RUN_OUTCOME" -Value $originalCuuQaRunOutcome
  Restore-EnvVar -Name "WORKHUB_CUU_QA_API_FAULT" -Value $originalCuuQaApiFault
  Restore-EnvVar -Name "WORKHUB_CLIENT_TOKEN" -Value $originalWorkHubClientToken
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
  if ($apiServerProcess -and -not $apiServerProcess.HasExited) {
    Stop-Process -Id $apiServerProcess.Id -Force
    $apiServerProcess.WaitForExit()
  }
  if ($apiServerStartedForCapture) {
    [void](Stop-CuuR3RunStreamApiServerIfOwned -Port 8787)
  }
}
