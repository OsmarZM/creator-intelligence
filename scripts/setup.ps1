$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

if (!(Test-Path -LiteralPath '.env')) {
    $passwordBytes = New-Object byte[] 24
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($passwordBytes) } finally { $generator.Dispose() }
    $developmentPassword = [BitConverter]::ToString($passwordBytes).Replace('-', '')
    $environmentFile = [IO.File]::ReadAllText((Join-Path (Get-Location) '.env.example')).Replace('CHANGE_ME', $developmentPassword)
    [IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $environmentFile)
    Write-Output 'Arquivo .env criado com senha aleatória para o banco local.'
}

docker compose up -d --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL não ficou disponível. Confira o Docker Desktop e docker compose logs postgres.' }

npm run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'As migrações falharam. Confira DATABASE_URL e o log do comando.' }

Write-Output 'Ambiente pronto. Execute npm run dev e abra http://127.0.0.1:3000.'
