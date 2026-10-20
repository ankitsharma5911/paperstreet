import {fetchQuotes,fetchCatalog} from '../lib/market/providers.mjs';
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
  const {token}=await readSecretInput();if(typeof token!=='string'||token.length<16)throw new Error('A current session token is required.');
  const session={provider:'zerodha-web',token:token.trim()};
  const fetcher=async(url,init)=>{const response=await fetch(url,init);const diagnostic={endpoint:new URL(url).origin+new URL(url).pathname,status:response.status,contentType:response.headers.get('content-type')};if(!response.ok){try{const body=await response.clone().json();diagnostic.errorType=String(body.error_type??'').slice(0,80);diagnostic.message=String(body.message??'').replaceAll(token,'[redacted]').slice(0,300);}catch{}}console.log(JSON.stringify(diagnostic));return response;};
  const result=await fetchQuotes(session,[{id:'NSE:RELIANCE',exchange:'NSE',kind:'EQ',tradingSymbol:'RELIANCE'}],{fetcher});
  const instruments=await fetchCatalog(session,{refresh:true});
  console.log(JSON.stringify({authenticated:!!result.quotes['NSE:RELIANCE'],quoteCount:Object.keys(result.quotes).length,quoteReceivedAt:new Date(result.receivedAt).toISOString(),exchangeTimestamp:result.quotes['NSE:RELIANCE']?.exchangeAt?new Date(result.quotes['NSE:RELIANCE'].exchangeAt).toISOString():null,instrumentCount:instruments.length,underlyings:[...new Set(instruments.map(i=>i.underlying))],expiries:[...new Set(instruments.map(i=>i.expiry))].sort().slice(0,3)}));
}catch(error){console.error(JSON.stringify({authenticated:false,error:error.message}));process.exitCode=1;}
