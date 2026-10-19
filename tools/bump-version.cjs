// Acrescenta ?v=<versão> aos arquivos locais (css/js) do index.html e do admin.html,
// para o navegador baixar a versão nova a cada publicação (evita cache antigo).
// Uso: node tools/bump-version.cjs
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const version = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
for (const file of ["index.html", "admin.html"]) {
  const p = path.join(root, file);
  const html = fs.readFileSync(p, "utf8").replace(
    /(<(?:script|link)\b[^>]*\s(?:src|href)=")((?!https?:|\/\/)[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?(")/g,
    (_, pre, url, post) => `${pre}${url}?v=${version}${post}`,
  );
  fs.writeFileSync(p, html);
}
console.log("versão", version);
