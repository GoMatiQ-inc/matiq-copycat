async function finishSetup(page){
 await page.waitForLoadState('domcontentloaded');
 await page.waitForFunction(()=>document.querySelector('.matiq-setup-preview')||document.querySelector('#message')?.textContent);
 const wizard=page.getByRole('dialog',{name:'Copycat setup',exact:true});
 if(!await wizard.isVisible())return;
 for(let index=0;index<8;index++){
  await wizard.getByText('Copycat setup · '+(index+1)+' of 8',{exact:true}).waitFor();
  const choice=wizard.locator('select');if(await choice.count())await choice.selectOption(index===1?'desktop':'none');
  const review=wizard.getByRole('checkbox');if(await review.count())await review.check();
  const check=wizard.getByRole('button',{name:/^Check (Screen Recording|Accessibility)$/});if(await check.count())await check.click();
  await wizard.getByRole('button',{name:index===7?'Finish setup':'Continue',exact:true}).click();
 }
 await wizard.waitFor({state:'hidden'});
}
async function openCaptureOptions(page,section){
 const options=page.locator('.capture-options');if(!await options.count())return;
 if(!await options.evaluate(node=>node.open))await options.locator('summary').first().click();
 const details=page.locator(section==='window'?'.capture-options > details:first-of-type':'#browser-tools');
 if(await details.count()&&!await details.evaluate(node=>node.open))await details.locator('summary').first().click();
}
async function openHostedCopycat(page,version){
 if(version==='0.1.1')await page.locator('article').filter({has:page.getByRole('heading',{name:'MatiQ Copycat',exact:true})}).getByRole('button',{name:'Open',exact:true}).click();
 else await page.getByRole('button',{name:'Copycat',exact:true}).click();
}
async function openSuiteUpdates(page,version){
 if(version==='0.1.1')await page.getByRole('button',{name:'Downloads & updates',exact:true}).click();
 else{await page.getByRole('button',{name:'Open app launcher',exact:true}).click();await page.getByRole('dialog',{name:'Installed apps',exact:true}).getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Downloads & updates',exact:true}).click();}
}
async function returnToHostedCopycat(page,version){
 if(version==='0.1.1')await page.locator('#open-tools').getByRole('button',{name:'MatiQ Copycat',exact:true}).click();
 else{await page.getByRole('button',{name:'MatiQ Solutions home',exact:true}).click();await openHostedCopycat(page,version);}
}
module.exports={finishSetup,openCaptureOptions,openHostedCopycat,openSuiteUpdates,returnToHostedCopycat};
