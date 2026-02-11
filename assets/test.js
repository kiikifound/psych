/* JSON-driven genealogy test (mobile first) */
const DATA = {
  questions: null,
  schools: null,
  ideals: null,
  encyclopedia: null,
};

const LS_KEY = "genealogy_psych_v1_answers";
const LS_TAB = "genealogy_psych_v1_tab";

function $(id){ return document.getElementById(id); }
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function round1(x){ return Math.round(x*10)/10; }

async function loadAll(){
  const [q,s,i,e] = await Promise.all([
    fetch("./data/questions.json").then(r=>r.json()),
    fetch("./data/schools.json").then(r=>r.json()),
    fetch("./data/ideals.json").then(r=>r.json()),
    fetch("./data/encyclopedia.json").then(r=>r.json()),
  ]);
  DATA.questions=q;
  DATA.schools=s;
  DATA.ideals=i;
  DATA.encyclopedia=e;
}

function getAnswers(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }catch(e){ return {}; }
}
function setAnswers(a){ localStorage.setItem(LS_KEY, JSON.stringify(a)); }
function clearAnswers(){ localStorage.removeItem(LS_KEY); }

function initTabs(){
  const chips = document.querySelectorAll(".nav-chip");
  const panels = {
    test: $("panel-test"),
    result: $("panel-result"),
    encyclopedia: $("panel-encyclopedia"),
    about: $("panel-about"),
  };

  function setTab(tab){
    Object.entries(panels).forEach(([k,el])=>{
      el.style.display = (k===tab) ? "" : "none";
    });
    chips.forEach(c=>{
      c.classList.toggle("active", c.dataset.tab===tab);
    });
    localStorage.setItem(LS_TAB, tab);

    // hash for deep link
    if(tab==="test") location.hash="start";
    if(tab==="encyclopedia") location.hash="encyclopedia";
    if(tab==="result") location.hash="result";
    if(tab==="about") location.hash="about";
  }

  chips.forEach(c=>c.addEventListener("click", ()=>setTab(c.dataset.tab)));

  // initial
  const hash = (location.hash||"").replace("#","");
  const saved = localStorage.getItem(LS_TAB);
  const initial = (hash==="encyclopedia"||hash==="start"||hash==="result"||hash==="about") ? (
    hash==="start" ? "test" : hash
  ) : (saved || "test");
  setTab(initial);

  return { setTab };
}

/* ---------- Questionnaire ---------- */
let qIndex = 0;

function buildScaleRow(){
  const row = $("scaleRow");
  row.innerHTML = "";
  for(let v=1; v<=7; v++){
    const btn = document.createElement("button");
    btn.className = "scale-btn";
    btn.type = "button";
    btn.textContent = String(v);
    btn.dataset.value = String(v);
    btn.addEventListener("click", ()=>selectValue(v));
    row.appendChild(btn);
  }
}

function selectValue(v){
  const q = DATA.questions[qIndex];
  const answers = getAnswers();
  answers[q.id] = v;
  setAnswers(answers);
  highlightScale(v);

  // auto advance if not last
  updateAutosaveHint();
}

function highlightScale(v){
  const buttons = document.querySelectorAll(".scale-btn");
  buttons.forEach(b=>b.classList.toggle("active", Number(b.dataset.value)===v));
}

function updateAutosaveHint(){
  const el = $("autosaveHint");
  el.textContent = "已自动保存";
}

function renderQuestion(){
  const q = DATA.questions[qIndex];
  const answers = getAnswers();
  const v = answers[q.id];

  $("qCount").textContent = `第 ${qIndex+1} / ${DATA.questions.length} 题`;
  $("qTag").textContent = q.type || "—";
  $("qTitle").textContent = q.text;
  $("choiceLeftText").textContent = q.left;
  $("choiceRightText").textContent = q.right;

  highlightScale(v || 0);

  // progress
  const doneCount = Object.keys(answers).filter(id => answers[id]).length;
  const pct = clamp(Math.round(doneCount / DATA.questions.length * 100), 0, 100);
  $("progressBar").style.width = pct + "%";

  $("btnPrev").disabled = (qIndex===0);
  $("btnNext").textContent = (qIndex===DATA.questions.length-1) ? "完成并计算" : "下一题";

  // finish card
  $("finishCard").style.display = (doneCount===DATA.questions.length) ? "" : "none";
}

function canGoNext(){
  const q = DATA.questions[qIndex];
  const answers = getAnswers();
  return !!answers[q.id];
}

function goNext(tabs){
  if(!canGoNext()){
    // soft prompt
    $("autosaveHint").textContent = "请选择 1–7 分";
    return;
  }
  if(qIndex < DATA.questions.length-1){
    qIndex += 1;
    renderQuestion();
    window.scrollTo({top:0, behavior:"smooth"});
    return;
  }
  // finished
  computeAndRenderResult();
  tabs.setTab("result");
  window.scrollTo({top:0, behavior:"smooth"});
}

function goPrev(){
  qIndex = Math.max(0, qIndex-1);
  renderQuestion();
  window.scrollTo({top:0, behavior:"smooth"});
}

/* ---------- Scoring ---------- */
function axisScoreFromValue(v){
  // v in 1..7 => 0..100 (higher => right)
  return ( (v-1) / 6 ) * 100;
}

function cosine(a,b){
  let dot=0, na=0, nb=0;
  for(let i=0;i<a.length;i++){
    dot += a[i]*b[i];
    na += a[i]*a[i];
    nb += b[i]*b[i];
  }
  if(na===0 || nb===0) return 0;
  return dot / (Math.sqrt(na)*Math.sqrt(nb));
}

function buildUserVector(answers){
  const axisIds = DATA.ideals.axes.map(x=>x.id);
  const sums = Object.fromEntries(axisIds.map(id=>[id,0]));
  const counts = Object.fromEntries(axisIds.map(id=>[id,0]));

  for(const q of DATA.questions){
    if(!q.axis) continue;
    const v = answers[q.id];
    if(!v) continue;
    sums[q.axis] += axisScoreFromValue(v);
    counts[q.axis] += 1;
  }

  const vec = axisIds.map(id=>{
    const c = counts[id] || 0;
    return c ? (sums[id]/c) : 50; // neutral fallback
  });
  return vec;
}

function buildCalibrationScores(answers){
  const calWeight = DATA.ideals.calibrationWeight ?? 0.4;
  const schoolIds = DATA.schools.map(s=>s.id);
  const raw = Object.fromEntries(schoolIds.map(id=>[id,0]));

  for(const q of DATA.questions){
    if(q.type !== "校准题") continue;
    const v = answers[q.id];
    if(!v) continue;
    // map 1..7 => -1..+1 (right positive)
    const t = ((v-1)/6)*2 - 1;
    const w = q.schoolWeights || {};
    for(const [sid, ww] of Object.entries(w)){
      raw[sid] += t * ww;
    }
  }

  // normalize to 0..1 per school for blending
  // find max abs to scale
  let maxAbs = 0.0001;
  for(const sid of schoolIds){
    maxAbs = Math.max(maxAbs, Math.abs(raw[sid]));
  }
  const norm = {};
  for(const sid of schoolIds){
    norm[sid] = (raw[sid]/maxAbs + 1) / 2; // [-1,1] -> [0,1]
  }
  return { calWeight, norm, raw };
}

function scoreSchools(userVec, answers){
  const { calWeight, norm } = buildCalibrationScores(answers);
  const res = [];

  for(const s of DATA.schools){
    const ideal = DATA.ideals.schoolVectors[s.id];
    const sim = cosine(userVec, ideal); // 0..1
    const c = norm[s.id] ?? 0.5; // 0..1
    const total = sim + calWeight * (c - 0.5); // center so calibration nudges, not dominates
    res.push({ id:s.id, sim, cal:c, total });
  }

  res.sort((a,b)=>b.total - a.total);
  return res;
}

function mixDecision(scores){
  if(scores.length < 2) return { hasMix:false };
  const s1 = scores[0], s2 = scores[1];
  const sim1 = s1.total, sim2 = s2.total;

  const ruleA = sim2 >= sim1 * (DATA.ideals.mixRule?.ratio ?? 0.85);
  const ruleB = (sim1 - sim2) <= (DATA.ideals.mixRule?.gap ?? 0.06);
  const hasMix = ruleA || ruleB;
  return { hasMix, primary:s1.id, secondary: hasMix ? s2.id : null, sim1, sim2 };
}

/* ---------- Rendering ---------- */
function renderRadar(canvas, labels, values, color){
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  const cx = w*0.52, cy = h*0.54;
  const r = Math.min(w,h) * 0.36;
  const n = labels.length;
  const angle0 = -Math.PI/2;

  function pt(i, rr){
    const ang = angle0 + i*(2*Math.PI/n);
    return [cx + rr*Math.cos(ang), cy + rr*Math.sin(ang)];
  }

  // grid rings
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(15,23,42,.12)";
  for(let k=1;k<=4;k++){
    const rr = r*(k/4);
    ctx.beginPath();
    for(let i=0;i<n;i++){
      const [x,y]=pt(i,rr);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.stroke();
  }
  // axes
  for(let i=0;i<n;i++){
    const [x,y]=pt(i,r);
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(x,y); ctx.stroke();
  }

  // polygon
  ctx.fillStyle = "rgba(79,102,255,.14)";
  ctx.strokeStyle = color || "rgba(79,102,255,.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for(let i=0;i<n;i++){
    const v = clamp(values[i],0,100)/100;
    const [x,y]=pt(i,r*v);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // labels
  ctx.fillStyle = "rgba(15,23,42,.72)";
  ctx.font = "12px ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei'";
  for(let i=0;i<n;i++){
    const [x,y]=pt(i,r*1.12);
    const t = labels[i];
    // simple alignment
    const metrics = ctx.measureText(t);
    let tx = x - metrics.width/2;
    let ty = y + 4;
    if(i===0) ty = y - 6;
    ctx.fillText(t, tx, ty);
  }
}

function pathTextFromVector(vec){
  const axes = DATA.ideals.axes;
  const parts = axes.map((ax, i)=>{
    const v = vec[i];
    let side;
    if(v >= 62) side = "更偏右";
    else if(v <= 38) side = "更偏左";
    else side = "较居中";
    const hint = (side==="更偏右") ? ax.rightShort : (side==="更偏左" ? ax.leftShort : "两端都能用");
    return `- ${ax.short}: ${side}（${hint}）`;
  });
  return parts.join("\n");
}

function renderModules(container, schoolId){
  container.innerHTML = "";
  const entry = DATA.encyclopedia[schoolId];
  if(!entry || !entry.modules) return;

  entry.modules.forEach(m=>{
    if(!m || !m.body) return;
    const wrap = document.createElement("div");
    wrap.className = "module";
    wrap.innerHTML = `
      <div class="card">
        <div class="module-title">${escapeHtml(m.title)}</div>
        <div class="module-body">${formatBody(m.body)}</div>
      </div>
    `;
    container.appendChild(wrap);
  });
}

function formatBody(body){
  // allow simple markdown list lines starting with '- '
  const lines = String(body).split("\n");
  const hasList = lines.some(l=>l.trim().startsWith("- "));
  if(hasList){
    const html = lines.map(l=>{
      const t=l.trim();
      if(t.startsWith("- ")){
        return `<li>${escapeHtml(t.slice(2))}</li>`;
      }
      if(t==="") return "";
      return `<p>${escapeHtml(t)}</p>`;
    }).join("");
    // wrap consecutive li into ul (simple)
    if(html.includes("<li>")){
      const items = lines.filter(l=>l.trim().startsWith("- ")).map(l=>`<li>${escapeHtml(l.trim().slice(2))}</li>`).join("");
      const paras = lines.filter(l=>!l.trim().startsWith("- ") && l.trim()!=="").map(l=>`<p>${escapeHtml(l.trim())}</p>`).join("");
      return `${paras}<ul class="list">${items}</ul>`;
    }
  }
  return `<p>${escapeHtml(body).replaceAll("\n","<br/>")}</p>`;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function computeAndRenderResult(){
  const answers = getAnswers();
  const userVec = buildUserVector(answers);
  const scores = scoreSchools(userVec, answers);
  const mix = mixDecision(scores);

  const primary = DATA.schools.find(s=>s.id===mix.primary);
  const secondary = mix.secondary ? DATA.schools.find(s=>s.id===mix.secondary) : null;

  $("resultBadge").textContent = secondary ? "主派别（混合型）" : "主派别";
  $("resultTitle").textContent = primary ? primary.name : "—";
  $("resultOneLiner").textContent = primary ? primary.oneLiner : "—";

  // tags
  const tagWrap = $("resultTags");
  tagWrap.innerHTML = "";
  (primary?.tags || []).forEach(t=>{
    const span = document.createElement("span");
    span.className="tag";
    span.textContent=t;
    tagWrap.appendChild(span);
  });

  // radar
  const labels = DATA.ideals.axes.map(a=>a.short);
  renderRadar($("radar"), labels, userVec, primary?.color);

  // path text
  $("pathText").innerHTML = `<pre class="muted" style="margin:0;white-space:pre-wrap;line-height:1.6">${escapeHtml(pathTextFromVector(userVec))}</pre>`;

  // mix text
  if(secondary){
    $("mixText").textContent = `你的第二派别为「${secondary.name}」。它与主派别接近，说明你在不同情境下会切换工具箱：有时用主派别的解释路径，有时用次派别的切入方式。`;
  }else{
    $("mixText").textContent = "你的第二派别与主派别差距较大，本次结果以主派别为主。";
  }

  // render modules for primary
  renderModules($("resultModules"), mix.primary);

  // store last result for share
  window.__lastResult = { primary: mix.primary, secondary: mix.secondary, vec: userVec, scores };
}

function buildEncyclopedia(){
  const list = $("encyList");
  const detail = $("encyDetail");
  const btnBack = $("btnBackToList");

  function showList(){
    detail.style.display = "none";
    list.style.display = "";
    btnBack.style.display = "none";
    $("encyTitle").textContent = "派别百科";
  }
  function showDetail(sid){
    list.style.display = "none";
    detail.style.display = "";
    btnBack.style.display = "";
    const s = DATA.schools.find(x=>x.id===sid);
    $("encyTitle").textContent = s ? s.name : "派别百科";

    detail.innerHTML = "";
    // header
    const head = document.createElement("div");
    head.className = "card";
    head.innerHTML = `
      <div class="result-badge">派别总览</div>
      <h2 class="result-title" style="margin-top:10px">${escapeHtml(s?.name || "")}</h2>
      <p class="muted" style="margin:0 0 10px">${escapeHtml(s?.oneLiner || "")}</p>
      <div class="tag-row">${(s?.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
    `;
    detail.appendChild(head);

    // modules (same as result, no personal radar)
    const modulesWrap = document.createElement("div");
    detail.appendChild(modulesWrap);
    renderModules(modulesWrap, sid);

    window.scrollTo({top:0, behavior:"smooth"});
  }

  btnBack.addEventListener("click", showList);

  list.innerHTML = "";
  DATA.schools.forEach(s=>{
    const card = document.createElement("div");
    card.className = "card ency-card";
    card.innerHTML = `
      <div class="row">
        <div>
          <div class="result-badge" style="background: rgba(79,102,255,.10); border-color: rgba(79,102,255,.18)">派别</div>
          <h3>${escapeHtml(s.name)}</h3>
          <p class="muted">${escapeHtml(s.oneLiner)}</p>
          <div class="tag-row" style="margin-top:10px">${(s.tags||[]).slice(0,3).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        </div>
        <div>
          <button class="btn primary" type="button">展开</button>
        </div>
      </div>
    `;
    card.querySelector("button").addEventListener("click", ()=>showDetail(s.id));
    list.appendChild(card);
  });

  return { showList, showDetail };
}

function setupButtons(tabs){
  $("btnPrev").addEventListener("click", goPrev);
  $("btnNext").addEventListener("click", ()=>goNext(tabs));
  $("btnGoResult").addEventListener("click", ()=>{ computeAndRenderResult(); tabs.setTab("result"); });
  $("btnGoEncy").addEventListener("click", ()=>tabs.setTab("encyclopedia"));

  $("btnReset").addEventListener("click", ()=>{
    clearAnswers();
    qIndex = 0;
    renderQuestion();
  });

  $("btnRecalc").addEventListener("click", computeAndRenderResult);

  $("btnShare").addEventListener("click", async ()=>{
    try{
      const r = window.__lastResult;
      if(!r){ computeAndRenderResult(); }
      const rr = window.__lastResult;
      const p = DATA.schools.find(s=>s.id===rr.primary);
      const s = rr.secondary ? DATA.schools.find(x=>x.id===rr.secondary) : null;
      const lines = [
        "心理学理论流派谱系测试结果：",
        `主派别：${p?.name || "—"}`,
        s ? `次派别：${s.name}` : "次派别：无（差距较大）",
        "理解路径（0-100 越高越偏右）：",
        ...DATA.ideals.axes.map((ax,i)=>`- ${ax.short}: ${round1(rr.vec[i])}`)
      ].join("\n");
      await navigator.clipboard.writeText(lines);
      $("btnShare").textContent = "已复制";
      setTimeout(()=>{$("btnShare").textContent="复制结果摘要";}, 1200);
    }catch(e){
      alert("复制失败：你的浏览器可能不支持剪贴板权限。");
    }
  });
}

function enrichAxesForUI(){
  // provide short labels and side hints for path translation
  DATA.ideals.axes.forEach(ax=>{
    ax.short = ax.short || ax.name;
    ax.leftShort = ax.leftShort || ax.leftHint || "偏左侧";
    ax.rightShort = ax.rightShort || ax.rightHint || "偏右侧";
  });
}

function ensureStartAtFirstUnanswered(){
  const answers = getAnswers();
  const idx = DATA.questions.findIndex(q=>!answers[q.id]);
  if(idx>=0) qIndex = idx;
}

async function main(){
  await loadAll();
  enrichAxesForUI();

  const tabs = initTabs();
  buildScaleRow();
  ensureStartAtFirstUnanswered();
  renderQuestion();

  const ency = buildEncyclopedia();
  setupButtons(tabs);

  // compute result if already completed
  const answers = getAnswers();
  const completed = DATA.questions.every(q=>!!answers[q.id]);
  if(completed){
    computeAndRenderResult();
  }

  // respond to hash
  if(location.hash==="#result"){
    computeAndRenderResult();
    tabs.setTab("result");
  }
  if(location.hash==="#encyclopedia"){
    tabs.setTab("encyclopedia");
    ency.showList();
  }
}

document.addEventListener("DOMContentLoaded", main);
