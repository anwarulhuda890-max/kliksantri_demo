#Requires -Version 5.1
<#
.SYNOPSIS
  Export PostgreSQL lokal "Administrasi Santri Digital" dan import ke Neon.

.PARAMETER Mode
  export  - hanya dump lokal (default, aman)
  import  - import dump ke Neon (butuh NEON_DATABASE_URL)
  full    - export lalu import + validasi
  verify  - validasi Neon saja (butuh NEON_DATABASE_URL)

.EXAMPLE
  .\scripts\migrate-local-to-neon.ps1 -Mode export

.EXAMPLE
  $env:NEON_DATABASE_URL = 'postgresql://USER:PASS@HOST/DB?sslmode=require'
  .\scripts\migrate-local-to-neon.ps1 -Mode import -DumpPath 'exports\full_backup.sql'
#>

[CmdletBinding()]
param(
  [ValidateSet('export', 'import', 'full', 'verify')]
  [string] $Mode = 'export',

  [string] $DumpPath = '',

  [string] $PgBin = 'C:\Program Files\PostgreSQL\18\bin',

  [string] $LocalHost = 'localhost',
  [int]    $LocalPort = 5432,
  [string] $LocalUser = 'postgres',
  [string] $LocalDatabase = 'Administrasi Santri Digital',

  [int]    $ExpectedTables = 38,
  [int]    $ExpectedUsers = 5
)

$ErrorActionPreference = 'Stop'

function Get-PgExe {
  param([string] $Name)
  $path = Join-Path $PgBin ($Name + '.exe')
  if (-not (Test-Path $path)) {
    throw "PostgreSQL CLI not found: $path"
  }
  return $path
}

function Write-Step {
  param([string] $Message)
  Write-Host ''
  Write-Host ('==> ' + $Message) -ForegroundColor Cyan
}

function Get-DefaultDumpPath {
  $root = Split-Path $PSScriptRoot -Parent
  $exportDir = Join-Path $root 'exports'
  if (-not (Test-Path $exportDir)) {
    New-Item -ItemType Directory -Path $exportDir | Out-Null
  }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  return Join-Path $exportDir ('full_backup_' + $stamp + '.sql')
}

function Invoke-LocalExport {
  param([string] $OutFile)

  $outDir = Split-Path $OutFile -Parent
  if ($outDir -and -not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  }

  $pgDump = Get-PgExe 'pg_dump'
  if ($env:LOCAL_PG_PASSWORD) {
    $env:PGPASSWORD = $env:LOCAL_PG_PASSWORD
  } else {
    $env:PGPASSWORD = '313333'
  }

  Write-Step ('Export lokal ke ' + $OutFile)
  Write-Host ('  DB: ' + $LocalDatabase + ' @ ' + $LocalHost + ':' + $LocalPort)

  & $pgDump `
    -U $LocalUser `
    -h $LocalHost `
    -p $LocalPort `
    -d $LocalDatabase `
    --no-owner `
    --no-privileges `
    --encoding=UTF8 `
    -f $OutFile

  if ($LASTEXITCODE -ne 0) {
    throw ('pg_dump failed with exit code ' + $LASTEXITCODE)
  }

  $size = (Get-Item $OutFile).Length
  $mb = [math]::Round($size / 1MB, 2)
  Write-Host ('  OK - ' + $mb + ' MB') -ForegroundColor Green
  return $OutFile
}

function Get-NeonUrl {
  if (-not $env:NEON_DATABASE_URL -or $env:NEON_DATABASE_URL.Trim() -eq '') {
    throw 'NEON_DATABASE_URL is not set. Example: postgresql://USER:PASS@HOST/DB?sslmode=require'
  }

  $url = $env:NEON_DATABASE_URL.Trim()
  if ($url -notlike '*sslmode=*') {
    if ($url -like '*?*') {
      $url = $url + '&sslmode=require'
    } else {
      $url = $url + '?sslmode=require'
    }
    Write-Host '  Added sslmode=require to connection string.' -ForegroundColor Yellow
  }
  return $url
}

function Invoke-NeonImport {
  param([string] $SqlFile)

  if (-not (Test-Path $SqlFile)) {
    throw ('Dump file not found: ' + $SqlFile)
  }

  $psql = Get-PgExe 'psql'
  $neonUrl = Get-NeonUrl

  Write-Step 'Import ke Neon'
  Write-Host ('  File: ' + $SqlFile)
  Write-Host ('  Target: ' + ($neonUrl -replace '://([^:@/]+):([^@/]+)@', '://***:***@'))

  Write-Host ''
  Write-Host '  WARNING: Import will write to the Neon target database.' -ForegroundColor Yellow
  Write-Host '  Ensure Neon is empty or you are ready to drop schema public.' -ForegroundColor Yellow
  $confirm = Read-Host '  Type YES to continue import'
  if ($confirm -ne 'YES') {
    throw 'Import cancelled by user.'
  }

  & $psql $neonUrl -v ON_ERROR_STOP=1 -f $SqlFile

  if ($LASTEXITCODE -ne 0) {
    throw ('psql import failed with exit code ' + $LASTEXITCODE)
  }

  Write-Host '  OK - import finished' -ForegroundColor Green
}

function Invoke-NeonVerify {
  $psql = Get-PgExe 'psql'
  $neonUrl = Get-NeonUrl

  Write-Step 'Validasi Neon'

  $tableSql = 'SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema = ''public'' AND table_type = ''BASE TABLE'';'
  $userSql = 'SELECT COUNT(*)::int FROM users;'
  $adminSql = 'SELECT username, role FROM users WHERE username = ''admin'' LIMIT 1;'

  $tableCount = (& $psql $neonUrl -t -A -c $tableSql).Trim()
  $userCount = (& $psql $neonUrl -t -A -c $userSql).Trim()
  $adminRow = (& $psql $neonUrl -t -A -F '|' -c $adminSql).Trim()

  Write-Host ('  Tabel public  : ' + $tableCount + ' (expected: ' + $ExpectedTables + ')')
  Write-Host ('  Baris users   : ' + $userCount + ' (expected: ' + $ExpectedUsers + ')')
  Write-Host ('  admin row     : ' + $adminRow)

  $ok = $true
  if ([int]$tableCount -lt $ExpectedTables) {
    Write-Host '  FAIL - table count below expected' -ForegroundColor Red
    $ok = $false
  }
  if ([int]$userCount -lt 1) {
    Write-Host '  FAIL - users table is empty' -ForegroundColor Red
    $ok = $false
  }
  if ($adminRow -notlike 'admin|superadmin*') {
    Write-Host '  FAIL - admin superadmin row not found' -ForegroundColor Red
    $ok = $false
  }

  if ($ok) {
    Write-Host ''
    Write-Host '  VALIDASI DB LULUS' -ForegroundColor Green
    Write-Host '  Next: test admin login via Vercel frontend -> Railway API.' -ForegroundColor Green
  } else {
    throw 'Validasi DB GAGAL - check import log or rollback.'
  }
}

$resolvedDump = if ($DumpPath) { $DumpPath } else { Get-DefaultDumpPath }

Write-Host 'KlikPesantren - migrate local PostgreSQL to Neon'
Write-Host ('Mode: ' + $Mode)

switch ($Mode) {
  'export' {
    Invoke-LocalExport -OutFile $resolvedDump
    Write-Host ''
    Write-Host ('Dump saved: ' + $resolvedDump) -ForegroundColor Green
    Write-Host 'Next: set NEON_DATABASE_URL, then run -Mode import or -Mode full'
  }
  'import' {
    if (-not $DumpPath) {
      throw 'Mode import requires -DumpPath pointing to an exported .sql file.'
    }
    Invoke-NeonImport -SqlFile $resolvedDump
    Invoke-NeonVerify
  }
  'full' {
    $file = Invoke-LocalExport -OutFile $resolvedDump
    Invoke-NeonImport -SqlFile $file
    Invoke-NeonVerify
  }
  'verify' {
    Invoke-NeonVerify
  }
}
