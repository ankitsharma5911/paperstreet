import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogLoader} from '../lib/market/providers.mjs';
import {instrumentDay,reconcileInstruments} from '../public/terminal/instruments.js';
import {createState,validState} from '../public/terminal/engine.js';

const session={provider:'zerodha-web',token:'fixture-not-a-real-token'};
const at=value=>Date.parse(value+'+05:30');
const csv=(lot=65,token=123,expiry='2026-10-27')=>'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange\n'+`${token},1,NIFTY26O2725000CE,NIFTY,100,${expiry},25000,0.05,${lot},CE,NFO-OPT,NFO\n`;

test('instrument calendar rolls at IST midnight and 08:30, not UTC midnight',()=>{
  assert.equal(instrumentDay(at('2026-10-20T23:59:59')).revision,'2026-10-20-ready');
  assert.equal(instrumentDay(at('2026-10-21T00:00:00')).revision,'2026-10-21-early');
  assert.equal(instrumentDay(at('2026-10-21T08:29:59')).nextRefreshAt,at('2026-10-21T08:30:00'));
  assert.equal(instrumentDay(at('2026-10-21T08:30:00')).revision,'2026-10-21-ready');
  assert.equal(instrumentDay(at('2026-10-21T08:30:00')).nextRefreshAt,at('2026-10-22T00:00:00'));
});

test('daily master download is combined, cached and refreshed with current broker metadata',async()=>{
  const load=createCatalogLoader();let calls=0;
  const fetcher=async(url,init)=>{assert.equal(String(url),'https://api.kite.trade/instruments');assert.equal(init.headers.Authorization,undefined);calls++;await new Promise(r=>setTimeout(r,5));return new Response(csv(calls===1?65:75,calls));};
  const options={fetcher,now:at('2026-10-20T10:00:00')};
  const [a,b]=await Promise.all([load(session,options),load(session,options)]);assert.equal(calls,1);assert.equal(a,b);assert.equal(a.instruments[0].lotSize,65);assert.equal(a.asOf,'2026-10-20');
  await load(session,{...options,now:at('2026-10-20T23:59:59')});assert.equal(calls,1);
  const next=await load(session,{...options,now:at('2026-10-21T00:00:00')});assert.equal(calls,2);assert.equal(next.instruments[0].lotSize,75);assert.equal(next.instruments[0].instrumentToken,'2');
  await load(session,{...options,now:at('2026-10-21T08:30:00')});assert.equal(calls,3);
  await load(session,{...options,now:at('2026-10-21T10:00:00'),refresh:true});assert.equal(calls,4);
});

test('a failed new-day download never serves yesterday and can be retried',async()=>{
  const load=createCatalogLoader();await load(session,{now:at('2026-10-20T10:00:00'),fetcher:async()=>new Response(csv())});
  await assert.rejects(load(session,{now:at('2026-10-21T10:00:00'),fetcher:async()=>new Response('unavailable',{status:503})}));
  const fresh=await load(session,{now:at('2026-10-21T10:00:00'),fetcher:async()=>new Response(csv(75,456))});assert.equal(fresh.asOf,'2026-10-21');assert.equal(fresh.instruments[0].lotSize,75);
});

test('public metadata cache survives a new loader and never stores broker credentials',async()=>{
  const entries=new Map(),cache={match:async key=>entries.get(key.url)?.clone(),put:async(key,value)=>entries.set(key.url,value)};
  const options={cache,now:at('2026-10-20T10:00:00'),fetcher:async()=>new Response(csv())};
  await createCatalogLoader()(session,options);
  const snapshot=await createCatalogLoader()(session,{...options,fetcher:async()=>{throw Error('must use cache');}});
  assert.equal(snapshot.instruments.length,1);assert.equal(JSON.stringify(snapshot).includes(session.token),false);assert.equal(entries.size,1);
});

test('daily metadata changes cancel pending orders while preserving account history and units',async()=>{
  const snapshot=await createCatalogLoader()(session,{now:at('2026-10-20T10:00:00'),fetcher:async()=>new Response(csv())});
  const c=snapshot.instruments[0],s=createState(Date.now(),'live');s.contracts[c.id]=c;
  s.orders=[{id:'pending',symbol:c.id,side:'buy',type:'limit',qty:65,limit:1,status:'open',asset:'FNO',createdAt:Date.now()}];
  const next=reconcileInstruments(s,[{...c,lotSize:75,instrumentToken:'789'}]);assert.equal(next.orders[0].status,'cancelled');assert.equal(next.contracts[c.id].lotSize,75);assert.equal(next.cash,s.cash);assert.equal(validState(next),true);assert.equal(s.orders[0].status,'open');
  const removed=reconcileInstruments(s,[]);assert.equal(removed.orders[0].status,'cancelled');assert.equal(removed.contracts[c.id].id,c.id);
  s.derivatives[c.id]={qty:65,basis:650000,margin:0};s.cash-=650000;
  const conflict=reconcileInstruments(s,[{...c,lotSize:75}]);assert.equal(conflict.derivatives[c.id].qty,65);assert.equal(conflict.contracts[c.id].metadataConflict,true);assert.equal(validState(conflict),true);
});
