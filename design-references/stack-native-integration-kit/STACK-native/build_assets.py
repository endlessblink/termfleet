from pathlib import Path
import json
P=Path(__file__).parent
# Native path geometry. Each record has its own anatomy rather than a shared D1 base.
def part(d,c='shell'): return f'<path class="stack-{c}" d="{d}"/>'
def shape(parts):return ''.join(part(d,c) for c,d in parts)
D=[]
def add(id,name,crop,head,parts,crest=None):
 x,y,w,h=head
 # A physical material face, never a display rectangle or dark visor.
 parts += [('shell',f'M{x+5} {y}H{x+w-5}Q{x+w} {y} {x+w} {y+5}V{y+h-5}Q{x+w} {y+h} {x+w-5} {y+h}H{x+5}Q{x} {y+h} {x} {y+h-5}V{y+5}Q{x} {y} {x+5} {y}Z')]
 if crest:parts+=crest
 D.append(dict(id=id,name=name,crop=crop,face=[x,y,w,h],anatomy=shape(parts)))
add('builder','Builder','translate(-10px, -1px) scale(1.32)',(20,5,24,17),[
('joint','M12 23H52L55 44 46 48 45 61H34L32 48 30 61H18L17 48 8 43Z'),
('shell','M18 21H46Q51 22 51 28L47 40H17L13 28Q13 22 18 21Z'),
('accent','M18 32H47L44 41H21Z'),('accent','M12 20Q4 18 3 26Q2 33 9 34L17 31Q20 24 12 20Z'),('accent','M50 21Q60 20 61 28Q62 33 55 35L48 31Q45 24 50 21Z'),
('shell','M7 32Q4 32 3 38V44Q3 49 8 50L13 48Q19 46 17 41L14 35Q12 31 7 32Z'),('shell','M53 33Q59 33 60 39L61 45Q61 49 55 51L50 49Q44 45 47 40L49 35Z'),
('accent','M21 43H43L41 51H23Z'),('shell','M19 49 29 50 28 61H15L17 54Z'),('shell','M35 50 45 49 48 61H34Z')], [('accent','M25 6H39Q44 7 43 14L41 20H23L21 14Q20 8 25 6Z')])
add('editor','Editor','translate(-17px, 0px) scale(1.52)',(24,6,17,16),[
('joint','M22 22H43L43 34 39 40 39 61H34L32 44 29 61H24L25 40 21 32Z'),
('shell','M21 22 42 23 39 34 25 35Z'),('accent','M27 22H36L37 28H28Z'),
('accent','M19 24Q23 24 22 30L20 43Q17 49 12 51L12 42Q13 32 16 27Z'),('accent','M43 25Q46 23 48 28L52 43Q53 48 46 51L42 42Z'),
('shell','M23 45 29 45 28 60H19Z'),('accent','M24 45H29L27 58H21Z'),('shell','M34 45H40L45 60H33Z')], [('accent','M29 7 31 1H35L37 13 32 14Z')])
add('designer','Designer','translate(-9px, -10px) scale(1.30)',(20,15,25,16),[
('joint','M11 34 22 29H43L54 34 49 45 42 48 46 60H33L30 49 28 60H14L19 48 10 44Z'),
('shell','M16 29H47L50 37 43 45H21L13 37Z'),('accent','M20 38H43L39 45H24Z'),
('accent','M11 29Q17 28 20 34Q22 38 15 42L9 43Q3 40 4 35Q5 30 11 29Z'),('accent','M50 30Q58 29 60 37Q62 43 54 44L49 43Q43 39 44 35Q45 31 50 30Z'),
('shell','M9 40Q15 38 17 44L20 49Q20 53 12 55L7 53Q2 51 4 46Z'),('shell','M52 41Q58 40 60 46L60 50Q59 54 51 56L45 52Q42 49 46 45Z'),
('accent','M18 51 28 51 28 60H11Z'),('accent','M35 51H44L52 60H35Z')], [('accent','M19 18 7 14 10 23 20 26ZM45 18 57 14 54 23 45 26Z'),('accent','M25 15H40Q45 16 44 23L42 28H22L20 23Q20 17 25 15Z')])
add('planner','Planner','translate(-11px, -1px) scale(1.34)',(23,7,22,16),[
('joint','M19 25 40 21 49 29 44 42 45 61H35L32 44 29 59H18L20 43 11 35Z'),
('shell','M18 25 38 22 47 29 41 41 23 40 14 33Z'),('accent','M16 23 24 24 21 32 11 31Z'),('accent','M41 22 52 28 50 36 43 36Z'),
('shell','M10 33 22 34 20 47 9 49 5 43Z'),('accent','M7 35 15 35 18 43 9 45Z'),('accent','M48 37 55 40 54 49 46 50 43 43Z'),
('shell','M20 47 29 46 28 60H14Z'),('accent','M35 47 44 43 49 60H35Z')],[('accent','M23 8 21 2 26 1 35 6 30 11Z'),('accent','M38 8 45 11V20L37 23Z')])
add('researcher','Researcher','translate(-12px, -1px) scale(1.40)',(25,5,16,13),[
('joint','M11 25H54L53 47 43 48 42 61H34L33 46 29 61H21L21 47 10 42Z'),
('shell','M18 18Q32 14 46 20Q53 25 50 36Q47 44 33 45Q18 44 15 35Q12 24 18 18Z'),
('accent','M18 32Q32 40 48 32L48 38Q34 48 19 39Z'),
('joint','M13 23 18 26 10 43 7 41ZM48 24 53 25 59 42 54 44Z'),
('accent','M5 39 12 42 14 54 5 55 2 49Z'),('accent','M53 41 60 38 63 49 59 55 51 52Z'),
('accent','M20 48 28 47 28 60H15Z'),('accent','M35 48 43 48 48 60H35Z')],[('accent','M24 7 22 10 24 15H27V7ZM40 7 44 9V14L40 16Z')])
add('communicator','Communicator','translate(-11px, -1px) scale(1.36)',(25,4,17,14),[
('joint','M7 24 17 20 48 20 57 24 49 41 40 45 39 61H33L31 47 28 61H20L23 43 16 37Z'),
('shell','M10 19 31 22 54 19 48 34 37 42 26 40 16 32Z'),
('accent','M6 19 18 21 18 31 11 30Z'),('accent','M44 21 58 19 54 31 46 33Z'),
('shell','M10 34 18 34 19 44 14 48 6 43Z'),('shell','M48 33 57 32 60 43 52 47 46 40Z'),
('accent','M23 49 28 45 29 60H17Z'),('accent','M34 46 40 49 47 60H35Z'),('accent','M25 33H43L37 40H29Z')])
add('writer','Writer','translate(-2px, 0px) scale(1.07)',(11,7,43,25),[
('joint','M21 34H43L43 46 38 50 42 60H32L30 50 28 60H17L23 49 19 44Z'),
('shell','M25 32H38L41 41 37 47H27L23 41Z'),
('accent','M17 36 24 36 25 43 18 49 13 44Z'),('accent','M41 35 48 38 50 45 43 49 38 43Z'),
('shell','M21 49 28 50 28 60H15Z'),('shell','M34 50 40 49 46 60H33Z'),
('accent','M9 12Q3 14 5 25L12 29V12ZM53 12Q61 13 60 24L54 29Z')],[('accent','M15 7H21L19 29Q11 26 11 18V12Z')])
add('operator','Operator','translate(-18px, -2px) scale(1.56)',(25,4,17,15),[
('joint','M23 20H43L40 33 38 39 40 61H34L32 42 29 61H24L26 37 24 31Z'),
('shell','M22 20 42 21 38 31H27Z'),('accent','M28 21H38L37 27H30Z'),
('joint','M21 23H25L20 43H16ZM40 23H44L50 43H46Z'),
('accent','M16 39 21 41 20 49 15 52 12 46Z'),('accent','M45 41 50 40 53 47 49 52 44 48Z'),
('accent','M24 44 29 44 28 60H18Z'),('shell','M35 44H40L46 60H34Z')],[('accent','M24 8 21 10V16H25ZM41 8 45 10V16H41Z')])
add('coordinator','Coordinator','translate(-9px, -6px) scale(1.28)',(21,11,23,16),[
('joint','M12 27H53V46L44 48 45 61H33L32 49 29 61H17L18 48 10 42Z'),
('shell','M16 26H47L49 39 44 45H21L15 37Z'),('accent','M20 37H45V44H21Z'),
('accent','M6 25H15L18 32 13 39H5Z'),('accent','M49 26H59V40L52 41 47 34Z'),
('accent','M5 39H14L17 50 11 54 4 50Z'),('accent','M51 40H60L60 51 52 55 47 49Z'),
('shell','M18 48H29L28 60H12Z'),('shell','M34 49H45L50 60H34Z')])
add('maker','Maker','translate(-15px, -1px) scale(1.45)',(26,5,16,14),[
('joint','M22 20 42 20 44 34 40 49 45 61H35L32 53 28 61H17L23 49 20 36Z'),
('shell','M20 20H44L40 46 37 56H27L23 46Z'),('accent','M29 24H37L36 56H29Z'),
('accent','M16 20 23 22 22 34 15 33Z'),('accent','M42 21 49 23 48 34H41Z'),
('shell','M15 34H22L23 43 18 47 12 42Z'),('shell','M43 35H49L52 43 47 47 42 41Z'),
('accent','M21 50 29 53 27 61H12Z'),('accent','M36 54 43 50 52 61H37Z')],[('accent','M31 6 32 1H35L37 9H31Z')])
add('strategist','Strategist','translate(-8px, -2px) scale(1.24)',(22,7,29,18),[
('joint','M14 27 31 25 46 32 42 45 42 61H32L30 48 26 61H16L20 45 9 36Z'),
('shell','M20 25 42 27 46 37 36 44 23 41 16 32Z'),('accent','M22 34 41 35 37 42H26Z'),
('accent','M10 25 20 25 22 34 12 42 4 36Z'),('shell','M5 39 15 38 21 51 10 55 3 49Z'),
('accent','M46 31 53 33 57 43 50 47 45 42Z'),('shell','M19 49 27 48 26 60H12Z'),('accent','M34 49 42 47 49 60H33Z')],[('accent','M23 7 31 9 29 23 22 21Z')])
add('explorer','Explorer','translate(-9px, -9px) scale(1.28)',(22,13,23,14),[
('joint','M13 27H50L55 37 44 45 45 55H39L35 44 33 62H27L27 44 21 56H14L17 43 8 36Z'),
('shell','M18 25H48L49 34 40 42H26L15 34Z'),('accent','M26 35H39L38 43H28Z'),
('shell','M10 29 18 28 21 35 12 43 5 38Z'),('shell','M48 28 56 31 62 40 56 46 47 38Z'),
('accent','M13 45 22 45 20 59H8Z'),('accent','M26 44H35L35 63H26Z'),('accent','M41 44 49 47 56 60H43Z')],[('accent','M23 14Q32 7 44 15L46 21 42 22Q31 16 20 22Z')])
(P/'members.json').write_text(json.dumps(D,indent=2))
# The public runtime is generated from these hand-authored native paths.
base=(P/'runtime-template.js').read_text()
(P/'stack-avatars.js').write_text(base.replace('__MEMBERS__',json.dumps(D,separators=(',',':'))))
print('12 native anatomy records created')
