import re,sys,os,glob,difflib
ROOT='/home/user/couranr-os'
MIG=sorted(glob.glob(ROOT+'/supabase/migrations/*.sql'))
QVL='20260902100000_couranr_quote_validity_and_policy_pin.sql'
RB=ROOT+'/supabase/rollbacks/20260902100000_couranr_quote_validity_and_policy_pin.rollback.sql'
def extract(txt,name):
    out=[]
    for m in re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+'+re.escape(name)+r'\s*\(', txt, re.I):
        start=m.start()
        m2=re.search(r'\bas\s+(\$[A-Za-z_]*\$)', txt[start:], re.I)
        if not m2: continue
        tag=m2.group(1); bodystart=start+m2.end()
        end=txt.find(tag,bodystart)
        out.append(txt[start:end+len(tag)+1])
    return out
def norm(s):
    # strip SQL comments and normalize whitespace
    s=re.sub(r'/\*.*?\*/','',s,flags=re.S)
    s=re.sub(r'--[^\n]*','',s)
    s=re.sub(r'\s+',' ',s)
    return s.strip()
names=sys.argv[1:]
rbtxt=open(RB).read()
for name in names:
    pre=None; presrc=None
    for p in MIG:
        if os.path.basename(p)==QVL: continue
        ds=extract(open(p).read(),name)
        if ds: pre=ds[-1]; presrc=os.path.basename(p)
    fwd=None
    ds=extract(open(ROOT+'/supabase/migrations/'+QVL).read(),name)
    if ds: fwd=ds[-1]
    rb=extract(rbtxt,name)
    print('#### %s'%name)
    print('   pre-QVL last def from: %s'%presrc)
    print('   rollback defs found: %d'%len(rb))
    if pre is None or not rb:
        print('   *** MISSING'); continue
    a=norm(pre); b=norm(rb[-1])
    print('   NORMALIZED IDENTICAL to pre-QVL: %s'%(a==b))
    if a!=b:
        for line in difflib.unified_diff(a.split(' '),b.split(' '),lineterm='',n=6):
            pass
        # word diff
        sm=difflib.SequenceMatcher(None,a.split(' '),b.split(' '))
        for tag,i1,i2,j1,j2 in sm.get_opcodes():
            if tag!='equal':
                print('     %s PRE[%s] -> RB[%s]'%(tag,' '.join(a.split(' ')[i1:i2])[:400],' '.join(b.split(' ')[j1:j2])[:400]))
    if fwd:
        print('   NORMALIZED IDENTICAL to FORWARD(QVL): %s'%(norm(fwd)==b))
