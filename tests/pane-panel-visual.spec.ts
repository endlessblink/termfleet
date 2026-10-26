import {expect,test,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
test.use({launchOptions:{executablePath:'/usr/bin/chromium',args:['--disable-crash-reporter','--disable-crashpad','--disable-gpu']}});
const screenshots=process.env.TERMFLEET_PANEL_EVIDENCE_DIR ?? resolve('artifacts/pane-panel');
mkdirSync(screenshots,{recursive:true});
async function seed(page:Page,{width=880,hebrew=false,theme='dark',explicit=false,unknown=false}:{width?:number;hebrew?:boolean;theme?:string;explicit?:boolean;unknown?:boolean}={}) {
  await page.goto(test.info().project.use.baseURL ?? 'http://127.0.0.1:5177',{waitUntil:'networkidle'});
  await page.evaluate(({width,hebrew,theme,explicit,unknown})=>{
    const store=window.__termfleetWorkspaceStore;if(!store)throw Error('Missing test store');
    const old=store.getState();const at=Date.now();
    const request=unknown?'':hebrew?'לשפר את העברת השיחה כדי לוודא שכל ההקשר וההנחיות של המשתמש נשמרים':'lets add to the complaints this to see that dropoffs will have all relevant context';
    const terminal={id:'terminal-panel-tab-panel-pane',paneId:'panel-pane',cols:100,rows:24,status:'reconnected',agentProvider:'claude',providerSessionId:'panel-chat',
      terminalVisibleText:'Calling lean-ctx · 28s…\n✻ Reticulating… (5m 28s · ↓ 12.2k tokens)\n❯\n[OMC] | thinking | session:3m | ctx:14%',terminalVisibleTextUpdatedAt:at,
      terminalOutput:'http://127.0.0.1:7810\nhttp://127.0.0.1:9223',previewUrl:'http://127.0.0.1:7810',
      mainUserAsk:explicit?{text:hebrew?'לשמור את ההקשר המלא בין שיחות':'Keep all user context and instructions between conversations',source:'manual',updatedAt:at}:undefined,
      statusSummary:{sessionId:'panel-chat',task:request,userTask:request,...(hebrew?{statedGoal:request}:{}),path:'freelance-desk',now:'Marking the plan task done.',status:'idle',provider:'claude',confidence:'high',updatedAt:at-10_000},statusSummarySource:'sidecar',statusSummaryUpdatedAt:at};
    const group={id:'panel-group',name:'freelance-desk',color:'#75b9a6',projectRoot:'/safe/fixture/freelance-desk'};
    store.setState({groups:[group],terminalGroups:[group],projectRoot:group.projectRoot,activeTabId:'panel-tab',activeTerminalId:terminal.id,activeGroupFilter:null,hydrating:false,
      workspaceUiState:{...old.workspaceUiState,workspaceMode:'canvas',primarySidebarCollapsed:false,primarySidebarPanel:'map',canvasSidebarCollapsed:false},
      tabs:[{id:'panel-tab',title:hebrew?'העברת שיחה עם כל ההנחיות הארוכות של המשתמש':'Helper: Continue from the very long handoff with all user instructions',emoji:'[]',color:'#75b9a6',groupId:group.id,initialCwd:group.projectRoot,activePaneId:'panel-pane',splitLayout:{type:'terminal',id:'panel-pane'},terminals:[terminal]}],
      canvasState:{selectedNodeId:null,selectedNodeIds:[],viewport:{x:20,y:10,zoom:1},nodes:[{id:'panel-pane',type:'terminal',title:'freelance-desk',terminalTabId:'panel-tab',x:0,y:0,width,height:600}]}} as never);
    document.documentElement.setAttribute('data-theme',theme);
    if(theme==='light') for(const [key,value] of Object.entries({'--surface-rail':'#f4f5f4','--surface-raised':'#ffffff','--surface-base':'#f8faf9','--text-primary':'#18251f','--text-secondary':'#4c5b53','--text-tertiary':'#58645d','--border-subtle':'#c5cec8','--surface-panel':'#f8faf9','--surface-hover':'#e9eee9','--surface-sunken':'#ffffff','--surface-floor':'#f4f7f4','--state-running':'#226348','--state-waiting':'#735019','--accent-live':'#236748','--accent-fill':'#236748'})) document.documentElement.style.setProperty(key,value);
  },{width,hebrew,theme,explicit,unknown});
  if(width<500) await page.getByTestId('canvas-terminal-status-block').evaluate((e,width)=>{(e as HTMLElement).style.width=`${width-24}px`; (e as HTMLElement).style.boxSizing='border-box';},width);
}

test('TF-091: an agent that stated no goal shows No goal yet, never a guess from its messages',async({page})=>{
  await seed(page);
  const card=page.getByTestId('canvas-terminal-status-block');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('canvas-terminal-node-attention')).toHaveAttribute('data-attention-state','running');
  await expect(page.getByTestId('canvas-terminal-node-goal')).toContainText('No goal yet');
  await expect(page.getByTestId('canvas-terminal-node-goal')).not.toContainText('relevant context');
  await expect(page.getByTestId('pane-goal-provenance')).toContainText('The agent has not stated a goal yet');
  await expect(page.getByTestId('canvas-terminal-node-now-row')).toContainText('Working');
  await expect(page.getByTestId('canvas-terminal-node-now-row')).not.toContainText('Marking the plan task done');
  expect(await card.locator('.pane-context-goal .pane-context-value').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(page.getByTestId('sidebar-map-node-goal-row').first()).toHaveText('No goal yet');
  await card.screenshot({path:`${screenshots}/map-panel-dark-inferred.png`});
});

test('manual Goal and unknown Goal remain visible without fabricating context',async({page})=>{
  await seed(page,{explicit:true});
  await expect(page.getByTestId('canvas-terminal-node-goal')).toHaveAttribute('data-goal-state','explicit');
  await expect(page.getByTestId('canvas-terminal-node-goal')).toContainText('Keep all user context');
  await seed(page,{unknown:true});
  await expect(page.getByTestId('canvas-terminal-node-goal')).toContainText('No goal yet');
  await expect(page.getByTestId('canvas-terminal-node-goal')).toHaveAttribute('data-goal-state','unknown');
  await seed(page);
  await page.evaluate(()=>{const s=window.__termfleetWorkspaceStore!;const st=s.getState();s.setState({tabs:st.tabs.map(t=>({...t,terminals:t.terminals.map(p=>({...p,statusSummary:{...p.statusSummary!,statedGoal:'Keep all user context and instructions between conversations'}}))}))} as never);});
  await expect(page.getByTestId('canvas-terminal-node-goal')).toHaveAttribute('data-goal-state','explicit');
  await expect(page.getByTestId('canvas-terminal-node-goal')).toContainText('Keep all user context');
  await expect(page.getByTestId('pane-goal-provenance')).toContainText('Declared goal');
});

test('small light Hebrew pane wraps, expands long text by keyboard and preserves row height during status changes',async({page})=>{
  await seed(page,{width:360,hebrew:true,theme:'light'});
  const card=page.getByTestId('canvas-terminal-status-block');
  await expect(card.locator('.pane-context-panel')).toHaveAttribute('dir','rtl');
  await expect(page.getByTestId('canvas-terminal-node-goal')).toContainText('מטרה');
  expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  const height=(await card.boundingBox())!.height;
  await card.screenshot({path:`${screenshots}/map-panel-light-hebrew-small.png`});
  const summary=card.locator('.pane-context-goal summary');await summary.focus();await summary.press('Enter');
  await expect(card.locator('.pane-context-goal details')).toHaveAttribute('open','');
  await summary.press('Enter');
  await page.evaluate(()=>{const s=window.__termfleetWorkspaceStore!;const st=s.getState();s.setState({tabs:st.tabs.map(t=>({...t,terminals:t.terminals.map(p=>({...p,terminalVisibleText:'✻ Churned for 36s · done 20:42\n❯',terminalVisibleTextUpdatedAt:Date.now()}))}))});});
  await expect(page.getByTestId('canvas-terminal-node-attention')).toHaveAttribute('data-attention-state','idle');
  await expect(page.getByTestId('canvas-terminal-node-now-row')).toContainText('סיים — ממתין להודעה הבאה שלך');
  expect((await card.boundingBox())!.height).toBe(height);
});

test('Services and Scope default to collapsed, retain choices and never overlap when opened or resized',async({page})=>{
  await seed(page,{hebrew:true});
  const services=page.getByTestId('map-local-services');const scope=page.getByTestId('map-workspace-summary');
  const serviceToggle=page.getByTestId('map-local-services-toggle');const scopeToggle=page.getByTestId('map-workspace-summary-toggle');
  await expect(serviceToggle).toHaveAttribute('aria-expanded','false');await expect(scopeToggle).toHaveAttribute('aria-expanded','false');
  await expect(page.getByTestId('map-local-service-row')).toHaveCount(0);
  await serviceToggle.click();await scopeToggle.click();
  await expect(serviceToggle).toHaveAttribute('aria-expanded','true');await expect(page.getByTestId('map-local-service-row').first()).toBeVisible();
  for(const width of [220,300,190,260]) {
    await page.locator('.map-utility-panel').evaluateAll((els,width)=>{for(const e of els){(e as HTMLElement).style.width=`${width}px`; (e as HTMLElement).style.boxSizing='border-box';}},width);
    const overlaps=await page.locator('.map-utility-header').evaluateAll(headers=>headers.flatMap(header=>{
      const children=Array.from(header.children).map(e=>e.getBoundingClientRect());
      return children.flatMap((a,i)=>children.slice(i+1).filter(b=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1 && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1));
    }));expect(overlaps,`header overlap at ${width}px`).toEqual([]);
    const serviceOverflow=await services.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,children:Array.from(e.querySelectorAll('*')).filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>({name:x.className,text:x.textContent,width:x.clientWidth,scroll:x.scrollWidth}))}));
    expect(serviceOverflow.scroll,JSON.stringify({atWidth:width,...serviceOverflow})).toBeLessThanOrEqual(serviceOverflow.width+1);
    expect(await scope.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  }
  await services.screenshot({path:`${screenshots}/sidebar-services-open-narrow.png`});
  await scope.screenshot({path:`${screenshots}/sidebar-scope-open-narrow.png`});
  await seed(page);await expect(serviceToggle).toHaveAttribute('aria-expanded','true');await expect(scopeToggle).toHaveAttribute('aria-expanded','true');
  await serviceToggle.click();await scopeToggle.click();
  await seed(page);await expect(serviceToggle).toHaveAttribute('aria-expanded','false');await expect(scopeToggle).toHaveAttribute('aria-expanded','false');
});

test('map and split share Goal and topic in independent windows and during narrow resize',async({page,context})=>{
  await seed(page,{explicit:true});
  const other=await context.newPage();await seed(other,{explicit:true});
  for(const windowPage of [page,other]) {
    await windowPage.evaluate(()=>{const s=window.__termfleetWorkspaceStore!;const st=s.getState();s.setState({workspaceUiState:{...st.workspaceUiState,workspaceMode:'split',primarySidebarPanel:'sessions'},tabs:st.tabs.map(t=>({...t,topicLabel:'Fix audio sync'}))});});
    await expect(windowPage.getByTestId('split-pane-goal')).toContainText('Keep all user context');
    await expect(windowPage.getByTestId('split-terminal-topic')).toHaveText('Fix audio sync');
    for(const width of [900,560,360,700]) {
      await windowPage.setViewportSize({width,height:900});
      await expect(windowPage.getByTestId('split-pane-goal')).toBeVisible();
      const panel=windowPage.locator('.pane-context-panel');expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
      expect(await windowPage.locator('.terminal-pane-frame').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
      await expect(windowPage.getByTestId('split-attention')).toHaveAttribute('data-attention-state','running');
    }
    await windowPage.locator('.terminal-pane-frame').screenshot({path:`${screenshots}/split-panel-${windowPage===page?'first':'second'}-window.png`});
    await windowPage.evaluate(()=>{const s=window.__termfleetWorkspaceStore!;const st=s.getState();s.setState({workspaceUiState:{...st.workspaceUiState,workspaceMode:'canvas',primarySidebarPanel:'map'},canvasState:{...st.canvasState,nodes:st.canvasState.nodes.map(n=>({...n,topicLabel:'Fix audio sync'}))}});});
    await expect(windowPage.getByTestId('canvas-terminal-topic')).toHaveText('Fix audio sync');
    await expect(windowPage.getByTestId('canvas-terminal-node-goal')).toContainText('Keep all user context');
  }
  await other.close();
});
test('short topic stays stable across activity and manual renaming updates the shared presentation',async({page})=>{
  await seed(page);const row=page.getByTestId('sidebar-map-node-goal-row').first();
  const first=await row.textContent();
  await page.evaluate(()=>{const s=window.__termfleetWorkspaceStore!;const st=s.getState();s.setState({tabs:st.tabs.map(t=>({...t,terminals:t.terminals.map(p=>({...p,statusSummary:{...p.statusSummary!,now:'Editing another file',status:'working',updatedAt:Date.now()}}))}))});});
  await expect(row).toHaveText(first!);
  await page.evaluate(()=>window.__termfleetWorkspaceStore!.getState().renameCanvasNode('panel-pane','Fix audio sync'));
  await expect(row).toHaveText('Fix audio sync');await expect(page.getByTestId('canvas-terminal-topic')).toHaveText('Fix audio sync');
  await expect(row).toHaveAttribute('data-topic-source','operator-label');
  await page.getByTestId('map-local-services').screenshot({path:`${screenshots}/sidebar-default-collapsed.png`});
});

test('two panes in the same folder keep independent goals and activity',async({page})=>{
  await seed(page,{explicit:true});
  await page.evaluate(()=>{const s=window.__termfleetWorkspaceStore!;const st=s.getState();const t=st.tabs[0];const first=t.terminals[0];const at=Date.now();
    s.setState({workspaceUiState:{...st.workspaceUiState,workspaceMode:'split',primarySidebarPanel:'sessions'},tabs:[{...t,
      splitLayout:{id:'split-root',type:'split',direction:'horizontal',sizes:[50,50],children:[{id:'panel-pane',type:'terminal'},{id:'other-pane',type:'terminal'}]},
      terminals:[first,{...first,id:'terminal-panel-tab-other-pane',paneId:'other-pane',providerSessionId:'other-chat',mainUserAsk:{text:'Redesign landing page',source:'manual',updatedAt:at},terminalVisibleText:'✻ Churned for 36s · done 20:42',terminalVisibleTextUpdatedAt:at,statusSummary:{...first.statusSummary!,sessionId:'other-chat',task:'Redesign landing page',userTask:'Redesign landing page',now:'Finished landing page update',status:'idle',updatedAt:at}}]}]} as never);
  });
  const first=page.locator('.terminal-pane-frame').filter({has:page.getByText('Keep all user context and instructions between conversations',{exact:true}).first()});
  const second=page.locator('.terminal-pane-frame').filter({has:page.getByText('Redesign landing page',{exact:true}).first()});
  await expect(first.getByTestId('split-pane-goal')).toContainText('Keep all user context');await expect(first.getByTestId('split-attention')).toHaveAttribute('data-attention-state','running');
  await expect(second.getByTestId('split-pane-goal')).toContainText('Redesign landing page');await expect(second.getByTestId('split-pane-task-row')).not.toContainText('dropoffs');await expect(second.getByTestId('split-attention')).toHaveAttribute('data-attention-state','idle');
  await page.screenshot({path:`${screenshots}/split-two-pane-isolation.png`});
});

test('agent-button map cards use the same readable Goal and current status',async({page})=>{
  await seed(page,{explicit:true});
  await page.evaluate(()=>{const s=window.__termfleetWorkspaceStore!;const st=s.getState();s.setState({tabs:st.tabs.map(t=>({...t,workstream:{kind:'agent',provider:'claude',providerSessionId:'panel-chat',status:'running',phase:'active',cwd:t.initialCwd,prompt:'Keep all user context and instructions between conversations',mission:'Keep all user context and instructions between conversations',statusSummary:t.terminals[0].statusSummary}}))} as never);});
  const card=page.getByTestId('canvas-agent-status-block');await expect(card).toBeVisible();
  await expect(card.getByTestId('canvas-agent-node-goal')).toContainText('Keep all user context');
  await expect(card.getByTestId('canvas-terminal-node-attention')).toHaveAttribute('data-attention-state','running');
  await expect(card.getByTestId('canvas-agent-node-now-row')).not.toContainText('Marking the plan task done');
  await card.screenshot({path:`${screenshots}/map-agent-button-panel.png`});
});
