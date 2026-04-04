# Creates a Desktop shortcut like "PDF TO PNG.lnk" but for Z Bars folders.
# Run: powershell -ExecutionPolicy Bypass -File create_z_bars_desktop_shortcut.ps1

$ErrorActionPreference = "Stop"
$repoConverter = Join-Path $PSScriptRoot "converter.py"
if (-not (Test-Path -LiteralPath $repoConverter)) {
    Write-Error "converter.py not found next to this script."
}

$pythonw = $null
foreach ($c in @(
        "$env:LocalAppData\Programs\Python\Python312\pythonw.exe",
        "$env:LocalAppData\Programs\Python\Python311\pythonw.exe",
        "$env:LocalAppData\Programs\Python\Python310\pythonw.exe"
    )) {
    if (Test-Path -LiteralPath $c) { $pythonw = $c; break }
}
if (-not $pythonw) {
    $pythonw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
}
if (-not $pythonw) {
    Write-Error "pythonw.exe not found. Install Python or edit this script with the full path."
}

$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "Z Bars PDF to PNG.lnk"
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnkPath)
$sc.TargetPath = $pythonw
$sc.Arguments = "`"$repoConverter`""
$sc.WorkingDirectory = $PSScriptRoot
$sc.WindowStyle = 7
$sc.Description = "Watch Z Bars\PDF and write PNGs to Z Bars\PNG"
$sc.Save()

Write-Host "Created: $lnkPath"
Write-Host "Target: $pythonw `"$repoConverter`""
