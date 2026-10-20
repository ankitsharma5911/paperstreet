import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCandles,fetchHistorical,resolveZerodhaInstruments,createCandleFeed} from '../lib/market/history.mjs';
import {exchangeTime,fetchCatalogSnapshot} from '../lib/market/providers.mjs';
import {handleMarket} from '../lib/market/api.mjs';
import {createState,placeOrder,settleOrders,validState} from '../public/terminal/engine.js';
import {executableQuote} from '../public/terminal/derivatives.js';
const now=Date.parse('2026-10-20T10:00:30+05:30'),session={provider:'zerodha-web',token:'fixture-only-no-real-token',brokerUserId:'TEST123'};
const master='instrument_token,tradingsymbol,name,expiry,strike,tick_size,lot_size,instrument_type,exchange\n789,RELIANCE,RELIANCE,,0,0.05,1,EQ,NSE\n123456,NIFTY 50,NIFTY 50,,0,0.05,1,EQ,NSE\n654,NIFTYTESTFUT,NIFTY,2026-10-27,0,0.05,65,FUT,NFO\n';
const rows=[['2026-10-19T15:29:00+0530',990,995,985,990,10,3],['2026-10-20T09:59:00+0530',1000,1005,995,1001,1234,50],['2026-10-20T10:00:00+0530',1001,1009,998,1007,700,60]];
const upstream=async url=>String(url)==='https://api.kite.trade/instruments'?new Response(master):Response.json({status:'success',data:{candles:rows}});
const secret='fixture-encryption-secret-over-32-characters';

test('Zerodha +0530 candle timestamps parse and unfinished/future candles are excluded',()=>{
  assert.equal(exchangeTime('2026-10-20T09:59:00+0530'),now-90000);
  const candles=normalizeCandles(rows,'minute',now);assert.equal(candles.length,2);assert.equal(candles.at(-1).close,100100);assert.equal(candles.at(-1).endAt,now-30000);assert.equal(candles.at(-1).oi,50);
  assert.equal(normalizeCandles([['2026-10-20T00:00:00+0530',1,2,1,2,1]],'day',now).length,0);
});

test('historical requests use the current master token, user ID, auth and cookie on the pinned read-only endpoint',async()=>{
  await fetchCatalogSnapshot(session,{fetcher:upstream,now,refresh:true});
  const mapped=await resolveZerodhaInstruments(session,['NSE:RELIANCE','NSE:NIFTY 50','NFO:NIFTYTESTFUT'],{fetcher:upstream,now});
  assert.deepEqual(mapped.map(i=>i.instrumentToken),['789','123456','654']);let captured;
  const result=await fetchHistorical(session,mapped[0],{now,fetcher:async(url,init)=>{captured={url:new URL(url),init};return upstream(url);}});
  assert.equal(captured.url.pathname,'/oms/instruments/historical/789/minute');assert.equal(captured.url.searchParams.get('user_id'),'TEST123');assert.equal(captured.url.searchParams.get('oi'),'1');assert.equal(captured.init.headers.Authorization,'enctoken '+session.token);assert.equal(captured.init.headers.Cookie,'enctoken='+session.token);assert.equal(captured.init.redirect,'error');assert.equal(result.candles.length,2);assert.equal(result.candles.at(-1).close,100100);
});

test('history rejects invalid ranges, unsupported intervals, missing user IDs and arbitrary token paths',async()=>{
  const item={id:'NSE:RELIANCE',instrumentToken:'789'};
  for(const options of [{interval:'second'},{from:'2026-02-30'},{to:'2027-01-01'},{from:'2021-01-01',interval:'minute'}])await assert.rejects(fetchHistorical(session,item,{...options,now,fetcher:upstream}));
  await assert.rejects(fetchHistorical({...session,brokerUserId:''},item,{now,fetcher:upstream}));await assert.rejects(fetchHistorical(session,{...item,instrumentToken:'../orders'},{now,fetcher:upstream}));
});

test('minute-close feed caches within a minute per credential, never labels candle time as last-trade time, and rotates on a new minute',async()=>{
  await fetchCatalogSnapshot(session,{fetcher:upstream,now,refresh:true});const feed=createCandleFeed();let calls=0;const fetcher=async url=>{calls++;return upstream(url);};
  const instrument={id:'NSE:RELIANCE'},options={fetcher,now};
  const a=await feed(session,[instrument],options),b=await feed(session,[instrument],{...options,now:now+10000});
  assert.equal(calls,1);assert.equal(a.pricing,'completed-minute-close');assert.equal(a.quotes[instrument.id].exchangeAt,null);assert.equal(a.quotes[instrument.id].candleEndAt,now-30000);assert.equal(b.quotes[instrument.id].fetchedAt,now);assert.equal(executableQuote(b.quotes[instrument.id],now+10000),true);
  await feed({...session,token:'other-fixture-token'},[instrument],options);assert.equal(calls,2);
  const next=await feed(session,[instrument],{...options,now:now+60000});assert.equal(calls,3);assert.equal(next.quotes[instrument.id].price,100700);
});

test('candle-based paper fills conserve cash, record their source, and reject stale and forming candles',()=>{
  const s=createState(now,'live'),quote={price:100100,source:'zerodha-history',pricing:'completed-minute-close',receivedAt:now,fetchedAt:now,candleAt:now-90000,candleEndAt:now-30000,exchangeAt:null};s.quotes.RELIANCE=quote.price;s.quoteMeta.RELIANCE=quote;
  const buy=placeOrder(s,{symbol:'RELIANCE',side:'buy',type:'market',qty:2},now);assert.equal(buy.orders[0].price,100100);assert.equal(buy.orders[0].source,'zerodha-candle-close');assert.equal(buy.orders[0].candleEndAt,quote.candleEndAt);assert.equal(validState(buy),true);
  for(const changed of [{candleAt:now-30000,candleEndAt:now+30000},{candleAt:now-300000,candleEndAt:now-240000},{receivedAt:now+6000},{fetchedAt:now-180000}])assert.equal(!!executableQuote({...quote,...changed},now),false);
  assert.equal(executableQuote({...quote,receivedAt:now+2000,fetchedAt:now+2000},now),true);
  assert.throws(()=>placeOrder({...s,quoteMeta:{RELIANCE:{...quote,candleAt:now-300000,candleEndAt:now-240000}}},{symbol:'RELIANCE',side:'buy',type:'market',qty:1},now),/completed one-minute/);
});

test('runtime-configured connection is limited to its owner, expires, never exposes the token, and can be disconnected',async()=>{
  const configuredZerodha={...session,ownerUserId:'owner',connectedAt:now-1000,expiresAt:now+60000},options={secret,configuredZerodha,now,userId:'owner'};
  const request=new Request('https://app.test/api/market/status');
  const owner=await handleMarket(request,options),data=await owner.json();assert.equal(data.connections['zerodha-web'].connected,true);assert.equal(JSON.stringify(data).includes(session.token),false);
  assert.equal((await(await handleMarket(request,{...options,userId:'other-user'})).json()).connections['zerodha-web'].connected,false);
  assert.equal((await(await handleMarket(request,{...options,now:now+60001})).json()).connections['zerodha-web'].connected,false);
  const disconnect=await handleMarket(new Request('https://app.test/api/market/disconnect',{method:'POST',headers:{Origin:'https://app.test'}}),options);assert.match(disconnect.headers.get('set-cookie'),/ps_broker_zerodha_web=off/);
  const off=await handleMarket(new Request(request,{headers:{Cookie:'ps_broker_zerodha_web=off'}}),options);assert.equal((await off.json()).connections['zerodha-web'].connected,false);
});

test('candle-based limits compare completed closes, not intrabar highs or lows',t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const s=createState(now,'live'),quote={price:100100,source:'zerodha-history',pricing:'completed-minute-close',receivedAt:now,fetchedAt:now,candleAt:now-90000,candleEndAt:now-30000,exchangeAt:null,high:110000,low:90000};s.quotes.RELIANCE=quote.price;s.quoteMeta.RELIANCE=quote;
  const pending=placeOrder(s,{symbol:'RELIANCE',side:'buy',type:'limit',qty:1,limit:100000},now);
  assert.equal(settleOrders(pending).orders[0].status,'open');
  pending.quotes.RELIANCE=99900;pending.quoteMeta.RELIANCE={...quote,price:99900};
  const filled=settleOrders(pending);assert.equal(filled.orders[0].status,'filled');assert.equal(filled.orders[0].price,99900);assert.equal(filled.orders[0].pricing,'completed-minute-close');assert.equal(validState(filled),true);
});
