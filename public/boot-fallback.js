// Last resort if React never mounts, including failure to load its entry module.
setTimeout(function () {
  var root = document.getElementById('root')
  if (!root || root.childElementCount > 0) return
  root.innerHTML =
    '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:100vh;padding:24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;">' +
    '<h1 style="font-size:20px;margin:0;">Não foi possível carregar o Evolutus</h1>' +
    '<p style="color:#57606a;max-width:420px;margin:0;">Isso costuma se resolver recarregando a página.</p>' +
    '<button style="padding:8px 20px;border-radius:6px;border:1px solid #d0d7de;background:#1f883d;color:#fff;font-weight:600;font-size:14px;cursor:pointer;">Recarregar</button>' +
    '</div>'
  root.querySelector('button').addEventListener('click', function () { location.reload() })
}, 12000)
