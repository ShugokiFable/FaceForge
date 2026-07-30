[CmdletBinding()]
param(
    [string]$Runtime = "win-x64"
)

$ErrorActionPreference = "Stop"
$snapshotRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $snapshotRoot
$artifactRoot = Join-Path $snapshotRoot "artifacts"
$publishRoot = Join-Path $artifactRoot "publish\$Runtime"
$standaloneName = "FaceForge 0.11.0 - STANDALONE.exe"
$artifactExe = Join-Path $artifactRoot $standaloneName
$shareExe = Join-Path $projectRoot $standaloneName
$desktopProject = Join-Path $snapshotRoot "src\FaceForge.Desktop\FaceForge.Desktop.csproj"

& (Join-Path $snapshotRoot "build.ps1") -Configuration Release
if ($LASTEXITCODE -ne 0) { throw "Build gate failed." }

if (Test-Path -LiteralPath $publishRoot) {
    $resolvedArtifact = [IO.Path]::GetFullPath($artifactRoot)
    $resolvedPublish = [IO.Path]::GetFullPath($publishRoot)
    if (-not $resolvedPublish.StartsWith($resolvedArtifact, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clear publish output outside the artifact root."
    }
    Remove-Item -Recurse -Force -LiteralPath $publishRoot
}

dotnet publish $desktopProject -c Release -r $Runtime --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:PublishReadyToRun=true -p:DebugType=None -p:DebugSymbols=false -o $publishRoot
if ($LASTEXITCODE -ne 0) { throw "Desktop publish failed." }

$webViewDocumentation = @(
    "Microsoft.Web.WebView2.Core.xml",
    "Microsoft.Web.WebView2.WinForms.xml",
    "Microsoft.Web.WebView2.Wpf.xml"
)
foreach ($name in $webViewDocumentation) {
    $documentationPath = Join-Path $publishRoot $name
    if (Test-Path -LiteralPath $documentationPath) {
        Remove-Item -Force -LiteralPath $documentationPath
    }
}

$publishedFiles = @(Get-ChildItem -LiteralPath $publishRoot -File)
if ($publishedFiles.Count -ne 1 -or $publishedFiles[0].Name -ne "FaceForge.exe") {
    $inventory = ($publishedFiles.Name | Sort-Object) -join ", "
    throw "Single-file gate failed. Publish contained: $inventory"
}
Copy-Item -LiteralPath $publishedFiles[0].FullName -Destination $artifactExe -Force
Copy-Item -LiteralPath $publishedFiles[0].FullName -Destination $shareExe -Force

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $shareExe
[pscustomobject]@{
    Path = $shareExe
    FilesToShare = 1
    Length = (Get-Item -LiteralPath $shareExe).Length
    SHA256 = $hash.Hash
} | Format-List
