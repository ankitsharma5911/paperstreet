import {BrokerError,brokerRequest,exchangeTime,fetchCatalogSnapshot} from './providers.mjs';
export const INTERVALS={minute:60000,'3minute':180000,'5minute':300000,'10minute':600000,'15minute':900000,'30minute':1800000,'60minute':3600000,day:86400000};
export const istDate=now=>new Date(now+330*60000).toISOString().slice(0,10);
const validDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
const paise=n=>Number.isFinite(Number(n))&&n!==null&&Number(n)>=0?Math.round(Number(n)*100):null;
export function normalizeCandles(rows,interval,now){
  if(!Array.isArray(rows))throw new BrokerError('Zerodha returned an invalid candle response.');
  const result=new Map();
  for(const row of rows){
    if(!Array.isArray(row)||row.length<6)continue;
    const at=exchangeTime(row[0]),prices=row.slice(1,5).map(paise);
    if(!Number.isFinite(at)||prices.some(p=>p===null)||prices[1]<Math.max(prices[0],prices[2],prices[3])||prices[2]>Math.min(prices[0],prices[1],prices[3]))continue;
    const endAt=interval==='day'?Date.parse(istDate(at)+'T15:30:00+05:30'):at+INTERVALS[interval];
    if(endAt>now)continue; // Never execute at or chart an unfinished/future candle as a close.
    result.set(at,{at,endAt,open:prices[0],high:prices[1],low:prices[2],close:prices[3],volume:Number.isFinite(Number(row[5]))?Number(row[5]):null,oi:row[6]!==undefined&&Number.isFinite(Number(row[6]))?Number(row[6]):null});
  }
  return [...result.values()].sort((a,b)=>a.at-b.at);
}
export async function resolveZerodhaInstruments(session,ids,options){
  const master=await fetchCatalogSnapshot(session,options),all=new Map([...master.cashInstruments,...master.instruments].map(i=>[i.id,i]));
  return ids.map(id=>all.get(id)??null);
}
export async function fetchHistorical(session,instrument,{interval='minute',from,to,fetcher=fetch,now=Date.now()}={}){
  if(session.provider!=='zerodha-web'||!session.token||!/^[A-Z0-9]{3,16}$/i.test(session.brokerUserId??''))throw new BrokerError('Enter your Kite user ID and daily enctoken in Data connections.',401);
  if(!Object.hasOwn(INTERVALS,interval))throw new BrokerError('Choose a supported candle interval.',400);
  from??=istDate(now-(interval==='day'?365:7)*86400000);to??=istDate(now);
  if(!validDate(from)||!validDate(to)||from>to||to>istDate(now)||(Date.parse(to)-Date.parse(from))/86400000>(interval==='day'?2000:30))throw new BrokerError('Use valid dates through today, with at most 2,000 days for daily candles or 30 days for intraday candles.',400);
  if(!instrument||!/^\d+$/.test(String(instrument.instrumentToken??''))||Number(instrument.instrumentToken)<1)throw new BrokerError('This symbol has no token in today’s Zerodha instrument file.',400);
  const url=new URL('https://kite.zerodha.com/oms/instruments/historical/'+instrument.instrumentToken+'/'+interval);
  for(const[k,v]of Object.entries({user_id:session.brokerUserId,oi:'1',from:from+' 00:00:00',to:to===istDate(now)?new Date(now+330*60000).toISOString().slice(0,19).replace('T',' '):to+' 23:59:59'}))url.searchParams.set(k,v);
  const body=await brokerRequest(url,{fetcher,headers:{Authorization:'enctoken '+session.token,Cookie:'enctoken='+session.token}});
  return {provider:'zerodha-web',source:'zerodha-history',id:instrument.id,instrumentToken:String(instrument.instrumentToken),interval,from,to,receivedAt:now,candles:normalizeCandles(body.data?.candles,interval,now)};
}

export function createCandleFeed(){
  const cache=new Map(),pending=new Map();
  return async function(session,instruments,{fetcher=fetch,now=Date.now()}={}){
    if(instruments.length>16)throw new BrokerError('Request at most 16 symbols per candle-feed update.',400);
    const mapped=await resolveZerodhaInstruments(session,instruments.map(i=>i.id),{fetcher,now}),quotes={},warnings={};
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(session.brokerUserId+':'+session.token));const account=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    for(let index=0;index<instruments.length;index++){
      const id=instruments[index].id,instrument=mapped[index];if(!instrument){warnings[id]='Not listed in today’s Zerodha instrument file.';continue;}
      const key=account+'/'+instrument.instrumentToken+'/'+Math.floor(now/60000);
      try{
        let data=cache.get(key);
        if(!data){
          let task=pending.get(key);
          if(!task){task=(async()=>{const result=await fetchHistorical(session,instrument,{fetcher,now});if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(key,result);return result;})();pending.set(key,task);}
          try{data=await task;}finally{pending.delete(key);}
        }
        const latest=data.candles.at(-1);if(!latest){warnings[id]='No completed minute candles returned.';continue;}
        const previous=data.candles.filter(c=>istDate(c.at)<istDate(latest.at)).at(-1);
        quotes[id]={price:latest.close,close:previous?.close??null,volume:latest.volume,oi:latest.oi,exchangeAt:null,receivedAt:now,fetchedAt:data.receivedAt,source:'zerodha-history',pricing:'completed-minute-close',candleAt:latest.at,candleEndAt:latest.endAt,instrumentToken:data.instrumentToken,candles:data.candles.slice(-180).map(c=>({at:c.endAt,price:c.close}))};
      }catch(error){if(error.status===401||error.status===429)throw error;warnings[id]=error instanceof BrokerError?error.message:'Candle data is temporarily unavailable.';}
    }
    if(!Object.keys(quotes).length)throw new BrokerError('No completed minute candles could be loaded. Check your Kite user ID, token and the current instrument file.');
    return {provider:'zerodha-web',source:'zerodha-history',pricing:'completed-minute-close',receivedAt:now,quotes,warnings};
  };
}
export const fetchCandleQuotes=createCandleFeed();
