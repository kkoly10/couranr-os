import re,sys,os,glob,difflib
ROOT='/home/user/couranr-os'
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
    s=re.sub(r'/\*.*?\*/','',s,flags=re.S)
    s=re.sub(r'--[^\n]*','',s)
    s=re.sub(r'\s+',' ',s)
    return s.strip()
a=norm(extract(open(sys.argv[1]).read(),sys.argv[3])[-1]).split(' ')
b=norm(extract(open(sys.argv[2]).read(),sys.argv[3])[-1]).split(' ')
sm=difflib.SequenceMatcher(None,a,b)
for tag,i1,i2,j1,j2 in sm.get_opcodes():
    if tag!='equal':
        print('%s\n   A: %s\n   B: %s'%(tag,' '.join(a[i1:i2])[:600],' '.join(b[j1:j2])[:600]))
