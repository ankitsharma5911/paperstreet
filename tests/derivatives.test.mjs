import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,placeOrder,cancelOrder,buyingPower,portfolio,validState,settleExpiry,settleOrders} from '../public/terminal/engine.js';
import {marketOpen,executableQuote,availableToClose} from '../public/terminal/derivatives.js';
const now=Date.parse('2026-10-20T10:00:00+05:30');
const c=(kind='FUT')=>({id:'NFO:TEST'+kind,symbol:'NFO:TEST'+kind,tradingSymbol:'TEST'+kind,kind,underlying:'NIFTY',lotSize:25,tickSize:5,strike:kind==='FUT'?0:2500000,expiry:'2026-10-27'});
function account(kind='FUT'){const s=createState();const contract=c(kind);s.contracts[contract.id]=contract;s.quotes[contract.id]=kind==='FUT'?2500000:15000;s.spots.NIFTY=2500000;return s;}
const trade=(s,opts={})=>placeOrder(s,{symbol:Object.keys(s.contracts)[0],side:'buy',type:'market',qty:25,...opts},now);
test('futures margin, long and short P&L use notional units without debiting full notional',()=>{
  for(const side of ['buy','sell']){let s=trade(account(),{side});assert.equal(s.cash,100000000);assert.equal(buyingPower(s),87500000);assert.equal(s.derivatives[c().id].qty,side==='buy'?25:-25);s.quotes[c().id]+=10000;assert.equal(portfolio(s).totalReturn,side==='buy'?250000:-250000);s=trade(s,{side:side==='buy'?'sell':'buy',reduceOnly:true});assert.deepEqual(s.derivatives,{});assert.equal(s.cash,side==='buy'?100250000:99750000);assert.equal(s.realized,portfolio(s).totalReturn);assert.ok(validState(s));}
});
test('long and short options account for premium, liability and collateral',()=>{
  for(const side of ['buy','sell']){let s=trade(account('CE'),{side});assert.equal(s.cash,side==='buy'?99625000:100375000);assert.equal(portfolio(s).totalReturn,0);s.quotes[c('CE').id]+=1000;s=trade(s,{side:side==='buy'?'sell':'buy',reduceOnly:true});assert.equal(s.realized,side==='buy'?25000:-25000);assert.equal(s.cash,100000000+s.realized);assert.ok(validState(s));}
});
test('F&O rejects odd lots, tick violations and insufficient margin',()=>{
  const s=account();assert.throws(()=>trade(s,{qty:24}),/whole number of lots/);assert.throws(()=>trade(s,{qty:250}),/buying power/);assert.throws(()=>trade(s,{type:'limit',limit:2499999}),/price tick/);
});
test('F&O limits reserve estimated margin and cannot spend it twice',()=>{
  let s=trade(account(),{type:'limit',limit:2400000,qty:175});assert.equal(s.orders[0].status,'open');assert.equal(buyingPower(s),16000000);assert.throws(()=>trade(s,{qty:50}),/buying power/);s=cancelOrder(s,s.orders[0].id);assert.equal(buyingPower(s),100000000);
});
test('close-only limits reserve position units and cannot reverse the position',()=>{
  let s=trade(account(),{qty:75});s=trade(s,{side:'sell',type:'limit',limit:2600000,qty:50,reduceOnly:true});assert.equal(availableToClose(s,c().id),25);assert.throws(()=>trade(s,{side:'sell',qty:50,reduceOnly:true}),/unreserved/);assert.throws(()=>trade(s,{side:'sell',qty:25}),/Close position/);s=trade(s,{side:'sell',qty:25,reduceOnly:true});s.quotes[c().id]=2600000;s=settleOrders(s);assert.deepEqual(s.derivatives,{});assert.ok(validState(s));
});
test('manual expiry settlement supports worthless options and frees all collateral',()=>{
  const after=Date.parse('2026-10-28T10:00:00+05:30');
  for(const side of ['buy','sell']){let s=trade(account('CE'),{side});s=settleExpiry(s,c('CE').id,2400000,after);assert.deepEqual(s.derivatives,{});assert.equal(s.orders[0].price,0);assert.equal(s.orders[0].source,'manual-expiry-settlement');assert.equal(s.realized,side==='buy'?-375000:375000);assert.ok(validState(s));}
});
test('futures expiry cash settlement records actual P&L rather than notional proceeds',()=>{let s=trade(account());s=settleExpiry(s,c().id,2510000,Date.parse('2026-10-28'));assert.equal(s.cash,100250000);assert.equal(s.realized,250000);assert.ok(validState(s));});
test('pending equity buys cannot consume collateral after a futures loss',()=>{let s=trade(account(),{qty:100});s=placeOrder(s,{symbol:'RELIANCE',side:'buy',type:'limit',qty:400,limit:100000},now);s.quotes[c().id]=2000000;s.quotes.RELIANCE=90000;s=settleOrders(s);assert.equal(s.orders[0].status,'cancelled');assert.equal(s.positions.RELIANCE,undefined);assert.ok(validState(s));});
test('live orders require current exchange timestamps and market hours',()=>{
  assert.equal(marketOpen(now),true);assert.equal(marketOpen(Date.parse('2026-10-20T20:00:00+05:30')),false);assert.equal(marketOpen(Date.parse('2026-10-24T10:00:00+05:30')),false);
  assert.equal(executableQuote({price:100,receivedAt:now,exchangeAt:now-300000},now),false);
  const s=createState(now,'live');s.quotes.RELIANCE=100000;s.quoteMeta.RELIANCE={price:100000,receivedAt:now,exchangeAt:now};assert.equal(placeOrder(s,{symbol:'RELIANCE',side:'buy',type:'market',qty:1},now).positions.RELIANCE.qty,1);assert.throws(()=>placeOrder(s,{symbol:'RELIANCE',side:'buy',type:'market',qty:1},now+20000),/fresh exchange quote/);
});
