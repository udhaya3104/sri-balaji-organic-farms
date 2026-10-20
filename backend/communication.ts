// A provider never changes business/financial records. It only records an outbox result.
export type DeliveryState='Simulated queued'|'Simulated delivered'|'Simulated read'|'Simulated failed';
export interface MessageProvider {readonly mode:'simulated'|'live';deliver(message:{id:string;body:string;recipient:string}):Promise<{status:string;providerId?:string}>}
export class SimulationProvider implements MessageProvider {
 readonly mode='simulated' as const;
 async deliver(message:{id:string;body:string;recipient:string}){return {status:'Simulated delivered',providerId:'demo:'+message.id}}
}
export class UnconfiguredOfficialProvider implements MessageProvider {
 readonly mode='live' as const;
 async deliver():Promise<{status:string}>{throw new Error('Official WhatsApp provider is not configured. Credentials, approved templates, verified webhooks and recipient eligibility checks are required.')}
}
