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
export function openTasks(items) {
  const seen=new Set(),groups=new Map();
  for(const it of items){
    if(it.locked || !statuses[it.status] || seen.has(it.id))continue;
    seen.add(it.id);
    const key=JSON.stringify([it.project,it.topics?.[0] || it.msgId || it.id]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(it);
  }
  const priority=['waiting','partial','assigned','new','ready'];
  return [...groups.values()].map(group=>{
    const first=group.find(it=>/[א-ת]/.test(it.words) && String(it.words).length>20) || group.find(it=>!/^Full instructions:/i.test(it.words)) || group[0];
    const text=first.topics?.includes('bot-chat-dashboard')?'תמונת מצב העבודה בתוך הצ׳אט':hebrew(plain(first.words).replace(/^Goal:\s*/i,''),'בקשה פתוחה — הנוסח המקורי בפרטים');
    const title=text.length>140?text.slice(0,137)+'…':text;
    const row={title,category:categories[first.project] || hebrew(first.project,'כללי'),status:statuses[priority.find(s=>group.some(it=>it.status===s))]};
    if(group.length>1 || title!==String(first.words || ''))row.details=group.map(it=>({text:String(it.words || ''),status:statuses[it.status]}));
    return row;
  });
}
export function activeTerminals(panes) {
  return panes.filter(p=>p.alive!==false && !p.sleeping && ['working','producing','needs-you','waiting','stuck'].includes(p.dashboardState)).map(p=>{
    const session=p.sessionAuthority?p.sessionViewV2:null;
    const title=p.operatorGoal?.text || session?.goal?.label || session?.task?.label || p.goal || p.profile?.name || p.title || p.name || p.project || '';
    const update=p.sessionAuthority ? (!session?.now?.stale ? session?.now?.label : '') : p.statedTask || p.task || '';
    const row={id:p.id,title:hebrew(title,'עבודה פעילה — הפרטים בצ׳אט'),name:plain(p.profile?.name || p.title || p.project).slice(0,80),update:hebrew(update,update?'טרם נמסר תיאור ברור בעברית; העדכון המקורי בפרטים':'עדיין לא נמסר עדכון עדכני על העבודה'),status:['needs-you','waiting'].includes(p.dashboardState)?'נדרש מענה':p.stalledForMs || p.dashboardState==='stuck'?'לא התקבל עדכון לאחרונה':'עובד כעת'};
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
