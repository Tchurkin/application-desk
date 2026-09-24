/*
 * The counselor for Windows: one file the student downloads and double-clicks, once.
 *
 * It sets up Claude Code, which the student already has and is signed in to, as their
 * counselor, running hidden on their own computer on their own Claude plan:
 * - a small watcher (PowerShell, no window) asks the desk every few seconds whether anything
 *   new was asked on the website. Waiting costs nothing: Claude isn't involved.
 * - when something arrives, it starts Claude Code headless in the counselor's folder, with the
 *   desk's connector, to answer it. Each run continues the same conversation, so the counselor
 *   remembers the student from one request to the next.
 * - it starts again whenever the student signs in to Windows, and turns itself off for good
 *   when its connector link is revoked in Settings.
 *
 * The file is a batch/PowerShell hybrid: cmd runs the first lines, which hand the whole file to
 * PowerShell, where those lines are a comment. It must stay ASCII with CRLF line endings.
 * PowerShell code lives in String.raw templates: no backticks in it, and "${" only for our own
 * substitutions.
 */

export interface InstallerConfig {
  /** The website, e.g. https://application-desk-seven.vercel.app */
  site: string;
  supabaseUrl: string;
  /** The Supabase publishable (or legacy anon) key; public, it ships in every page. */
  supabaseKey: string;
  /** The counselor's own connector token. */
  token: string;
}

/** The folder the counselor lives in, under %LOCALAPPDATA%. */
export const COUNSELOR_DIR = String.raw`ApplicationDesk\Counselor`;
export const STARTUP_NAME = "Application Desk counselor.lnk";
export const INSTALLER_NAME = "Application Desk counselor setup.cmd";

const MCP_SERVER = "application-desk";

/** What Claude is told each time it wakes. */
export const WAKE_PROMPT =
  "New requests are waiting on my Application Desk. Handle every waiting request now: call list_desk_requests and do exactly what each one says, closing each with answer_request. Then stop, with one short line per request.";

/** The counselor's standing instructions (its folder's CLAUDE.md). */
export const COUNSELOR_BRIEF = String.raw`# Application Desk counselor

You are this student's college counselor and writing partner. You work on their Application Desk through the application-desk tools. The student never reads this conversation: they use the Application Desk website, and everything you do has to land there.

Each time you are started, requests from the website are waiting. Call list_desk_requests and handle every request exactly as it says, closing each with answer_request: a question gets your answer; polish gets rewordings suggested in the essay; odds get set_college_strategy; an interview answer gets saved to the profile and followed by your next question. Then stop.

This conversation continues from one request to the next, so you remember what the student has told you. Read their profile (read_profile) when you need context, and save anything lasting you learn about them with save_profile_section.

Stay within what the student allows (list_my_desk says). Be honest, specific and encouraging, keep the student's voice, and never invent facts about them.
`;

/** The watcher, saved as watch.ps1 in the counselor's folder. */
const WATCHER = String.raw`# Application Desk counselor: watches the desk and wakes Claude Code when something is asked.
# Started hidden at sign-in. Log: counselor.log in this folder.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Cfg = [IO.File]::ReadAllText((Join-Path $Dir 'config.json')) | ConvertFrom-Json
$LogFile = Join-Path $Dir 'counselor.log'
$OutFile = Join-Path $Dir 'last-run.log'
$ErrFile = Join-Path $Dir 'last-run-errors.log'
$SessionFile = Join-Path $Dir 'session.txt'
$Mcp = Join-Path $Dir 'mcp.json'

function Log($m) { try { Add-Content -Path $LogFile -Value ((Get-Date).ToString('s') + ' ' + $m) } catch {} }
if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) { Move-Item -Force $LogFile ($LogFile + '.old') }

# One watcher at a time.
$Fresh = $false
$Mutex = New-Object System.Threading.Mutex($true, 'Local\ApplicationDeskCounselor', [ref]$Fresh)
if (-not $Fresh) { exit }

$Headers = @{ apikey = $Cfg.key }
if ($Cfg.key -like 'eyJ*') { $Headers['Authorization'] = 'Bearer ' + $Cfg.key }
$Body = @{ token = $Cfg.token } | ConvertTo-Json -Compress
$PollUrl = $Cfg.supabaseUrl + '/rest/v1/rpc/connector_counselor_poll'

function Quote($a) { return '"' + ($a -replace '"', '\"') + '"' }

$script:Run = $null
$script:Started = $null
$script:Resumed = $false
$script:Again = $false

function Start-Counselor {
  $session = ''
  if (Test-Path $SessionFile) { $session = ([IO.File]::ReadAllText($SessionFile)).Trim() }
  $a = @('-p', (Quote $Cfg.prompt))
  if ($session) {
    $a += @('--resume', $session)
    $script:Resumed = $true
  } else {
    $session = [guid]::NewGuid().ToString()
    [IO.File]::WriteAllText($SessionFile, $session)
    $a += @('--session-id', $session, '--name', (Quote 'Application Desk counselor'))
    $script:Resumed = $false
  }
  $a += @('--mcp-config', (Quote $Mcp), '--strict-mcp-config', '--allowedTools', 'mcp__${MCP_SERVER}', 'WebSearch', 'WebFetch')
  try {
    $script:Run = Start-Process -FilePath $Cfg.claude -ArgumentList ($a -join ' ') -WorkingDirectory $Dir -NoNewWindow -PassThru -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile
    $null = $script:Run.Handle
    $script:Started = Get-Date
    Log 'Claude is answering.'
  } catch {
    $script:Run = $null
    Log ('Could not start Claude Code: ' + $_.Exception.Message)
  }
}

function Finish-Run {
  $code = $script:Run.ExitCode
  $script:Run = $null
  if ($code -eq 0) { Log 'Done.'; return }
  $e = ''
  try { $e = [IO.File]::ReadAllText($ErrFile) + ' ' + [IO.File]::ReadAllText($OutFile) } catch {}
  Log ('Claude Code stopped with an error (' + $code + '): ' + $e.Trim())
  if ($script:Resumed -and $e -match 'conversation|session') {
    # The saved conversation is gone: start a new one.
    Remove-Item -Force -ErrorAction SilentlyContinue $SessionFile
    $script:Again = $true
  }
}

Log 'Counselor started.'
$Fails = 0
$Waiting = 0
while ($true) {
  $pause = 3
  try {
    $r = Invoke-RestMethod -Method Post -Uri $PollUrl -Headers $Headers -ContentType 'application/json' -Body $Body -TimeoutSec 30
    $Fails = 0
    $Waiting = [int]$r.waiting
    if ([int]$r.fresh -gt 0) { $script:Again = $true }
  } catch {
    $detail = ''
    if ($_.ErrorDetails) { $detail = $_.ErrorDetails.Message }
    if ($detail -like '*not valid*') {
      Log 'Its connector link was revoked, so the counselor is turning itself off.'
      Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath('Startup')) '${STARTUP_NAME}')
      exit
    }
    $Fails++
    Log ('Could not reach the desk: ' + $_.Exception.Message + ' ' + $detail)
    $pause = [Math]::Min(60, 3 * $Fails)
  }
  if ($script:Run) {
    if ($script:Run.HasExited) { Finish-Run }
    elseif (((Get-Date) - $script:Started).TotalMinutes -gt 20) {
      Log 'Claude took over 20 minutes; stopping that run.'
      try { $script:Run.Kill() } catch {}
      $script:Run = $null
    }
  }
  if ($script:Again -and -not $script:Run) {
    $script:Again = $false
    if ($Waiting -gt 0) { Start-Counselor }
  }
  Start-Sleep -Seconds $pause
}
`;

/** Stops the watcher and removes it from sign-in (stop.ps1, and the installer's first step). */
const STOPPER = String.raw`Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { $_.CommandLine -like '*${COUNSELOR_DIR}\watch.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath('Startup')) '${STARTUP_NAME}')
`;

const TURN_OFF_CMD = String.raw`@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
echo The Application Desk counselor is off. Double-click the setup file again to turn it back on.
pause
`;

/** The installer's PowerShell. Placeholders are filled in by counselorInstaller. */
const SETUP = String.raw`$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Site = '__SITE__'
$SupabaseUrl = '__SUPABASE_URL__'
$Key = '__KEY__'
$Token = '__TOKEN__'
$Dir = Join-Path $env:LOCALAPPDATA '${COUNSELOR_DIR}'
$Shell = New-Object -ComObject WScript.Shell
$NL = [Environment]::NewLine
function Say($text, $icon) { [void]$Shell.Popup($text, 0, 'Application Desk counselor', $icon) }
function Save($name, $text) { [IO.File]::WriteAllText((Join-Path $Dir $name), $text, (New-Object System.Text.UTF8Encoding($false))) }

try {
  # Claude Code, which the counselor runs on.
  $Claude = $null
  $found = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $Claude = $found.Source }
  if (-not $Claude) {
    foreach ($p in @((Join-Path $env:USERPROFILE '.local\bin\claude.exe'), (Join-Path $env:APPDATA 'npm\claude.cmd'))) {
      if (Test-Path $p) { $Claude = $p; break }
    }
  }
  if (-not $Claude) {
    Say ("Claude Code isn't installed on this computer yet." + $NL + $NL + "Install it from claude.com/claude-code and sign in once, then double-click this file again.") 48
    exit 1
  }

  Write-Host 'Setting up your counselor...'
  __STOPPER__
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $config = [ordered]@{ site = $Site; supabaseUrl = $SupabaseUrl; key = $Key; token = $Token; claude = $Claude; prompt = '__PROMPT__' }
  Save 'config.json' ($config | ConvertTo-Json)
  $mcp = @{ mcpServers = @{ '${MCP_SERVER}' = @{ type = 'http'; url = ($Site + '/api/mcp/' + $Token) } } }
  Save 'mcp.json' ($mcp | ConvertTo-Json -Depth 5)
  Save 'CLAUDE.md' @'
__BRIEF__
'@
  Save 'watch.ps1' @'
__WATCHER__
'@
  Save 'stop.ps1' @'
__STOPPER__
'@
  Save 'Turn off counselor.cmd' @'
__TURN_OFF__
'@
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Dir 'session.txt')

  # A first run checks that Claude Code is signed in and can reach the desk, and starts the conversation.
  Write-Host 'Checking that Claude can reach your desk (this takes a few seconds)...'
  Set-Location $Dir
  $session = [guid]::NewGuid().ToString()
  # Claude Code may write notices to stderr; they mustn't stop the setup.
  $ErrorActionPreference = 'Continue'
  $check = & $Claude -p 'You are now my Application Desk counselor. Call list_my_desk, then reply with only the desk title.' --session-id $session --name 'Application Desk counselor' --mcp-config (Join-Path $Dir 'mcp.json') --strict-mcp-config --allowedTools 'mcp__${MCP_SERVER}' 2>&1 | Out-String
  $ok = $LASTEXITCODE -eq 0
  $ErrorActionPreference = 'Stop'
  if (-not $ok) {
    $why = $check.Trim()
    if ($why.Length -gt 600) { $why = $why.Substring(0, 600) + '...' }
    Say ("Claude Code couldn't reach your desk:" + $NL + $NL + $why + $NL + $NL + "If it asks you to sign in, open Claude Code once and sign in, then double-click this file again.") 16
    exit 1
  }
  Save 'session.txt' $session

  # Start hidden now, and at every sign-in.
  $conhost = Join-Path $env:WINDIR 'System32\conhost.exe'
  $launch = '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Dir 'watch.ps1') + '"'
  $lnk = $Shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) '${STARTUP_NAME}'))
  $lnk.TargetPath = $conhost
  $lnk.Arguments = $launch
  $lnk.WorkingDirectory = $Dir
  $lnk.WindowStyle = 7
  $lnk.Description = 'Answers what you ask on your Application Desk, with Claude Code'
  $lnk.Save()
  Start-Process -FilePath $conhost -ArgumentList $launch -WorkingDirectory $Dir

  Say ("Your counselor is on." + $NL + $NL + "Ask anything on your Application Desk (Ask, Polish, Odds, the Profile interview) and Claude answers there, with nothing else to open. It runs hidden and starts again whenever you sign in to Windows." + $NL + $NL + "To turn it off, revoke its connector link in Settings, or run 'Turn off counselor' in " + $Dir) 64
} catch {
  Say ("Setting up the counselor failed:" + $NL + $NL + $_.Exception.Message) 16
  exit 1
}
`;

const HEADER = [
  "<# : Application Desk counselor setup - double-click to install",
  "@echo off",
  'set "APPDESK_SETUP=%~f0"',
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ([IO.File]::ReadAllText($env:APPDESK_SETUP))"',
  "exit /b",
  "#>",
].join("\n");

const SAFE = {
  url: /^https?:\/\/[A-Za-z0-9.:\-]+(\/[A-Za-z0-9._\-/]*)?$/,
  key: /^[A-Za-z0-9._\-]+$/,
  token: /^[A-Za-z0-9_\-]{20,64}$/,
};

/** Text for a single-quoted PowerShell here-string: no line may start with '@. */
function hereString(s: string): string {
  if (/^'@/m.test(s)) throw new Error("A here-string can't contain a line starting with '@");
  return s.replace(/\s+$/, "");
}

function crlf(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

/** The whole installer, ready to download. */
export function counselorInstaller(c: InstallerConfig): string {
  const site = c.site.replace(/\/+$/, "");
  const supabaseUrl = c.supabaseUrl.replace(/\/+$/, "");
  if (!SAFE.url.test(site) || !SAFE.url.test(supabaseUrl)) throw new Error("Unexpected site or database address.");
  if (!SAFE.key.test(c.supabaseKey)) throw new Error("Unexpected database key.");
  if (!SAFE.token.test(c.token)) throw new Error("Unexpected connector token.");
  if (WAKE_PROMPT.includes("'")) throw new Error("The wake prompt can't contain a single quote.");
  // Functions, so "$" in PowerShell code is never read as a replacement pattern.
  const fill: [string, string][] = [
    ["__STOPPER__", STOPPER.trim().split("\n").join("\n  ")],
    ["__BRIEF__", hereString(COUNSELOR_BRIEF)],
    ["__WATCHER__", hereString(WATCHER)],
    ["__STOPPER__", hereString(STOPPER)],
    ["__TURN_OFF__", hereString(TURN_OFF_CMD)],
    ["__PROMPT__", WAKE_PROMPT],
    ["__SITE__", site],
    ["__SUPABASE_URL__", supabaseUrl],
    ["__KEY__", c.supabaseKey],
    ["__TOKEN__", c.token],
  ];
  const body = fill.reduce((text, [mark, value]) => text.replace(mark, () => value), SETUP);
  const out = crlf(`${HEADER}\n${body}`);
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(out)) throw new Error("The installer must be plain ASCII.");
  return out;
}
