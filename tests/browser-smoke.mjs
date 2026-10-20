import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const artifacts=path.resolve('artifacts');await mkdir(artifacts,{recursive:true});
const port=9400+Math.floor(Math.random()*500);
const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(artifacts,'browser-profile-'+port)}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let chromeLog='';chrome.stderr.on('data',data=>{chromeLog+=data;});
let ws;const keepAlive=setInterval(()=>{},1000);const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  let tabs;
  for(let i=0;i<60;i++){try{tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();break;}catch{await sleep(200);}}
  if(!tabs)throw new Error('Headless Chrome did not start. '+chromeLog);
  ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let sequence=0;const pending=new Map(),errors=[];
  ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const task=pending.get(data.id);pending.delete(data.id);data.error?task.reject(new Error(JSON.stringify(data.error))):task.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown'){errors.push(data.params.exceptionDetails.exception?.description??data.params.exceptionDetails.text);}};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timeout=setTimeout(()=>reject(new Error('CDP timeout: '+method)),10000);pending.set(id,{resolve:r=>{clearTimeout(timeout);resolve(r);},reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(50);}throw new Error('Timed out: '+expression);};
  const click=async selector=>{const rect=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing element');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:el.classList.contains('mobile-backdrop')?r.right-10:r.x+r.width/2,y:r.y+r.height/2}})()`);await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});};
  const input=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const account=()=>evaluate(`JSON.parse(localStorage.getItem('paperstreet.nse.v1'))`);
  const screenshot=async name=>{await evaluate('window.scrollTo(0,0)');await sleep(250);const result=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(artifacts,name),Buffer.from(result.data,'base64'));};
  await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:'http://127.0.0.1:3000'});await wait(`document.querySelector('.chart-panel')!==null`);
  await evaluate(`localStorage.setItem('paperstreet.mode','simulation');localStorage.removeItem('paperstreet.nse.v1');location.reload()`);await wait(`document.querySelector('.chart-panel')!==null`);await sleep(700);
  await screenshot('desktop.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Desktop should not overflow');
  await click('.intro-actions [data-action="trade"]');await wait(`document.querySelector('#order-form')!==null`);await sleep(230);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#limit-field')).display`),'none','Market orders hide the limit price');
  await input('#quantity','5');await click('#submit-order');await wait(`document.querySelector('#order-form')===null`);
  assert.equal((await account()).positions.RELIANCE.qty,5);
  await click('.intro-actions [data-action="trade"]');await sleep(230);await click('[data-action="side"][data-side="sell"]');await input('#quantity','2');await click('#submit-order');await wait(`document.querySelector('#order-form')===null`);assert.equal((await account()).positions.RELIANCE.qty,3);
  await click('.intro-actions [data-action="trade"]');await sleep(230);await click('[data-action="side"][data-side="sell"]');await input('#quantity','4');await click('#submit-order');await wait(`document.querySelector('#form-error').textContent.includes('Not enough')`);await click('[data-action="close-modal"]');
  await click('.intro-actions [data-action="trade"]');await sleep(230);await input('#quantity','100000');await click('#submit-order');await wait(`document.querySelector('#form-error').textContent.includes('Insufficient')`);await input('#quantity','2');await input('#order-type','limit');await input('#limit-price','100.00');assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('#limit-field')).display`),'none');await click('#submit-order');await wait(`document.querySelector('#order-form')===null`);assert.equal((await account()).orders[0].status,'open');
  await evaluate(`location.hash='orders'`);await wait(`document.querySelector('[data-action="cancel"]')!==null`);await click('[data-action="cancel"]');await wait(`document.querySelector('[data-action="cancel"]')===null`);assert.equal((await account()).orders[0].status,'cancelled');
  await cdp('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:artifacts});await click('.intro-actions [data-action="export"]');await sleep(300);const csv=await readFile(path.join(artifacts,'paperstreet-orders.csv'),'utf8');assert.match(csv,/RELIANCE/);assert.match(csv,/cancelled/);
  await evaluate(`location.hash='watchlist'`);await wait(`document.querySelector('.page-toolbar [data-action="add-watch"]')!==null`);await click('.page-toolbar [data-action="add-watch"]');await sleep(230);await input('#watch-search','SBIN');await click('.picker-row [data-action="star"]');await wait(`JSON.parse(localStorage.getItem('paperstreet.nse.v1')).watchlist.includes('SBIN')`);await click('[data-action="close-modal"]');
  await evaluate(`location.hash='markets'`);await wait(`document.querySelector('#market-filter')!==null`);await input('#market-filter','tcs');assert.equal(await evaluate(`document.querySelectorAll('tbody tr').length`),1);await input('#market-filter','');await input('#sector-filter','Banking');assert.equal(await evaluate(`document.querySelectorAll('tbody tr').length`),4);
  await evaluate(`location.reload()`);await wait(`document.querySelector('#market-filter')!==null`);assert.equal((await account()).positions.RELIANCE.qty,3);assert.equal((await account()).watchlist.includes('SBIN'),true);
  for(const width of [390,320,768,1024]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<650});await sleep(250);
    for(const route of ['overview','markets','portfolio','orders','watchlist']){await evaluate(`location.hash=${JSON.stringify(route)}`);await wait(`document.querySelector('#page-crumb').textContent===${JSON.stringify(route[0].toUpperCase()+route.slice(1))}`);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`${route} overflows at ${width}px`);}
  }
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(250);await evaluate(`location.hash='overview'`);await wait(`document.querySelector('.chart-panel')!==null`);await screenshot('mobile.png');
  await click('.mobile-toggle');await wait(`document.querySelector('#sidebar').classList.contains('open')`);await sleep(250);await click('[data-action="close-menu"]');await sleep(250);
  await click('.intro-actions [data-action="trade"]');await sleep(230);assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);await screenshot('mobile-order.png');await click('[data-action="close-modal"]');
  await evaluate(`document.querySelector('[data-action="settings"]').click()`);await wait(`document.querySelector('[data-action="confirm-reset"]')!==null`);await click('[data-action="confirm-reset"]');assert.equal(await evaluate(`document.querySelector('#reset-confirm').disabled`),true);await input('#reset-text','RESET');await click('#reset-confirm');await wait(`document.querySelector('#reset-confirm')===null`);assert.equal((await account()).cash,100000000);assert.equal((await account()).orders.length,0);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});await sleep(250);await screenshot('desktop.png');
  await input('#search','tcs');await wait(`document.querySelector('.search-result')!==null`);await click('.search-result');await wait(`document.querySelector('.chart-symbol h2')?.textContent.includes('TCS')`);
  await click('[data-action="range"][data-range="1M"]');assert.equal(await evaluate(`document.querySelector('.range-button.active').textContent`),'1M');
  await click('[data-action="chart-mode"][data-mode="candles"]');assert.equal(await evaluate(`document.querySelectorAll('.main-chart rect').length>20`),true);
  assert.deepEqual(errors,[],'No browser runtime errors');
  console.log('Browser checks passed: market buy/sell, validation, limit/cancel, CSV export, watchlist, search/sector filtering, reload persistence, reset, navigation, and 5 routes at 4 viewport widths.');
  console.log('Screenshots: artifacts/desktop.png, artifacts/mobile.png, artifacts/mobile-order.png');
}finally{clearInterval(keepAlive);ws?.close();chrome.kill();}
