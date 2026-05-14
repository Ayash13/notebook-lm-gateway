const A='';let nb=null,busy=false,clientIP='',histData=[],hasCheckedInitial=false;

async function health(){
    try{
        const d=await(await fetch(`${A}/health`)).json();
        document.getElementById('dot').className='dot on';
        document.getElementById('statusText').textContent='online';
        clientIP=d.ip||'';
        document.getElementById('ipLabel').textContent=clientIP?clientIP.slice(0,8):'';
        if(d.session){
            const s=d.session;
            const st=document.getElementById('authStatus');
            st.textContent=s.status;st.className='val '+(s.status==='valid'?'ok':'bad');
            document.getElementById('authExpiry').textContent=s.expires_at?new Date(s.expires_at).toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'–';
            const rem=document.getElementById('authRemaining');
            rem.textContent=s.remaining||'–';
            const days=parseInt(s.remaining);
            rem.className='val '+(s.status==='expired'?'bad':days<=2?'warn':'ok');
        }
        if(d.currentNotebook){
            nb=d.currentNotebook;
            const t=d.currentNotebookTitle||(nb.split('/notebook/')[1]?.slice(0,12)+'...');
            document.getElementById('nbLabel').textContent=t;
            document.getElementById('setupModal').style.display='none';
            if(d.savedNotebooks){
                const grid=document.getElementById('nbGrid');
                grid.innerHTML='';
                d.savedNotebooks.forEach(n=>{
                    const c=document.createElement('div');
                    c.className='nb-card'+(n.url===nb?' active':'');
                    c.onclick=()=>switchNb(n.url, c);
                    c.innerHTML=`
                        <div class="title">${esc(n.title||n.url)}</div>
                        <div class="url">${esc(n.url.split('/notebook/')[1]||'')}</div>
                        <div class="nb-actions">
                            <button class="nb-act-btn" onclick="event.stopPropagation();editNb('${n.url}','${esc((n.title||'').replace(/'/g,"\\'"))}')">✎</button>
                            <button class="nb-act-btn del" onclick="event.stopPropagation();delNb('${n.url}')">×</button>
                        </div>
                    `;
                    grid.appendChild(c);
                });
                const add=document.createElement('div');
                add.className='nb-card nb-add';add.textContent='+ add notebook';
                add.onclick=()=>document.getElementById('setupModal').style.display='flex';
                grid.appendChild(add);
            }
            if(!hasCheckedInitial){hasCheckedInitial=true;loadHist()}
        } else {
            document.getElementById('setupModal').style.display='flex';
            hasCheckedInitial=true;
        }
    }catch{
        document.getElementById('dot').className='dot';
        document.getElementById('statusText').textContent='offline';
    }
}

async function loadHist(){
    try{
        const u=nb?`${A}/api/history?notebook=${encodeURIComponent(nb)}`:`${A}/api/history`;
        const d=await(await fetch(u)).json();
        if(!d.success)return;
        histData=d.data;
        clientIP=d.meta.ip;document.getElementById('ipLabel').textContent=clientIP?clientIP.slice(0,8):'';
        renderHist();
    }catch{}
}

function renderHist(activeId){
    const el=document.getElementById('hist');el.innerHTML='';
    histData.forEach(i=>{
        const e=document.createElement('div');
        e.className='hist-item'+(activeId===i.id?' active':'');
        e.innerHTML=`<div class="q">${esc(i.query)}</div><div class="m">${i.duration_ms?((i.duration_ms/1000).toFixed(1)+'s'):'–'} · ${fmt(i.created_at)}</div>`;
        e.onclick=()=>{showConversation(i.id);if(window.innerWidth<=768)toggleMenu()};
        el.appendChild(e);
    });
}

function showConversation(id){
    const f=document.getElementById('feed');f.innerHTML='';
    renderHist(id);
    const idx=histData.findIndex(i=>i.id===id);
    if(idx===-1)return;
    const item=histData[idx];
    const ts=item.created_at?new Date(item.created_at+'Z').toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
    addEntryRaw('user',item.query,ts);
    if(item.response){
        addEntryRaw('bot',item.response,ts,item.duration_ms);
    }
    f.scrollTop=0;
}

function addEntryRaw(type,text,ts,ms){
    const f=document.getElementById('feed');
    const e=document.createElement('div');e.className=`entry ${type}`;
    let rendered=text||'';
    if(type==='bot') rendered=rendered.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/\n/g,'<br>');
    e.innerHTML=`<div class="prompt"><span class="arrow">${type==='user'?'❯':'◆'}</span> <span style="color:${type==='user'?'var(--green)':'var(--cyan)'}">${type==='user'?'query':'response'}</span><span class="ip">${clientIP?clientIP.slice(0,8):''}</span><span class="ts">${ts}</span></div><div class="body">${type==='user'?esc(text):rendered}</div>${ms?`<div class="dur">${(ms/1000).toFixed(2)}s</div>`:''}`;
    f.appendChild(e);
}

function addEntry(type,text,ms){
    const ts=new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    addEntryRaw(type,text,ts,ms);
    document.getElementById('feed').scrollTop=document.getElementById('feed').scrollHeight;
}

function addTyping(){
    const f=document.getElementById('feed');
    const e=document.createElement('div');e.className='typing-row';e.id='typing';
    e.innerHTML='<div class="prompt"><span class="arrow" style="color:var(--cyan)">◆</span> <span style="color:var(--cyan)">processing</span></div><div class="body"><span class="cursor-blink"></span></div>';
    f.appendChild(e);f.scrollTop=f.scrollHeight;
}

async function send(){
    const input=document.getElementById('qi'),q=input.value.trim();
    if(!q||busy)return;
    busy=true;input.value='';input.style.height='auto';document.getElementById('sendBtn').disabled=true;
    renderHist(); 
    addEntry('user',q);addTyping();
    try{
        const body={query:q};if(nb)body.notebook=nb;
        const d=await(await fetch(`${A}/api/ask`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
        document.getElementById('typing')?.remove();
        if(d.success){addEntry('bot',d.data.response,d.data.duration_ms);loadHist()}
        else addEntry('bot','[error] '+d.error.message);
    }catch(e){document.getElementById('typing')?.remove();addEntry('bot','[network error] '+e.message)}
    busy=false;document.getElementById('sendBtn').disabled=false;input.focus();
}

async function saveSetup() {
    const u = document.getElementById('setupUrl').value.trim();
    if(u && u.includes('notebooklm.google.com/notebook/')){
        const btn = document.getElementById('setupModal').querySelector('button');
        btn.textContent='Connecting...';
        try {
            const res = await fetch(`${A}/api/notebook`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:u})});
            if(res.ok) {
                const data = await res.json();
                nb = u;
                document.getElementById('nbLabel').textContent=data.data.title || u.split('/notebook/')[1]?.slice(0,12)+'...';
                document.getElementById('setupModal').style.display='none';
                document.getElementById('setupUrl').value='';
                loadHist();
                health(); 
            } else toast('Failed to connect','err');
        } catch(e) { toast('Network error','err'); }
        btn.textContent='Connect';
    } else toast('Invalid URL','err');
}

async function switchNb(u, el){
    if(u===nb)return;
    if(el){
        document.querySelectorAll('.nb-card').forEach(c=>c.classList.remove('active'));
        el.classList.add('active');
    }
    nb=u;
    document.getElementById('feed').innerHTML='';
    loadHist();
    toast('connecting...','ok');
    try {
        const res = await fetch(`${A}/api/notebook`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:u})});
        if(res.ok) {
            const data = await res.json();
            document.getElementById('nbLabel').textContent=data.data.title || u.split('/notebook/')[1]?.slice(0,12)+'...';
            health();
        } else toast('failed to switch','err');
    } catch(e) { toast('network error','err'); }
}
function editNb(u, current) {
    document.getElementById('editUrl').value = u;
    document.getElementById('editTitle').value = current;
    document.getElementById('editModal').style.display = 'flex';
    document.getElementById('editTitle').focus();
}
async function saveEdit() {
    const u = document.getElementById('editUrl').value;
    const t = document.getElementById('editTitle').value.trim();
    if(t) {
        document.getElementById('editModal').style.display = 'none';
        if(u===nb) document.getElementById('nbLabel').textContent = t; 
        await fetch(`${A}/api/notebook`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:u, title:t})});
        health();
    }
}
function delNb(u) {
    document.getElementById('delUrl').value = u;
    document.getElementById('delModal').style.display = 'flex';
}
async function confirmDel() {
    const u = document.getElementById('delUrl').value;
    document.getElementById('delModal').style.display = 'none';
    if(u===nb) { nb=null; document.getElementById('feed').innerHTML=''; loadHist(); } 
    await fetch(`${A}/api/notebook`, {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:u})});
    health();
}
function clearChat(){document.getElementById('feed').innerHTML='';renderHist()}
function toast(m,t){const e=document.createElement('div');e.className=`toast ${t}`;e.textContent='> '+m;document.body.appendChild(e);setTimeout(()=>e.remove(),3000)}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function fmt(t){if(!t)return'';return new Date(t+'Z').toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}
function toggleMenu(){
    document.querySelector('.sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('open');
}
document.getElementById('qi').addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'});
health();setInterval(health,15000);
