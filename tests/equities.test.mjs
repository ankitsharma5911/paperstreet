import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCashInstrument,fetchCatalogSnapshot} from '../lib/market/providers.mjs';
import {matchStocks,reconcileEquities,equityListed} from '../public/terminal/equities.js';
import {instrumentDay} from '../public/terminal/instruments.js';
import {createState,placeOrder,validState} from '../public/terminal/engine.js';
import {createRequestGate} from '../lib/market/rate-limit.mjs';
import {sealSession,cookieName} from '../lib/market/session.mjs';
import {handleMarket} from '../lib/market/api.mjs';

const now=Date.parse('2026-10-20T10:00:30+05:30');
const row={tradingsymbol:'VEDL',name:'VEDANTA',exchange:'NSE',segment:'NSE',instrument_type:'EQ',instrument_token:'784129',tick_size:'0.05',lot_size:'1'};
const ved=normalizeCashInstrument(row);
test('NSE equities come from the master, including symbols outside the former preset list',()=>{
  assert.equal(ved.symbol,'VEDL');assert.equal(ved.name,'VEDANTA');assert.equal(ved.instrumentToken,'784129');
  for(const bad of [{exchange:'BSE'},{segment:'NFO-OPT'},{instrument_type:'CE'},{instrument_token:''},{tradingsymbol:'<script>'}])assert.equal(normalizeCashInstrument({...row,...bad}),null);
  const tata=normalizeCashInstrument({...row,tradingsymbol:'TMPV',name:'TATA MOTORS PASSENGER VEH'});
  assert.deepEqual(matchStocks([tata,ved],'ved').map(s=>s.symbol),['VEDL']);
  assert.deepEqual(matchStocks([tata,ved],'tata motors').map(s=>s.symbol),['TMPV']);
  assert.deepEqual(matchStocks([tata,ved],'TATAMOTORS'),[tata]);
  assert.deepEqual(matchStocks([tata,ved],'not listed'),[]);
});
test('new stocks trade, persist and retain positions when removed; pending orders are cancelled',()=>{
  const initial=createState(now,'live');initial.watchlist.push('VEDL');initial.equities={VEDL:ved};let state=reconcileEquities(initial,[ved],instrumentDay(now).revision);
  state.quotes.VEDL=10000;state.quoteMeta.VEDL={price:10000,receivedAt:now,exchangeAt:now};
  state=placeOrder(state,{symbol:'VEDL',side:'buy',type:'market',qty:2},now);
  state.watchlist.push('VEDL');
  assert.equal(validState(JSON.parse(JSON.stringify(state))),true);
  assert.equal(state.positions.VEDL.qty,2);
  state=placeOrder(state,{symbol:'VEDL',side:'buy',type:'limit',qty:1,limit:9000},now);
  const removed=reconcileEquities(state,[],instrumentDay(now).revision);
  assert.equal(removed.orders[0].status,'cancelled');assert.equal(removed.positions.VEDL.qty,2);assert.equal(removed.cash,state.cash);
  assert.equal(removed.quoteMeta.VEDL,undefined);assert.equal(equityListed(removed,'VEDL',now),false);
  assert.equal(validState(JSON.parse(JSON.stringify(removed))),true);
  assert.throws(()=>placeOrder(removed,{symbol:'VEDL',side:'sell',type:'market',qty:1},now),/unavailable/);
  assert.equal(equityListed(state,'VEDL',now+86400000),false);
});
test('mixed concurrent Zerodha requests never exceed three starts in a rolling second, even after a delay',async()=>{
  let time=0;const starts=[];
  const gate=createRequestGate({clock:()=>time,sleep:async ms=>{time+=ms+(starts.length===3?1200:0);}});
  await Promise.all(Array.from({length:20},(_,i)=>gate(()=>{starts.push(time);return i===4?Promise.reject(Error('upstream failure')):Promise.resolve(i);}).catch(()=>null)));
  assert.equal(starts.length,20);
  for(const start of starts)assert.ok(starts.filter(t=>t>=start&&t<start+1000).length<=3);
  assert.ok(starts.every((t,i)=>i===0||t-starts[i-1]>=400));
});
test('quote API accepts current new symbols and rejects absent old symbols before contacting historical data',async()=>{
  const master='instrument_token,tradingsymbol,name,expiry,strike,tick_size,lot_size,instrument_type,exchange,segment\n784129,VEDL,VEDANTA,,0,0.05,1,EQ,NSE,NSE\n654,NIFTYTESTFUT,NIFTY,2026-10-27,0,0.05,65,FUT,NFO,NFO-FUT\n';
  const session={provider:'zerodha-web',token:'fixture-token-only-no-secret',brokerUserId:'TEST123',userId:'tester',connectedAt:now,expiresAt:now+3600000};
  let paths=[];const fetcher=async url=>{paths.push(new URL(url).pathname);return String(url)==='https://api.kite.trade/instruments'?new Response(master):Response.json({status:'success',data:{candles:[['2026-10-20T09:59:00+0530',100,101,99,100,1000]]}});};
  await fetchCatalogSnapshot(session,{fetcher,now,refresh:true});
  const secret='test-only-encryption-secret-at-least-32-chars',cookie=cookieName(session.provider)+'='+await sealSession(session,secret);
  const request=symbol=>new Request('http://localhost/api/market/quotes?provider=zerodha-web&i='+encodeURIComponent('NSE:'+symbol),{headers:{cookie}});
  const response=await handleMarket(request('VEDL'),{userId:'tester',secret,fetcher,now});
  assert.equal(response.status,200);assert.equal((await response.json()).quotes['NSE:VEDL'].price,10000);
  assert.ok(paths.includes('/oms/instruments/historical/784129/minute'));
  const before=paths.length;
  assert.equal((await handleMarket(request('TATAMOTORS'),{userId:'tester',secret,fetcher,now})).status,400);
  assert.equal(paths.length,before);
});
