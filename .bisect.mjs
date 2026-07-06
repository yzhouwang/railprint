import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const S='/private/tmp/claude-501/-Users-yuzhouwang-train/490bb7ff-2f55-4404-bf53-f7b5abbb7969/scratchpad';
const { ids, version } = JSON.parse(readFileSync(`${S}/demo-segments.json`,'utf8'));
const name = process.argv[2];
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await (await b.newContext({viewport:{width:1200,height:800},deviceScaleFactor:2})).newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0,200)); });
await page.goto('http://localhost:4173/?e2e=1');
await page.waitForFunction(async()=> (await indexedDB.databases()).some(d=>d.name==='railprint'), null, {timeout:20000});
await page.evaluate(async ({ids,version})=>{
  await new Promise((resolve,reject)=>{
    const open=indexedDB.open('railprint');
    open.onsuccess=()=>{const db=open.result;const tx=db.transaction('rideEvents','readwrite');
      for(const segmentId of ids) tx.objectStore('rideEvents').put({id:crypto.randomUUID(),segmentId,railGeoVersion:version,source:'manual',createdAt:new Date().toISOString()});
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
    open.onerror=()=>reject(open.error);});
},{ids,version});
await page.reload();
await page.waitForFunction(()=>window.__mapReady===true,null,{timeout:30000});
await page.evaluate(()=>window.__map.jumpTo({center:[140.39,41.42],zoom:8.3}));
await page.waitForFunction(()=>window.__map.loaded(),null,{timeout:20000});
await page.waitForTimeout(800);
await page.screenshot({path:`${S}/bisect-${name}.png`});
console.log(`bisect-${name} | console errors: ${errors.length}`, errors.slice(0,3));
await b.close();
