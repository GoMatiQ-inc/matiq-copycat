async function finishSetup(page){
 await page.waitForLoadState('domcontentloaded');
 await page.waitForFunction(()=>document.querySelector('.matiq-setup-preview')||document.querySelector('#message')?.textContent);
 const wizard=page.getByRole('dialog',{name:'Copycat setup',exact:true});
 if(!await wizard.isVisible())return;
 for(let index=0;index<8;index++){
  const choice=wizard.locator('select');if(await choice.count())await choice.selectOption(index===1?'desktop':'none');
  const review=wizard.getByRole('checkbox');if(await review.count())await review.check();
  const check=wizard.getByRole('button',{name:/^Check (Screen Recording|Accessibility)$/});if(await check.count())await check.click();
  await wizard.getByRole('button',{name:index===7?'Finish setup':'Continue',exact:true}).click();
 }
 await wizard.waitFor({state:'hidden'});
}
module.exports={finishSetup};
