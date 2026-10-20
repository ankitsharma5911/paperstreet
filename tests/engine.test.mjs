import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_FUNDS,createState,validState,placeOrder,cancelOrder,buyingPower,availableShares,portfolio,settleOrders,tick} from '../public/terminal/engine.js';
const order=(s,options={})=>placeOrder(s,{symbol:'RELIANCE',side:'buy',type:'market',qty:10,...options});
test('a new account starts with ₹10 lakh and no holdings',()=>{
  const s=createState();assert.equal(s.cash,INITIAL_FUNDS);assert.equal(portfolio(s).totalReturn,0);assert.equal(validState(s),true);
});
test('market purchases and partial sales conserve value and account for cost basis',()=>{
  const initial=createState(),bought=order(initial);
  assert.equal(initial.orders.length,0);assert.equal(bought.positions.RELIANCE.qty,10);assert.equal(portfolio(bought).equity,INITIAL_FUNDS);
  bought.quotes.RELIANCE+=101;
  const sold=order(bought,{side:'sell',qty:3});
  assert.equal(sold.positions.RELIANCE.qty,7);assert.equal(sold.realized,303);assert.equal(portfolio(sold).unrealized,707);assert.equal(portfolio(sold).totalReturn,1010);
  const exited=order(sold,{side:'sell',qty:7});assert.equal(exited.positions.RELIANCE,undefined);assert.equal(exited.cash,INITIAL_FUNDS+1010);assert.equal(exited.realized,1010);
});
test('rejects overspending, short selling, fractional quantities, invalid stock and invalid prices',()=>{
  const s=createState();
  for(const options of [{qty:100000},{side:'sell'},{qty:0},{qty:-1},{qty:1.2},{qty:NaN},{symbol:'FAKE'},{type:'limit',limit:0},{type:'limit',limit:1.25}])assert.throws(()=>order(s,options));
  assert.equal(s.orders.length,0);assert.equal(s.cash,INITIAL_FUNDS);
});
test('open buy limits reserve funds and cancellation releases the full reservation',()=>{
  let s=order(createState(),{type:'limit',limit:100000,qty:500});
  assert.equal(s.orders[0].status,'open');assert.equal(s.cash,INITIAL_FUNDS);assert.equal(buyingPower(s),INITIAL_FUNDS-50000000);
  assert.throws(()=>order(s,{type:'limit',limit:100000,qty:501}),/buying power/);
  s=cancelOrder(s,s.orders[0].id);assert.equal(buyingPower(s),INITIAL_FUNDS);assert.equal(s.orders[0].status,'cancelled');assert.throws(()=>cancelOrder(s,s.orders[0].id));
});
test('buy limits fill at a better quote, releasing excess reservations exactly once',()=>{
  let s=order(createState(),{type:'limit',limit:140000,qty:10});s.quotes.RELIANCE=139995;
  s=settleOrders(s);assert.equal(s.orders[0].price,139995);assert.equal(s.cash,INITIAL_FUNDS-1399950);assert.equal(buyingPower(s),s.cash);assert.equal(s.positions.RELIANCE.qty,10);
  assert.deepEqual(settleOrders(s),s);
});
test('sell limits reserve shares and cannot be oversold or double reserved',()=>{
  let s=order(createState());s=order(s,{side:'sell',type:'limit',qty:7,limit:160000});
  assert.equal(availableShares(s,'RELIANCE'),3);assert.throws(()=>order(s,{side:'sell',qty:4}),/available shares/);
  s=order(s,{side:'sell',qty:3});assert.equal(availableShares(s,'RELIANCE'),0);
  s.quotes.RELIANCE=161000;s=settleOrders(s);assert.equal(s.positions.RELIANCE,undefined);assert.equal(s.orders.filter(o=>o.status==='filled').length,3);assert.equal(validState(s),true);
});
test('marketable limits execute immediately at the current quote',()=>{
  const s=order(createState(),{type:'limit',limit:150000});assert.equal(s.orders[0].status,'filled');assert.equal(s.orders[0].price,144285);
});
test('repeated purchases and small partial exits leave no rounding residue',()=>{
  let s=order(createState(),{qty:3});s.quotes.RELIANCE+=1;s=order(s,{qty:4});
  for(let i=0;i<7;i++)s=order(s,{side:'sell',qty:1});
  assert.deepEqual(s.positions,{});assert.equal(s.realized,s.cash-INITIAL_FUNDS);assert.equal(validState(s),true);
});
test('simulation preserves ledger invariants and bounded prices for 1000 ticks',()=>{
  let s=order(createState());s=order(s,{type:'limit',qty:10,limit:144000});
  for(let i=0;i<1000;i++){s=tick(s);assert.equal(validState(s),true);const p=portfolio(s);assert.equal(p.totalReturn,p.unrealized+s.realized);}
});
test('invalid saved accounts are rejected',()=>{
  for(const state of [null,{}, {...createState(),cash:-1},{...createState(),quotes:{}},{...createState(),positions:{FAKE:{qty:1,cost:1}}},{...createState(),watchlist:['FAKE']}])assert.equal(validState(state),false);
});
