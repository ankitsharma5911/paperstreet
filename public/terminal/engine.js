import {derivativesMargin,futuresUnrealized,optionsMarketValue,optionsBasis,derivativesUnrealized,contractValid,validateDerivativeOrder,executeDerivative,expireDerivativeOrders,executableQuote,paperMargin,expiryTime} from './derivatives.js';
export const INITIAL_FUNDS = 100_000_000; // All money is stored as integer paise.
export const STOCKS = [
  {symbol:'RELIANCE',name:'Reliance Industries',sector:'Energy',price:144285,close:142010,color:'#3f72c9',mark:'R',volume:'82.4L'},
  {symbol:'TCS',name:'Tata Consultancy Services',sector:'Technology',price:342860,close:339420,color:'#8868cd',mark:'T',volume:'24.6L'},
  {symbol:'HDFCBANK',name:'HDFC Bank',sector:'Banking',price:173820,close:174955,color:'#426bac',mark:'H',volume:'96.2L'},
  {symbol:'INFY',name:'Infosys',sector:'Technology',price:158465,close:155820,color:'#5085a2',mark:'I',volume:'51.8L'},
  {symbol:'ICICIBANK',name:'ICICI Bank',sector:'Banking',price:128645,close:127310,color:'#b78443',mark:'I',volume:'68.1L'},
  {symbol:'BHARTIARTL',name:'Bharti Airtel',sector:'Telecom',price:187450,close:188920,color:'#c85b69',mark:'a',volume:'36.7L'},
  {symbol:'ITC',name:'ITC Limited',sector:'Consumer',price:42135,close:41680,color:'#4a779e',mark:'I',volume:'73.6L'},
  {symbol:'SBIN',name:'State Bank of India',sector:'Banking',price:81270,close:79960,color:'#3d96aa',mark:'S',volume:'112.5L'},
  {symbol:'LT',name:'Larsen & Toubro',sector:'Industrials',price:361240,close:364180,color:'#6c86ad',mark:'L',volume:'18.9L'},
  {symbol:'HINDUNILVR',name:'Hindustan Unilever',sector:'Consumer',price:246730,close:245210,color:'#6a71ad',mark:'U',volume:'15.2L'},
  {symbol:'TATAMOTORS',name:'Tata Motors',sector:'Automotive',price:72460,close:70620,color:'#4e92ba',mark:'T',volume:'124.3L'},
  {symbol:'SUNPHARMA',name:'Sun Pharmaceutical',sector:'Healthcare',price:174235,close:176380,color:'#b97f4e',mark:'S',volume:'21.6L'},
  {symbol:'AXISBANK',name:'Axis Bank',sector:'Banking',price:118460,close:116910,color:'#ad567c',mark:'A',volume:'44.7L'},
  {symbol:'MARUTI',name:'Maruti Suzuki',sector:'Automotive',price:1258420,close:1241200,color:'#5b87b4',mark:'M',volume:'6.8L'},
  {symbol:'WIPRO',name:'Wipro',sector:'Technology',price:26785,close:27140,color:'#9374b0',mark:'W',volume:'63.2L'},
  {symbol:'TITAN',name:'Titan Company',sector:'Consumer',price:332840,close:328950,color:'#568e95',mark:'T',volume:'12.4L'}
];
export const stockBySymbol = symbol => STOCKS.find(s => s.symbol === symbol);
export function createState(now = Date.now(),mode='simulation') {
  return {version:1,mode,initial:INITIAL_FUNDS,cash:INITIAL_FUNDS,realized:0,positions:{},derivatives:{},contracts:{},spots:{},quoteMeta:{},liveSeries:{},orders:[],watchlist:['RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK'],quotes:mode==='live'?{}:Object.fromEntries(STOCKS.map(s=>[s.symbol,s.price])),seed:243769,createdAt:now,updatedAt:now};
}
export function validState(s) {
  if (!s || s.version!==1 || s.initial!==INITIAL_FUNDS || !Number.isSafeInteger(s.cash) || !Number.isSafeInteger(s.realized) || !s.positions || typeof s.positions!=='object' || !Array.isArray(s.orders) || !Array.isArray(s.watchlist) || !s.quotes || !Number.isInteger(s.seed)) return false;
  if (!Object.entries(s.positions).every(([symbol,p])=>stockBySymbol(symbol)&&p&&Number.isSafeInteger(p.qty)&&p.qty>0&&Number.isSafeInteger(p.cost)&&p.cost>=0)) return false;
  if (s.mode!=='live'&&!STOCKS.every(stock=>Number.isSafeInteger(s.quotes[stock.symbol])&&s.quotes[stock.symbol]>0)) return false;
  if (!Object.values(s.quotes).every(p=>Number.isSafeInteger(p)&&p>=0)) return false;
  if (!Object.values(s.contracts??{}).every(contractValid)) return false;
  if (!Object.entries(s.derivatives??{}).every(([id,p])=>s.contracts?.[id]&&Number.isSafeInteger(p.qty)&&p.qty!==0&&p.qty%s.contracts[id].lotSize===0&&Number.isSafeInteger(p.basis)&&Math.sign(p.basis)===Math.sign(p.qty)&&Number.isSafeInteger(p.margin)&&p.margin>=0)) return false;
  if (!s.watchlist.every(symbol=>!!stockBySymbol(symbol))) return false;
  if (!s.orders.every(o=>o&&typeof o.id==='string'&&(stockBySymbol(o.symbol)||s.contracts?.[o.symbol])&&['buy','sell'].includes(o.side)&&['market','limit'].includes(o.type)&&['open','filled','cancelled'].includes(o.status)&&Number.isSafeInteger(o.qty)&&o.qty>0&&Number.isFinite(o.createdAt)&&(o.type==='market'||Number.isSafeInteger(o.limit)&&o.limit>0)&&(o.status!=='filled'||Number.isSafeInteger(o.price)&&o.price>=0))) return false;
  const basis=Object.values(s.positions).reduce((n,p)=>n+p.cost,0)+optionsBasis(s);
  return s.cash+basis===s.initial+s.realized&&STOCKS.every(stock=>availableShares(s,stock.symbol)>=0);
}
export const reservedCash = s => s.orders.filter(o=>o.status==='open').reduce((n,o)=>n+(o.asset==='FNO'?(o.reserve??0):o.side==='buy'?o.qty*o.limit:0),0);
export const buyingPower = s => s.cash-reservedCash(s)-derivativesMargin(s)+Math.min(0,futuresUnrealized(s));
export const availableShares = (s,symbol) => (s.positions[symbol]?.qty??0)-s.orders.filter(o=>o.status==='open'&&o.side==='sell'&&o.symbol===symbol).reduce((n,o)=>n+o.qty,0);
export function portfolio(s) {
  const invested=Object.values(s.positions).reduce((n,p)=>n+p.cost,0);
  const marketValue=Object.entries(s.positions).reduce((n,[symbol,p])=>n+p.qty*(s.quotes[symbol]??Math.round(p.cost/p.qty)),0);
  const equity=s.cash+marketValue+optionsMarketValue(s)+futuresUnrealized(s);
  return {invested,marketValue,equity,unrealized:marketValue-invested+derivativesUnrealized(s),totalReturn:equity-s.initial,returnPct:(equity/s.initial-1)*100,margin:derivativesMargin(s)};
}
function execute(s,order,price) {
  const feed=s.quoteMeta?.[order.symbol];if(feed?.source==='zerodha-history'){order.pricing='completed-minute-close';order.candleEndAt=feed.candleEndAt;}
  if(order.asset==='FNO'){
    if(!order.reduceOnly&&paperMargin(s.contracts[order.symbol],order.side,order.qty,price,s.spots?.[s.contracts[order.symbol].underlying])>buyingPower(s)+(order.reserve??0))throw new Error('Paper margin changed before the order could fill.');
    return executeDerivative(s,order,price);
  }
  const cost=price*order.qty;
  const held=s.positions[order.symbol];
  if (order.side==='buy') {
    const ownReserve=order.status==='open'&&order.type==='limit'?order.qty*order.limit:0;
    if (s.cash<cost||buyingPower(s)+ownReserve<cost) throw new Error('Insufficient virtual funds or paper margin.');
    s.cash-=cost;
    s.positions[order.symbol]={qty:(held?.qty??0)+order.qty,cost:(held?.cost??0)+cost};
  } else {
    if (!held||held.qty<order.qty) throw new Error('You do not have enough shares to sell.');
    const basis=order.qty===held.qty?held.cost:Math.round(held.cost*order.qty/held.qty);
    s.cash+=cost;
    s.realized+=cost-basis;
    if (held.qty===order.qty) delete s.positions[order.symbol];
    else s.positions[order.symbol]={qty:held.qty-order.qty,cost:held.cost-basis};
  }
  order.status='filled';order.price=price;order.filledAt=Date.now();
}
export function placeOrder(state,{symbol,side,type,qty,limit,reduceOnly=false},now=Date.now()) {
  const derivative=state.contracts?.[symbol];
  if (!stockBySymbol(symbol)&&!derivative) throw new Error('Choose a valid NSE stock or listed F&O contract.');
  if (!['buy','sell'].includes(side)||!['market','limit'].includes(type)) throw new Error('Choose a valid order type.');
  if (!Number.isSafeInteger(qty)||qty<1||qty>1_000_000) throw new Error('Enter a whole number of shares between 1 and 10,00,000.');
  if (type==='limit'&&(!Number.isSafeInteger(limit)||limit<=0||limit>1_000_000_000)) throw new Error('Enter a valid limit price greater than ₹0.');
  const price=state.quotes[symbol];
  if(state.mode==='live'&&!executableQuote(state.quoteMeta?.[symbol],now))throw new Error(state.quoteMeta?.[symbol]?.source==='zerodha-history'?'A fresh, completed one-minute candle during market hours is required. Candle-based paper fills are paused.':'A fresh exchange quote during market hours is required. Live paper fills are paused.');
  const cost=qty*(type==='limit'?limit:price);
  if (!Number.isSafeInteger(cost)) throw new Error('Order value is too large.');
  if(!derivative&&side==='buy'&&cost>buyingPower(state)) throw new Error('Insufficient buying power. Reduce the quantity or cancel an open buy order.');
  if(!derivative&&side==='sell'&&qty>availableShares(state,symbol)) throw new Error('Not enough available shares. You can only sell shares you own that are not reserved.');
  if(state.mode==='live'&&state.orders.filter(o=>o.status==='open').length>=10)throw new Error('Cancel an open order before adding another (10 open orders per live account).');
  const reserve=derivative?validateDerivativeOrder(state,{symbol,side,type,qty,limit,reduceOnly},buyingPower(state),now):undefined;
  const s=structuredClone(state);
  const order={id:`PS-${now.toString(36).toUpperCase()}-${s.orders.length+1}`,symbol,side,type,qty,limit:type==='limit'?limit:null,status:'open',createdAt:now,...(derivative?{asset:'FNO',reserve,reduceOnly,lotSize:derivative.lotSize,kind:derivative.kind}:{}),source:state.mode==='live'?(state.quoteMeta?.[symbol]?.source==='zerodha-history'?'zerodha-candle-close':'broker'):'simulation'};
  s.orders.unshift(order);
  if (type==='market'||side==='buy'&&price<=limit||side==='sell'&&price>=limit) execute(s,order,price);
  s.updatedAt=now;
  return s;
}
export function cancelOrder(state,id) {
  const s=structuredClone(state), order=s.orders.find(o=>o.id===id);
  if (!order||order.status!=='open') throw new Error('This order is no longer open.');
  order.status='cancelled';s.updatedAt=Date.now();return s;
}
export function settleExpiry(state,id,underlyingSettlement,now=Date.now()){
  const c=state.contracts?.[id],p=state.derivatives?.[id];
  if(!c||!p||expiryTime(c)>now)throw new Error('Only an expired open contract can be settled.');
  if(!Number.isSafeInteger(underlyingSettlement)||underlyingSettlement<=0)throw new Error('Enter a valid final underlying settlement price.');
  const s=expireDerivativeOrders(structuredClone(state),now),price=c.kind==='FUT'?underlyingSettlement:c.kind==='CE'?Math.max(0,underlyingSettlement-c.strike):Math.max(0,c.strike-underlyingSettlement);
  const order={id:`PS-SETTLE-${now.toString(36).toUpperCase()}-${s.orders.length+1}`,symbol:id,side:p.qty>0?'sell':'buy',type:'market',qty:Math.abs(p.qty),limit:null,status:'open',createdAt:now,asset:'FNO',lotSize:c.lotSize,kind:c.kind,reduceOnly:true,source:'manual-expiry-settlement',underlyingSettlement};
  s.orders.unshift(order);executeDerivative(s,order,price);s.quotes[id]=price;s.updatedAt=now;return s;
}
export function settleOrders(state) {
  const s=expireDerivativeOrders(structuredClone(state));
  for (const order of [...s.orders].reverse()) {
    if (order.status!=='open') continue;
    const price=s.quotes[order.symbol];
    if(s.mode==='live'&&!executableQuote(s.quoteMeta?.[order.symbol]))continue;
    if (order.side==='buy'?price<=order.limit:price>=order.limit){try{execute(s,order,price);}catch{order.status='cancelled';order.reason='Position or funds changed before execution';}}
  }
  return s;
}
export function tick(state) {
  if(state.mode==='live')return state;
  const s=structuredClone(state);
  for (const stock of STOCKS) {
    s.seed^=s.seed<<13;s.seed^=s.seed>>>17;s.seed^=s.seed<<5;s.seed>>>=0;
    const random=s.seed/4294967296;
    s.quotes[stock.symbol]=Math.round(Math.min(stock.close*1.08,Math.max(stock.close*.92,s.quotes[stock.symbol]*(1+(random-.497)*.0012))));
  }
  s.updatedAt=Date.now();
  return settleOrders(s);
}
export function history(symbol,range='1D',count=90) {
  const stock=stockBySymbol(symbol);
  const final=stock?.price??2485730, start=stock?.close??2463820;
  const scale={'1D':1,'1W':2.2,'1M':4,'3M':7,'1Y':12}[range]??1;
  let seed=[...symbol].reduce((n,c)=>n+c.charCodeAt(0),0)+range.charCodeAt(1),walk=0;
  const values=[];
  for (let i=0;i<count;i++) {
    seed=(seed*1664525+1013904223)>>>0;
    walk+=(seed/4294967296-.46)*final*.0015*scale;
    values.push(start+(final-start)*i/(count-1)+walk);
  }
  const adjustment=final-values.at(-1);
  return values.map((v,i)=>Math.round(v+adjustment*i/(count-1)));
}
