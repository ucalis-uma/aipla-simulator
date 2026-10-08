param(
  [Parameter(Mandatory=$true)][string]$Path,
  [string]$Lang = "ja-JP",
  [double]$Scale = 2,
  [string]$CropRect = "",
  [switch]$Words
)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime] | Out-Null

$src = [System.Drawing.Image]::FromFile((Resolve-Path $Path).Path)
$cropX = 0; $cropY = 0; $cropW = $src.Width; $cropH = $src.Height
if ($CropRect -ne "") {
  $p = $CropRect.Split(",")
  $cropX = [int]$p[0]; $cropY = [int]$p[1]; $cropW = [int]$p[2]; $cropH = [int]$p[3]
}
$w = [int]($cropW * $Scale); $h = [int]($cropH * $Scale)
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), (New-Object System.Drawing.Rectangle($cropX, $cropY, $cropW, $cropH)), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $src.Dispose()
$tmp = [System.IO.Path]::Combine($env:TEMP, "winocr_scaled.png")
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "[winocr] src ${cropW}x${cropH} crop($cropX,$cropY) scale=${Scale} -> ${w}x${h}"

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $tmp).Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$language = New-Object Windows.Globalization.Language($Lang)
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if ($null -eq $engine) { Write-Host "[winocr] no engine for $Lang"; exit 2 }
$res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
Write-Host "===== LINES ($($res.Lines.Count)) ====="
foreach ($line in $res.Lines) {
  $wordList = @($line.Words)
  $x = [int]($wordList[0].BoundingRect.X / $Scale) + $cropX
  $y = [int]($wordList[0].BoundingRect.Y / $Scale) + $cropY
  $x2 = [int](($wordList[$wordList.Count-1].BoundingRect.X + $wordList[$wordList.Count-1].BoundingRect.Width) / $Scale) + $cropX
  Write-Host ("[{0,5},{1,5}-{2,5}] {3}" -f $x, $y, $x2, $line.Text)
  if ($Words) {
    foreach ($wd in $wordList) {
      Write-Host ("        w[{0,5},{1,5} {2,4}x{3,4}] {4}" -f ([int]($wd.BoundingRect.X/$Scale)+$cropX), ([int]($wd.BoundingRect.Y/$Scale)+$cropY), [int]($wd.BoundingRect.Width/$Scale), [int]($wd.BoundingRect.Height/$Scale), $wd.Text)
    }
  }
}
