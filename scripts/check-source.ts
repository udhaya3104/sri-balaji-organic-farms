import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
let errors=0,files=0;
function walk(dir:string){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(/\.tsx?$/.test(path)&&!path.endsWith('.d.ts')){files++;let source='';try{source=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path))}catch{console.error(path+': invalid UTF-8');errors++}if(/\bdebugger\s*;/.test(source)||/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(/.test(source)){console.error(path+': unsafe/debug statement');errors++}}}}
for(const dir of ['backend','src','tests'])walk(dir);console.log(`Source hygiene: ${files} TypeScript files checked; ${errors} errors. This is a targeted hygiene check; semantic/syntax checking is npm run typecheck.`);if(errors)process.exit(1);
