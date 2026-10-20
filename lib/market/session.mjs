const encoder=new TextEncoder(),decoder=new TextDecoder();
export const PROVIDERS=['zerodha-web','kite','groww'];
export const cookieName=provider=>'ps_broker_'+provider.replaceAll('-','_');
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const bytes=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function key(secret){if(!secret||secret.length<32)throw new Error('Secure broker sessions are not configured on the server.');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(secret)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export function nextSessionExpiry(now=Date.now()) {
  const shifted=new Date(now+330*60000),date=shifted.toISOString().slice(0,10);
  let expiry=Date.parse(date+'T06:00:00+05:30');if(expiry<=now)expiry+=86400000;return expiry;
}
export async function sealSession(session,secret){const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('paperstreet-broker-v1')},await key(secret),encoder.encode(JSON.stringify(session)));return b64(iv)+'.'+b64(new Uint8Array(ciphertext));}
export async function openSession(value,secret,userId,provider,now=Date.now()){
  if(!value)return null;
  try{const [iv,data]=value.split('.');const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:encoder.encode('paperstreet-broker-v1')},await key(secret),bytes(data));const session=JSON.parse(decoder.decode(raw));return session.userId===userId&&session.provider===provider&&session.expiresAt>now?session:null;}catch{return null;}
}
export function requestCookie(request,name){const item=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));return item?.slice(name.length+1)??null;}
export function sessionCookie(provider,value,expiresAt,secure=true){return `${cookieName(provider)}=${value}; Path=/api/market; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((expiresAt-Date.now())/1000))}${secure?'; Secure':''}`;}
