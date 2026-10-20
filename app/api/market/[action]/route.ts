import { getChatGPTUser } from '../../../chatgpt-auth';
import { handleMarket } from '../../../../lib/market/api.mjs';
export const dynamic='force-dynamic';
async function handle(request:Request){
  const user=await getChatGPTUser();
  const {env}=await import('cloudflare:workers');
  return handleMarket(request,{userId:user?.userId,secret:(env as unknown as Record<string,string>).BROKER_SESSION_SECRET});
}
export const GET=handle;
export const POST=handle;
