import re,sys,os,glob
MIG=sorted(glob.glob('/home/user/couranr-os/supabase/migrations/*.sql'))
def extract(path,name):
    txt=open(path).read()
    out=[]
    # find each create [or replace] function <name>(
    for m in re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+'+re.escape(name)+r'\s*\(', txt, re.I):
        start=m.start()
        # find the AS $tag$ ... $tag$;
        m2=re.search(r'\bas\s+(\$[A-Za-z_]*\$)', txt[start:], re.I)
        if not m2:
            out.append((start,txt[start:start+200]+'\n...NO BODY TAG...'))
            continue
        tag=m2.group(1)
        bodystart=start+m2.end()
        end=txt.find(tag,bodystart)
        if end==-1:
            out.append((start,'UNTERMINATED'))
            continue
        out.append((start,txt[start:end+len(tag)+1]))
    return out
name=sys.argv[1]
for p in MIG:
    for (s,body) in extract(p,name):
        print('===FILE %s offset %d'%(os.path.basename(p),s))
