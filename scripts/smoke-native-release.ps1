[CmdletBinding()]
param(
    [string]$OutputDirectory = "",
    [switch]$InstallTest
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repositoryRoot "release"
}
$cargoToml = Get-Content (Join-Path $repositoryRoot "Cargo.toml") -Raw
$version = [regex]::Match($cargoToml, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
$setup = Join-Path $OutputDirectory "Dagou-Desktop-Pet-Setup-$version-x64.exe"
$portable = Join-Path $OutputDirectory "Dagou-Desktop-Pet-Portable-$version-x64.exe"
$checksums = Join-Path $OutputDirectory "SHA256SUMS.txt"
foreach ($path in @($setup, $portable, $checksums)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing release file: $path"
    }
}

$checksumRows = @{}
foreach ($line in Get-Content -LiteralPath $checksums) {
    if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
        $checksumRows[$Matches[2]] = $Matches[1].ToLowerInvariant()
    }
}
foreach ($path in @($setup, $portable)) {
    $name = Split-Path -Leaf $path
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    if ($checksumRows[$name] -ne $actual) {
        throw "SHA-256 mismatch for $name"
    }
    if ((Get-Item -LiteralPath $path).Length -gt 32MB) {
        throw "$name exceeds the 32 MB release budget."
    }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) "DagouPetSmoke-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$env:DAGOU_SETTINGS_PATH = Join-Path $testRoot "portable-settings.json"
$portableProcess = Start-Process -FilePath $portable -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
$portableProcess.Refresh()
if ($portableProcess.HasExited -or -not $portableProcess.Responding) {
    throw "Portable executable did not stay responsive."
}
Stop-Process -Id $portableProcess.Id -Force

if ($InstallTest) {
    $installDirectory = Join-Path $testRoot "installed"
    $setupProcess = Start-Process -FilePath $setup `
        -ArgumentList @("/S", "/NOLEGACY", "/D=$installDirectory") `
        -WindowStyle Hidden -Wait -PassThru
    if ($setupProcess.ExitCode -ne 0) {
        throw "Setup exited with code $($setupProcess.ExitCode)."
    }
    $installedExe = Join-Path $installDirectory "dagou-pet.exe"
    $uninstaller = Join-Path $installDirectory "Uninstall.exe"
    if (-not (Test-Path -LiteralPath $installedExe) -or -not (Test-Path -LiteralPath $uninstaller)) {
        throw "Setup did not install the expected files."
    }
    $env:DAGOU_SETTINGS_PATH = Join-Path $testRoot "installed-settings.json"
    $installedProcess = Start-Process -FilePath $installedExe -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 3
    $installedProcess.Refresh()
    if ($installedProcess.HasExited -or -not $installedProcess.Responding) {
        throw "Installed executable did not stay responsive."
    }
    Stop-Process -Id $installedProcess.Id -Force
    $uninstallProcess = Start-Process -FilePath $uninstaller `
        -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru
    if ($uninstallProcess.ExitCode -ne 0 -or (Test-Path -LiteralPath $installedExe)) {
        throw "Silent uninstall did not remove the installed executable."
    }
}

Get-Item -LiteralPath $setup, $portable, $checksums |
    Select-Object Name, Length
