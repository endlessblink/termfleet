import {expect,test} from '@playwright/test';

test.use({launchOptions:{executablePath:'/usr/bin/chromium',args:['--disable-crash-reporter','--disable-crashpad','--disable-gpu']}});

test('the existing Agents rail action, embedded route and saved mode survive panel changes',async({page})=>{
  // Keep this routing check isolated from the operator's running bridge and agents.
  await page.route('http://127.0.0.1:7810/**',route=>route.fulfill({contentType:'text/html',body:'<main>Safe agent routing fixture</main>'}));
  await page.goto('http://127.0.0.1:5177/',{waitUntil:'networkidle'});
  await page.evaluate(()=>{const s=window.__termfleetWorkspaceStore!;s.getState().setWorkspaceMode('split');s.getState().updateWorkspaceUiState({primarySidebarCollapsed:false});});
  await page.getByRole('button',{name:'Agents',exact:true}).click();
  await expect(page.locator('section.agents-view')).toBeVisible();
  await expect(page.getByTitle('Agents',{exact:true})).toHaveAttribute('src','http://127.0.0.1:7810/embed');
  await expect.poll(()=>page.evaluate(()=>window.__termfleetWorkspaceStore!.getState().workspaceUiState.workspaceMode)).toBe('agents');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('terminal-workspace.v1')??'{}').workspaceUiState?.workspaceMode)).toBe('agents');
  await page.reload({waitUntil:'networkidle'});
  await expect(page.locator('section.agents-view')).toBeVisible();
  expect(await page.evaluate(()=>window.__termfleetWorkspaceStore!.getState().workspaceUiState.workspaceMode)).toBe('agents');
});
