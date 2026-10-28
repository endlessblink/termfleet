const statuses = {new:'טרם התחיל',assigned:'בטיפול',partial:'עדיין לא הושלם',waiting:'נדרש מענה',ready:'מוכן לבדיקה'};
const tone = status => ({'נדרש מענה':'waiting','לא התקבל עדכון לאחרונה':'waiting','מוכן לבדיקה':'ready','בטיפול':'working','עובד כעת':'working'})[status] || 'new';
const badge = status => `<span class="work-status ${tone(status)}">${esc(status)}</span>`;
const sourceStatus = status => statuses[status] || ({done:'נרשמה השלמה',answered:'נרשם מענה',dropped:'הבקשה הוסרה',context:'מידע והסבר'})[status] || 'המצב דורש בירור';
const categories = {termfleet:'סביבת העבודה',termcontrol:'שליטה מהטלפון','agent-manager':'ניהול העבודה','health-app':'יומן הבריאות','health-coach_dev':'יומן הבריאות','freelance-desk':'סביבת העבודה המקצועית'};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain = value => String(value || '').replace(/\bR-\d+\b/g,'').replace(/\s+/g,' ').trim();
const translations = {'Food log speed':'שיפור מהירות יומן האוכל','Dashboard in existing UI':'תמונת מצב בתוך הממשק הקיים','Running export':'מייצא את הנתונים','Prompt submitted':'קיבל את המשימה ומתחיל לעבוד'};
const readable = value => translations[plain(value)] || plain(value);
const hebrew = (value, fallback) => {
  const text=readable(value);
  return /[א-ת]/.test(text) && !/(?:\/\w+\/|\b(?:npm|node|cargo|git|API|SQL)\b|```)/i.test(text) ? text : fallback;
};
const topicTitles = {
  'bot-chat-dashboard':'תמונת מצב העבודה בתוך הצ׳אט',
  'sql-enforcement':'שמירת היסטוריית העבודה במסד הנתונים',
  'session-logs':'שמירת תיעוד השיחות והעבודה',
  'open-tasks-panel':'רשימת המשימות שטרם נפתרו',
  'terminal-auto-healthcheck':'בדיקת תקינות אוטומטית לטרמינלים',
  'terminal-permissions':'אישורי פעולה לטרמינלים',
  'termfleet-screen-rule':'שמירה על המסך פנוי בזמן עבודת הסוכנים',
  'termfleet-reliability':'שיפור אמינות סביבת העבודה',
  'bot-reliability':'שיפור אמינות הבוט',
  'bot-throughput':'שיפור קצב העבודה של הבוט',
  'remove-requests-panel':'הסרת לוח הבקשות מהצ׳אט',
  'remove-try-panel':'הסרת לוח הבדיקות מהצ׳אט',
  'token-monitoring':'מעקב אחר שימוש ועלויות',
  'agent-event-history':'היסטוריית פעילות הסוכנים',
  'scroll-stuck':'תיקון גלילה תקועה בצ׳אט',
  'scroll-jump-to-top':'מניעת קפיצה לראש הצ׳אט',
  'stale-map-terminals':'הסרת טרמינלים ישנים ממפת העבודה',
  'terminal-map-mismatch':'התאמת מפת העבודה לטרמינלים הפעילים',
  'instant-answers-while-busy':'מענה להודעות בזמן העבודה',
  'options-with-link':'קישורים לצפייה בכל אפשרות לבחירה',
  'obsidian-complaints-list':'ריכוז התקלות ומעקב אחר פתרונן',
  'sidebar-folders':'תיקיות למיון ולהסתרה של שיחות לפי נושא',
  'agent-animation':'הצגת אנימציות בתוך הצ׳אט',
  'agent-animationterminal-permissions':'הצגת אנימציות ואישורי פעולה בצ׳אט',
};
// Feedback stays in the topic details, never in the task heading.
const taskText = value => {
  const text=plain(value).replace(/^Goal:\s*/i,'');
  if(/^(?:Full instructions:|Bot registry|Validated checkout|Registry snapshot|אם אתה|תכניס את זה|לא עשית|זה חסר|כישלון|לפחות \d|בוא נלך)/i.test(text))return '';
  return /(?:תיקון|בדיק|שיפור|שמירת|הוספת|הסרת|לתקן|לבדוק|לשפר|לשלב|להוסיף|להסיר|לבנות|להציג|רשימ|פאנל|(?:^|\s)(?:צור|תיצור|תוסיף|תסיר|תתקן|תסדר|תבדוק|תשפר|תבנה|תציג|תשמור|תעדכן)|\b(?:fix|investigate|inspect|build|verify|improve|add|remove)\b)/i.test(text)?text:'';
};
const shortWork = value => {
  const text=readable(value);
  if(hebrew(text,''))return text;
  const phrases=[
    [/\bClaude\b.*\bresearch only\b/i,'מחקר בעזרת Claude ללא שינוי הקבצים'],
    [/^Reading the plan(?: file)? and /i,'קריאת תוכנית העבודה והשינויים הקשורים אליה'],
    [/^Read(?:ing)? \/.*(?:HANDOFF|instructions|child-tasks)/i,'קריאת הוראות המשימה והמשך הטיפול'],
    [/fixes.*(?:exercises|excersizes).*hardcoded/i,'תיקון התאמת התרגילים לבקשות בצ׳אט'],
    [/\bClaude\b.*\bmulti-file\b.*\bbuild/i,'בניית השינוי בכמה קבצים בעזרת Claude'],
    [/dashboard.*(?:data|quality)|(?:data|quality).*dashboard/i,'שיפור המידע בתמונת המצב'],
    [/dashboard/i,'שיפור תמונת המצב'],
    [/show the animation.*chat/i,'הצגת אנימציות בתוך הצ׳אט'],
    [/^inspect monthly totals$/i,'בדיקת הסכומים החודשיים'],
    [/^(?:inspect|investigate) \/.*\.(?:log|txt)(?: for(?: .*)?)?$/i,'בדיקת יומן הפעילות'],
  ];
  // Unknown wording stays visible rather than inventing a translation or progress.
  return phrases.find(([pattern])=>pattern.test(text))?.[1] || text.slice(0,100);
};
export function openTasks(items) {
  const seen=new Set(),groups=new Map();
  for(const it of items){
    if(it.locked || !statuses[it.status] || seen.has(it.id))continue;
    seen.add(it.id);
    const topic=plain(it.topic || it.topics?.[0]);
    if(!topic)continue;
    const key=JSON.stringify([it.project,topic]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(it);
  }
  const priority=['waiting','partial','assigned','new','ready'];
  return [...groups.values()].flatMap(group=>{
    const first=group.find(it=>taskText(it.words)) || group[0];
    const topic=plain(first.topic || first.topics?.[0]);
    const text=topicTitles[topic] || hebrew(taskText(first.words),'') || (taskText(first.words)?shortWork(first.words):'');
    if(!text)return [];
    const title=text.length>140?text.slice(0,137)+'…':text;
    const row={title,category:categories[first.project] || hebrew(first.project,'כללי'),status:statuses[priority.find(s=>group.some(it=>it.status===s))]};
    if(group.length>1 || title!==String(first.words || ''))row.details=group.map(it=>({text:String(it.words || ''),status:statuses[it.status]}));
    return [row];
  });
}

const receiptTime = value => {
  const time=typeof value==='number'?value:Date.parse(value || '');
  return Number.isFinite(time) && time>0?time:0;
};
const safeTarget = value => {
  try { const url=new URL(value);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};
// Read-only interpretation, never a ledger transition. targetChecks must come from an
// actual target visit/check, not from the ready label or the author's claim of a link.
// Unknown metadata is deliberately left open. The UI must not invent a test handoff.
export function projectWork(items,{targetChecks=new Map(),now=Date.now()}={}) {
  const groups=new Map(),seen=new Set();
  for(const item of items){
    if(!item || seen.has(item.id))continue;
    seen.add(item.id);
    const topic=plain(item.topic || item.topics?.[0]);
    const history=item.locked || ['done','answered','dropped'].includes(item.status);
    const family=history?'history':item.status==='context' || item.kind==='context'?'context':item.kind==='machine' || item.testing?.kind==='machine'?'machine':'delivery';
    // A topic alone is not evidence that separate messages ask for one deliverable.
    const identity=item.deliverableId || (topic && item.msgId ? `${topic}:${item.msgId}` : item.id);
    const key=JSON.stringify([item.source,item.project,identity,family]);
    if(!groups.has(key))groups.set(key,{family,items:[]});
    groups.get(key).items.push(item);
  }
  return [...groups.values()].map(({family,items:group})=>{
    const first=group[0],reasons=[];
    const tests=group.map(item=>{
      const t=item.testing || {},check=t.targetCheck?.method==='ready-link-check'?t.targetCheck:targetChecks.get(t.link),at=receiptTime(item.statusAt);
      if(item.status!=='ready')reasons.push(`${item.id}:delivery-open`);
      const action=plain(t.tryText);
      const ownerAction=/(?:^|\s)(?:(?:פתח|פתחי|לחץ|לחצי|גלול|גללי|בחר|בחרי|הקלד|הקלידי|שלח|שלחי|גרור|גררי|השווה|השווי|צפה|צפי)(?:\s|$)|(?:open|click|scroll|select|choose|type|send|drag|compare|watch)\b)/i.test(action);
      if(action.split(/\s+/).length<3 || !ownerAction || /(?:\b(?:npm|cargo|node|sql|backend|unit test)\b|```)/i.test(action))reasons.push(`${item.id}:specific-owner-action-missing`);
      if(plain(t.expected).length<8)reasons.push(`${item.id}:observable-outcome-missing`);
      if(!safeTarget(t.link) || t.artifact!==t.link)reasons.push(`${item.id}:delivered-target-missing`);
      if(!at || !(item.evidence || []).some(e=>e.scope!=='machine' && receiptTime(e.at)>=at && String(e.what || '').includes(t.artifact) && String(e.what || '').length>String(t.artifact || '').length+12))reasons.push(`${item.id}:delivery-evidence-missing`);
      const checkedAt=receiptTime(check?.checkedAt);
      if(!check || check.reachable!==true || checkedAt<at || checkedAt>now || now-checkedAt>15*60*1000)reasons.push(`${item.id}:target-unverified-or-unavailable`);
      return {action,expected:plain(t.expected),link:t.link};
    });
    if(new Set(tests.map(t=>t.link)).size>1)reasons.push('group:delivered-target-needs-review');
    const bucket=family==='delivery'?(reasons.length?'open':'owner'):family;
    const topic=plain(first.topic || first.topics?.[0]);
    const fallback={context:'הסבר שנשמר עם הבקשה',machine:'בדיקה שנמסרה למערכת',history:'תוצאה קודמת שנשמרה'}[family] || 'נדרש בירור של הבקשה';
    const text=topicTitles[topic] || hebrew(taskText(first.words),'') || fallback;
    return {title:text,category:categories[first.project] || hebrew(first.project,'כללי'),bucket,
      status:bucket==='owner'?'מוכן להתנסות':bucket==='open'?'נדרש המשך טיפול':bucket==='machine'?'בדיקה של המערכת':bucket==='context'?'מידע והסבר':'תוצאה שנרשמה',
      reasons:family==='delivery'?reasons:[`${family}:source-authority`],
      ...(bucket==='owner'?{ownerAction:{action:[...new Set(tests.map(t=>t.action))].join(' · '),expected:[...new Set(tests.map(t=>t.expected))].join(' · '),link:tests[0].link}}:{}),
      details:group.map(it=>({id:it.id,text:String(it.words || ''),status:it.status,source:it.source,msgId:it.msgId,part:it.part,of:it.of,locked:it.locked,confirmedBy:it.confirmedBy,note:it.note,evidence:it.evidence,testing:it.testing}))};
  });
}
export function activeTerminals(panes) {
  return panes.filter(p=>p.alive!==false && !p.sleeping && ['working','producing','needs-you','waiting','stuck'].includes(p.dashboardState)).map(p=>{
    const session=p.sessionAuthority?p.sessionViewV2:null;
    const title=p.operatorGoal?.text || session?.goal?.label || session?.task?.label || p.goal || p.profile?.name || p.title || p.name || p.project || '';
    const update=p.sessionAuthority ? (!session?.now?.stale ? session?.now?.label : '') : p.statedTask || p.task || '';
    const name=plain(p.profile?.name || p.name || p.title || p.project).slice(0,80);
    const assignedWork=!update ? p.operatorGoal?.text || session?.goal?.label || session?.task?.label || p.goal || p.title || (shortWork(name)!==name?name:'') : '';
    const row={id:p.id,title:hebrew(title,name),name,update:hebrew(update,update?'עובד על: '+shortWork(update):assignedWork?(p.sessionAuthority?'המשימה: ':'עובד על: ')+shortWork(assignedWork):'עדיין לא נמסר עדכון עדכני על העבודה'),status:['needs-you','waiting'].includes(p.dashboardState)?'נדרש מענה':p.stalledForMs || p.dashboardState==='stuck'?'לא התקבל עדכון לאחרונה':'עובד כעת'};
    if(update && !hebrew(shortWork(update),'')){
      const task=[title,name].map(shortWork).find(text=>hebrew(text,''));
      if(task)row.update='המשימה: '+task;
    }
    if(/^\[Message from an orchestrating agent/i.test(plain(update)))row.update='עובד על: '+shortWork(title || name);
    if(row.title!==title || (update && row.update!==update))row.details={title,update};
    return row;
  });
}
export function mountWorkDashboard({host,button,botId,isCurrent}) {
  host.innerHTML='<div class="work-heading"><h2>תמונת מצב</h2><button type="button" aria-label="סגירת תמונת המצב">×</button></div><p class="work-fresh" role="status">טוען את המצב הנוכחי…</p><section aria-labelledby="work-tasks-title"><h3 id="work-tasks-title">משימות פתוחות</h3><p class="work-category">הבקשות לבוט הזה, לפי נושא</p><div data-work="tasks" tabindex="0" role="region" aria-label="רשימת המשימות הפתוחות"></div></section><section aria-labelledby="work-terminals-title"><h3 id="work-terminals-title">טרמינלים פעילים</h3><div data-work="terminals" tabindex="0" role="region" aria-label="רשימת הטרמינלים הפעילים"></div></section>';
  host.hidden=false;
  const close=()=>{host.classList.remove('expanded');button.setAttribute('aria-expanded','false');button.focus();};
  button.onclick=()=>{const open=host.classList.toggle('expanded');button.setAttribute('aria-expanded',String(open));if(open)host.querySelector('button').focus();};
  host.querySelector('button').onclick=close;
  host.onkeydown=e=>{if(e.key==='Escape')close();};
  let busy=false,stopped=false;
  const rendered=new Map();
  const paint=(key,html)=>{const el=host.querySelector(`[data-work="${key}"]`);if(rendered.get(key)!==html){el.innerHTML=html;rendered.set(key,html);}};
  const read=async (url,key)=>{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('read failed');const data=await r.json();if(!data || !Array.isArray(data[key]) || data[key].some(item=>!item || typeof item!=='object') || (key==='panes' && typeof data.daemon!=='boolean'))throw Error('invalid data');return data;};
  const refresh=async()=>{
    if(busy || stopped || !isCurrent())return;
    busy=true;
    try {
    const results=await Promise.allSettled([read('/api/requirements?dashboard=1&closed=1&source='+encodeURIComponent('bot:'+botId),'items'),read('/api/work-terminals','panes')]);
    if(stopped || !isCurrent()){busy=false;return;}
    const [tasks,terminals]=results;
    if(tasks.status==='fulfilled'){
      const rows=projectWork(tasks.value.items || []);
      host.querySelector('#work-tasks-title').textContent=`עבודה ומידע · ${rows.length}`;
      const groups=new Map();
      const labels={open:'עבודה פתוחה',machine:'בדיקות של המערכת',owner:'התנסות או בחירה שלך',context:'מידע והסבר',history:'תוצאות שנרשמו'};
      for(const row of rows){const key=`${labels[row.bucket]} · ${row.category}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
      const sections=['owner','open','machine','context','history'].map(bucket=>{
        const entries=[...groups].filter(([,items])=>items[0].bucket===bucket);
        const content=entries.map(([category,items])=>`<div class="work-group"><h4 class="work-group-label" dir="auto">${esc(category)}</h4><ul>${items.map(r=>`<li class="work-item ${tone(r.status)}" data-work-kind="${esc(r.bucket)}"><div class="work-body"><p dir="auto">${esc(r.title)}</p>${badge(r.status)}${r.ownerAction?`<p dir="auto">מה לנסות: ${esc(r.ownerAction.action)}</p><p dir="auto">מה אמור לקרות: ${esc(r.ownerAction.expected)}</p><a href="${esc(r.ownerAction.link)}" target="_blank" rel="noopener noreferrer">פתיחת התוצאה</a>`:r.bucket==='open'?'<p class="work-update">עדיין חסרים מסירה, הוכחה או הוראות התנסות שאפשר לאמת.</p>':''}<details><summary>הבקשות המקוריות והמצב שלהן</summary>${r.details.map(d=>`<p dir="auto">${esc(d.text)} ${badge(sourceStatus(d.status))}<small dir="auto"> ${esc([d.id,d.source,d.msgId,d.part?`${d.part}/${d.of || '?'}`:''].filter(Boolean).join(' · '))}</small></p>${d.locked?'<p>נשמרה נעילת התוצאה המקורית.</p>':''}${d.note?`<p dir="auto">${esc(d.note)}</p>`:''}${(d.evidence || []).map(e=>`<p dir="auto">הוכחה שנרשמה: ${esc(e.what)}</p>`).join('')}`).join('')}</details></div></li>`).join('')}</ul></div>`).join('');
        if(!content)return '';
        return ['context','history'].includes(bucket)?`<details data-work-section="${bucket}"><summary>${labels[bucket]} · ${entries.reduce((sum,[,items])=>sum+items.length,0)}</summary>${content}</details>`:content;
      }).join('');
      paint('tasks',sections || '<p class="work-empty">אין עבודה או מידע להצגה כרגע.</p>');
    }else {host.querySelector('#work-tasks-title').textContent='משימות פתוחות';paint('tasks','<p class="work-empty">לא ניתן לטעון את המשימות. ננסה שוב אוטומטית.</p>');}
    if(terminals.status==='fulfilled'){
      const data=terminals.value;
      if(data.daemon===false)paint('terminals','<p class="work-empty">אין כרגע חיבור לטרמינלים. המצב אינו ידוע.</p>');
      else{
        const rows=activeTerminals(data.panes || []);
        paint('terminals',rows.length?`<ul>${rows.map(r=>`<li class="work-terminal ${tone(r.status)}"><span class="work-dot" aria-hidden="true"></span><div class="work-body"><a href="#${encodeURIComponent(r.id)}" dir="auto" title="${esc(r.title)}">${esc(r.name || r.title)}</a><p class="work-update" dir="auto" title="${esc(r.update)}">${esc(r.update)}</p><details><summary>פרטים</summary><p dir="auto">${esc(r.title)}</p><p dir="auto">${esc(r.update)}</p>${r.details?`<p dir="auto">${esc(r.details.title)}</p><p dir="auto">${esc(r.details.update)}</p>`:''}</details></div>${badge(r.status)}</li>`).join('')}</ul>`:'<p class="work-empty">אין טרמינלים שעובדים כרגע.</p>');
      }
    }else paint('terminals','<p class="work-empty">לא ניתן לטעון את הטרמינלים. ננסה שוב אוטומטית.</p>');
    host.querySelector('.work-fresh').textContent=results.every(r=>r.status==='fulfilled') && terminals.value.daemon?`עודכן ב־${new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}`:'חלק מהמידע אינו זמין כרגע';
    } finally { busy=false; }
  };
  refresh();const timer=setInterval(refresh,15000);
  return ()=>{stopped=true;clearInterval(timer);host.hidden=true;host.classList.remove('expanded');};
}
