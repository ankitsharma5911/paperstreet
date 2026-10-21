import {instrumentDay} from './instruments.js';

// ponytail: approximate largest NSE companies by market cap; the instrument file has no market cap. Re-order occasionally, or swap for a market-cap feed if one is added.
const LARGE_CAPS=['RELIANCE','HDFCBANK','BHARTIARTL','TCS','ICICIBANK','SBIN','INFY','BAJFINANCE','HINDUNILVR','LICI','LT','ITC','MARUTI','HCLTECH','M&M','SUNPHARMA','KOTAKBANK','AXISBANK','ULTRACEMCO','BAJAJFINSV','NTPC','HAL','TITAN','ADANIPORTS','ONGC','DMART','BEL','POWERGRID','ADANIENT','WIPRO','JSWSTEEL','BAJAJ-AUTO','COALINDIA','ETERNAL','TMPV','NESTLEIND','ASIANPAINT','TATASTEEL','IOC','TRENT','VEDL','HINDZINC','SBILIFE','GRASIM','DLF','JIOFIN','EICHERMOT','TECHM','HDFCLIFE','INDIGO','HINDALCO','SHRIRAMFIN','CIPLA','DRREDDY','APOLLOHOSP','TATACONSUM','BRITANNIA','HEROMOTOCO','INDUSINDBK','TATAPOWER'];
const capRank=symbol=>{const i=LARGE_CAPS.indexOf(symbol);return i<0?LARGE_CAPS.length:i;};
// Zerodha suffixes non-EQ series (bonds -N0, SME -SM, trade-to-trade -BE, gold bonds -GB) with two characters.
const seriesRank=symbol=>/-[A-Z0-9]{2}$/.test(symbol)?1:0;
export function matchStocks(stocks,query=''){
  const clean=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean).map(clean);
  return stocks.filter(s=>terms.every(t=>clean(s.symbol+' '+s.name).includes(t))).sort((a,b)=>{
    const q=clean(query),rank=s=>clean(s.symbol)===q?0:clean(s.symbol).startsWith(q)?1:2;
    return rank(a)-rank(b)||capRank(a.symbol)-capRank(b.symbol)||seriesRank(a.symbol)-seriesRank(b.symbol)||a.symbol.localeCompare(b.symbol);
  });
}
export function equityListed(state,symbol,now=Date.now()){
  return state.equityRevision===instrumentDay(now).revision&&state.equities?.[symbol]?.listed===true;
}
export function reconcileEquities(state,instruments,revision){
  const next=structuredClone(state),prior=state.equities??{},listed=new Map(instruments.filter(i=>i.kind==='EQ').map(i=>[i.symbol,i])),current={};
  const referenced=new Set([...Object.keys(state.positions),...state.watchlist,...state.orders.filter(o=>o.asset!=='FNO').map(o=>o.symbol)]);
  for(const symbol of referenced){const fresh=listed.get(symbol);if(fresh)current[symbol]={...fresh,listed:true};else if(prior[symbol])current[symbol]={...prior[symbol],listed:false};}
  next.equities=current;next.equityRevision=revision;
  for(const symbol of new Set([...Object.keys(prior),...Object.keys(state.quotes)])){
    if(symbol.startsWith('NFO:')||['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','SENSEX'].includes(symbol))continue;
    const fresh=listed.get(symbol),old=prior[symbol];
    if(!fresh||old&&old.instrumentToken!==fresh.instrumentToken){delete next.quoteMeta[symbol];delete next.liveSeries[symbol];}
  }
  for(const order of next.orders){
    if(order.status!=='open'||order.asset==='FNO')continue;
    const fresh=current[order.symbol],old=prior[order.symbol];
    if(!fresh?.listed||old&&(old.instrumentToken!==fresh.instrumentToken||old.tickSize!==fresh.tickSize)){
      order.status='cancelled';order.reason='Stock missing or changed in the daily instrument file; review before placing a new order.';
    }
  }
  return next;
}
