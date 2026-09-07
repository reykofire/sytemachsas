import argparse
from pathlib import Path
import re
import shutil

parser=argparse.ArgumentParser()
parser.add_argument('root',type=Path)
parser.add_argument('runtime',type=Path)
args=parser.parse_args()
root=args.root
source=args.runtime.read_bytes()
(root/'js/runtime.js').write_bytes(source)
for p in root.glob('*.html'):
    s=p.read_text(encoding='utf-8')
    if 'js/runtime.js' not in s:
        pos=s.find('  <script src="js/')
        assert pos!=-1,str(p)
        s=s[:pos]+'  <script src="js/runtime.js?v=projects-20260907" defer></script>\n'+s[pos:]
    s=re.sub(r'(\b(?:src|href)="(?:js|css)/[^"?]+)(?:\?[^"\s]*)?"',r'\1?v=projects-20260907"',s)
    p.write_text(s,encoding='utf-8',newline='\n')

changes={
    'api.js': [
        ('const TOKEN_KEY = "hs_session_v1";', 'const TOKEN_KEY = HS_APP.key("hs_session_v1");'),
        ('fetch(`/api${path}`', 'fetch(`${HS_APP.apiBase}${path}`'),
    ],
    'data.js': [('fetch("/api/commerce")','fetch(HS_APP.url("api/commerce"))')],
    'ui.js': [('new URL(String(value ?? ""), location.origin)','new URL(HS_APP.url(value))')],
    'cart.js': [
        ('const KEY = "hs_cart_v1";', 'const KEY = HS_APP.key("hs_cart_v1");'),
        ('const PENDING_PREFIX = "hs_cart_pending_v1:";', 'const PENDING_PREFIX = HS_APP.key("hs_cart_pending_v1") + ":";'),
    ],
    'pages.js': [
        ('sessionStorage.setItem("hs_return_to",','sessionStorage.setItem(HS_APP.key("hs_return_to"),'),
    ],
    'portal.js': [
        ('sessionStorage.getItem("hs_return_to")','sessionStorage.getItem(HS_APP.key("hs_return_to"))'),
        ('sessionStorage.removeItem("hs_return_to")','sessionStorage.removeItem(HS_APP.key("hs_return_to"))'),
        ('src="${escapeHtml(item.image_url)}"','src="${escapeHtml(hsSafeUrl(item.image_url, ""))}"'),
        ('src="${escapeHtml(item.image_url || "")}"','src="${escapeHtml(hsSafeUrl(item.image_url || "", ""))}"'),
        ('src = event.target.value','src = hsSafeUrl(event.target.value, "")'),
    ],
}
for name,replacements in changes.items():
    p=root/'js'/name
    s=p.read_text(encoding='utf-8')
    for before,after in replacements:s=s.replace(before,after)
    if name=='pages.js':
        s=re.sub(r'const KEY = "(hs_[^"]+)";',r'const KEY = HS_APP.key("\1");',s)
    p.write_text(s,encoding='utf-8',newline='\n')
print('Project-aware URLs and storage applied to',root)
