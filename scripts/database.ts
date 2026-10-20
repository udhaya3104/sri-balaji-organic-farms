import {Store} from '../backend/db.ts';
import {seed} from '../backend/seed.ts';
import {existsSync,copyFileSync,mkdirSync,renameSync} from 'node:fs';
const cmd=process.argv[2]||'migrate',dbPath=process.env.DATABASE_PATH||'data/crm.sqlite';
mkdirSync('data/backups',{recursive:true});
if(cmd==='reset'){
 if(!process.argv.includes('--confirm-reset'))throw Error('Stop the app, then run npm run db:reset -- --confirm-reset. This archives existing prototype data.');
 if(existsSync(dbPath)){const backup='data/backups/crm-before-reset-'+Date.now()+'.sqlite';const existing=new Store(dbPath);existing.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');existing.close();renameSync(dbPath,backup);console.log('Previous database archived: '+backup)}
 const store=new Store(dbPath);seed(store);store.close();console.log('Fresh internally consistent demo data seeded. Legacy JSON was not imported on reset.');
}else if(cmd==='backup'){
 const store=new Store(dbPath),dest='data/backups/crm-'+Date.now()+'.sqlite';store.db.prepare('VACUUM INTO ?').run(dest);store.close();console.log('Backup: '+dest);
}else{const store=new Store(dbPath);if(cmd==='seed')seed(store,existsSync('data/state.json')?'data/state.json':undefined);console.log('Database ready. Migration versions: '+store.db.prepare('SELECT version FROM migrations').all().map((r:any)=>r.version).join(','));store.close()}
