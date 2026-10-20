import {Store,DomainError,requireThat,integer,text,today,addDays,type Row,tables} from './db.ts';

export const modules=['dashboard','customers','orders','deliveries','inventory','purchases','suppliers','payments','expenses','follow-ups','whatsapp','campaigns','automations','reports','staff','settings'];

export const roles:Record<string,{view:string[];write:string[]}>={

 Owner:{view:modules,write:modules},

 'Sales Manager':{view:modules.filter(x=>!['staff','settings'].includes(x)),write:['customers','orders','follow-ups','whatsapp','campaigns','automations']},

 'Sales Staff':{view:['dashboard','customers','orders','inventory','follow-ups','whatsapp'],write:['customers','orders','follow-ups','whatsapp']},

 'Purchase Manager':{view:['dashboard','inventory','purchases','suppliers','reports'],write:['purchases','suppliers']},

 'Warehouse Staff':{view:['dashboard','inventory','orders','deliveries'],write:['inventory']},

 'Dispatch Manager':{view:['dashboard','customers','orders','inventory','deliveries'],write:['deliveries']},

 Accountant:{view:['dashboard','customers','orders','purchases','suppliers','payments','expenses','reports'],write:['payments','expenses']},

 'Support Staff':{view:['dashboard','customers','follow-ups','whatsapp'],write:['follow-ups','whatsapp']}

};

const actionModule:Record<string,string>={product:'settings',warehouse:'settings',driver:'deliveries',reviseOrder:'orders',customer:'customers',customerArchive:'customers',order:'orders',confirmOrder:'orders',cancelOrder:'orders',purchase:'purchases',receive:'purchases',bill:'purchases',supplier:'suppliers',supplierPayment:'payments',stock:'inventory',transfer:'inventory',trip:'deliveries',dispatch:'deliveries',completeStop:'deliveries',closeTrip:'deliveries',payment:'payments',allocate:'payments',reversePayment:'payments',reconcile:'payments',expense:'expenses',task:'follow-ups',taskUpdate:'follow-ups',generateFollowups:'follow-ups',message:'whatsapp',simulateMessage:'whatsapp',campaign:'campaigns',campaignRun:'campaigns',campaignPause:'campaigns',automation:'automations',settings:'settings',staff:'staff',return:'inventory',approveCredit:'payments'};

export function can(user:Row,module:string,write=false){return user.active!==false&&!!roles[user.role]?.[write?'write':'view'].includes(module)}

export class Business {

 store:Store;

 constructor(store:Store){this.store=store}

 all=(t:string)=>this.store.all(t);

 get=(t:string,id:string)=>this.store.get(t,id);

 add=(t:string,d:any)=>this.store.add(t,d);

 update=(t:string,id:string,d:any)=>this.store.update(t,id,d);

 settings(){return this.get('settings','business')}
 reorderInterval(c:Row){if(c.scheduleMode!=='History')return c.interval||7;const dates=[...new Set<string>(this.all('orders').filter(o=>o.customerId===c.id&&['Delivered','Closed (partial cancellation)'].includes(o.status)).map(o=>o.date))].sort();const gaps=dates.slice(1).map((d,n)=>(Date.parse(d)-Date.parse(dates[n]))/86400000).filter(n=>n>0).sort((a,b)=>a-b);return gaps.length?Math.max(1,Math.round(gaps[Math.floor(gaps.length/2)])):c.interval||7;}

 audit(actor:Row,action:string,record:Row,before:any=null){this.add('audits',{actorId:actor.id,actor:actor.name,action,recordId:record.id,before,after:record,at:new Date().toISOString()})}

 stock(productId:string,warehouseId?:string){const moves=this.all('movements').filter(x=>x.productId===productId&&(!warehouseId||x.warehouseId===warehouseId));const onHand=moves.reduce((a,x)=>a+x.qty,0);const items=this.all('order_items');const reserved=this.all('reservations').filter(r=>{const i=items.find(x=>x.id===r.itemId);return i?.productId===productId&&(!warehouseId||i.warehouseId===warehouseId)}).reduce((a,x)=>a+x.remaining,0);return {onHand,reserved,available:onHand-reserved};}

 cost(productId:string){const p=this.get('products',productId);const incoming=this.all('movements').filter(x=>x.productId===productId&&x.costPaise!==undefined);const qty=incoming.reduce((a,x)=>a+x.qty,0);return qty>0?Math.max(0,Math.round(incoming.reduce((a,x)=>a+x.qty*x.costPaise,0)/qty)):p.costPaise;}

 movement(productId:string,warehouseId:string,qty:number,type:string,ref:string,costPaise?:number){this.get('products',productId);this.get('warehouses',warehouseId);return this.add('movements',{productId,warehouseId,qty,type,ref,costPaise:costPaise??this.cost(productId),date:today()})}

 invoicePaid(invoiceId:string){return this.all('allocations').filter(x=>x.invoiceId===invoiceId&&!this.get('payments',x.paymentId).reversed).reduce((a,x)=>a+x.amount,0)}

 invoiceBalance(i:Row){return i.amount-(i.credit||0)-this.invoicePaid(i.id)}

 supplierBalance(b:Row){return b.amount-this.all('supplier_allocations').filter(x=>x.billId===b.id).reduce((a,x)=>a+x.amount,0)}

 exposure(customerId:string){return this.all('invoices').filter(i=>i.customerId===customerId).reduce((a,i)=>a+this.invoiceBalance(i),0)}

 reservation(itemId:string){return this.all('reservations').find(x=>x.itemId===itemId)}

 message(customerId:string,body:string,eventKey:string,extra:any={}){const c=this.get('customers',customerId);if(!c.consent||c.active===false||c.paused)return null;if(this.all('messages').some(x=>x.eventKey===eventKey))return null;return this.add('messages',{customerId,body,eventKey,direction:'outbound',status:'Simulated queued',date:today(),...extra})}

 notify(event:string,customerId:string,body:string,key:string){const config=this.settings();if(config.automations?.[event]!==false)this.message(customerId,body,key,{event})}

 deriveOrder(orderId:string){const o=this.get('orders',orderId),items=this.all('order_items').filter(i=>i.orderId===orderId);if(o.status==='Draft')return o;const qty=items.reduce((a,i)=>a+i.qty,0),del=items.reduce((a,i)=>a+(i.delivered||0),0),cancelled=items.reduce((a,i)=>a+(i.cancelled||0),0),transit=items.reduce((a,i)=>a+(i.inTransit||0),0);let status='Confirmed';if(cancelled===qty)status='Cancelled';else if(del+cancelled===qty&&transit===0)status=cancelled?'Closed (partial cancellation)':'Delivered';else if(del>0)status='Partially delivered';else if(transit>0)status=transit+del+cancelled===qty?'Dispatched':'Partially dispatched';return this.update('orders',orderId,{status})}

 command(actor:Row,action:string,p:any,key:string){requireThat(action in actionModule,'Unknown operation');requireThat(can(actor,actionModule[action],true),'Access denied for this role',403);requireThat(typeof key==='string'&&key.length>=8&&key.length<=100,'An idempotency key is required');return this.store.tx(()=>{const cached=this.store.db.prepare('SELECT * FROM idempotency WHERE id=?').get(key) as any;if(cached){requireThat(cached.actor===actor.id&&cached.action===action&&cached.request===JSON.stringify(p),'Idempotency key was already used with a different request',409);return JSON.parse(cached.response)}const beforeTables:Record<string,string>={customer:'customers',supplier:'suppliers',product:'products',warehouse:'warehouses',driver:'drivers',staff:'users',confirmOrder:'orders',cancelOrder:'orders',reviseOrder:'orders',dispatch:'trips',completeStop:'stops',closeTrip:'trips',reversePayment:'payments',reconcile:'cash',taskUpdate:'tasks',campaignRun:'campaigns',campaignPause:'campaigns',approveCredit:'returns'};const before=p.id&&beforeTables[action]?this.get(beforeTables[action],p.id):action==='settings'||action==='automation'?this.settings():null;const result=this.execute(actor,action,p);this.audit(actor,action,result,before);this.store.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run(key,actor.id,action,JSON.stringify(p),JSON.stringify(result));return result})}

 execute(actor:Row,action:string,p:any):Row {

 const cfg=this.settings();

 if(action==='product'){const data={name:text(p.name,'Product name',100),variety:text(p.variety,'Variety',100),pricePaise:integer(p.pricePaise,'Selling price',1),costPaise:integer(p.costPaise,'Default cost',1),reorder:integer(p.reorder,'Reorder threshold'),active:p.active!==false};return p.id?this.update('products',p.id,data):this.add('products',data)}

 if(action==='warehouse'){const data={name:text(p.name,'Warehouse name',120),area:text(p.area,'Warehouse area',120),active:true};return p.id?this.update('warehouses',p.id,data):this.add('warehouses',data)}

 if(action==='driver'){const phone=text(p.phone,'Phone',30).replace(/\D/g,'');requireThat(phone.length>=10&&phone.length<=15,'Driver phone must contain 10–15 digits');const data={name:text(p.name,'Driver name',120),phone,vehicle:text(p.vehicle,'Vehicle number',30),active:true};return p.id?this.update('drivers',p.id,data):this.add('drivers',data)}

 if(action==='reviseOrder'){const old=this.get('orders',p.id);requireThat(['Draft','Confirmed'].includes(old.status),'Only an unfulfilled draft or confirmed order may be revised');requireThat(this.all('order_items').filter(i=>i.orderId===old.id).every(i=>!i.inTransit&&!i.delivered),'Order already has fulfillment history');const reason=text(p.revisionReason,'Revision reason');this.execute(actor,'cancelOrder',{id:old.id,reason:'Superseded: '+reason});const replacement=this.execute(actor,'order',{...p,customerId:p.customerId||old.customerId});this.update('orders',replacement.id,{replacesOrderId:old.id,revisionReason:reason});return this.update('orders',old.id,{replacedByOrderId:replacement.id})}

 if(action==='customer'||action==='supplier'){

  const table=action==='customer'?'customers':'suppliers';const name=text(p.name,'Business name',120),phone=text(p.phone,'Phone',30).replace(/\D/g,'');requireThat(phone.length>=10&&phone.length<=15,'Enter a 10–15 digit phone');requireThat(!this.all(table).some(x=>x.id!==p.id&&x.phone===phone),'A record with this phone already exists',409);

  const duplicate=this.all(table).find(x=>x.id!==p.id&&x.name.toLowerCase()===name.toLowerCase());requireThat(!duplicate,'A business with this name already exists',409);

  const d={name,phone,person:text(p.person,'Contact person',120),area:text(p.area,'Area',100),address:p.address||p.area,addresses:Array.isArray(p.addresses)?p.addresses:[p.address||p.area],category:p.category||'Shop',consent:p.consent===true,active:p.active!==false,creditLimit:integer(p.creditLimit??10000000,'Credit limit'),terms:integer(p.terms??7,'Payment term days'),interval:integer(p.interval??7,'Reorder interval',1),scheduleMode:p.scheduleMode==='History'?'History':'Manual',notes:String(p.notes||'').slice(0,2000),defaultPrice:integer(p.defaultPrice??650,'Default selling price',1),gst:String(p.gst||'').slice(0,30),paused:p.paused===true};

  if(p.id){const before=this.get(table,p.id);this.audit(actor,'Before '+action,before);return this.update(table,p.id,d)}return this.add(table,d);

 }

 if(action==='customerArchive'){const c=this.get('customers',p.id);return this.update('customers',c.id,{active:false,consent:false})}

 if(action==='order'){

  const c=this.get('customers',p.customerId);requireThat(c.active!==false,'Customer is inactive');requireThat(Array.isArray(p.items)&&p.items.length>0&&p.items.length<=30,'Add 1–30 order items');const draft=p.draft===true;

  const its=p.items.map((i:any)=>{const prod=this.get('products',i.productId);requireThat(prod.active!==false,'Product is inactive');this.get('warehouses',i.warehouseId);return {productId:prod.id,warehouseId:i.warehouseId,qty:integer(i.qty,'Egg quantity',1),rate:integer(i.rate??c.defaultPrice??prod.pricePaise,'Price in paise',1),delivered:0,inTransit:0,cancelled:0,costPaise:this.cost(prod.id),traySize:cfg.traySize}});

  const subtotal=its.reduce((a:number,i:any)=>a+i.qty*i.rate,0),discount=integer(p.discount||0,'Discount'),charges=integer(p.charges||0,'Charges'),tax=integer(p.tax||0,'Tax');requireThat(discount<=subtotal,'Discount cannot exceed subtotal');const amount=subtotal-discount+charges+tax;

  const override=!!p.overrideReason;requireThat(this.exposure(c.id)+amount<=c.creditLimit||(actor.role==='Owner'&&override)||draft,'Customer credit limit exceeded. Owner approval with a reason is required');

  const o=this.add('orders',{customerId:c.id,number:`SO-${Math.max(1000,...this.all('orders').map(o=>Number(o.number.replace('SO-',''))||1000))+1}`,date:validDate(p.date||today()),deliveryDate:validDate(p.deliveryDate||today()),status:'Draft',subtotal,discount,charges,tax,amount,notes:String(p.notes||''),address:p.address||c.address,terms:c.terms,actorId:actor.id,overrideReason:override?text(p.overrideReason,'Override reason'):null});

  for(const i of its)this.add('order_items',{...i,orderId:o.id});

  if(!draft)this.confirm(o.id);return this.get('orders',o.id);

 }

 if(action==='confirmOrder'){this.confirm(p.id);return this.get('orders',p.id)}

 if(action==='cancelOrder'){

  const o=this.get('orders',p.id);requireThat(!['Cancelled','Delivered','Closed (partial cancellation)'].includes(o.status),'This order cannot be cancelled');const reason=text(p.reason,'Cancellation reason');const items=this.all('order_items').filter(i=>i.orderId===o.id);requireThat(items.every(i=>!i.inTransit),'Reconcile all in-transit quantities before cancelling remaining items');let cancelValue=0;

  for(const i of items){const q=i.qty-i.delivered-i.cancelled;cancelValue+=q*i.rate;this.update('order_items',i.id,{cancelled:i.cancelled+q});const r=this.reservation(i.id);if(r)this.update('reservations',r.id,{remaining:0});this.movement(i.productId,i.warehouseId,0,'Reservation release',o.number)}

  const inv=this.all('invoices').find(i=>i.orderId===o.id);if(inv){const credit=Math.round(o.amount*(cancelValue/o.subtotal));requireThat(inv.amount-(inv.credit||0)-credit>=this.invoicePaid(inv.id),'Reverse allocated payments before cancelling this amount');this.update('invoices',inv.id,{credit:(inv.credit||0)+credit,creditReason:reason})}this.update('orders',o.id,{cancelReason:reason});if(o.status==='Draft')return this.update('orders',o.id,{status:'Cancelled'});this.deriveOrder(o.id);this.notify('order',o.customerId,`Order ${o.number}: remaining eggs cancelled. ${reason}`,'cancel:'+o.id);return this.get('orders',o.id);

 }

 if(action==='stock'){

  const qty=integer(Math.abs(Number(p.qty)),'Quantity',1)*(Number(p.qty)<0?-1:1);requireThat(['Opening balance','Adjustment','Damage'].includes(p.type),'Invalid stock event');const reason=text(p.reason,'Stock movement reason');requireThat(p.type!=='Damage'||qty<0,'Damage must be a negative quantity');if(qty<0)requireThat(this.stock(p.productId,p.warehouseId).available>=-qty,'Cannot remove reserved or unavailable eggs');return this.movement(p.productId,p.warehouseId,qty,p.type,reason,integer(p.costPaise??this.cost(p.productId),'Cost'));

 }

 if(action==='transfer'){const qty=integer(p.qty,'Transfer eggs',1);requireThat(p.from!==p.to,'Choose different warehouses');requireThat(this.stock(p.productId,p.from).available>=qty,'Insufficient available stock');this.movement(p.productId,p.from,-qty,'Transfer out',p.to);return this.movement(p.productId,p.to,qty,'Transfer in',p.from)}

 if(action==='purchase'){

  this.get('suppliers',p.supplierId);requireThat(Array.isArray(p.items)&&p.items.length,'Add purchase items');const its=p.items.map((i:any)=>({productId:this.get('products',i.productId).id,warehouseId:this.get('warehouses',i.warehouseId).id,qty:integer(i.qty,'Egg quantity',1),rate:integer(i.rate,'Purchase rate',1),received:0,rejected:0,damaged:0}));const po=this.add('purchases',{supplierId:p.supplierId,number:`PO-${1001+this.all('purchases').length}`,date:validDate(p.date||today()),expectedDate:validDate(p.expectedDate||today()),status:'Ordered',amount:its.reduce((a:number,i:any)=>a+i.qty*i.rate,0),notes:String(p.notes||''),invoiceRef:String(p.invoiceRef||'')});for(const i of its)this.add('purchase_items',{...i,purchaseId:po.id});return po;

 }

 if(action==='receive'){

  const i=this.get('purchase_items',p.itemId),po=this.get('purchases',i.purchaseId);const accepted=integer(p.accepted,'Accepted eggs'),rejected=integer(p.rejected||0,'Rejected eggs'),damaged=integer(p.damaged||0,'Damaged eggs');const qty=accepted+rejected+damaged;requireThat(qty>0&&i.received+i.rejected+i.damaged+qty<=i.qty,'Receipt must not exceed remaining ordered quantity');const r=this.add('receipts',{purchaseId:po.id,itemId:i.id,accepted,rejected,damaged,batch:text(p.batch||'LOT-'+Date.now(),'Batch'),date:today()});this.update('purchase_items',i.id,{received:i.received+accepted,rejected:i.rejected+rejected,damaged:i.damaged+damaged});if(accepted)this.movement(i.productId,i.warehouseId,accepted,'Purchase receipt',r.id,i.rate);const its=this.all('purchase_items').filter(x=>x.purchaseId===po.id);const done=its.every(x=>x.received+x.rejected+x.damaged===x.qty);this.update('purchases',po.id,{status:done?'Received':'Partially received'});return r;

 }

 if(action==='bill'){

  this.get('suppliers',p.supplierId);if(p.purchaseId){const po=this.get('purchases',p.purchaseId);requireThat(po.supplierId===p.supplierId,'Bill supplier does not match purchase');}const ref=text(p.reference,'Supplier invoice reference',100);requireThat(!this.all('bills').some(x=>x.supplierId===p.supplierId&&x.reference===ref),'Supplier invoice already recorded');return this.add('bills',{supplierId:p.supplierId,purchaseId:p.purchaseId||null,amount:integer(p.amount,'Bill amount',1),reference:ref,date:validDate(p.date||today()),due:validDate(p.due||addDays(today(),7)),status:'Approved'});

 }

 if(action==='supplierPayment'){

  const b=this.get('bills',p.billId),amount=integer(p.amount,'Payment amount',1);requireThat(amount<=this.supplierBalance(b),'Payment exceeds supplier bill balance');const pay=this.add('supplier_payments',{supplierId:b.supplierId,amount,date:validDate(p.date||today()),method:validMethod(p.method),reference:String(p.reference||'')});this.add('supplier_allocations',{paymentId:pay.id,billId:b.id,amount});return pay;

 }

 if(action==='trip'){

  const driver=this.get('drivers',p.driverId);requireThat(Array.isArray(p.allocations)&&p.allocations.length>0,'Assign at least one order item');requireThat(!this.all('trips').some(t=>t.driverId===driver.id&&['Planned','In transit'].includes(t.status)),'Driver already has an open trip');const trip=this.add('trips',{driverId:driver.id,vehicle:p.vehicle||driver.vehicle,number:`TR-${String(this.all('trips').length+1).padStart(3,'0')}`,date:validDate(p.date||today()),departure:p.departure||'08:30',status:'Planned',notes:String(p.notes||'')});

  for(const [index,a] of p.allocations.entries()){const i=this.get('order_items',a.itemId),o=this.get('orders',i.orderId);requireThat(!['Draft','Cancelled','Delivered'].includes(o.status),'Order is not eligible for scheduling');const qty=integer(a.qty,'Allocated quantity',1);const scheduled=this.all('stops').filter(s=>s.itemId===i.id&&s.status==='Assigned').reduce((n,s)=>n+s.qty,0);requireThat(qty<=i.qty-i.delivered-i.inTransit-i.cancelled-scheduled,'Allocation exceeds remaining order quantity');this.add('stops',{tripId:trip.id,itemId:i.id,orderId:o.id,customerId:o.customerId,qty,sequence:index+1,status:'Assigned',address:a.address||o.address,plannedTime:a.time||'09:00',delivered:0,returned:0})}return trip;

 }

 if(action==='dispatch'){

  const t=this.get('trips',p.id);requireThat(t.status==='Planned','Only a planned trip can be dispatched');const stops=this.all('stops').filter(x=>x.tripId===t.id);for(const stop of stops){const i=this.get('order_items',stop.itemId),r=this.reservation(i.id);requireThat(r&&r.remaining>=stop.qty,'Insufficient reservation; reconcile this trip');requireThat(this.stock(i.productId,i.warehouseId).onHand>=stop.qty,'Insufficient warehouse stock');this.update('reservations',r.id,{remaining:r.remaining-stop.qty});this.movement(i.productId,i.warehouseId,-stop.qty,'Dispatch',t.number,i.costPaise);this.update('order_items',i.id,{inTransit:i.inTransit+stop.qty});this.update('stops',stop.id,{status:'In transit'});this.deriveOrder(i.orderId);this.notify('delivery',stop.customerId,`Your order ${this.get('orders',i.orderId).number} is out for delivery. Driver: ${this.get('drivers',t.driverId).name}. Vehicle ${t.vehicle}.`,'dispatch:'+stop.id)}

  this.add('messages',{customerId:null,recipient:'Driver '+this.get('drivers',t.driverId).name,body:stops.map(x=>`${x.sequence}. ${this.get('customers',x.customerId).name}, ${x.qty} eggs, ${x.address}, contact ${this.get('customers',x.customerId).phone}`).join('\n'),eventKey:'driver:'+t.id,direction:'outbound',status:'Simulated queued',date:today(),event:'driver'});return this.update('trips',t.id,{status:'In transit'});

 }

 if(action==='completeStop'){

  const stop=this.get('stops',p.id);requireThat(stop.status==='In transit','This stop is not in transit');const delivered=integer(p.delivered,'Delivered eggs');requireThat(delivered<=stop.qty,'Delivered quantity exceeds allocation');const reason=text(p.proof,'Recipient name / proof reason',500);const returned=stop.qty-delivered;const i=this.get('order_items',stop.itemId);this.update('order_items',i.id,{inTransit:i.inTransit-stop.qty,delivered:i.delivered+delivered});if(returned){this.movement(i.productId,i.warehouseId,returned,'Undelivered return',stop.id,i.costPaise);const r=this.reservation(i.id);if(r)this.update('reservations',r.id,{remaining:r.remaining+returned})}const result=this.update('stops',stop.id,{delivered,returned,status:delivered===stop.qty?'Delivered':delivered?'Partially delivered':'Failed',actualAt:new Date().toISOString()});this.add('proofs',{stopId:stop.id,type:'Authorized recipient / manual confirmation',recipient:reason,date:today()});this.deriveOrder(i.orderId);

  const collected=integer(p.collected||0,'Collection');if(collected){requireThat(collected<=this.exposure(stop.customerId)-this.all('cash').filter(c=>c.customerId===stop.customerId&&c.status==='Pending handover').reduce((n,c)=>n+c.amount,0),'Collection exceeds customer outstanding after pending cash');if(validMethod(p.method)==='Cash'){this.add('cash',{stopId:stop.id,customerId:stop.customerId,tripId:stop.tripId,amount:collected,status:'Pending handover',date:today()})}else this.postPayment({customerId:stop.customerId,amount:collected,method:p.method,date:today(),reference:'Delivery '+stop.id,allocate:true})}this.notify('delivery',stop.customerId,`${delivered} eggs delivered. ${returned?returned+' eggs returned for rescheduling.':''}`,'delivered:'+stop.id);return result;

 }

 if(action==='closeTrip'){const t=this.get('trips',p.id);requireThat(t.status==='In transit','Trip must be in transit');requireThat(this.all('stops').filter(x=>x.tripId===t.id).every(x=>!['Assigned','In transit'].includes(x.status)),'Complete or fail each stop first');requireThat(!this.all('cash').some(x=>x.tripId===t.id&&x.status==='Pending handover'),'Reconcile driver cash before closing trip');return this.update('trips',t.id,{status:'Closed'})}

 if(action==='payment')return this.postPayment(p);

 if(action==='allocate'){const pay=this.get('payments',p.paymentId);requireThat(!pay.reversed,'Cannot allocate a reversed payment');this.allocate(pay,p.allocations);return pay}

 if(action==='reversePayment'){requireThat(actor.role==='Owner'||actor.role==='Accountant','Access denied',403);const pay=this.get('payments',p.id);requireThat(!pay.reversed,'Payment already reversed');return this.update('payments',pay.id,{reversed:true,reversalReason:text(p.reason,'Reversal reason'),reversedAt:new Date().toISOString()})}

 if(action==='reconcile'){const cash=this.get('cash',p.id);requireThat(cash.status==='Pending handover','Cash already reconciled');const verified=integer(p.verified,'Verified cash');requireThat(verified===cash.amount,'Cash difference must be resolved before posting; expected '+cash.amount+' paise');const pay=this.postPayment({customerId:cash.customerId,amount:cash.amount,method:'Cash',date:today(),allocate:true,reference:'Driver handover '+cash.id});return this.update('cash',cash.id,{status:'Reconciled',paymentId:pay.id,verified,actorId:actor.id})}

 if(action==='expense')return this.add('expenses',{category:text(p.category,'Category',100),amount:integer(p.amount,'Amount',1),date:validDate(p.date||today()),method:validMethod(p.method),payee:text(p.payee,'Payee'),notes:String(p.notes||''),status:'Approved',actorId:actor.id});

 if(action==='task'){this.get('customers',p.customerId);return this.add('tasks',{customerId:p.customerId,title:text(p.title,'Task'),due:validDate(p.due||today()),status:'Scheduled',assignedTo:p.assignedTo||actor.id,notes:String(p.notes||'')})}

 if(action==='taskUpdate'){const t=this.get('tasks',p.id);requireThat(['Contacted','Replied','Snoozed','Closed'].includes(p.status),'Invalid follow-up status');return this.update('tasks',t.id,{status:p.status,due:p.status==='Snoozed'?validDate(p.due):t.due,notes:String(p.notes||t.notes||'')})}

 if(action==='generateFollowups')return this.generateFollowups(actor,p.force===true);

 if(action==='message'){const c=this.get('customers',p.customerId);requireThat(c.consent&&!c.paused&&c.active!==false,'Customer is opted out, inactive or paused');const m=this.message(c.id,text(p.body,'Message',4000),'manual:'+crypto.randomUUID());return m!;}

 if(action==='simulateMessage'){

  if(p.reply){const c=this.get('customers',p.customerId);const body=text(p.body,'Simulated reply',4000);if(body.toLowerCase().trim()==='stop')this.update('customers',c.id,{consent:false});for(const t of this.all('tasks').filter(x=>x.customerId===c.id&&!['Closed','Order Created'].includes(x.status)))this.update('tasks',t.id,{status:'Replied'});return this.add('messages',{customerId:c.id,body,direction:'inbound',status:'Simulated received',date:today(),eventKey:'reply:'+crypto.randomUUID()})}

  const m=this.get('messages',p.id);requireThat(m.direction==='outbound','Only outbound messages have delivery states');requireThat(['Simulated delivered','Simulated read','Simulated failed','Simulated queued'].includes(p.status),'Invalid simulation state');if(m.customerId){const c=this.get('customers',m.customerId);requireThat(c.consent||p.status==='Simulated failed','Customer opted out; delivery blocked')}return this.update('messages',m.id,{status:p.status});

 }

 if(action==='campaign')return this.add('campaigns',{name:text(p.name,'Campaign name',120),body:text(p.body,'Template body',4000),area:p.area||'',category:p.category||'',scheduledAt:p.scheduledAt||null,status:p.scheduledAt?'Scheduled':'Draft',actorId:actor.id});

 if(action==='campaignPause'){const c=this.get('campaigns',p.id);requireThat(c.status!=='Completed','Completed campaigns cannot be paused');return this.update('campaigns',c.id,{status:'Paused'})}

 if(action==='campaignRun'){const c=this.get('campaigns',p.id);requireThat(c.status!=='Completed','Campaign already completed');requireThat(!c.scheduledAt||new Date(c.scheduledAt).getTime()<=Date.now(),'Scheduled campaign is not due yet');let eligible=0;for(const customer of this.all('customers').filter(x=>x.active!==false&&x.consent&&!x.paused&&(!c.area||x.area===c.area)&&(!c.category||x.category===c.category))){if(this.message(customer.id,c.body.replaceAll('{{name}}',customer.person),'campaign:'+c.id+':'+customer.id,{campaignId:c.id}))eligible++}return this.update('campaigns',c.id,{status:'Completed',eligible,executedAt:new Date().toISOString()})}

 if(action==='automation'){requireThat(['order','delivery','payment','reorder'].includes(p.event),'Unknown automation');return this.update('settings','business',{automations:{...cfg.automations,[p.event]:p.enabled===true}})}

 if(action==='settings'){return this.update('settings','business',{name:text(p.name,'Company name',120),owner:text(p.owner,'Owner name',100),phone:String(p.phone||''),address:String(p.address||''),email:String(p.email||''),traySize:integer(p.traySize,'Eggs per tray',1),quietStart:boundedHour(p.quietStart??20),quietEnd:boundedHour(p.quietEnd??8),timezone:'Asia/Kolkata',currency:'INR'})}

 if(action==='staff'){

  requireThat(actor.role==='Owner','Only owner can manage staff',403);requireThat(p.role in roles,'Unknown role');const before=p.id?this.get('users',p.id):null;const active=p.active!==false;if(before?.role==='Owner'&&(!active||p.role!=='Owner'))requireThat(this.all('users').some(x=>x.id!==before.id&&x.role==='Owner'&&x.active),'Cannot remove the last active owner');const data={name:text(p.name,'Staff name',120),role:p.role,active,email:String(p.email||''),department:String(p.department||'Operations')};return p.id?this.update('users',p.id,data):this.add('users',data);

 }

 if(action==='return'){

  const i=this.get('order_items',p.itemId);const previous=this.all('returns').filter(x=>x.itemId===i.id).reduce((a,x)=>a+x.qty,0),qty=integer(p.qty,'Returned eggs',1);requireThat(qty<=i.delivered-previous,'Return exceeds delivered eggs');const damaged=p.damaged!==false;const r=this.add('returns',{itemId:i.id,orderId:i.orderId,qty,damaged,status:'Recorded',reason:text(p.reason,'Return reason'),date:today()});if(!damaged)this.movement(i.productId,i.warehouseId,qty,'Verified saleable return',r.id,i.costPaise);else this.movement(i.productId,i.warehouseId,0,'Quarantined damaged return',r.id,i.costPaise);return r;

 }

 if(action==='approveCredit'){const r=this.get('returns',p.id);requireThat(!r.creditAmount,'Credit already approved');const i=this.get('order_items',r.itemId),inv=this.all('invoices').find(x=>x.orderId===i.orderId)!;const amount=integer(p.amount,'Credit amount',1);requireThat(amount<=r.qty*i.rate&&amount<=this.invoiceBalance(inv),'Credit exceeds eligible unallocated invoice balance');this.update('invoices',inv.id,{credit:(inv.credit||0)+amount});return this.update('returns',r.id,{creditAmount:amount,status:'Credit approved',approvedBy:actor.id})}

 throw new DomainError('Operation unavailable');

 }

 confirm(id:string){const o=this.get('orders',id);requireThat(o.status==='Draft','Only draft orders can be confirmed');const c=this.get('customers',o.customerId);requireThat(this.exposure(c.id)+o.amount<=c.creditLimit||o.overrideReason,'Customer credit limit exceeded');for(const i of this.all('order_items').filter(x=>x.orderId===id)){requireThat(this.stock(i.productId,i.warehouseId).available>=i.qty,'Insufficient available stock for '+this.get('products',i.productId).name);this.add('reservations',{itemId:i.id,remaining:i.qty,original:i.qty});this.movement(i.productId,i.warehouseId,0,'Reservation',o.number)}this.update('orders',id,{status:'Confirmed'});this.add('invoices',{customerId:o.customerId,orderId:id,number:`INV-${1001+this.all('invoices').length}`,amount:o.amount,credit:0,date:o.date,due:addDays(o.date,c.terms),status:'Finalized',businessName:this.settings().name,customerName:c.name,customerAddress:o.address,items:this.all('order_items').filter(x=>x.orderId===id),subtotal:o.subtotal,discount:o.discount,charges:o.charges,tax:o.tax});for(const t of this.all('tasks').filter(x=>x.customerId===c.id&&!['Closed','Order Created'].includes(x.status)))this.update('tasks',t.id,{status:'Order Created'});this.update('customers',c.id,{nextExpected:addDays(o.date,this.reorderInterval(c))});this.notify('order',c.id,`Order ${o.number} confirmed: ₹${(o.amount/100).toFixed(2)}. Delivery ${o.deliveryDate}.`,'order:'+id)}

 postPayment(p:any){const c=this.get('customers',p.customerId);if(p.reference)requireThat(!this.all('payments').some(x=>x.reference===p.reference&&x.method===(p.method||'Cash')&&!x.reversed),'A payment with this reference already exists',409);const pay=this.add('payments',{customerId:c.id,amount:integer(p.amount,'Payment amount',1),date:validDate(p.date||today()),method:validMethod(p.method),reference:String(p.reference||''),notes:String(p.notes||''),reversed:false});if(p.allocations)this.allocate(pay,p.allocations);else if(p.invoiceId&&p.allocate!==false){const invoice=this.get('invoices',p.invoiceId);requireThat(invoice.customerId===c.id,'Selected invoice belongs to another customer');const balance=this.invoiceBalance(invoice);requireThat(balance>0,'Selected invoice is already paid. Choose another invoice or record an advance.');this.allocate(pay,[{invoiceId:invoice.id,amount:Math.min(pay.amount,balance)}])}else if(p.allocate!==false){let left=pay.amount;const allocations:any[]=[];for(const inv of this.all('invoices').filter(x=>x.customerId===c.id).sort((a,b)=>a.date.localeCompare(b.date))){const amount=Math.min(left,this.invoiceBalance(inv));if(amount>0){allocations.push({invoiceId:inv.id,amount});left-=amount}}this.allocate(pay,allocations)}this.notify('payment',c.id,`Payment received: ₹${(pay.amount/100).toFixed(2)}. Thank you. Ref ${pay.reference||pay.id.slice(0,8)}.`,'payment:'+pay.id);return pay}

 allocate(pay:Row,allocations:any[]){requireThat(Array.isArray(allocations),'Invalid payment allocations');let used=this.all('allocations').filter(x=>x.paymentId===pay.id).reduce((a,x)=>a+x.amount,0);for(const a of allocations){const inv=this.get('invoices',a.invoiceId);requireThat(inv.customerId===pay.customerId,'Cannot allocate across customers');const amount=integer(a.amount,'Allocation amount',1);requireThat(amount<=this.invoiceBalance(inv),'Allocation exceeds invoice balance');requireThat(used+amount<=pay.amount,'Allocation exceeds payment amount');this.add('allocations',{paymentId:pay.id,invoiceId:inv.id,amount});used+=amount}}

 generateFollowups(actor:Row,force=false){const cfg=this.settings(),hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hour12:false,timeZone:'Asia/Kolkata'}).format(new Date()));const quiet=cfg.quietStart>cfg.quietEnd?(hour>=cfg.quietStart||hour<cfg.quietEnd):(hour>=cfg.quietStart&&hour<cfg.quietEnd);let created=0,queued=0;for(const c of this.all('customers').filter(x=>x.active!==false&&!x.paused)){const orders=this.all('orders').filter(o=>o.customerId===c.id&&!['Draft','Cancelled'].includes(o.status));if(orders.some(o=>!['Delivered','Closed (partial cancellation)'].includes(o.status)))continue;const last=orders.sort((a,b)=>b.date.localeCompare(a.date))[0];const due=last?addDays(last.date,this.reorderInterval(c)):c.nextExpected||today();if(due>today())continue;let t=this.all('tasks').find(x=>x.customerId===c.id&&x.eventKey==='reorder:'+due);if(!t){t=this.add('tasks',{customerId:c.id,title:'Reorder check-in',due,status:'Scheduled',assignedTo:actor.id,eventKey:'reorder:'+due});created++}if(cfg.automations.reorder&&!quiet&&c.consent&&!['Closed','Order Created','Snoozed'].includes(t.status)){const prior=this.all('messages').some(m=>m.customerId===c.id&&m.event==='reorder'&&m.date===today());if(!prior&&this.message(c.id,`Vanakkam ${c.person}, ready for fresh eggs? Reply with your tray quantity and we will arrange your next delivery.`,'reorder:'+c.id+':'+due,{event:'reorder'}))queued++}}

 return this.add('executions',{event:'reorder',created,queued,quietHours:quiet,date:today(),actorId:actor.id,status:quiet?'Tasks created; messages held for quiet hours':'Completed'})}

 snapshot(actor:Row,from='0000-01-01',to='9999-12-31'){

  const view=(m:string)=>can(actor,m);const data:any={user:actor,permissions:roles[actor.role],settings:this.settings(),today:today(),roles};

  const map:Record<string,string>={customers:'customers',suppliers:'suppliers',products:'inventory',warehouses:'inventory',drivers:'deliveries',orders:'orders',order_items:'orders',invoices:'payments',payments:'payments',allocations:'payments',purchases:'purchases',purchase_items:'purchases',receipts:'purchases',bills:'suppliers',supplier_payments:'payments',supplier_allocations:'payments',trips:'deliveries',stops:'deliveries',proofs:'deliveries',cash:'payments',returns:'inventory',expenses:'expenses',tasks:'follow-ups',campaigns:'campaigns',messages:'whatsapp',executions:'automations',audits:'staff',users:'staff',movements:'inventory',reservations:'inventory'};

  // Read dependencies are explicit. Financial postings remain restricted to finance roles.

  for(const [table,module] of Object.entries(map)){const dependency=['products','warehouses'].includes(table)&&(view('orders')||view('purchases')||view('deliveries'));const contact=table==='customers'&&(view('orders')||view('whatsapp')||view('deliveries')||view('follow-ups')||view('payments'));data[table]=view(module)||dependency||contact||(table==='invoices'&&view('orders'))||(view('reports')&&['customers','orders','order_items','invoices','payments','expenses','allocations','suppliers','bills','trips','stops','products','warehouses'].includes(table))?this.all(table):[]}

  data.stock=this.all('products').map(p=>({...p,...this.stock(p.id),costPaise:this.cost(p.id),locations:this.all('warehouses').map(w=>({...w,...this.stock(p.id,w.id)}))}));

  data.customers=data.customers.map((c:Row)=>({...c,effectiveInterval:this.reorderInterval(c)}));data.invoices=data.invoices.map((i:Row)=>({...i,paid:this.invoicePaid(i.id),balance:this.invoiceBalance(i)}));data.bills=data.bills.map((b:Row)=>({...b,balance:this.supplierBalance(b)}));

  const inRange=(x:Row)=>x.date>=from&&x.date<=to;const orders=this.all('orders').filter(o=>!['Draft','Cancelled'].includes(o.status));const invoices=this.all('invoices');const selected=invoices.filter(inRange);const payments=this.all('payments').filter(p=>!p.reversed&&inRange(p));const expenses=this.all('expenses').filter(inRange);const sales=selected.reduce((a,i)=>a+i.amount-(i.credit||0),0);const cogs=selected.reduce((a,inv)=>a+this.all('order_items').filter(i=>i.orderId===inv.orderId).reduce((sum:number,i:Row)=>sum+(i.qty-i.cancelled-this.all('returns').filter(r=>r.itemId===i.id&&!r.damaged).reduce((n,r)=>n+r.qty,0))*i.costPaise,0),0);const financial=view('payments')||view('reports');

  data.metrics={booked:orders.filter(inRange).reduce((a,o)=>a+o.amount,0),sales:financial?sales:null,collected:financial?payments.reduce((a,p)=>a+p.amount,0):null,outstanding:financial?invoices.reduce((a,i)=>a+this.invoiceBalance(i),0):null,payable:financial?this.all('bills').reduce((a,b)=>a+this.supplierBalance(b),0):null,orders:orders.filter(inRange).length,awaiting:orders.filter(o=>o.status==='Confirmed'||o.status==='Partially dispatched').length,available:data.stock.reduce((a:number,p:Row)=>a+p.available,0),reserved:data.stock.reduce((a:number,p:Row)=>a+p.reserved,0),delivered:this.all('stops').filter(s=>s.status==='Delivered'&&this.get('trips',s.tripId).date>=from&&this.get('trips',s.tripId).date<=to).length,trips:this.all('trips').filter(inRange).length,expenses:financial?expenses.reduce((a,e)=>a+e.amount,0):null,gross:financial?sales-cogs:null,profit:financial?sales-cogs-expenses.reduce((a,e)=>a+e.amount,0):null,lowStock:data.stock.filter((p:Row)=>p.available<p.reorder).length,followups:this.all('tasks').filter(t=>t.due<=today()&&!['Closed','Order Created','Contacted','Replied'].includes(t.status)).length};

  const end=to==='9999-12-31'?today():to;const start=from==='0000-01-01'?addDays(end,-6):from;const span=Math.max(1,Math.min(3660,Math.floor((Date.parse(end)-Date.parse(start))/86400000)+1));const size=Math.ceil(span/7),buckets=Math.ceil(span/size);
  data.trend=Array.from({length:buckets},(_,n)=>{const first=addDays(start,n*size),last=addDays(start,Math.min(span-1,(n+1)*size-1));return {id:first,date:last,from:first,sales:financial?invoices.filter(i=>i.date>=first&&i.date<=last).reduce((a,i)=>a+i.amount-(i.credit||0),0):0,collections:financial?this.all('payments').filter(p=>p.date>=first&&p.date<=last&&!p.reversed).reduce((a,p)=>a+p.amount,0):0}});const productTotals=this.all('products').map(p=>({id:p.id,name:p.name,qty:0,amount:0}));for(const inv of selected){const lines=this.all('order_items').filter(i=>i.orderId===inv.orderId&&i.qty>i.cancelled);const base=lines.reduce((n,i)=>n+(i.qty-i.cancelled)*i.rate,0);let remaining=inv.amount-(inv.credit||0);for(const [index,i] of lines.entries()){const group=productTotals.find(p=>p.id===i.productId)!;const part=index===lines.length-1?remaining:Math.round((inv.amount-(inv.credit||0))*(i.qty-i.cancelled)*i.rate/base);group.amount+=part;group.qty+=i.qty-i.cancelled;remaining-=part;}}
  data.reportRows={customers:this.all('customers').map(c=>({id:c.id,name:c.name,area:c.area,orders:selected.filter(i=>i.customerId===c.id).length,amount:selected.filter(i=>i.customerId===c.id).reduce((n,i)=>n+i.amount-(i.credit||0),0)})),products:productTotals,areas:[...new Set(this.all('customers').map(c=>c.area))].map(area=>({id:area,name:area,amount:selected.filter(i=>this.get('customers',i.customerId).area===area).reduce((n,i)=>n+i.amount-(i.credit||0),0)})),aging:invoices.filter(i=>this.invoiceBalance(i)>0).map(i=>({id:i.id,name:this.get('customers',i.customerId).name,amount:this.invoiceBalance(i),days:Math.max(0,Math.floor((Date.parse(today())-Date.parse(i.due))/86400000))}))};if(!financial)delete data.reportRows;return data;

 }

}

export function validDate(v:any){requireThat(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Invalid calendar date');return v}

function validMethod(v:any){requireThat(['Cash','UPI','Bank','Cheque','Other'].includes(v||'Cash'),'Invalid payment method');return v||'Cash'}



function boundedHour(v:any){const n=integer(v,'Quiet hour');requireThat(n<=23,'Quiet hour must be 0–23');return n}

