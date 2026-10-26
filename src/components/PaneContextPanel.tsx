import type {PresentedGoal} from '../lib/paneContextPresentation';
import './PaneContextPanel.css';

const sourceNames: Record<string,string> = {
  operator:'Set by you', 'latest-request':'Latest request', 'pane-request':'Pane request',
  'opening-request':'Opening request', 'operator-request':'Operator request',
  declared:'Declared task', 'session-title':'Conversation title',
  'about-what':'Captured context', 'plan-explanation':'Agent plan', 'goal-task':'Declared goal',
  'agent-goal':'Agent goal', 'user-prompt':'User request', 'stated-goal':'Declared goal',
};

const sameText=(a:string,b:string)=>{
  const norm=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  return norm(a)===norm(b);
};

// Design B (owner choice, 2026-10-10): Goal → Task → Now read left to right in one band,
// small caps labels, thin dividers. A Task that only repeats the Goal is not shown twice.
export function PaneContextPanel({goal,task,now,prefix="canvas-terminal-node",compact=false}: {goal:PresentedGoal;task:string;now:string;prefix?:string;compact?:boolean}) {
  const hebrew = /[֐-׿]/.test(goal.text || task);
  const translated:Record<string,string> = {'Current activity not yet known':'הפעילות הנוכחית עדיין לא ידועה','No active agent turn':'אין כרגע פעילות של הסוכן','Waiting for your answer':'ממתין לתשובה שלך','Working — current step not yet known':'עובד — השלב הנוכחי עדיין לא ידוע','Task not yet known':'המשימה עדיין לא ידועה','Task not captured':'המשימה עדיין לא ידועה','No task declared':'עדיין לא הוגדרה משימה','No task yet':'עדיין אין משימה','Waiting for you':'ממתין לך','Finished — waiting for your next message':'סיים — ממתין להודעה הבאה שלך','Working':'עובד'};
  const localText=(text:string)=>hebrew ? translated[text] ?? text : text;
  const goalLabel = goal.kind === 'inferred' ? (hebrew ? 'מטרה משוערת' : 'Goal') : (hebrew ? 'מטרה' : 'Goal');
  const seen = goal.updatedAt ? new Date(goal.updatedAt).toLocaleString(hebrew?'he-IL':'en-GB') : '';
  const provenance = goal.kind === 'unknown' ? (hebrew?'הסוכן עוד לא הצהיר על מטרה':'The agent has not stated a goal yet') :
    `${goal.kind==='inferred'?(hebrew?'מטרה משוערת · ':'Inferred goal · '):''}${sourceNames[goal.source] ?? goal.source}${seen ? ` · ${goal.stale ? (hebrew?'מידע קודם':'Earlier context') : (hebrew?'עודכן':'Updated')} ${seen}` : ` · ${hebrew?'זמן המקור אינו ידוע':'Source time unknown'}`}`;
  const goalText = goal.text || (hebrew?'עדיין אין מטרה':'No goal yet');
  const showTask = !sameText(task,goalText);
  const stop = (event:{stopPropagation:()=>void}) => event.stopPropagation();
  const row = (label:string,value:string,testId:string,kind:'goal'|'task'|'now',hint?:string) => (
    <div className={`pane-context-row pane-context-${kind}`} data-testid={testId} data-goal-state={kind==='goal'?goal.kind:undefined}>
      <span className="pane-context-label" title={hint}>{label}</span>
      <div className="pane-context-value">
        <details className="pane-context-details" onClick={stop} onMouseDown={stop}>
          <summary title={value} aria-label={`${label}: ${value}. ${hebrew?'הצגת הטקסט המלא':'Show full text'}`}>
            <span dir="auto" data-testid={testId==='canvas-terminal-node-task-row'?'canvas-terminal-node-description':testId==='canvas-terminal-node-now-row'?'canvas-terminal-node-header-title':undefined}>{value}</span>
          </summary>
        </details>
        {kind==='goal' && <span className="pane-context-provenance" dir="auto" data-testid="pane-goal-provenance">{provenance}</span>}
      </div>
    </div>
  );
  return <section className={`pane-context-panel${compact?" pane-context-compact":""}${showTask?"":" pane-context-two"}`} aria-label={hebrew?'מטרה, משימה ופעילות נוכחית':'Goal, task and current activity'} dir={hebrew?'rtl':'ltr'}>
    {row(goalLabel,goalText,`${prefix}-goal`,'goal',provenance)}
    {showTask && row(hebrew?'משימה':'Task',localText(task),`${prefix}-task-row`,'task')}
    {row(hebrew?'עכשיו':'Now',localText(now),`${prefix}-now-row`,'now')}
  </section>;
}
