import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMarket} from '../lib/market/api.mjs';
import {sealSession,openSession,nextSessionExpiry} from '../lib/market/session.mjs';
import {normalizeKiteQuotes,normalizeInstrument,csvRecords,fetchQuotes} from '../lib/market/providers.mjs';
const secret='unit-test-encryption-secret-32-characters-long',now=Date.parse('2026-10-20T10:00:00+05:30');
const token='test-token-value-is-not-a-real-broker-token';
const body={status:'success',data:{'NSE:RELIANCE':{last_price:1000.05,ohlc:{close:990},last_trade_time:'2026-10-20 10:00:00',volume:1234}}};
const upstream=async()=>Response.json(body);
const options={userId:'owner',secret,now,fetcher:upstream};
const req=(action,init={})=>{const [name,...params]=action.split('&');return new Request('https://app.test/api/market/'+name+'?provider=zerodha-web'+(params.length?'&'+params.join('&'):''),{...init,headers:{Origin:'https://app.test',...init.headers}});};
test('broker session encryption is private, identity-bound and expires daily',async()=>{
  const session={userId:'owner',provider:'zerodha-web',token,expiresAt:now+60000};const sealed=await sealSession(session,secret);assert.equal(sealed.includes(token),false);assert.equal((await openSession(sealed,secret,'owner','zerodha-web',now)).token,token);assert.equal(await openSession(sealed,secret,'other-user','zerodha-web',now),null);assert.equal(await openSession(sealed,secret,'owner','groww',now),null);assert.equal(await openSession(sealed+'x',secret,'owner','zerodha-web',now),null);assert.equal(await openSession(sealed,secret,'owner','zerodha-web',now+60001),null);assert.equal(new Date(nextSessionExpiry(now)).toISOString(),'2026-10-21T00:30:00.000Z');
});
test('connection rejects anonymous or cross-site submissions',async()=>{
  assert.equal((await handleMarket(req('status'),{secret})).status,401);
  assert.equal((await handleMarket(req('connect',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),options)).status,403);
});
test('enctoken connects to the read-only Kite web quote endpoint and is never echoed',async()=>{
  let captured;
  const response=await handleMarket(req('connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}),{...options,fetcher:async(url,init)=>{captured={url:String(url),init};return Response.json(body);}});
  assert.equal(response.status,200);assert.match(captured.url,/^https:\/\/kite\.zerodha\.com\/oms\/quote\?/);assert.equal(captured.init.headers.Authorization,'enctoken '+token);assert.equal(captured.init.redirect,'error');const text=await response.text();assert.equal(text.includes(token),false);const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);assert.equal(cookie.includes(token),false);
});
test('invalid and expired broker tokens do not create a connection or leak errors',async()=>{
  const response=await handleMarket(req('connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}),{...options,fetcher:async()=>new Response(token,{status:403})});assert.equal(response.status,401);assert.equal(response.headers.get('set-cookie'),null);assert.equal((await response.text()).includes(token),false);
});
test('quotes require a session and reject symbols outside the instrument universe',async()=>{
  assert.equal((await handleMarket(req('quotes'),options)).status,401);const cookie='ps_broker_zerodha_web='+await sealSession({userId:'owner',provider:'zerodha-web',token,expiresAt:now+10000},secret);const response=await handleMarket(req('quotes&i=EVIL:SYMBOL',{headers:{Cookie:cookie}}),options);assert.equal(response.status,400);
});
test('broker quotes preserve missing values and convert India exchange timestamps and money',()=>{
  const q=normalizeKiteQuotes(body,['NSE:RELIANCE','NSE:FAKE'],now);assert.equal(q['NSE:RELIANCE'].price,100005);assert.equal(q['NSE:RELIANCE'].close,99000);assert.equal(q['NSE:RELIANCE'].exchangeAt,now);assert.equal(q['NSE:FAKE'],undefined);
});
test('Groww cash and FNO quotes use separate segments, bearer auth and exchange symbols',async()=>{
  const calls=[];const result=await fetchQuotes({provider:'groww',token},[{id:'NSE:RELIANCE',exchange:'NSE',kind:'EQ'},{id:'NFO:TESTFUT',exchange:'NFO',kind:'FUT',growwKey:'NSE_TESTFUT'}],{now,fetcher:async(url,init)=>{calls.push({url:String(url),headers:init.headers});return Response.json({status:'SUCCESS',payload:String(url).includes('/ltp')?{'NSE_RELIANCE':1000,'NSE_TESTFUT':25000}:{'NSE_RELIANCE':'{close: 990}','NSE_TESTFUT':{close:24900}}});}});assert.equal(calls.length,4);assert.ok(calls.some(c=>c.url.includes('segment=FNO')));assert.ok(calls.every(c=>c.headers.Authorization==='Bearer '+token));assert.equal(result.quotes['NFO:TESTFUT'].price,2500000);assert.equal(result.quotes['NSE:RELIANCE'].close,99000);assert.equal(result.quotes['NFO:TESTFUT'].exchangeAt,null);
});
test('streaming CSV handles quoted commas and boundaries without loading the full master',async()=>{
  const input='name,symbol\r\n"A, B",TEST\r\n"A ""quoted"" name",ABC\n';const rows=[];const stream=new ReadableStream({start(c){for(let i=0;i<input.length;i+=3)c.enqueue(new TextEncoder().encode(input.slice(i,i+3)));c.close();}});for await(const row of csvRecords(stream))rows.push(row);assert.deepEqual(rows,[['name','symbol'],['A, B','TEST'],['A "quoted" name','ABC']]);
});
test('derivative instruments use broker lot sizes and expiries, never assumed contract names',()=>{
  const row={instrument_type:'CE',name:'NIFTY',expiry:'2026-10-27',tradingsymbol:'NIFTY26O2725000CE',lot_size:'65',strike:'25000',tick_size:'0.05',exchange:'NFO'};const c=normalizeInstrument(row,'kite','2026-10-20');assert.equal(c.lotSize,65);assert.equal(c.strike,2500000);assert.equal(c.id,'NFO:NIFTY26O2725000CE');assert.equal(normalizeInstrument({...row,expiry:'2026-10-19'},'kite','2026-10-20'),null);assert.equal(normalizeInstrument({...row,name:'UNKNOWN'},'kite','2026-10-20'),null);
});

test('daily public instruments load for a signed-in visitor without exposing or requiring a broker token',async()=>{
  const csv='instrument_token,tradingsymbol,name,expiry,strike,tick_size,lot_size,instrument_type,exchange\n123,NIFTYTESTCE,NIFTY,2026-10-27,25000,0.05,65,CE,NFO\n';
  assert.equal((await handleMarket(req('instruments'),{secret})).status,401);
  const response=await handleMarket(req('instruments&refresh=1'),{...options,fetcher:async(url,init)=>{assert.equal(init.headers.Authorization,undefined);return new Response(csv);}});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.asOf,'2026-10-20');assert.equal(data.revision,'2026-10-20-ready');assert.equal(data.instruments[0].lotSize,65);
});

test('HTTP 400 from the web quote endpoint reports its limitation without declaring the token invalid',async()=>{
  const response=await handleMarket(req('connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}),{...options,fetcher:async()=>new Response(token,{status:400})});
  assert.equal(response.status,502);const data=await response.json();assert.match(data.error,/HTTP 400/);assert.equal(data.error.includes(token),false);assert.equal(response.headers.get('set-cookie'),null);
});
