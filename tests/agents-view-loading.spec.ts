import {expect,test} from '@playwright/test';

test.use({launchOptions:{executablePath:'/usr/bin/chromium',args:['--disable-crash-reporter','--disable-crashpad','--disable-gpu']}});

// Noam 2026-10-20: right after a restart the Agents view was a blank white page while
// the agent page was still on its way. It must say it is opening, then show the page.
test('a slow agents page shows "Opening the agents…" instead of a white page',async({page})=>{
  let release!:()=>void;
  const arrived=new Promise<void>(r=>{release=r;});
  await page.route('http://127.0.0.1:7810/**',async route=>{await arrived;await route.fulfill({contentType:'text/html',body:'<main>Safe agent fixture</main>'});});
  await page.goto('http://127.0.0.1:5177/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.__termfleetWorkspaceStore));
  await page.evaluate(()=>{const s=window.__termfleetWorkspaceStore!;s.getState().setWorkspaceMode('split');s.getState().updateWorkspaceUiState({primarySidebarCollapsed:false});});
  await page.getByRole('button',{name:'Agents',exact:true}).click();
  const frame=page.getByTitle('Agents',{exact:true});
  await expect(page.locator('section.agents-view [role=status]')).toHaveText('Opening the agents…');
  await expect(frame).toHaveCSS('visibility','hidden');
  release();
  await expect(frame).toHaveCSS('visibility','visible');
  await expect(page.locator('section.agents-view [role=status]')).toHaveCount(0);
  await expect(page.frameLocator('iframe[title=Agents]').locator('main')).toHaveText('Safe agent fixture');
});
