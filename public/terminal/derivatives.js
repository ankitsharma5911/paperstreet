export const FNO_MARGIN_RATE=.2;
export const expiryTime=contract=>Date.parse(contract.expiry+'T15:30:00+05:30');
export function marketOpen(now=Date.now()) {const d=new Date(now+330*60000),day=d.getUTCDay(),minutes=d.getUTCHours()*60+d.getUTCMinutes();return day>0&&day<6&&minutes>=555&&minutes<930;}
export function executableQuote(quote,now=Date.now()){
  if(!quote||quote.price<=0||quote.receivedAt>now+5000||now-quote.receivedAt>15000||!marketOpen(now))return false;
  if(quote.source==='zerodha-history')return quote.pricing==='completed-minute-close'&&Number.isFinite(quote.candleAt)&&quote.candleEndAt===quote.candleAt+60000&&quote.candleEndAt<=now&&now-quote.candleEndAt<=90000&&quote.fetchedAt<=now+5000&&now-quote.fetchedAt<=90000&&marketOpen(quote.candleAt);
  return quote.exchangeAt&&Math.abs(now-quote.exchangeAt)<=120000;
}
export function contractValid(c){return c&&c.id===c.symbol&&/^NFO:[A-Z0-9-]+$/.test(c.id)&&['FUT','CE','PE'].includes(c.kind)&&['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY'].includes(c.underlying)&&/^\d{4}-\d{2}-\d{2}$/.test(c.expiry)&&Number.isFinite(expiryTime(c))&&Number.isSafeInteger(c.lotSize)&&c.lotSize>0&&Number.isSafeInteger(c.strike)&&c.strike>=0;}
export const derivativesMargin=s=>Object.values(s.derivatives??{}).reduce((sum,p)=>sum+p.margin,0);
export const derivativesUnrealized=s=>Object.entries(s.derivatives??{}).reduce((sum,[id,p])=>sum+p.qty*(s.quotes[id]??Math.round(p.basis/p.qty))-p.basis,0);
export const futuresUnrealized=s=>Object.entries(s.derivatives??{}).filter(([id])=>s.contracts[id]?.kind==='FUT').reduce((sum,[id,p])=>sum+p.qty*(s.quotes[id]??Math.round(p.basis/p.qty))-p.basis,0);
export const optionsMarketValue=s=>Object.entries(s.derivatives??{}).filter(([id])=>s.contracts[id]?.kind!=='FUT').reduce((sum,[id,p])=>sum+p.qty*(s.quotes[id]??Math.round(p.basis/p.qty)),0);
export const optionsBasis=s=>Object.entries(s.derivatives??{}).filter(([id])=>s.contracts[id]?.kind!=='FUT').reduce((sum,[,p])=>sum+p.basis,0);
export function paperMargin(contract,side,qty,price,spot){
  if(contract.kind!=='FUT'&&side==='buy')return qty*price;
  const underlying=contract.kind==='FUT'?price:spot;
  if(!Number.isSafeInteger(underlying)||underlying<=0)throw new Error('A current underlying quote is required to estimate paper margin.');
  return Math.ceil(qty*underlying*FNO_MARGIN_RATE);
}
export function availableToClose(s,id){const held=s.derivatives?.[id];return Math.max(0,Math.abs(held?.qty??0)-s.orders.filter(o=>o.symbol===id&&o.status==='open'&&o.reduceOnly).reduce((sum,o)=>sum+o.qty,0));}
export function validateDerivativeOrder(s,order,availableFunds,now=Date.now()){
  const c=s.contracts?.[order.symbol];if(!contractValid(c))throw new Error('Choose a contract from the broker’s instrument list.');
  if(expiryTime(c)<=now)throw new Error('This contract has expired. New orders are disabled.');
  if(!Number.isSafeInteger(order.qty)||order.qty<1||order.qty>1_000_000||order.qty%c.lotSize!==0)throw new Error(`Quantity must be a whole number of lots (${c.lotSize} units per lot).`);
  if(order.type==='limit'&&order.limit%(c.tickSize||5)!==0)throw new Error('Limit price must follow the contract’s price tick.');
  const held=s.derivatives?.[order.symbol],direction=order.side==='buy'?1:-1;
  if(order.reduceOnly&&(!held||Math.sign(held.qty)===direction||order.qty>availableToClose(s,order.symbol)))throw new Error('The close order exceeds the unreserved open position.');
  if(!order.reduceOnly&&held&&Math.sign(held.qty)!==direction)throw new Error('Use Close position to reduce or exit this contract before opening the other direction.');
  const price=order.type==='limit'?order.limit:s.quotes[order.symbol],spot=s.spots?.[c.underlying];
  if(!Number.isSafeInteger(price)||price<=0)throw new Error('Wait for a current broker quote before trading this contract.');
  const reserve=order.reduceOnly?0:paperMargin(c,order.side,order.qty,price,spot);
  if(!order.reduceOnly&&reserve>availableFunds)throw new Error('Insufficient buying power for this paper margin or option premium.');
  return reserve;
}
export function executeDerivative(s,order,price){
  const c=s.contracts[order.symbol],held=s.derivatives?.[order.symbol],direction=order.side==='buy'?1:-1;s.derivatives??={};
  if(order.reduceOnly){
    if(!held||Math.sign(held.qty)===direction||order.qty>Math.abs(held.qty))throw new Error('The open position is no longer available to close.');
    const closedSign=Math.sign(held.qty),basis=order.qty===Math.abs(held.qty)?held.basis:Math.round(held.basis*order.qty/Math.abs(held.qty)),pnl=closedSign*order.qty*price-basis;
    if(c.kind==='FUT')s.cash+=pnl;else s.cash-=direction*order.qty*price;
    s.realized+=pnl;
    if(order.qty===Math.abs(held.qty))delete s.derivatives[order.symbol];
    else s.derivatives[order.symbol]={...held,qty:held.qty+direction*order.qty,basis:held.basis-basis,margin:Math.ceil(held.margin*(Math.abs(held.qty)-order.qty)/Math.abs(held.qty))};
  }else{
    if(held&&Math.sign(held.qty)!==direction)throw new Error('Close the existing direction first.');
    const margin=c.kind==='FUT'||direction<0?paperMargin(c,order.side,order.qty,price,s.spots?.[c.underlying]):0;
    if(c.kind!=='FUT')s.cash-=direction*order.qty*price;
    s.derivatives[order.symbol]={qty:(held?.qty??0)+direction*order.qty,basis:(held?.basis??0)+direction*order.qty*price,margin:(held?.margin??0)+margin};
  }
  order.price=price;order.status='filled';order.filledAt=Date.now();
}
export function expireDerivativeOrders(s,now=Date.now()) {for(const o of s.orders)if(o.status==='open'&&s.contracts?.[o.symbol]&&expiryTime(s.contracts[o.symbol])<=now){o.status='cancelled';o.reason='Contract expired';}return s;}
