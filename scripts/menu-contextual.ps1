<#
.SYNOPSIS
    Agrega (o quita) el menú "Asu" al clic derecho de las carpetas del Explorador.

.DESCRIPTION
    Escribe en HKCU\Software\Classes (no pide administrador):
      Directory\shell\Asu             clic derecho sobre una carpeta
      Directory\Background\shell\Asu  clic derecho en el fondo de una carpeta abierta
    Cada subopción abre Windows Terminal maximizado (o cmd si no está) en esa carpeta y
    ejecuta asu; al terminar, la ventana espera una tecla.
    En Windows 11 aparece en "Mostrar más opciones" (o Shift + clic derecho).

    Genera en ~/.asu-cli (o $env:ASU_CLI_HOME):
      asu-menu.cmd  lanzador: entra a la carpeta, ejecuta asu, pausa
      asu.ico       ícono armado desde recursos/asu.png

.PARAMETER Desinstalar
    Quita el menú, el lanzador y el ícono.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\menu-contextual.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\menu-contextual.ps1 -Desinstalar
#>
param([switch]$Desinstalar)

$ErrorActionPreference = 'Stop'

$claves = @(
    'HKCU:\Software\Classes\Directory\shell\Asu',
    'HKCU:\Software\Classes\Directory\Background\shell\Asu'
)

# Orden = orden en el menú. Argumentos = lo que va después de "asu".
$entradas = @(
    @{ Nombre = 'Menú…';             Argumentos = '' },
    @{ Nombre = 'Encode';            Argumentos = 'encode' },
    @{ Nombre = 'Comparar';          Argumentos = 'comparar' },
    @{ Nombre = 'Verificar fuentes'; Argumentos = 'fuentes' },
    @{ Nombre = 'AVS de trabajo';    Argumentos = 'avs-trabajo' },
    @{ Nombre = 'AVS de compresión'; Argumentos = 'avs-compresion' },
    @{ Nombre = 'Unir subtítulos';   Argumentos = 'unir' },
    @{ Nombre = 'Corregir offset';   Argumentos = 'corregir-offset' }
)

$carpetaAsu = if ($env:ASU_CLI_HOME) { $env:ASU_CLI_HOME } else { Join-Path $HOME '.asu-cli' }
$lanzador = Join-Path $carpetaAsu 'asu-menu.cmd'
$icono = Join-Path $carpetaAsu 'asu.ico'

function Quitar-Menu {
    foreach ($clave in $claves) {
        if (Test-Path -LiteralPath $clave) {
            Remove-Item -LiteralPath $clave -Recurse -Force
        }
    }
}

# ICO con varias imágenes PNG (formato admitido desde Windows Vista).
function Escribir-Icono([string]$rutaPng, [string]$destino) {
    Add-Type -AssemblyName System.Drawing
    $original = [System.Drawing.Image]::FromFile($rutaPng)
    try {
        $imagenes = foreach ($lado in 16, 24, 32, 48, 256) {
            $bitmap = New-Object System.Drawing.Bitmap $lado, $lado
            $grafico = [System.Drawing.Graphics]::FromImage($bitmap)
            $grafico.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $grafico.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $grafico.DrawImage($original, 0, 0, $lado, $lado)
            $grafico.Dispose()
            $memoria = New-Object System.IO.MemoryStream
            $bitmap.Save($memoria, [System.Drawing.Imaging.ImageFormat]::Png)
            $bitmap.Dispose()
            , @{ Lado = $lado; Bytes = $memoria.ToArray() }
        }
    } finally {
        $original.Dispose()
    }

    $salida = New-Object System.IO.MemoryStream
    $escritor = New-Object System.IO.BinaryWriter $salida
    $escritor.Write([uint16]0)
    $escritor.Write([uint16]1)
    $escritor.Write([uint16]$imagenes.Count)
    $desplazamiento = 6 + 16 * $imagenes.Count
    foreach ($imagen in $imagenes) {
        $lado = if ($imagen.Lado -ge 256) { 0 } else { $imagen.Lado }
        $escritor.Write([byte]$lado)
        $escritor.Write([byte]$lado)
        $escritor.Write([byte]0)
        $escritor.Write([byte]0)
        $escritor.Write([uint16]1)
        $escritor.Write([uint16]32)
        $escritor.Write([uint32]$imagen.Bytes.Length)
        $escritor.Write([uint32]$desplazamiento)
        $desplazamiento += $imagen.Bytes.Length
    }
    foreach ($imagen in $imagenes) {
        $escritor.Write([byte[]]$imagen.Bytes)
    }
    $escritor.Flush()
    [System.IO.File]::WriteAllBytes($destino, $salida.ToArray())
    $escritor.Dispose()
}

if ($Desinstalar) {
    Quitar-Menu
    foreach ($archivo in $lanzador, $icono) {
        if (Test-Path -LiteralPath $archivo) {
            Remove-Item -LiteralPath $archivo -Force
        }
    }
    Write-Host 'Menú "Asu" quitado.'
    exit 0
}

$asu = Get-Command asu -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $asu) {
    Write-Error 'No se encontró "asu" en el PATH. Instálalo con "bun link" desde la carpeta del repo.'
}

$terminal = Get-Command wt -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'

New-Item -ItemType Directory -Force -Path $carpetaAsu | Out-Null

# %1 = carpeta; %2 %3 = argumentos de asu. chcp 65001: rutas y textos con tildes.
# Pausa siempre: si no, la ventana se cierra antes de leer el resultado.
$contenidoLanzador = @"
@echo off
chcp 65001 >nul
cd /d "%~1" || (pause & exit /b 1)
"$($asu.Source)" %2 %3
pause
"@
[System.IO.File]::WriteAllText($lanzador, ($contenidoLanzador -replace "`r?`n", "`r`n"))

Escribir-Icono (Join-Path $PSScriptRoot '..\recursos\asu.png') $icono

# "%V." en vez de "%V": en la raíz quedaría "C:\" y wt leería \" como comilla
# escapada. Con el punto: "C:\." o "C:\carpeta." (Windows quita el punto final).
# "call": evita que cmd /c quite las comillas del lanzador.
# wt: ventana nueva y maximizada.
$prefijo = if ($terminal) { "`"$($terminal.Source)`" -w new --maximized " } else { '' }
$base = "$prefijo`"$cmd`" /d /c call `"$lanzador`" `"%V.`""

Quitar-Menu
foreach ($clave in $claves) {
    New-Item -Path $clave -Force | Out-Null
    Set-ItemProperty -LiteralPath $clave -Name 'MUIVerb' -Value 'Asu'
    Set-ItemProperty -LiteralPath $clave -Name 'Icon' -Value $icono
    Set-ItemProperty -LiteralPath $clave -Name 'SubCommands' -Value ''

    for ($i = 0; $i -lt $entradas.Count; $i++) {
        $entrada = $entradas[$i]
        $subclave = Join-Path $clave ('shell\{0:D2}' -f ($i + 1))
        New-Item -Path "$subclave\command" -Force | Out-Null
        Set-ItemProperty -LiteralPath $subclave -Name 'MUIVerb' -Value $entrada.Nombre
        Set-ItemProperty -LiteralPath "$subclave\command" -Name '(default)' -Value "$base $($entrada.Argumentos)".TrimEnd()
    }
}

Write-Host "Menú `"Asu`" instalado ($($entradas.Count) opciones)."
if (-not $terminal) {
    Write-Host 'Windows Terminal no encontrado: se usará cmd.'
}
Write-Host 'En Windows 11: "Mostrar más opciones" o Shift + clic derecho.'
