# GitHub Copilot's SessionStart hook on Windows. It prints the JSON that
# session-start.sh copilot prints on macOS and Linux, byte for byte, with the
# checks of setup-pstack's sheet.awk and the output of copilot-context.awk and
# json.awk, so Windows needs neither Bash nor awk. copilot-hooks.json runs it
# through the `powershell` key. Keep it in step with those awk files:
# tests/session-hook-windows.test.mjs compares the two hooks on the same sheets.
# Windows PowerShell 5.1 and PowerShell 7 both run it. Keep this file ASCII.

$ErrorActionPreference = 'Stop'

# Stamped from plugins/pstack/models.json; edit there and rerun tools/generate.mjs.
$SheetRoles = @(
    'feature, refactoring'
    'bug-fix'
    'perf-issue'
    'hillclimb'
    'judgment and prose'
    'strongest judgment'
    'how explorer'
    'how explainer'
    'why investigators'
    'why synthesizer'
    'reflect tooling'
    'reflect judgment, divergent, synthesizer'
    'arena runners'
    'arena cross-judge pool'
    'swarm workers'
    'architect runners'
    'interrogate reviewers'
)
$PanelRoles = @(
    'arena runners'
    'arena cross-judge pool'
    'architect runners'
    'interrogate reviewers'
)
$SheetEfforts = @(
    'low'
    'medium'
    'high'
    'xhigh'
    'max'
)
# End of the stamped role list.

$Utf8 = [System.Text.UTF8Encoding]::new($false)

# The sheet's lines, decoded as read-sheet.sh decodes them: UTF-16 LE behind a
# byte-order mark, or UTF-8. One byte-order mark and one carriage return per
# line are dropped. Returns $null when the sheet is missing or cannot be
# decoded, which leaves the hook on.
function Read-Sheet([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
            $text = [System.Text.UnicodeEncoding]::new($false, $false, $true).GetString($bytes)
        } else {
            $text = $Utf8.GetString($bytes)
        }
    } catch {
        return $null
    }
    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
    $lines = $text.Split([char]10)
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i].EndsWith([string][char]13)) { $lines[$i] = $lines[$i].Substring(0, $lines[$i].Length - 1) }
    }
    return ,$lines
}

function Remove-SheetSpace([string]$Text) {
    return $Text.Trim([char[]]@([char]' ', [char]9))
}

# The key of `key: value` at the start of a line, or '' for any other line.
function Get-SheetKey([string]$Line) {
    if ($Line.Length -eq 0 -or $Line[0] -eq [char]' ' -or $Line[0] -eq [char]9) { return '' }
    $at = $Line.IndexOf(':')
    if ($at -lt 0) { return '' }
    return Remove-SheetSpace $Line.Substring(0, $at)
}

function Get-SheetValue([string]$Line) {
    return Remove-SheetSpace $Line.Substring($Line.IndexOf(':') + 1)
}

# Drops a role value's reasoning effort suffix, as in `gpt-5.5 @xhigh`, when
# the suffix names a level.
function Get-SheetModel([string]$Entry) {
    $m = [regex]::Match($Entry, '[ \t]+@[a-z]+\z')
    if ($m.Success) {
        $level = $m.Value.TrimStart([char[]]@([char]' ', [char]9)).Substring(1)
        if ($SheetEfforts -ccontains $level) { return $Entry.Substring(0, $m.Index) }
    }
    return $Entry
}

function Get-SheetVendor([string]$Model) {
    $at = $Model.IndexOf('-')
    if ($at -ge 0) { return $Model.Substring(0, $at) }
    return $Model
}

# Checks the sheet's lines as sheet.awk's sheet_problems does. Problems are
# '; '-separated, or '' for a well-formed sheet. Values holds the last value of
# each known role and of `default effort`. A problem never quotes sheet text.
function Test-Sheet([string[]]$Lines) {
    $values = [System.Collections.Generic.Dictionary[string, string]]::new([System.StringComparer]::Ordinal)
    $anyVendor = $false
    foreach ($line in $Lines) {
        $key = Get-SheetKey $line
        if (($SheetRoles -ccontains $key) -or $key -ceq 'default effort') {
            $values[$key] = Get-SheetValue $line
        } elseif ($key -ceq 'panel vendors' -and (Get-SheetValue $line) -ceq 'any') {
            $anyVendor = $true
        }
    }

    $problems = [System.Collections.Generic.List[string]]::new()
    foreach ($role in $SheetRoles) {
        if (-not $values.ContainsKey($role)) { $problems.Add('missing role `' + $role + '`') }
    }
    if ($values.ContainsKey('default effort') -and $values['default effort'] -cne 'session' -and
        -not ($SheetEfforts -ccontains $values['default effort'])) {
        $problems.Add('default effort is not session or a level')
    }

    foreach ($role in $SheetRoles) {
        if (-not $values.ContainsKey($role)) { continue }
        $raw = $values[$role]
        $entries = if ($raw -ceq '') { @() } else { $raw.Split(',') }
        if ($entries.Count -eq 0) { $problems.Add('no model in `' + $role + '`') }
        $vendors = [System.Collections.Generic.List[string]]::new()
        $real = $false
        foreach ($entry in $entries) {
            $model = Get-SheetModel (Remove-SheetSpace $entry)
            if ($model -ceq '') { $problems.Add('an empty entry in `' + $role + '`'); continue }
            if ($model -ceq 'inherit-parent' -or $model -ceq 'auto') { continue }
            if (-not [regex]::IsMatch($model, '\A[a-z0-9][a-z0-9.-]*\z')) {
                $problems.Add('`' + $role + '` has an entry that is not a model ID')
                continue
            }
            $real = $true
            $vendor = Get-SheetVendor $model
            if (-not $vendors.Contains($vendor)) { $vendors.Add($vendor) }
        }
        if (($PanelRoles -ccontains $role) -and $real -and $vendors.Count -lt 2 -and -not $anyVendor) {
            $problems.Add('`' + $role + '` has models from one vendor (' + ($vendors -join ', ') + ')')
        }
    }
    return @{ Problems = ($problems -join '; '); Values = $values }
}

# The file's text without the one newline that ends it, as copilot-context.awk
# reads it.
function Get-HookText([string]$Name) {
    $text = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot $Name), $Utf8)
    if ($text.EndsWith("`n")) { $text = $text.Substring(0, $text.Length - 1) }
    return $text
}

# json.awk's esc, applied to the whole text: backslash, quote, tab, and
# carriage return are escaped, a line feed becomes \n, and other control
# characters and DEL are dropped.
function ConvertTo-JsonText([string]$Text) {
    $out = [System.Text.StringBuilder]::new()
    foreach ($c in $Text.ToCharArray()) {
        $code = [int]$c
        if ($c -eq '\') { [void]$out.Append('\\') }
        elseif ($c -eq '"') { [void]$out.Append('\"') }
        elseif ($code -eq 9) { [void]$out.Append('\t') }
        elseif ($code -eq 13) { [void]$out.Append('\r') }
        elseif ($code -eq 10) { [void]$out.Append('\n') }
        elseif ($code -ge 32 -and $code -ne 127) { [void]$out.Append($c) }
    }
    return $out.ToString()
}

$sheetDir = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
$lines = Read-Sheet (Join-Path $sheetDir 'pstack-models.md')
# A sheet with `session hook: off` on a line of its own turns the hook off.
if ($null -ne $lines -and ($lines -ccontains 'session hook: off')) { exit 0 }

$found = $null -ne $lines
$problems = 'no sheet'
$values = $null
if ($found) {
    $check = Test-Sheet $lines
    $problems = $check.Problems
    $values = $check.Values
}

$notes = Get-HookText 'session-start-copilot.md'
if ($problems -eq '') {
    $notes += "`n`n" + (Get-HookText 'session-start-copilot-sheet.md') + "`n"
    foreach ($role in $SheetRoles) { $notes += "`n" + $role + ': ' + $values[$role] }
    if ($values.ContainsKey('default effort')) { $notes += "`ndefault effort: " + $values['default effort'] }
} else {
    if ($found) { $notes += "`n`nsheet invalid: " + $problems }
    $notes += "`n`n" + (Get-HookText 'session-start-copilot-setup.md')
}

$body = Get-HookText 'session-start-context.md'
$close = '</EXTREMELY_IMPORTANT>'
$at = $body.IndexOf($close, [System.StringComparison]::Ordinal)
if ($at -ge 0) {
    $body = $body.Substring(0, $at) + "`n" + $notes + "`n" + $body.Substring($at)
} else {
    $body = $body + "`n" + $notes
}

$json = '{"additionalContext":"' + (ConvertTo-JsonText ($body + "`n")) + '"}' + "`n"
$bytes = $Utf8.GetBytes($json)
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($bytes, 0, $bytes.Length)
$stdout.Flush()
