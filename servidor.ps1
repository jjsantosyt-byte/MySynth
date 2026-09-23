# servidor.ps1
# Servidor local simples, so para testar o app no computador.
# O navegador so libera o motor de som (AudioWorklet) em http://localhost
# ou em enderecos https, por isso nao da para abrir o index.html direto.

param(
  [int]$Porta = 8080,
  [switch]$Abrir
)

$raiz = $PSScriptRoot
$tipos = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.wav'  = 'audio/wav'
}

$ouvinte = New-Object System.Net.HttpListener
$ouvinte.Prefixes.Add("http://localhost:$Porta/")
$ouvinte.Start()
Write-Host "Servidor ligado em http://localhost:$Porta/"
Write-Host "Para desligar, feche esta janela."
if ($Abrir) { Start-Process "http://localhost:$Porta/" }

try {
  while ($ouvinte.IsListening) {
    $pedido = $ouvinte.GetContext()
    $resposta = $pedido.Response
    try {
      $caminho = [Uri]::UnescapeDataString($pedido.Request.Url.AbsolutePath).TrimStart('/')
      if ($caminho -eq '') { $caminho = 'index.html' }
      $arquivo = [IO.Path]::GetFullPath((Join-Path $raiz $caminho))

      # So entrega arquivos de dentro da pasta do projeto.
      if ($arquivo.StartsWith($raiz) -and (Test-Path -LiteralPath $arquivo -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($arquivo)
        $extensao = [IO.Path]::GetExtension($arquivo).ToLower()
        if ($tipos.ContainsKey($extensao)) { $resposta.ContentType = $tipos[$extensao] }
        else { $resposta.ContentType = 'application/octet-stream' }
        $resposta.Headers.Add('Cache-Control', 'no-store')
        $resposta.ContentLength64 = $bytes.Length
        $resposta.OutputStream.Write($bytes, 0, $bytes.Length)
      }
      else {
        $resposta.StatusCode = 404
      }
    }
    catch {
      $resposta.StatusCode = 500
    }
    finally {
      $resposta.Close()
    }
  }
}
finally {
  $ouvinte.Stop()
}
