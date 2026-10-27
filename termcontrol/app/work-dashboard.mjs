const statuses = {new:'טרם התחיל',assigned:'בטיפול',partial:'עדיין לא הושלם',waiting:'נדרש מענה',ready:'מוכן לבדיקה'};
const tone = status => ({'נדרש מענה':'waiting','לא התקבל עדכון לאחרונה':'waiting','מוכן לבדיקה':'ready','בטיפול':'working','עובד כעת':'working'})[status] || 'new';
const badge = status => `<span class="work-status ${tone(status)}">${esc(status)}</span>`;
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
    const results=await Promise.allSettled([read('/api/requirements?dashboard=1&source='+encodeURIComponent('bot:'+botId),'items'),read('/api/work-terminals','panes')]);
    if(stopped || !isCurrent()){busy=false;return;}
    const [tasks,terminals]=results;
    if(tasks.status==='fulfilled'){
      const rows=openTasks(tasks.value.items || []);
      host.querySelector('#work-tasks-title').textContent=`משימות פתוחות · ${rows.length}`;
      const groups=new Map();
      for(const row of rows){if(!groups.has(row.category))groups.set(row.category,[]);groups.get(row.category).push(row);}
      paint('tasks',rows.length?[...groups].map(([category,items])=>`<div class="work-group"><h4 class="work-group-label" dir="auto">${esc(category)}</h4><ul>${items.map(r=>`<li class="work-item ${tone(r.status)}"><div class="work-body"><p dir="auto">${esc(r.title)}</p>${badge(r.status)}${r.details?`<details><summary>הבקשות המקוריות והמצב שלהן</summary>${r.details.map(d=>`<p dir="auto">${esc(d.text)} ${badge(d.status)}</p>`).join('')}</details>`:''}</div></li>`).join('')}</ul></div>`).join(''):'<p class="work-empty">אין משימות פתוחות כרגע.</p>');
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
