import "dotenv/config";
import { loadFullCatalog, listCotaOptions } from "./server/valuation-builder.ts";
const cat = await loadFullCatalog(1);
console.log("linhas:", cat.length);
if(cat.length){
  const cidades=[...new Set(cat.map(r=>r.cidade))];
  console.log("praças:", cidades.length, "→", cidades.slice(0,8).join(" | "));
  console.log("opções em", cidades[0], ":", listCotaOptions(cat, cidades[0]).length);
  console.log("linhas com imagem:", cat.filter(r=>r.imagem).length);
} else console.log("⚠️ vazio");
