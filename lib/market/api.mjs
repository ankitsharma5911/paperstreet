import {PROVIDERS,cookieName,requestCookie,openSession,sealSession,sessionCookie,nextSessionExpiry} from './session.mjs';
import {fetchQuotes,fetchCatalog,fetchCatalogSnapshot,staticInstruments,UNDERLYINGS,BrokerError} from './providers.mjs';
import {fetchHistorical,resolveZerodhaInstruments} from './history.mjs';
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export async function handleMarket(request,{userId,secret,configuredZerodha,fetcher=fetch,now=Date.now()}={}){
  if(!userId)return json({error:'Sign in to access your broker connection.'},401);
  const url=new URL(request.url),action=url.pathname.split('/').filter(Boolean).at(-1),provider=url.searchParams.get('provider')??'zerodha-web';
  if(!PROVIDERS.includes(provider))return json({error:'Choose a supported data provider.'},400);
  const origin=request.headers.get('origin');
  if(request.method!=='GET'&&(origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'))return json({error:'Cross-site connection requests are not allowed.'},403);
  try{
    const getSession=async p=>{
      const cookie=requestCookie(request,cookieName(p));if(cookie==='off')return null;
      const saved=await openSession(cookie,secret,userId,p,now);if(saved&&(p!=='zerodha-web'||/^[A-Z0-9]{3,16}$/i.test(saved.brokerUserId??'')))return saved;
      if(p==='zerodha-web'&&configuredZerodha?.ownerUserId===userId&&configuredZerodha.token&&configuredZerodha.expiresAt>now)return {...configuredZerodha,provider:p,userId};
      return null;
    };
    if(action==='status'&&request.method==='GET'){
      const connections={};for(const p of PROVIDERS){const session=await getSession(p);connections[p]=session?{connected:true,connectedAt:session.connectedAt,expiresAt:session.expiresAt,...(p==='zerodha-web'?{pricing:'completed-minute-close',brokerUserId:session.brokerUserId}:{} )}:{connected:false};}
      return json({connections,secureSetup:!!secret&&secret.length>=32});
    }
    if(action==='connect'&&request.method==='POST'){
      if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Expected a JSON connection request.'},415);
      if(Number(request.headers.get('content-length'))>8192)return json({error:'Connection request is too large.'},413);
      const raw=await request.text();if(raw.length>8192)return json({error:'Connection request is too large.'},413);
      let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid connection request.'},400);}
      const token=String(body.token??'').trim().replace(/^(enctoken|Bearer)\s+/i,''),apiKey=String(body.apiKey??'').trim();
      if(token.length<16||token.length>4096||/[\r\n;\s]/.test(token))return json({error:'Enter the token value only, without cookie names or other cookies.'},400);
      if(provider==='kite'&&!/^[a-zA-Z0-9_-]{5,100}$/.test(apiKey))return json({error:'Enter your Kite Connect API key.'},400);
      const brokerUserId=String(body.brokerUserId??(configuredZerodha?.ownerUserId===userId?configuredZerodha.brokerUserId:'')??'').trim().toUpperCase();
      if(provider==='zerodha-web'&&!/^[A-Z0-9]{3,16}$/.test(brokerUserId))return json({error:'Enter your Kite user ID, as shown in your Zerodha account.'},400);
      const session={provider,token,brokerUserId:provider==='zerodha-web'?brokerUserId:undefined,apiKey:provider==='kite'?apiKey:undefined,userId,connectedAt:now,expiresAt:nextSessionExpiry(now)};
      const encrypted=await sealSession(session,secret);
      if(encrypted.length>3500)return json({error:'This token is too large for a secure broker session. Use the broker’s access-token value only.'},400);
      if(provider==='zerodha-web'){
        const [instrument]=await resolveZerodhaInstruments(session,['NSE:NIFTY 50'],{fetcher,now});
        const validation=await fetchHistorical(session,instrument,{interval:'day',fetcher,now});
        if(!validation.candles.length)throw new BrokerError('No completed daily candles were returned. Check your user ID and data access.',401);
      }else{
        const validation=await fetchQuotes(session,[{id:'NSE:RELIANCE',kind:'EQ',exchange:'NSE',tradingSymbol:'RELIANCE'}],{critical:['NSE:RELIANCE'],fetcher,now});
        if(!validation.quotes['NSE:RELIANCE'])throw new BrokerError('No market quote was returned. Check your session and market-data access.',401);
      }
      return json({connected:true,provider,expiresAt:session.expiresAt},200,{'Set-Cookie':sessionCookie(provider,encrypted,session.expiresAt,url.protocol==='https:')});
    }
    if(action==='disconnect'&&request.method==='POST')return json({disconnected:true},200,{'Set-Cookie':sessionCookie(provider,provider==='zerodha-web'&&configuredZerodha?'off':'',provider==='zerodha-web'&&configuredZerodha?configuredZerodha.expiresAt:0,url.protocol==='https:')});
    if(request.method!=='GET')return json({error:'Method not allowed.'},405,{'Allow':'GET, POST'});
    if(action==='instruments'){
      const underlying=url.searchParams.get('underlying');if(underlying&&!UNDERLYINGS.includes(underlying))return json({error:'Unsupported underlying.'},400);
      // The daily instrument dump is public and does not require a broker token.
      const snapshot=await fetchCatalogSnapshot({provider},{fetcher,now,refresh:url.searchParams.get('refresh')==='1'});
      return json({...snapshot,provider,receivedAt:now,instruments:underlying?snapshot.instruments.filter(i=>i.underlying===underlying):snapshot.instruments});
    }
    const session=await getSession(provider);if(!session)return json({error:'Connect or update your daily broker token to load live data.'},401);
    if(action==='history'){
      if(provider!=='zerodha-web')return json({error:'Historical candle charts are available for Zerodha web sessions.'},400);
      const id=url.searchParams.get('i');if(!id||id.length>100)return json({error:'Choose one current symbol for the historical chart.'},400);
      const [instrument]=await resolveZerodhaInstruments(session,[id],{fetcher,now});
      return json(await fetchHistorical(session,instrument,{interval:url.searchParams.get('interval')??'minute',from:url.searchParams.get('from')??undefined,to:url.searchParams.get('to')??undefined,fetcher,now}));
    }
    if(action==='quotes'){
      const ids=[...new Set(url.searchParams.getAll('i'))];if(!ids.length||ids.length>50)return json({error:'Request between 1 and 50 instruments.'},400);
      let allowed;
      if(provider!=='groww'){const snapshot=await fetchCatalogSnapshot(session,{fetcher,now});allowed=[...snapshot.cashInstruments,...snapshot.instruments];}
      else {allowed=staticInstruments();if(ids.some(id=>id.startsWith('NFO:')))allowed=allowed.concat(await fetchCatalog(session,{fetcher,now}));}
      const mapped=ids.map(id=>allowed.find(i=>i.id===id));if(mapped.some(i=>!i))return json({error:'An instrument is not in the current broker catalog.'},400);
      const critical=url.searchParams.getAll('critical');if(critical.length>10||critical.some(id=>!ids.includes(id)))return json({error:'Request at most 10 execution quotes from the selected instruments.'},400);
      return json(await fetchQuotes(session,mapped,{critical,fetcher,now}));
    }
    return json({error:'Unknown market-data route.'},404);
  }catch(error){return json({error:error instanceof BrokerError?error.message:'The secure broker connection could not be completed. Check server configuration and try again.'},error instanceof BrokerError?error.status:500);}
}
