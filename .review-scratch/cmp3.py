import re,sys,glob,os,difflib
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
name=sys.argv[1]
pre=None
for p in MIG:
    if os.path.basename(p)==QVL: continue
    d=extract(open(p).read(),name)
    if d: pre=d[-1]
rb=extract(open(RB).read(),name)[-1]
for l in difflib.unified_diff(pre.splitlines(),rb.splitlines(),'PRE','RB',lineterm='',n=1):
    print(l)
