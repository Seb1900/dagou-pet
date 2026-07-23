[CmdletBinding()]
param(
    [string]$TargetDirectory = "$env:LOCALAPPDATA\DagouPetBuild",
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repositoryRoot "release"
}

$cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
if (-not (Test-Path -LiteralPath $cargo)) {
    throw "Rust is not installed for the current user."
}
$windres = Get-Command windres.exe -ErrorAction SilentlyContinue
$mingw = if ($windres) {
    Split-Path -Parent $windres.Source
} else {
    @(
        "C:\msys64\mingw64\bin",
        "C:\mingw64\bin"
        Get-Item `
            "C:\ProgramData\chocolatey\lib\mingw\tools\install\mingw64\bin" `
            -ErrorAction SilentlyContinue |
            Where-Object { $_.PSIsContainer } |
            Select-Object -ExpandProperty FullName
        Get-Item `
            "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_*\mingw64\bin" `
            -ErrorAction SilentlyContinue |
            Where-Object { $_.PSIsContainer } |
            Select-Object -ExpandProperty FullName
    ) | Where-Object { Test-Path -LiteralPath (Join-Path $_ "windres.exe") } |
        Select-Object -First 1
}
if (-not $mingw) {
    throw "WinLibs POSIX MSVCRT is required to build the GNU Rust target."
}
$makeNsis = @(
    "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
    "$env:ProgramFiles\NSIS\makensis.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $makeNsis) {
    throw "NSIS is not installed."
}

$cargoToml = Get-Content (Join-Path $repositoryRoot "Cargo.toml") -Raw
$versionMatch = [regex]::Match($cargoToml, '(?m)^version\s*=\s*"([^"]+)"')
if (-not $versionMatch.Success) {
    throw "Cargo.toml does not contain a package version."
}
$version = $versionMatch.Groups[1].Value
$env:PATH = "$mingw;$env:PATH"
$env:CARGO_TARGET_DIR = $TargetDirectory

Push-Location $repositoryRoot
try {
    & $cargo fmt --all --check
    if ($LASTEXITCODE -ne 0) { throw "cargo fmt --check failed." }
    & $cargo clippy --all-targets -- -D warnings
    if ($LASTEXITCODE -ne 0) { throw "cargo clippy failed." }
    & $cargo test
    if ($LASTEXITCODE -ne 0) { throw "cargo test failed." }
    & $cargo build --release
    if ($LASTEXITCODE -ne 0) { throw "cargo build --release failed." }
} finally {
    Pop-Location
}

$sourceExe = Join-Path $TargetDirectory "release\dagou-pet.exe"
if (-not (Test-Path -LiteralPath $sourceExe)) {
    throw "Release executable was not generated."
}
$versionInfo = (Get-Item -LiteralPath $sourceExe).VersionInfo
if ($versionInfo.FileDescription -ne "大狗桌宠" -or
    $versionInfo.ProductName -ne "大狗桌宠" -or
    $versionInfo.ProductVersion -ne $version) {
    throw "Release executable has missing or mismatched Windows version resources."
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$setupName = "Dagou-Desktop-Pet-Setup-$version-x64.exe"
$portableName = "Dagou-Desktop-Pet-Portable-$version-x64.exe"
$setupPath = Join-Path $OutputDirectory $setupName
$portablePath = Join-Path $OutputDirectory $portableName
Remove-Item -LiteralPath $setupPath, $portablePath -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath $sourceExe -Destination $portablePath

$nsisArguments = @(
    "/INPUTCHARSET", "UTF8",
    "/DVERSION=$version",
    "/DSOURCE_EXE=$sourceExe",
    "/DOUTPUT_DIR=$OutputDirectory",
    "/DREPOSITORY_ROOT=$repositoryRoot",
    (Join-Path $repositoryRoot "native\windows\installer.nsi")
)
& $makeNsis @nsisArguments
if ($LASTEXITCODE -ne 0) {
    throw "NSIS build failed."
}
if (-not (Test-Path -LiteralPath $setupPath)) {
    throw "NSIS did not create the expected setup file."
}

$checksumPath = Join-Path $OutputDirectory "SHA256SUMS.txt"
$checksumLines = foreach ($path in @($setupPath, $portablePath)) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    "$hash  $(Split-Path -Leaf $path)"
}
Set-Content -LiteralPath $checksumPath -Value $checksumLines -Encoding utf8NoBOM

Get-Item $setupPath, $portablePath, $checksumPath |
    Select-Object Name, Length, LastWriteTime
