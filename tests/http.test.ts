import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../backend/db.ts';
import {seed} from '../backend/seed.ts';
process.env.NODE_ENV='test';
const {createApp}=await import('../backend/server.ts');
test('HTTP workflow: session, CSRF, create customer/order/payment, export, deep data and role denial',async()=>{
 const store=new Store(':memory:');seed(store);const server=createApp(store).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const port=(server.address() as any).port,base=`http://127.0.0.1:${port}`;let cookie='',csrf='';
 async function req(path:string,method='GET',body?:any,headers:any={}){const r=await fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':csrf}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return r}
 try{
  const noSession=await req('/api/workspace');assert.equal(noSession.status,401);
  const bootstrap=await req('/api/bootstrap');assert.equal(bootstrap.status,200);const boot=await bootstrap.json() as any;csrf=boot.csrf;assert.match(cookie,/crm_session=/);assert.match(bootstrap.headers.get('set-cookie')!,/HttpOnly/i);
  const denied=await req('/api/commands','POST',{action:'payment',payload:{}},{'X-CSRF-Token':'invalid','Idempotency-Key':randomUUID()});assert.equal(denied.status,403);
  const cors=await req('/api/commands','POST',{action:'payment',payload:{}},{Origin:'https://evil.example','Idempotency-Key':randomUUID()});assert.equal(cors.status,403);
  const command=async(action:string,payload:any,key=randomUUID())=>{const r=await req('/api/commands','POST',{action,payload},{'Idempotency-Key':key});return {status:r.status,body:await r.json() as any}};
  const customer=await command('customer',{name:'HTTP Test Customer',person:'Test Contact',phone:'0000000999',area:'Anna Nagar',consent:true,creditLimit:10000000});assert.equal(customer.status,200);const c=customer.body.result;
  const order=await command('order',{customerId:c.id,items:[{productId:'white',warehouseId:'redhills',qty:600,rate:650}]});assert.equal(order.status,200);assert.equal(order.body.result.amount,390000);
  const snapshot=await (await req('/api/workspace?page=orders')).json() as any;const inv=snapshot.invoices.find((i:any)=>i.orderId===order.body.result.id);assert.ok(inv);assert.equal(inv.balance,390000);
  const key=randomUUID(),payment={customerId:c.id,amount:100000,method:'UPI'};const paid=await command('payment',payment,key);assert.equal(paid.status,200);const retried=await command('payment',payment,key);assert.equal(retried.body.result.id,paid.body.result.id);
  const updated=await (await req('/api/workspace?page=payments')).json() as any;assert.equal(updated.invoices.find((i:any)=>i.id===inv.id).balance,290000);
  const print=await req('/api/invoices/'+inv.id+'/print');assert.equal(print.status,200);assert.match(await print.text(),/FINALIZED INVOICE/);
  const exp=await req('/api/export?kind=orders&ids='+order.body.result.id);assert.equal(exp.status,200);assert.match(exp.headers.get('content-type')!,/text\/csv/);
  await req('/api/demo/switch','POST',{userId:'warehouse'});const noFinance=await command('payment',{customerId:c.id,amount:1,method:'Cash'});assert.equal(noFinance.status,403);assert.equal((await req('/api/workspace?page=payments')).status,403);assert.equal((await req('/api/export?kind=payments')).status,403);
  const warehouse=await (await req('/api/workspace?page=inventory')).json() as any;assert.equal(warehouse.payments.length,0);assert.equal(warehouse.metrics.collected,null);
  await req('/api/demo/switch','POST',{userId:'accounts'});assert.equal((await command('payment',{customerId:c.id,amount:100,method:'Cash'})).status,200);assert.equal((await command('staff',{name:'Escalate',role:'Owner',active:true})).status,403);
  await req('/api/logout','POST',{});assert.equal((await req('/api/workspace')).status,401);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close()}
});
test('Password-mode authentication does not offer automatic sessions or demo role switching',async()=>{
 const store=new Store(':memory:');seed(store);const server=createApp(store,{demo:false,password:'testing-private-password-123'}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
 try{assert.equal((await fetch(base+'/api/bootstrap')).status,401);const bad=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'wrong'})});assert.equal(bad.status,401);const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'testing-private-password-123'})});assert.equal(login.status,200);const csrf=(await login.json() as any).csrf,cookie=login.headers.get('set-cookie')!.split(';')[0];const change=await fetch(base+'/api/demo/switch',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Cookie:cookie},body:JSON.stringify({userId:'warehouse'})});assert.equal(change.status,403)}finally{await new Promise<void>(r=>server.close(()=>r()));store.close()}
});
