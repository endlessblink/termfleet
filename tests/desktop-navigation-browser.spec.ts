import {test,expect} from '@playwright/test';

test('agent dialog keyboard opening, cancellation, validation and focus trap',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('textbox',{name:'Workspace command'})).toBeVisible();
 await page.keyboard.press('Control+Alt+n');
 const dialog=page.getByRole('dialog',{name:'New agent'});
 await expect(dialog).toBeVisible();
 await page.screenshot({path:'/tmp/termfleet-new-agent-dialog.png'});
 await expect(dialog.getByRole('radiogroup',{name:'Agent'}).getByRole('radio',{checked:true})).toBeFocused();
 await dialog.getByRole('button',{name:/^Agent/}).focus();
 await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:/^Continue$/})).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'New agent'}).click();await expect(dialog).toBeVisible();
 await dialog.getByRole('radiogroup',{name:'Agent'}).getByText('Claude',{exact:true}).click();
 await dialog.getByRole('button',{name:/^Continue$/}).click();
 await dialog.getByText('New project',{exact:true}).click();
 await dialog.getByLabel('Parent folder').fill('/fixture');
 await dialog.getByLabel('New folder name').fill('../invalid');
 await dialog.getByRole('button',{name:/^Continue$/}).click();
 await expect(dialog.getByRole('alert')).toContainText('single folder name');
 await dialog.getByLabel('New folder name').fill('valid');
 await dialog.getByRole('button',{name:/^Continue$/}).click();
 await dialog.getByLabel('Work to start').fill('Fixture work');
 await expect(dialog.getByRole('button',{name:'Start Claude'})).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
});

test('MRU works from terminal keyboard focus, keeps held order, and reload preserves use history',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {useWorkspaceStore:store}=await import('/src/stores/workspace.ts');
  const state=store.getState();const template=state.tabs[0];
  store.setState({tabs:['a','b','c'].map((id,i)=>({...template,id,title:id,lastUsedAt:30-i,groupId:null,terminals:template.terminals.map(pane=>({...pane,id:`fixture-${id}`,paneId:`fixture-pane-${id}`})),activePaneId:`fixture-pane-${id}`,splitLayout:{id:`fixture-pane-${id}`,type:'terminal'}})),activeTabId:'a',workspaceUiState:{...state.workspaceUiState,workspaceMode:'split'}});
 });
 const active=()=>page.evaluate(async()=>{const {useWorkspaceStore:store}=await import('/src/stores/workspace.ts');return store.getState().activeTabId;});
 // Browser preview uses xterm; synthetic terminal input explicitly exercises the
 // same keyboard-owner predicate without attaching any real agent or daemon.
 await page.evaluate(()=>{const input=document.createElement('textarea');input.className='terminal-canvas-input';input.id='fixture-keyboard-owner';document.body.append(input);input.focus();});
 await page.keyboard.down('Control');await page.keyboard.down('Alt');
 await page.keyboard.press('PageDown');expect(await active()).toBe('b');
 await page.keyboard.press('PageDown');expect(await active()).toBe('c');
 await page.keyboard.press('PageUp');expect(await active()).toBe('b');
 await page.keyboard.up('Alt');await page.keyboard.up('Control');
 await page.waitForTimeout(650);
 const before=await page.evaluate(async()=>{const {useWorkspaceStore:store}=await import('/src/stores/workspace.ts');return store.getState().tabs.map(tab=>({id:tab.id,lastUsedAt:tab.lastUsedAt}));});
 await page.reload();
 const after=await page.evaluate(async()=>{const {useWorkspaceStore:store}=await import('/src/stores/workspace.ts');return store.getState().tabs.map(tab=>({id:tab.id,lastUsedAt:tab.lastUsedAt}));});
 expect(after).toEqual(before);
});

test('explicit launch target overrides stale group and persists below its own project',async({page})=>{
 await page.goto('/');
 const created=await page.evaluate(async()=>{
  const {useWorkspaceStore:store,createAgentWorkstream}=await import('/src/stores/workspace.ts');
  const {newAgentTerminalPosition}=await import('/src/lib/newAgentTerminal.ts');
  const {AGENT_PROVIDERS}=await import('/src/lib/agentProviders.ts');
  const state=store.getState();const template=state.tabs[0];
  const groups=[{id:'chosen',name:'Chosen',projectRoot:'/fixture/chosen',color:'#aaa'},{id:'stale',name:'Stale',projectRoot:'/fixture/stale',color:'#bbb'}];
  const tabs=[{...template,id:'chosen-tab',groupId:'chosen',initialCwd:'/fixture/chosen'},{...template,id:'stale-tab',groupId:'stale',initialCwd:'/fixture/stale'}];
  const nodes=[{id:'chosen-node',type:'terminal',terminalTabId:'chosen-tab',title:'Chosen',x:0,y:0,width:1180,height:720},{id:'stale-node',type:'terminal',terminalTabId:'stale-tab',title:'Stale',x:1400,y:0,width:1180,height:720}];
  store.setState({tabs,groups,terminalGroups:groups,activeTabId:'stale-tab',activeGroupFilter:'stale',activeGroupId:'stale',canvasState:{...state.canvasState,nodes}});
  const placement=newAgentTerminalPosition(nodes,tabs,'chosen');
  const id=createAgentWorkstream('shell','Synthetic launch',{...AGENT_PROVIDERS.shell,available:true,message:'Fixture'},{cwd:'/fixture/chosen',isolationMode:'shared-worktree'},'terminal',{groupId:'chosen',projectCwd:'/fixture/chosen',placement});
  const current=store.getState();return {id,group:current.tabs.find(tab=>tab.id===id)?.groupId,node:current.canvasState.nodes.find(node=>node.terminalTabId===id)};
 });
 expect(created.group).toBe('chosen');expect(created.node?.x).toBe(0);expect(created.node?.y).toBe(768);
 await page.waitForTimeout(650);await page.reload();
 const restored=await page.evaluate(async(id)=>{const {useWorkspaceStore:store}=await import('/src/stores/workspace.ts');const s=store.getState();return {group:s.tabs.find(tab=>tab.id===id)?.groupId,node:s.canvasState.nodes.find(node=>node.terminalTabId===id)};},created.id);
 expect(restored.group).toBe('chosen');expect(restored.node?.y).toBe(768);
});

test('attention never auto-focuses; explicit review acknowledgement survives reload',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {useWorkspaceStore:store}=await import('/src/stores/workspace.ts');
  const state=store.getState(),template=state.tabs[0];
  const tabs=['idle','approval','finished'].map((id,i)=>({...template,id,title:id,groupId:null,activePaneId:`attention-${id}`,splitLayout:{id:`attention-${id}`,type:'terminal'},terminals:[{...template.terminals[0],id:`attention-pty-${id}`,paneId:`attention-${id}`,status:'running',statusSummary:{task:'Fixture work',path:'/fixture',now:'Fixture activity',status:i===1?'waiting':'idle',confidence:'high',updatedAt:100,waitingReason:i===1?'approval':undefined,completedAt:i===2?100:undefined,sessionId:id}}]}));
  store.setState({tabs,activeTabId:'idle',workspaceUiState:{...state.workspaceUiState,workspaceMode:'split'}});
 });
 const active=()=>page.evaluate(async()=>{const {useWorkspaceStore:store}=await import('/src/stores/workspace.ts');return store.getState().activeTabId;});
 expect(await active()).toBe('idle');
 await page.keyboard.press('Control+Alt+Home');expect(await active()).toBe('approval');
 await page.keyboard.press('Control+Alt+Home');expect(await active()).toBe('finished');
 const acknowledged=()=>page.evaluate(async()=>{const {useWorkspaceStore:store}=await import('/src/stores/workspace.ts');const pane=store.getState().tabs.find(tab=>tab.id==='finished')?.terminals[0];return {at:pane?.reviewedCompletionAt,session:pane?.reviewedCompletionSessionId};});
 expect(await acknowledged()).toEqual({at:100,session:'finished'});
 await page.waitForTimeout(650);await page.reload();expect(await acknowledged()).toEqual({at:100,session:'finished'});
 const remaining=await page.evaluate(async()=>{const {useWorkspaceStore:store}=await import('/src/stores/workspace.ts');const {terminalAttentionTargets}=await import('/src/lib/terminalNavigation.ts');return terminalAttentionTargets(store.getState().tabs).map(target=>target.tabId);});
 expect(remaining).not.toContain('finished');
});
