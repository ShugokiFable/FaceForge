[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$snapshotRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$webRoot = Join-Path $snapshotRoot "src\FaceForge.Web"
$webBuildParent = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "FaceForge\Build"
$webBuildRoot = Join-Path $webBuildParent "Web-0.24.3"
$desktopResources = Join-Path $snapshotRoot "src\FaceForge.Desktop\Resources"
$webBundle = Join-Path $desktopResources "FaceForge.WebBundle.zip"
$desktopProject = Join-Path $snapshotRoot "src\FaceForge.Desktop\FaceForge.Desktop.csproj"
$coreTests = Join-Path $snapshotRoot "src\FaceForge.Core.Tests\FaceForge.Core.Tests.csproj"
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$pnpmExe = $null
$pnpmArgs = @()

if ($null -ne $pnpmCommand) {
    $pnpmExe = $pnpmCommand.Source
}
else {
    # Node ships corepack, which provides the exact pnpm pinned in package.json. Requiring a
    # global pnpm install would fail on a machine that never enabled the shim.
    $corepack = Get-Command corepack -ErrorAction SilentlyContinue
    if ($null -eq $corepack) {
        throw "Neither pnpm nor corepack is available on PATH. Install Node.js 20+ or pnpm."
    }
    $pnpmExe = $corepack.Source
    $pnpmArgs = @("pnpm")

    # package.json lifecycle scripts (prebuild -> "pnpm copy:mediapipe") shell out to a bare
    # "pnpm", so a corepack-only machine needs a shim on PATH or the nested call dies.
    $shimDir = Join-Path $webBuildParent "pnpm-shim"
    New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $shimDir "pnpm.cmd") -Encoding ascii -Value @(
        "@echo off",
        "`"$($corepack.Source)`" pnpm %*"
    )
    $env:PATH = "$shimDir;$env:PATH"
}

function Invoke-Pnpm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    # pnpm and vitest write progress to stderr. Under $ErrorActionPreference = "Stop" Windows
    # PowerShell turns that into a terminating NativeCommandError even on a clean exit 0, so the
    # exit code has to be the success signal here, not the stream.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $pnpmExe @($pnpmArgs + $Arguments)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

$resolvedBuildParent = [IO.Path]::GetFullPath($webBuildParent)
$resolvedBuildRoot = [IO.Path]::GetFullPath($webBuildRoot)
if (-not $resolvedBuildRoot.StartsWith($resolvedBuildParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to prepare a web build outside the FaceForge local build cache."
}
if (Test-Path -LiteralPath $webBuildRoot) {
    Remove-Item -Recurse -Force -LiteralPath $webBuildRoot
}
New-Item -ItemType Directory -Path $webBuildRoot -Force | Out-Null
foreach ($file in @(
    "index.html",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.app.json",
    "tsconfig.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "vitest.config.ts"
)) {
    Copy-Item -LiteralPath (Join-Path $webRoot $file) -Destination $webBuildRoot
}
foreach ($directory in @("src", "public", "scripts")) {
    Copy-Item -LiteralPath (Join-Path $webRoot $directory) -Destination $webBuildRoot -Recurse
}

Push-Location $webBuildRoot
try {
    if (-not $SkipInstall) {
        Invoke-Pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed." }
    }
    Invoke-Pnpm test
    if ($LASTEXITCODE -ne 0) { throw "Frontend tests failed." }
    Invoke-Pnpm build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
}
finally {
    Pop-Location
}

$distRoot = Join-Path $webRoot "dist"
$resolvedWebRoot = [IO.Path]::GetFullPath($webRoot)
$resolvedDistRoot = [IO.Path]::GetFullPath($distRoot)
if (-not $resolvedDistRoot.StartsWith($resolvedWebRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace web output outside the FaceForge web project."
}
if (Test-Path -LiteralPath $distRoot) {
    Remove-Item -Recurse -Force -LiteralPath $distRoot
}
Copy-Item -LiteralPath (Join-Path $webBuildRoot "dist") -Destination $distRoot -Recurse

New-Item -ItemType Directory -Path $desktopResources -Force | Out-Null
if (Test-Path -LiteralPath $webBundle) {
    Remove-Item -Force -LiteralPath $webBundle
}
Compress-Archive -Path (Join-Path $distRoot "*") -DestinationPath $webBundle -CompressionLevel Optimal

dotnet run --project $coreTests -c $Configuration
if ($LASTEXITCODE -ne 0) { throw "Native core validation failed." }

dotnet build $desktopProject -c $Configuration
if ($LASTEXITCODE -ne 0) { throw "Desktop build failed." }

Write-Host "FaceForge build passed."
