import { getChatGPTUser } from '../../../chatgpt-auth';
import { handleMarket } from '../../../../lib/market/api.mjs';
export const dynamic='force-dynamic';
async function handle(request:Request){
  const user=await getChatGPTUser();
  const {env}=await import('cloudflare:workers');
  const settings=env as unknown as Record<string,string>;
  return handleMarket(request,{userId:user?.userId,secret:settings.BROKER_SESSION_SECRET,configuredZerodha:{token:settings.ZERODHA_ENCTOKEN,brokerUserId:settings.ZERODHA_BROKER_USER_ID,ownerUserId:settings.ZERODHA_OWNER_USER_ID,connectedAt:Number(settings.ZERODHA_CONNECTED_AT),expiresAt:Number(settings.ZERODHA_EXPIRES_AT)}});
}
export const GET=handle;
export const POST=handle;
