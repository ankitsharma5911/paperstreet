// Shared by the browser and server. Zerodha recommends downloading after 08:30 IST.
export function instrumentDay(now=Date.now()){
  const shifted=new Date(now+330*60000),date=shifted.toISOString().slice(0,10);
  const morning=Date.parse(date+'T08:30:00+05:30'),nextMidnight=Date.parse(date+'T00:00:00+05:30')+86400000;
  return {date,revision:date+(now<morning?'-early':'-ready'),nextRefreshAt:now<morning?morning:nextMidnight};
}

export function reconcileInstruments(state,instruments){
  const next=structuredClone(state),current=new Map(instruments.map(c=>[c.id,c]));
  next.contracts=Object.fromEntries(Object.entries(next.contracts??{}).filter(([id])=>next.derivatives?.[id]||next.orders.some(o=>o.symbol===id)).map(([id,old])=>{
    const fresh=current.get(id),position=next.derivatives?.[id];
    // Preserve ledger units if a contract changes incompatibly; require settlement/review.
    if(fresh&&position&&position.qty%fresh.lotSize!==0)return [id,{...old,metadataConflict:true}];
    return [id,fresh??old];
  }));
  for(const order of next.orders){
    if(order.status!=='open'||order.asset!=='FNO')continue;
    const old=state.contracts[order.symbol],fresh=current.get(order.symbol);
    if(!fresh||fresh.lotSize!==old.lotSize||fresh.tickSize!==old.tickSize||fresh.instrumentToken!==old.instrumentToken){order.status='cancelled';order.reason='Daily instrument metadata changed; review and place a new paper order';}
  }
  return next;
}
