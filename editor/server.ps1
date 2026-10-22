# Local viewing and editing server for md-view's /md-view on Windows machines
# without Node.js: the same protocol and checks as server.mjs, in Windows
# PowerShell 5.1 or later, with nothing to install.
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File server.ps1 <file.md>
#
# It listens on 127.0.0.1 on a free port, prints "READY <port>" once listening,
# serves the editor page and its assets, and reads and writes exactly the one
# Markdown file it was started for. It exits after $IdleMs without a request
# (the open page polls every few seconds), or when its parent kills it.

param([Parameter(Mandatory = $true)][string]$File)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions

$File = [IO.Path]::GetFullPath($File)
$Here = $PSScriptRoot
$IdleMs = 30 * 60 * 1000
$MaxBody = 10MB
$Assets = @{
  'toastui-editor-all.min.js' = 'text/javascript; charset=utf-8'
  'restore-style.js'          = 'text/javascript; charset=utf-8'
  'codemirror-bundle.js'      = 'text/javascript; charset=utf-8'
  'toastui-editor.css'        = 'text/css; charset=utf-8'
  'toastui-editor-dark.css'   = 'text/css; charset=utf-8'
}
$Reasons = @{ 200 = 'OK'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 409 = 'Conflict'
  413 = 'Payload Too Large'; 415 = 'Unsupported Media Type'; 500 = 'Internal Server Error' }

# UTF-8 without adding or dropping a byte-order mark: a BOM in the file reads
# as U+FEFF and is written back as it was, as Node does.
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Latin1 = [Text.Encoding]::GetEncoding(28591)
$Json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$Json.MaxJsonLength = 64MB

$Name = [IO.Path]::GetFileName($File)
$Page = [IO.File]::ReadAllText((Join-Path $Here 'editor.html'), $Utf8).Replace('__TITLE__', ($Name -replace '[<>&"]', ''))

# Microseconds since 1970: finer than Node's milliseconds, and exact as a JSON number.
function Get-Mtime {
  [int64][math]::Floor(([IO.File]::GetLastWriteTimeUtc($File).Ticks - 621355968000000000) / 10)
}

function Send-Bytes($Stream, [int]$Status, [byte[]]$Body, [string]$Type) {
  $head = "HTTP/1.1 $Status $($Reasons[$Status])`r`nContent-Type: $Type`r`nContent-Length: $($Body.Length)`r`n" +
    "Cache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
  $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($headBytes, 0, $headBytes.Length)
  if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
}

function Send-Json($Stream, [int]$Status, $Value) {
  Send-Bytes $Stream $Status ($Utf8.GetBytes($Json.Serialize($Value))) 'application/json; charset=utf-8'
}

# Reads one request: method, path, lowercased headers and body bytes, or
# $null when the connection closes or sends nonsense.
function Read-Request($Stream) {
  $buffer = New-Object byte[] 65536
  $received = New-Object IO.MemoryStream
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    $count = $Stream.Read($buffer, 0, $buffer.Length)
    if ($count -le 0) { return $null }
    $received.Write($buffer, 0, $count)
    $headerEnd = $Latin1.GetString($received.ToArray()).IndexOf("`r`n`r`n")
    if ($headerEnd -lt 0 -and $received.Length -gt 65536) { return $null }
  }

  $all = $received.ToArray()
  $lines = $Latin1.GetString($all, 0, $headerEnd) -split "`r`n"
  $first = $lines[0] -split ' '
  if ($first.Count -lt 2) { return $null }
  $headers = @{}
  foreach ($line in $lines[1..($lines.Count - 1)]) {
    $colon = $line.IndexOf(':')
    if ($colon -gt 0) { $headers[$line.Substring(0, $colon).Trim().ToLowerInvariant()] = $line.Substring($colon + 1).Trim() }
  }

  $body = New-Object IO.MemoryStream
  $start = $headerEnd + 4
  $body.Write($all, $start, $all.Length - $start)
  $isChunked = "$($headers['transfer-encoding'])" -match 'chunked'
  if ($isChunked) {
    # Read to the last chunk's marker, then join the chunks.
    while (-not $Latin1.GetString($body.ToArray()).EndsWith("0`r`n`r`n")) {
      if ($body.Length -gt $MaxBody) { return @{ TooLarge = $true } }
      $count = $Stream.Read($buffer, 0, $buffer.Length)
      if ($count -le 0) { return $null }
      $body.Write($buffer, 0, $count)
    }
    $raw = $body.ToArray()
    $joined = New-Object IO.MemoryStream
    $at = 0
    while ($true) {
      $lineEnd = $Latin1.GetString($raw, $at, $raw.Length - $at).IndexOf("`r`n")
      if ($lineEnd -lt 0) { return $null }
      $size = [Convert]::ToInt64(($Latin1.GetString($raw, $at, $lineEnd) -split ';')[0].Trim(), 16)
      $at += $lineEnd + 2
      if ($size -eq 0) { break }
      if ($at + $size -gt $raw.Length) { return $null }
      $joined.Write($raw, $at, $size)
      $at += $size + 2
    }
    $body = $joined
  }
  else {
    $length = 0
    if ($headers.ContainsKey('content-length')) { $length = [int64]$headers['content-length'] }
    if ($length -gt $MaxBody) { return @{ TooLarge = $true } }
    while ($body.Length -lt $length) {
      $count = $Stream.Read($buffer, 0, $buffer.Length)
      if ($count -le 0) { return $null }
      $body.Write($buffer, 0, $count)
    }
  }

  return @{ Method = $first[0]; Path = ($first[1] -split '\?')[0]; Headers = $headers; Body = $body.ToArray() }
}

function Handle-Request($Stream) {
  $req = Read-Request $Stream
  if ($null -eq $req) { return }
  if ($req.TooLarge) { Send-Json $Stream 413 @{ error = 'too large' }; return }

  # Only this machine, by this exact address: refuses DNS-rebound names.
  if ($req.Headers['host'] -cne "127.0.0.1:$Port") { Send-Json $Stream 403 @{ error = 'bad host' }; return }
  $script:Idle.Restart()

  try {
    if ($req.Method -eq 'GET' -and $req.Path -eq '/') {
      Send-Bytes $Stream 200 ($Utf8.GetBytes($Page)) 'text/html; charset=utf-8'
    }
    elseif ($req.Method -eq 'GET' -and $req.Path.StartsWith('/assets/')) {
      $asset = $req.Path.Substring('/assets/'.Length)
      if (-not $Assets.ContainsKey($asset)) { Send-Json $Stream 404 @{ error = 'not found' }; return }
      Send-Bytes $Stream 200 ([IO.File]::ReadAllBytes((Join-Path (Join-Path $Here 'assets') $asset))) $Assets[$asset]
    }
    elseif ($req.Method -eq 'GET' -and $req.Path -eq '/api/doc') {
      $text = $Utf8.GetString([IO.File]::ReadAllBytes($File))
      Send-Json $Stream 200 @{ name = $Name; path = $File; text = $text; mtime = (Get-Mtime) }
    }
    elseif ($req.Method -eq 'GET' -and $req.Path -eq '/api/mtime') {
      Send-Json $Stream 200 @{ mtime = (Get-Mtime) }
    }
    elseif ($req.Method -eq 'POST' -and $req.Path -eq '/api/save') {
      # A write only from the editor page itself, never from another site.
      if ($req.Headers['origin'] -cne "http://127.0.0.1:$Port") { Send-Json $Stream 403 @{ error = 'bad origin' }; return }
      if (-not "$($req.Headers['content-type'])".StartsWith('application/json')) {
        Send-Json $Stream 415 @{ error = 'json only' }; return
      }
      $payload = $Json.DeserializeObject($Utf8.GetString($req.Body))
      $text = $payload['text']
      if ($text -isnot [string]) { Send-Json $Stream 400 @{ error = 'text missing' }; return }

      $current = Get-Mtime
      $base = $payload['baseMtime']
      $isSame = $null -ne $base -and [int64]$base -eq $current
      if (-not $payload['force'] -and -not $isSame) { Send-Json $Stream 409 @{ conflict = $true; mtime = $current }; return }

      [IO.File]::WriteAllBytes($File, $Utf8.GetBytes($text))
      Send-Json $Stream 200 @{ mtime = (Get-Mtime) }
    }
    else {
      Send-Json $Stream 404 @{ error = 'not found' }
    }
  }
  catch {
    Send-Json $Stream 500 @{ error = $_.Exception.Message }
  }
}

$Listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$Listener.Start()
$Port = $Listener.LocalEndpoint.Port
[Console]::Out.WriteLine("READY $Port")
[Console]::Out.Flush()

$Idle = [Diagnostics.Stopwatch]::StartNew()
while ($Idle.ElapsedMilliseconds -lt $IdleMs) {
  if (-not $Listener.Pending()) { Start-Sleep -Milliseconds 20; continue }
  $client = $Listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $client.SendTimeout = 5000
    Handle-Request $client.GetStream()
  }
  catch { }
  finally { $client.Close() }
}
$Listener.Stop()
