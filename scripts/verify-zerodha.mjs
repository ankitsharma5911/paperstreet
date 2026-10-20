import {fetchQuotes,fetchCatalog} from '../lib/market/providers.mjs';
import {fetchHistorical,resolveZerodhaInstruments} from '../lib/market/history.mjs';
import {handleMarket} from '../lib/market/api.mjs';
import {createInterface} from 'node:readline';

async function readSecretInput(){
  if(!process.stdin.isTTY){const rl=createInterface({input:process.stdin});for await(const line of rl){rl.close();return JSON.parse(line);}throw new Error('Missing session input.');}
  return new Promise((resolve,reject)=>{
    let raw='';process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');
    process.stderr.write('Ready for Zerodha verification JSON on stdin (input is hidden).\n');
    const finish=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();};
    function onData(chunk){if(chunk.includes('\u0003')){finish();reject(new Error('Cancelled.'));return;}raw+=chunk;if(raw.includes('\n')||raw.includes('\r')){finish();try{resolve(JSON.parse(raw.trim()));}catch{reject(new Error('Invalid session input.'));}}}
    process.stdin.on('data',onData);process.stdin.resume();
  });
}

try{
  const {token,brokerUserId,mode}=await readSecretInput();if(typeof token!=='string'||token.length<16)throw new Error('A current session token is required.');
  if(mode==='history'){
    const url=new URL('https://kite.zerodha.com/oms/instruments/historical/256265/day');url.searchParams.set('user_id',brokerUserId);url.searchParams.set('oi','1');url.searchParams.set('from','2021-10-22');url.searchParams.set('to','2026-10-21');
    const response=await fetch(url,{headers:{Authorization:'enctoken '+token,Cookie:'enctoken='+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
    let body;try{body=await response.json();}catch{throw Error('Historical endpoint returned a non-JSON response.');}
    console.log(JSON.stringify({endpoint:'/oms/instruments/historical/256265/day',httpStatus:response.status,status:body.status,candleCount:body.data?.candles?.length??0,firstCandleAt:body.data?.candles?.[0]?.[0],lastCandleAt:body.data?.candles?.at(-1)?.[0],errorType:body.error_type,message:body.message?String(body.message).replaceAll(token,'[redacted]').slice(0,160):undefined}));
    if(!response.ok||body.status!=='success')process.exitCode=1;
  }else if(mode==='api'){
    const options={userId:'verification-owner',secret:crypto.randomUUID()+crypto.randomUUID()};
    const connected=await handleMarket(new Request('https://verification.invalid/api/market/connect',{method:'POST',headers:{Origin:'https://verification.invalid','Content-Type':'application/json'},body:JSON.stringify({token,brokerUserId})}),options);
    if(connected.status!==200)throw Error('Historical connection validation failed with status '+connected.status+'.');
    const cookie=connected.headers.get('set-cookie').split(';')[0];
    const response=await handleMarket(new Request('https://verification.invalid/api/market/quotes?i=NSE%3ANIFTY%2050&i=NSE%3ARELIANCE',{headers:{Cookie:cookie}}),options),data=await response.json();
    console.log(JSON.stringify({connectionStatus:connected.status,quoteStatus:response.status,pricing:data.pricing,symbols:Object.keys(data.quotes??{}),sessionCookieEncrypted:!cookie.includes(token),tokenInResponse:JSON.stringify(data).includes(token)}));
    if(response.status!==200)process.exitCode=1;
  }else if(mode==='fno'){
    const session={provider:'zerodha-web',token,brokerUserId},catalog=await fetchCatalog(session,{refresh:true});
    const future=catalog.filter(c=>c.underlying==='NIFTY'&&c.kind==='FUT').sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
    const option=catalog.filter(c=>c.underlying==='NIFTY'&&c.kind==='CE').sort((a,b)=>a.expiry.localeCompare(b.expiry)||Math.abs(a.strike-2300000)-Math.abs(b.strike-2300000))[0];
    const result=await fetchQuotes(session,[future,option]);console.log(JSON.stringify({authenticated:true,pricing:result.pricing,contracts:[future,option].map(c=>({id:c.id,instrumentToken:c.instrumentToken,lotSize:c.lotSize,expiry:c.expiry,candleEndAt:result.quotes[c.id]?new Date(result.quotes[c.id].candleEndAt).toISOString():null,price:result.quotes[c.id]?.price,oi:result.quotes[c.id]?.oi})),warnings:result.warnings}));
  }else if(mode==='adapter'){
    const session={provider:'zerodha-web',token,brokerUserId};
    const mapped=await resolveZerodhaInstruments(session,['NSE:NIFTY 50','NSE:RELIANCE']);
    const daily=await fetchHistorical(session,mapped[0],{interval:'day',from:'2021-10-22',to:new Date(Date.now()+330*60000).toISOString().slice(0,10)});
    const result=await fetchQuotes(session,mapped);
    console.log(JSON.stringify({authenticated:true,symbols:mapped.map(i=>({symbol:i.id,instrumentToken:i.instrumentToken})),dailyCandles:daily.candles.length,pricing:result.pricing,prices:Object.entries(result.quotes).map(([id,q])=>({id,source:q.source,candleEndAt:new Date(q.candleEndAt).toISOString(),price:q.price,oi:q.oi})),warnings:result.warnings}));
  }else{
  const session={provider:'zerodha-web',token:token.trim()};
  const fetcher=async(url,init)=>{const response=await fetch(url,init);const diagnostic={endpoint:new URL(url).origin+new URL(url).pathname,status:response.status,contentType:response.headers.get('content-type')};if(!response.ok){try{const body=await response.clone().json();diagnostic.errorType=String(body.error_type??'').slice(0,80);diagnostic.message=String(body.message??'').replaceAll(token,'[redacted]').slice(0,300);}catch{}}console.log(JSON.stringify(diagnostic));return response;};
  const result=await fetchQuotes(session,[{id:'NSE:RELIANCE',exchange:'NSE',kind:'EQ',tradingSymbol:'RELIANCE'}],{fetcher});
  const instruments=await fetchCatalog(session,{refresh:true});
  console.log(JSON.stringify({authenticated:!!result.quotes['NSE:RELIANCE'],quoteCount:Object.keys(result.quotes).length,quoteReceivedAt:new Date(result.receivedAt).toISOString(),exchangeTimestamp:result.quotes['NSE:RELIANCE']?.exchangeAt?new Date(result.quotes['NSE:RELIANCE'].exchangeAt).toISOString():null,instrumentCount:instruments.length,underlyings:[...new Set(instruments.map(i=>i.underlying))],expiries:[...new Set(instruments.map(i=>i.expiry))].sort().slice(0,3)}));
  }
}catch(error){console.error(JSON.stringify({authenticated:false,error:error.message}));process.exitCode=1;}
