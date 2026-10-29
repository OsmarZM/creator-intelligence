const path=require("node:path");
const {createRequire}=require("node:module");
const {existsSync}=require("node:fs");
module.exports=function verifyRuntime(serverRoot){
  const root=path.resolve(serverRoot),localRequire=createRequire(path.join(root,"package.json")),seen=new Set();
  for(const name of ["storage","release",".desktop-resources","output",".playwright-cli"])if(existsSync(path.join(root,name)))throw new Error(`Diretório privado no pacote: ${name}`);
  function within(file){const relative=path.relative(root,file);return relative!==".."&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);}
  function visit(module){if(!module||seen.has(module.id))return;seen.add(module.id);if(module.filename&&!within(module.filename))throw new Error(`Dependência resolvida fora do pacote: ${module.filename}`);for(const child of module.children)visit(child);}
  for(const name of ["pg","exceljs","jszip","saxes","next/dist/server/next","next/dist/server/lib/start-server"]){const resolved=localRequire.resolve(name);if(!within(resolved))throw new Error(`Dependência ausente no pacote: ${name}`);localRequire(name);visit(localRequire.cache[resolved]);}
};
