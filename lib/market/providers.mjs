export const UNDERLYINGS=['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY'];
export const EQUITIES=['RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','BHARTIARTL','ITC','SBIN','LT','HINDUNILVR','TATAMOTORS','SUNPHARMA','AXISBANK','MARUTI','WIPRO','TITAN'];
export const INDEX_KEYS={NIFTY:'NSE:NIFTY 50',BANKNIFTY:'NSE:NIFTY BANK',FINNIFTY:'NSE:NIFTY FIN SERVICE',MIDCPNIFTY:'NSE:NIFTY MID SELECT',SENSEX:'BSE:SENSEX'};
export class BrokerError extends Error{constructor(message,status=502){super(message);this.status=status;}}
const paise=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Math.round(Number(value)*100):null;
export function exchangeTime(value){if(typeof value==='number')return value<1e12?value*1000:value;if(!value)return null;const date=String(value);const time=Date.parse(/Z$|[+-]\d\d:\d\d$/.test(date)?date:date.replace(' ','T')+'+05:30');return Number.isFinite(time)?time:null;}
export async function brokerRequest(url,{headers={},fetcher=fetch,accept='application/json'}={}){
  let response;try{response=await fetcher(url,{headers:{Accept:accept,...headers},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new BrokerError('The broker could not be reached. Quotes and paper fills are paused.');}
  if(response.status===401||response.status===403)throw new BrokerError('The broker rejected this session. Update your daily token or check market-data access.',401);
  if(response.status===429)throw new BrokerError('Broker rate limit reached. Wait a moment before refreshing.',429);
  if(!response.ok)throw new BrokerError('The broker returned an error. No simulated quotes have been substituted.');
  if(accept==='text/csv')return response;
  let body;try{body=await response.json();}catch{throw new BrokerError('The broker returned an unexpected response. The web session may be unsupported or blocked.');}
  if(!['success','SUCCESS'].includes(body.status))throw new BrokerError('The broker did not accept the request. Check your token and data subscription.',401);
  return body;
}
export function auth(session){return session.provider==='groww'?{'Authorization':'Bearer '+session.token,'X-API-VERSION':'1.0'}:{'Authorization':session.provider==='zerodha-web'?'enctoken '+session.token:'token '+session.apiKey+':'+session.token,'X-Kite-Version':'3'};}
function kiteRoot(session){return session.provider==='zerodha-web'?'https://kite.zerodha.com/oms':'https://api.kite.trade';}
function ohlc(value){if(typeof value==='object'&&value)return value;if(typeof value!=='string')return {};try{return JSON.parse(value);}catch{const match=value.match(/close\s*:\s*([\d.]+)/);return match?{close:Number(match[1])}:{};}}
export function normalizeKiteQuotes(body,requested,receivedAt=Date.now()){
  const quotes={};for(const id of requested){const row=body.data?.[id];if(!row||paise(row.last_price)===null)continue;quotes[id]={price:paise(row.last_price),close:paise(row.ohlc?.close),volume:row.volume??null,oi:row.oi??null,exchangeAt:exchangeTime(row.last_trade_time??row.timestamp),receivedAt};}return quotes;
}
export async function fetchQuotes(session,instruments,{critical=[],fetcher=fetch,now=Date.now()}={}){
  const ids=[...new Set(instruments.map(i=>i.id))];if(!ids.length||ids.length>50)throw new BrokerError('Request between 1 and 50 instruments.',400);
  const headers=auth(session),quotes={};
  if(session.provider!=='groww'){
    const url=new URL(kiteRoot(session)+'/quote');ids.forEach(id=>url.searchParams.append('i',id));
    return {provider:session.provider,receivedAt:now,quotes:normalizeKiteQuotes(await brokerRequest(url,{headers,fetcher}),ids,now)};
  }
  const growwKey=instrument=>instrument.growwKey??instrument.id.replace(':','_');
  for(const segment of ['CASH','FNO']){
    const group=instruments.filter(i=>(i.kind==='EQ'||i.kind==='INDEX'?'CASH':'FNO')===segment);if(!group.length)continue;
    const keys=group.map(growwKey);const makeUrl=type=>{const u=new URL('https://api.groww.in/v1/live-data/'+type);u.searchParams.set('segment',segment);u.searchParams.set('exchange_symbols',keys.join(','));return u;};
    const ltp=await brokerRequest(makeUrl('ltp'),{headers,fetcher}),daily=await brokerRequest(makeUrl('ohlc'),{headers,fetcher});
    for(const item of group){const key=growwKey(item),price=paise(ltp.payload?.[key]);if(price===null)continue;quotes[item.id]={price,close:paise(ohlc(daily.payload?.[key]).close),volume:null,oi:null,exchangeAt:null,receivedAt:now};}
  }
  for(const item of instruments.filter(i=>critical.includes(i.id)).slice(0,10)){
    const u=new URL('https://api.groww.in/v1/live-data/quote');u.searchParams.set('exchange',item.exchange==='NFO'?'NSE':item.exchange);u.searchParams.set('segment',item.kind==='EQ'||item.kind==='INDEX'?'CASH':'FNO');u.searchParams.set('trading_symbol',item.tradingSymbol??item.id.split(':')[1]);
    const data=(await brokerRequest(u,{headers,fetcher})).payload;
    if(data&&paise(data.last_price)!==null)quotes[item.id]={price:paise(data.last_price),close:paise(ohlc(data.ohlc).close),volume:data.volume??null,oi:data.open_interest??null,exchangeAt:exchangeTime(data.last_trade_time),receivedAt:now};
  }
  return {provider:session.provider,receivedAt:now,quotes};
}
export async function* csvRecords(stream){
  const reader=stream.getReader(),decoder=new TextDecoder();let field='',row=[],quoted=false,quotePending=false;
  function* consume(text){for(const char of text){if(quotePending){quotePending=false;if(char==='"'){field+='"';continue;}quoted=false;}if(quoted){if(char==='"')quotePending=true;else field+=char;continue;}if(char==='"'&&field===''){quoted=true;continue;}if(char===','){row.push(field);field='';}else if(char==='\n'){row.push(field.replace(/\r$/,''));field='';yield row;row=[];}else field+=char;}}
  try{while(true){const {value,done}=await reader.read();if(done)break;yield*consume(decoder.decode(value,{stream:true}));}yield*consume(decoder.decode());if(field||row.length){row.push(field.replace(/\r$/,''));yield row;}}finally{reader.releaseLock();}
}
export function normalizeInstrument(row,provider,today){
  const groww=provider==='groww',kind=row.instrument_type,underlying=(groww?row.underlying_symbol:row.name)?.trim(),expiry=(groww?row.expiry_date:row.expiry)?.slice(0,10),tradingSymbol=(groww?row.trading_symbol:row.tradingsymbol)?.trim(),lotSize=Number(row.lot_size);
  if(!UNDERLYINGS.includes(underlying)||!['FUT','CE','PE'].includes(kind)||!expiry||expiry<today||!Number.isSafeInteger(lotSize)||lotSize<1||!tradingSymbol)return null;
  if(groww?(row.exchange!=='NSE'||row.segment!=='FNO'):row.exchange!=='NFO')return null;
  return {id:'NFO:'+tradingSymbol,symbol:'NFO:'+tradingSymbol,tradingSymbol,exchange:'NFO',kind,underlying,expiry,strike:kind==='FUT'?0:paise(groww?row.strike_price:row.strike),lotSize,tickSize:paise(row.tick_size)??5,instrumentToken:row.instrument_token??row.exchange_token,growwKey:'NSE_'+tradingSymbol,name:`${underlying} ${expiry} ${kind==='FUT'?'Futures':(groww?row.strike_price:row.strike)+' '+(kind==='CE'?'Call':'Put')}`,color:kind==='PE'?'#b478a3':'#80a971',mark:kind==='FUT'?'F':kind==='CE'?'C':'P',sector:'Derivatives',price:0,close:0,volume:'—'};
}
const catalogCache=new Map();
export async function fetchCatalog(session,{fetcher=fetch,now=Date.now(),refresh=false}={}){
  const date=new Date(now+330*60000).toISOString().slice(0,10),provider=session.provider==='groww'?'groww':'kite',cached=catalogCache.get(provider);
  if(!refresh&&cached?.date===date)return cached.items;
  const url=provider==='groww'?'https://growwapi-assets.groww.in/instruments/instrument.csv':'https://api.kite.trade/instruments/NFO';
  const response=await brokerRequest(url,{accept:'text/csv',headers:session.provider==='kite'?auth(session):{},fetcher});
  let header;const items=[];
  for await(const fields of csvRecords(response.body)){
    if(!header){header=fields.map(v=>v.replace(/^\uFEFF/,'').trim());continue;}
    const row=Object.fromEntries(header.map((key,i)=>[key,fields[i]??'']));const instrument=normalizeInstrument(row,provider,date);if(instrument)items.push(instrument);
  }
  if(!items.length)throw new BrokerError('No current index F&O contracts were returned by the broker. Try refreshing the contract list.');
  catalogCache.set(provider,{date,items});return items;
}
export function staticInstruments(){const items=EQUITIES.map(symbol=>({id:'NSE:'+symbol,kind:'EQ',exchange:'NSE',tradingSymbol:symbol}));for(const [underlying,id]of Object.entries(INDEX_KEYS))items.push({id,kind:'INDEX',exchange:id.split(':')[0],tradingSymbol:id.split(':')[1],growwKey:(underlying==='SENSEX'?'BSE_':'NSE_')+underlying});return items;}
