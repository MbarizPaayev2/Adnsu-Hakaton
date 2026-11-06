/** Browser QA against scripts/product-theme-fixture.mjs and a dedicated Next preview.
 * This checks presentation with synthetic content, not backend workflows.
 * PRODUCT_PREVIEW_URL, PRODUCT_EVIDENCE_DIR and CHROMIUM_PATH are optional.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
const dir=process.env.PRODUCT_EVIDENCE_DIR || '/tmp/aise-product-ui-evidence';
await mkdir(dir,{recursive:true});
const base=process.env.PRODUCT_PREVIEW_URL || 'http://127.0.0.1:3471';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw Error('UI fixture verification is loopback only');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || (process.platform==='darwin' ? `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` : undefined)});
const results=[];const errors=[];
try{
 for(const width of [390,1440,320,768]){
  const ctx=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
  await ctx.addInitScript(()=>localStorage.setItem('aise-cookie-consent','denied'));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  const csrf=await(await ctx.request.get(base+'/api/auth/csrf')).json();
  await ctx.request.post(base+'/api/auth/callback/credentials',{form:{csrfToken:csrf.csrfToken,email:'candidate@example.test',password:'visual-fixture-only',json:'true'}});
  const session=await(await ctx.request.get(base+'/api/auth/session')).json();if(!session.user)throw Error('Synthetic candidate session missing');
  await ctx.addCookies([{name:'business_session',value:'local-visual-fixture',url:base,httpOnly:true},{name:'admin_session',value:'local-visual-fixture',url:base,httpOnly:true}]);
  const paths=['/jobs','/jobs/imported/frontend','/login','/register','/pricing','/terms','/dashboard','/dashboard/matches','/dashboard/profile','/dashboard/resumes','/dashboard/applications','/dashboard/settings','/business/dashboard','/business/vacancies','/business/applications','/business/company','/business/settings','/admin/overview','/admin/system'];
  for(const path of width===320 || width===768 ? ['/jobs','/login','/dashboard','/business/dashboard','/admin/overview'] : paths){
   await page.goto(base+path,{waitUntil:'networkidle',timeout:60000});
   await page.waitForTimeout(300);
   if(new URL(page.url()).pathname !== path) throw Error('Unexpected redirect '+path+' to '+page.url());
   const value=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,h1:document.querySelector('h1')?.textContent,canvas:getComputedStyle(document.body).backgroundColor,active:[...document.querySelectorAll('nav [aria-current="page"]')].map(e=>e.textContent.trim())}));
   results.push({path,...value});
   if(value.scrollWidth>width+1)console.log('OVERFLOW',path,width,value.scrollWidth);
   await page.screenshot({path:dir+'/'+path.replaceAll('/','-').slice(1)+'-'+width+'.png',fullPage:false});
   console.log(path,width,value.h1||'(form heading)');
  }
  if(width===390){
   await page.goto(base+'/dashboard/matches',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Menyunu aç'}).click();
   await page.screenshot({path:dir+'/candidate-menu-390.png'});
   const close=page.getByRole('button',{name:'Menyunu bağla'});
   await close.focus();await page.keyboard.press('Shift+Tab');
   if(!(await page.getByRole('button',{name:'Çıxış'}).evaluate(e=>e===document.activeElement)))throw Error('Drawer focus escaped backwards');
   await page.keyboard.press('Tab');
   if(!(await close.evaluate(e=>e===document.activeElement)))throw Error('Drawer focus escaped forwards');
   await page.keyboard.press('Escape');
   if(!(await page.getByRole('button',{name:'Menyunu aç'}).evaluate(e=>e===document.activeElement)))throw Error('Drawer failed focus restoration');
   if(await page.getByRole('dialog',{name:'Menyu'}).count())throw Error('Drawer failed Escape');
  }
  await ctx.close();
 }
 await writeFile(dir+'/verification.json',JSON.stringify({kind:'Synthetic local UI fixtures; not backend, live inventory or delivery evidence',results,errors},null,2));
 console.log('COMPLETE',results.length,'pages/viewports;',errors.length,'runtime errors');
 if(errors.length||results.some(r=>r.scrollWidth>r.width+1))process.exitCode=1;
}finally{await browser.close();}
