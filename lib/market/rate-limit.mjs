// Shared by every Zerodha endpoint in this server process, including the master CSV.
// Space actual request starts by 400 ms: at most 3 in any rolling second.
export function createRequestGate({clock=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),spacing=400}={}){
  let tail=Promise.resolve(),last=-Infinity;
  return function run(start){
    const ready=tail.then(async()=>{
      let delay=last+spacing-clock();
      while(delay>0){await sleep(delay);delay=last+spacing-clock();}
      last=clock();
      // Start synchronously before releasing the next queue entry.
      return {response:start()};
    });
    tail=ready.then(()=>{},()=>{});
    return ready.then(({response})=>response);
  };
}
export const zerodhaRequest=createRequestGate();
