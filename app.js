const DEFAULTS = {
  dayPrice: 0.1654, nightPrice: 0.1356, capacity: 1.92, batteryPrice: 550,
  socMin: 15, efficiency: 90, maxPower: 3, lifeCycles: 6000, lifeYears: 10,
  batteries: [
    {name:"Batterie zendure 1.92 kWh",capacity:1.92,price:550,socMin:15,efficiency:90,maxPower:3,lifeCycles:6000,lifeYears:10},
    {name:"Batterie jackery 2.52 kWh",capacity:2.52,price:750,socMin:15,efficiency:90,maxPower:3,lifeCycles:6000,lifeYears:10},
    {name:"Batterie hoymiles 4.02 kWh",capacity:4.02,price:1150,socMin:15,efficiency:90,maxPower:3,lifeCycles:6000,lifeYears:10}
  ]
};
const KEY="shellyBatterySettings";
let settings=loadSettings(), records=[], simulations=[], energyChart, batteryChart;

const $=id=>document.getElementById(id);
const fmt=(n,d=2)=>Number(n||0).toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d});
const euro=n=>`${fmt(n,2)} €`;
const kwh=n=>`${fmt(n,2)} kWh`;

function loadSettings(){
  try{return {...DEFAULTS,...JSON.parse(localStorage.getItem(KEY)||"{}")}}catch{return {...DEFAULTS}}
}
function saveSettings(){localStorage.setItem(KEY,JSON.stringify(settings));}

function init(){
  $("dayPrice").value=settings.dayPrice;$("nightPrice").value=settings.nightPrice;
  renderBatteryOptions();bind();
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
function renderBatteryOptions(){
  const select=$("batterySelect");select.innerHTML="";
  settings.batteries.forEach((b,i)=>{const o=document.createElement("option");o.value=i;o.textContent=b.name;select.appendChild(o)});
  applyBattery(0);
}
function applyBattery(i){
  const b=settings.batteries[i]||settings.batteries[0];
  $("capacity").value=b.capacity;$("batteryPrice").value=b.price;$("socMin").value=b.socMin;
  $("efficiency").value=b.efficiency;$("maxPower").value=b.maxPower;$("lifeCycles").value=b.lifeCycles;$("lifeYears").value=b.lifeYears;
  settings.capacity=b.capacity;settings.batteryPrice=b.price;settings.socMin=b.socMin;settings.efficiency=b.efficiency;settings.maxPower=b.maxPower;settings.lifeCycles=b.lifeCycles;settings.lifeYears=b.lifeYears;
  saveSettings(); if(records.length) simulateAndRender();
}
function bind(){
  $("csvInput").addEventListener("change",e=>{const f=e.target.files[0];if(f) readCSV(f)});
  $("demoBtn").addEventListener("click",makeDemo);
  $("batterySelect").addEventListener("change",e=>applyBattery(+e.target.value));
  ["dayPrice","nightPrice","capacity","batteryPrice","socMin","efficiency","maxPower","lifeCycles","lifeYears"].forEach(id=>{
    $(id).addEventListener("input",()=>{
      settings.dayPrice=+$("dayPrice").value;settings.nightPrice=+$("nightPrice").value;
      settings.capacity=+$("capacity").value;settings.batteryPrice=+$("batteryPrice").value;settings.socMin=+$("socMin").value;
      settings.efficiency=+$("efficiency").value;settings.maxPower=+$("maxPower").value;settings.lifeCycles=+$("lifeCycles").value;settings.lifeYears=+$("lifeYears").value;
      const i=+$("batterySelect").value,b=settings.batteries[i];if(b){Object.assign(b,{capacity:settings.capacity,price:settings.batteryPrice,socMin:settings.socMin,efficiency:settings.efficiency,maxPower:settings.maxPower,lifeCycles:settings.lifeCycles,lifeYears:settings.lifeYears})}
      saveSettings();if(records.length)simulateAndRender();
    });
  });
  $("resetBtn").addEventListener("click",()=>{settings=JSON.parse(JSON.stringify(DEFAULTS));saveSettings();location.reload()});
}
function readCSV(file){
  const reader=new FileReader();
  reader.onload=()=>Papa.parse(reader.result,{skipEmptyLines:true,complete:r=>{
    records=parseShellyRows(r.data);$("fileLabel").textContent=`${file.name} · ${records.length} relevés`;
    simulateAndRender();
  }});
  reader.readAsText(file);
}

/* Le format Shelly est sectionné : "Phase A", "Phase B", "Retour Phase A",
   puis des lignes Date Heure, valeur. PapaParse s'occupe du découpage robuste
   du CSV ; cette couche reconnaît ensuite les sections et les relevés. */
function parseShellyRows(rows){
  const maps={A:new Map(),B:new Map(),R:new Map()};let section="";
  for(const row of rows){
    const text=row.map(x=>String(x??"").trim()).join(",").trim();
    const m=text.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s*,\s*(-?[\d.,]+)$/);
    if(m){
      const key=isoDate(m[1])+"T"+m[2];
      const value=parseFloat(m[3].replace(",",".")); if(!Number.isNaN(value)){
        if(section==="Phase A")maps.A.set(key,value);
        if(section==="Phase B")maps.B.set(key,value);
        if(section==="Retour Phase A")maps.R.set(key,value);
      } continue;
    }
    if(/^Phase A$/i.test(text))section="Phase A";
    else if(/^Phase B$/i.test(text))section="Phase B";
    else if(/^Retour Phase A$/i.test(text))section="Retour Phase A";
  }
  const keys=new Set([...maps.A.keys(),...maps.B.keys(),...maps.R.keys()]);
  return [...keys].sort().map(key=>{
    const [date,time]=key.split("T");
    const exportWh=-(maps.R.get(key)||0); // Shelly negative = injection
    return {key,date,time,consWh:Math.max(0,maps.A.get(key)||0),prodWh:Math.max(0,maps.B.get(key)||0),exportWh:Math.max(0,exportWh)};
  });
}
function isoDate(d){const [day,month,year]=d.split("/");return `${year}-${month}-${day}`}

function tariff(time){const h=+time.slice(0,2);return h>=6&&h<22?settings.dayPrice:settings.nightPrice}

function simulateBattery(b){
  const cap=Math.max(0,b.capacity)*1000,reserve=cap*Math.min(99,Math.max(0,b.socMin))/100;
  const eta=Math.sqrt(Math.min(1,Math.max(.01,b.efficiency/100)));
  const pmax=b.maxPower>0?b.maxPower*1000:Infinity;
  let level=reserve,totalCharge=0,totalUsed=0,lost=0,conversionLoss=0,economy=0;
  const out=[]; const daily={};
  for(const r of records){
    const price=tariff(r.time);
    const day=daily[r.date] ||= {economy:0,charge:0,used:0};
    // Charge: production surplus = export measured by Shelly.
    const rawCharge=Math.min(r.exportWh,pmax);
    const stockable=rawCharge*eta;
    const stored=Math.min(stockable,Math.max(0,cap-level));
    const drawn=eta>0?stored/eta:0;
    const curtail=Math.max(0,r.exportWh-drawn);
    level+=stored;
    // Discharge to Phase A consumption.
    const demand=Math.min(r.consWh,pmax);
    const stockNeed=demand/eta;
    const stockTaken=Math.min(stockNeed,Math.max(0,level-reserve));
    const delivered=stockTaken*eta;
    level-=stockTaken;
    totalCharge+=stored;totalUsed+=delivered;lost+=curtail;conversionLoss+=(drawn-stored)+(stockTaken-delivered);
    economy+=(delivered/1000)*price;
    day.economy+=(delivered/1000)*price;day.charge+=stored;day.used+=delivered;
    out.push({...r,level,delivered,gridAfter:Math.max(0,r.consWh-delivered),price});
  }
  const days=Object.keys(daily).length,cycles=cap?totalCharge/cap:0,avgDay=days?economy/days:0;
  const daysPayback=avgDay>0?b.price/avgDay:null;
  const cyclesYear=days?cycles/days*365.25:0;
  const remaining=b.lifeCycles>0?Math.max(0,b.lifeCycles-cycles):null;
  const daysLife=remaining!==null&&cycles/days>0?remaining/(cycles/days):null;
  const vals=Object.values(daily).map(x=>x.economy);
  const best=vals.length?Math.max(...vals):0,worst=vals.length?Math.min(...vals):0;
  return {battery:b,out,totalCharge,totalUsed,lost,conversionLoss,economy,days,cycles,avgDay,daysPayback,cyclesYear,remaining,daysLife,best,worst};
}
function simulateAndRender(){
  if(!records.length)return;
  const production=records.reduce((s,r)=>s+r.prodWh,0)/1000;
  const direct=records.reduce((s,r)=>s+Math.max(0,r.prodWh-r.exportWh),0)/1000;
  settings.dayPrice=+$("dayPrice").value;settings.nightPrice=+$("nightPrice").value;saveSettings();
  simulations=settings.batteries.map(simulateBattery);
  const active=simulations[+$("batterySelect").value]||simulations[0];
  $("emptyState").hidden=true;$("dashboard").hidden=false;
  $("periodLabel").textContent=`${records[0].date} → ${records.at(-1).date} · ${Object.keys(new Set(records.map(r=>r.date))).length} jour(s)`;
  $("kpiProduction").textContent=fmt(production);
  $("kpiAutoconso").textContent=fmt(direct);
  $("kpiEconomy").textContent=euro(active.economy);
  $("kpiPayback").textContent=active.daysPayback===null?"N/A":fmt(active.daysPayback/365.25,1)+" an(s)";
  drawCharts(active);renderComparison();renderDetail(active);
}
function drawCharts(active){
  if(energyChart)energyChart.destroy();if(batteryChart)batteryChart.destroy();
  const labels=records.map(r=>r.date.slice(5)+" "+r.time);
  energyChart=new Chart($("energyChart"),{type:"line",data:{labels,datasets:[
    {label:"Consommation",data:records.map(r=>r.consWh/1000),tension:.25,borderWidth:2,pointRadius:0},
    {label:"Production PV",data:records.map(r=>r.prodWh/1000),tension:.25,borderWidth:2,pointRadius:0},
    {label:"Export",data:records.map(r=>r.exportWh/1000),tension:.25,borderWidth:2,pointRadius:0}
  ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{position:"bottom"}},scales:{x:{ticks:{maxTicksLimit:10}},y:{beginAtZero:true,title:{display:true,text:"kWh"}}}}});
  batteryChart=new Chart($("batteryChart"),{type:"line",data:{labels,datasets:[{label:"Énergie stockée",data:active.out.map(x=>x.level/1000),fill:true,tension:.25,borderWidth:2,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"}},scales:{x:{ticks:{maxTicksLimit:10}},y:{beginAtZero:true,max:active.battery.capacity,title:{display:true,text:"kWh"}}}}});
}
function renderComparison(){
  const tb=$("comparisonTable").querySelector("tbody");tb.innerHTML="";
  simulations.forEach(s=>{
    const pay=s.daysPayback===null?"N/A":`${fmt(s.daysPayback/365.25,1)} an`;
    const life=s.daysLife===null?"N/A":s.daysLife/365.25;
    const ok=s.daysPayback!==null&&s.daysLife!==null&&s.daysPayback<=s.daysLife;
    const tr=document.createElement("tr");tr.innerHTML=`<td><b>${esc(s.battery.name)}</b></td><td>${fmt(s.battery.capacity)} kWh</td><td>${euro(s.battery.price)}</td><td>${euro(s.avgDay)}</td><td>${fmt(s.cycles,2)}</td><td>${fmt(s.cyclesYear,1)}</td><td>${pay}</td><td class="${ok?'good':s.daysPayback===null?'warn':'bad'}">${ok?"Oui":s.daysPayback===null?"N/A":"Non"}</td>`;
    tb.appendChild(tr);
  });
}
function renderDetail(active){
  const tb=$("detailTable").querySelector("tbody");tb.innerHTML="";
  records.forEach((r,i)=>{const s=active.out[i],tr=document.createElement("tr");
    tr.innerHTML=`<td>${r.date}</td><td>${r.time}</td><td>${fmt(r.consWh/1000,3)}</td><td>${fmt(r.prodWh/1000,3)}</td><td>${fmt(r.exportWh/1000,3)}</td><td>${fmt(s.level/1000,3)}</td><td>${fmt(s.gridAfter/1000,3)}</td><td>${euro(s.price)}</td>`;tb.appendChild(tr)
  });$("rowCount").textContent=`${records.length} lignes`;
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

function makeDemo(){
  const start=new Date("2026-06-01T00:00:00"),days=14;records=[];
  for(let d=0;d<days;d++)for(let h=0;h<24;h++){
    const date=new Date(start);date.setDate(start.getDate()+d);
    const ds=date.toISOString().slice(0,10),time=String(h).padStart(2,"0")+":00";
    const pv=(h>=7&&h<=19)?Math.max(0,2.4*Math.sin((h-7)/12*Math.PI)*(0.85+0.25*Math.sin(d*.7))):0;
    const cons=(h<6||h>22)?0.35:(h>=7&&h<=9?0.9:h>=18&&h<=21?1.2:0.45);
    const exp=Math.max(0,pv-cons*.55);
    records.push({key:ds+"T"+time,date:ds,time,consWh:cons*1000,prodWh:pv*1000,exportWh:exp*1000});
  }
  $("fileLabel").textContent="Données de démonstration";simulateAndRender();
}
init();