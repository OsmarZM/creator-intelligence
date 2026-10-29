import {execFileSync} from "node:child_process";
const files=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const failures=[];
for(const name of files){
  if(/^(storage|release|output|\.next|\.desktop-resources|\.playwright-cli|node_modules|docs\/screenshots)\//.test(name)||(/(^|\/)\.env/.test(name)&&name!==".env.example")||/\.(xlsx|exe|blockmap|db|sqlite|bak)$/i.test(name))failures.push(name);
  if(/\.(png|ico|jpg|jpeg|webp|gif)$/i.test(name)){
    if(!/^desktop\/icon\.(png|ico)$/.test(name))failures.push(name);
    continue;
  }
  const content=execFileSync("git",["show",":"+name],{encoding:"utf8",maxBuffer:8*1024*1024});
  if(/(?:ghp_|github_pat_|sk-proj-|sk-ant-)[A-Za-z0-9_-]{16,}/.test(content))failures.push(name);
}
if(failures.length)throw new Error(`Arquivos que exigem revisão antes da publicação: ${[...new Set(failures)].join(", ")}`);
console.log(`${files.length} arquivos rastreados conferidos; artefatos privados e capturas locais excluídos.`);
