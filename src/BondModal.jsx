// src/BondModal.jsx
import { useState, useEffect } from "react";
import { getRateForPurchase, fetchLatestRates } from "./bondRates";
import { INFLATION_HISTORY, getInflationForBondPeriod } from "./inflationData";

// ─── Typy obligacji ───────────────────────────────────────────────────────────
export const BOND_TYPES = {
  "TOS": { label:"TOS (3-latki, stałe)", months:36, periods:3, defaultRate:0.0565, rateType:"fixed", coupon:false, earlyRedemptionCost:1.0 },
  "COI": { label:"COI (4-latki, inflacja)", months:48, periods:4, defaultRate:0.0500, rateType:"inflation", margin:0.015, coupon:true, earlyRedemptionCost:2.0 },
  "EDO": { label:"EDO (10-latki, inflacja)", months:120, periods:10, defaultRate:0.0625, rateType:"inflation", margin:0.02, coupon:false, earlyRedemptionCost:3.0 },
  "ROR": { label:"ROR (roczne)", months:12, periods:1, defaultRate:0.0525, rateType:"fixed", coupon:true, earlyRedemptionCost:0.5 },
  "DOR": { label:"DOR (2-latki)", months:24, periods:2, defaultRate:0.054, rateType:"fixed", coupon:true, earlyRedemptionCost:0.7 },
  "ROS": { label:"ROS (6-latki, inflacja)", months:72, periods:6, defaultRate:0.062, rateType:"inflation", margin:0.02, coupon:false, earlyRedemptionCost:2.0 },
  "ROD": { label:"ROD (12-latki, inflacja)", months:144, periods:12, defaultRate:0.065, rateType:"inflation", margin:0.025, coupon:false, earlyRedemptionCost:3.0 },
};

// ─── Silnik obliczeń (oficjalny wzór MF) ─────────────────────────────────────
// Wzór: WP_k = N_(k-1) * (1 + r_k * a_k / ACT_k) - b
// Inflacja pobierana z inflationData.js (aktualizowanego automatycznie przez GH Actions)
function calcSingleBond(params, purchaseDate, today, rate1) {
  let val = 100.0;
  for (let k = 0; k < params.periods; k++) {
    const pStart = new Date(purchaseDate);
    pStart.setFullYear(pStart.getFullYear() + k);
    const pEnd = new Date(purchaseDate);
    pEnd.setFullYear(pEnd.getFullYear() + k + 1);

    let rate;
    if (k === 0) {
      rate = rate1;
    } else if (params.rateType === "inflation") {
      // Inflacja z miesiąca poprzedzającego 1. dzień okresu odsetkowego (zasada BGK)
      const inflation = getInflationForBondPeriod(pStart);
      rate = Math.max(0, inflation) + params.margin;
    } else {
      rate = rate1;
    }

    const ACT = (pEnd - pStart) / 86400000;
    if (today <= pEnd) {
      const a_k = (today - pStart) / 86400000;
      val = Math.round((params.coupon ? 100.0 : val) * (1 + rate * a_k / ACT) * 100) / 100;
      break;
    } else {
      val = params.coupon ? 100.0 : Math.round(val * (1 + rate) * 100) / 100;
    }
  }
  return val;
}

export function calcBondCurrentValue(bond) {
  const { type, purchaseDate, quantity, rate } = bond;
  const params = BOND_TYPES[type];
  if (!params || !purchaseDate || !quantity) return { currentValue:(quantity||0)*100, earned:0, dailyGain:0, progress:0 };

  const today = new Date(); today.setHours(0,0,0,0);
  const purchase = new Date(purchaseDate); purchase.setHours(0,0,0,0);
  const maturityDate = new Date(purchase);
  maturityDate.setFullYear(maturityDate.getFullYear() + params.periods);

  const progress = Math.min(1, Math.max(0, (today - purchase) / (maturityDate - purchase)));
  const totalNominal = quantity * 100;
  const bondRate = rate || params.defaultRate;

  let totalValue = 0;
  for (let i = 0; i < quantity; i++) totalValue += calcSingleBond(params, purchase, today, bondRate);

  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  let valueYesterday = 0;
  for (let i = 0; i < quantity; i++) valueYesterday += calcSingleBond(params, purchase, yesterday, bondRate);

  return {
    currentValue: Math.round(totalValue * 100) / 100,
    earned: Math.round((totalValue - totalNominal) * 100) / 100,
    dailyGain: Math.round((totalValue - valueYesterday) * 100) / 100,
    progress, maturityDate, totalNominal, bondRate,
  };
}

// ─── Style ────────────────────────────────────────────────────────────────────
const labelSt = { fontSize:11, color:"#5a6a7e", display:"block", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" };
const baseInp = { display:"block", width:"100%", padding:"9px 12px", fontSize:13, borderRadius:8, background:"#1a2535", border:"1px solid #243040", color:"#e8f0f8", fontFamily:"'Sora', sans-serif", outline:"none", WebkitAppearance:"none", boxSizing:"border-box", transition:"border-color .15s, box-shadow .15s" };
const focusInp = e => { e.target.style.borderColor="#f0a030"; e.target.style.boxShadow="0 0 0 3px #f0a03018"; };
const blurInp  = e => { e.target.style.borderColor="#243040"; e.target.style.boxShadow="none"; };
const fmt = n => new Intl.NumberFormat("pl-PL",{style:"currency",currency:"PLN",maximumFractionDigits:2}).format(n);

// ─── Modal ────────────────────────────────────────────────────────────────────
export function BondModal({ bond, onSave, onDelete, onClose }) {
  const isEdit = !!bond;
  const todayStr = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState(bond || { type:"TOS", quantity:"", purchaseDate:todayStr, rate:"", note:"" });
  const [autoRate, setAutoRate] = useState(null);
  const [ratesLoaded, setRatesLoaded] = useState(false);
  const [hovSave, setHovSave] = useState(false);
  const [hovDel,  setHovDel]  = useState(false);
  const [hovClose,setHovClose]= useState(false);

  useEffect(() => {
    fetchLatestRates().then(() => setRatesLoaded(true));
  }, []);

  useEffect(() => {
    if (!form.purchaseDate || form.rate) return;
    const detected = getRateForPurchase(form.type, form.purchaseDate);
    setAutoRate(detected);
  }, [form.type, form.purchaseDate, ratesLoaded]);

  const params = BOND_TYPES[form.type];
  const qty = parseInt(form.quantity) || 0;
  const bondRate = form.rate ? parseFloat(form.rate) / 100 : (autoRate || params?.defaultRate);

  let preview = null;
  if (qty > 0 && form.purchaseDate && bondRate) {
    preview = calcBondCurrentValue({ type:form.type, purchaseDate:form.purchaseDate, quantity:qty, rate:bondRate });
  }

  // Dla obligacji indeksowanych — pokaż informację o inflacji użytej do obliczeń
  const showInflationInfo = params?.rateType === "inflation" && form.purchaseDate;
  const latestInflationKey = Object.keys(INFLATION_HISTORY).sort().pop();
  const latestInflation = INFLATION_HISTORY[latestInflationKey];

  function submit() {
    if (!qty || !form.purchaseDate || !params) return;
    const maturityDate = new Date(form.purchaseDate);
    maturityDate.setFullYear(maturityDate.getFullYear() + params.periods);
    onSave({
      ...form,
      id: bond?.id || Date.now(),
      quantity: qty,
      rate: bondRate,
      purchaseAmount: qty * 100,
      maturityDate: maturityDate.toISOString().split("T")[0],
      name: `${form.type} – ${qty} szt. (${(bondRate*100).toFixed(2)}%)`,
      category: "Obligacje",
      value: preview ? preview.currentValue : qty * 100,
      isBond: true,
    });
    onClose();
  }

  const displayRate = form.rate ? parseFloat(form.rate) : autoRate ? +(autoRate*100).toFixed(2) : +(params?.defaultRate*100).toFixed(2);
  const rateSource = form.rate ? "ręcznie" : autoRate ? "z tabeli emisji" : "domyślna";
  const rateColor = form.rate ? "#00c896" : autoRate ? "#f0a030" : "#5a7a9e";

  return (
    <div onClick={e => e.target===e.currentTarget && onClose()}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}}>
      <div style={{background:"#161d28",border:"1px solid #2a3a50",borderRadius:16,padding:28,width:"100%",maxWidth:460,maxHeight:"90vh",overflowY:"auto"}}>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
          <div style={{fontSize:16,fontWeight:600,color:"#e8f0f8"}}>{isEdit?"Edytuj obligacje":"Dodaj obligacje"}</div>
          <button onClick={onClose} onMouseEnter={()=>setHovClose(true)} onMouseLeave={()=>setHovClose(false)}
            style={{background:hovClose?"#f0506018":"#161d28",border:`1px solid ${hovClose?"#f05060":"#f0506030"}`,borderRadius:6,color:"#f05060",cursor:"pointer",fontSize:18,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>

        {/* Typ */}
        <div style={{marginBottom:14}}>
          <label style={labelSt}>Rodzaj obligacji</label>
          <select style={baseInp} value={form.type}
            onChange={e => setForm(f=>({...f,type:e.target.value,rate:""}))}
            onFocus={focusInp} onBlur={blurInp}>
            {Object.entries(BOND_TYPES).map(([k,v])=>(
              <option key={k} value={k} style={{background:"#1a2535"}}>{v.label}</option>
            ))}
          </select>
        </div>

        {/* Inflacja info dla obligacji indeksowanych */}
        {showInflationInfo && (
          <div style={{background:"#0f1a27",border:"1px solid #1e3a50",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#5a7a9e",lineHeight:1.7}}>
            <span style={{color:"#3b9eff",fontWeight:600}}>Indeksowana inflacją GUS </span>
            · marża {((params.margin)*100).toFixed(1)}%
            <br/>
            Ostatnia inflacja GUS: <span style={{color:"#e8f0f8",fontFamily:"'DM Mono',monospace"}}>
              {(latestInflation*100).toFixed(1)}%
            </span>
            <span style={{color:"#4a5a6e",marginLeft:6}}>({latestInflationKey})</span>
            <br/>
            Stawka bieżącego okresu: <span style={{color:"#00c896",fontFamily:"'DM Mono',monospace"}}>
              {((Math.max(0,latestInflation)+params.margin)*100).toFixed(2)}%
            </span>
          </div>
        )}

        {/* Ilość + data */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          <div>
            <label style={labelSt}>Liczba obligacji (1 szt. = 100 zł)</label>
            <input style={{...baseInp,MozAppearance:"textfield"}} type="number" min="1" placeholder="np. 150"
              value={form.quantity} onChange={e=>setForm(f=>({...f,quantity:e.target.value}))}
              onFocus={focusInp} onBlur={blurInp}/>
          </div>
          <div>
            <label style={labelSt}>Data zakupu</label>
            <input style={baseInp} type="date" value={form.purchaseDate}
              onChange={e=>setForm(f=>({...f,purchaseDate:e.target.value,rate:""}))}
              onFocus={focusInp} onBlur={blurInp}/>
          </div>
        </div>

        {/* Stawka */}
        <div style={{marginBottom:14}}>
          <label style={labelSt}>
            Oprocentowanie roku 1 (%)
            <span style={{color:rateColor,marginLeft:8,fontWeight:400,textTransform:"none",letterSpacing:0}}>
              {displayRate.toFixed(2)}% — {rateSource}
            </span>
          </label>
          <input style={{...baseInp,MozAppearance:"textfield"}} type="number" step="0.01"
            placeholder={`${displayRate.toFixed(2)} (wpisz żeby nadpisać)`}
            value={form.rate}
            onChange={e=>setForm(f=>({...f,rate:e.target.value}))}
            onFocus={focusInp} onBlur={blurInp}/>
          <div style={{fontSize:11,color:"#4a5a6e",marginTop:4}}>
            {autoRate && !form.rate
              ? `Stawka dobrana automatycznie dla ${form.type} z ${form.purchaseDate?.substring(0,7)}. Zostaw puste lub wpisz ręcznie.`
              : "Znajdziesz na obligacjeskarbowe.pl → lista emisyjna Twojej serii"}
          </div>
        </div>

        {/* Notatka */}
        <div style={{marginBottom:14}}>
          <label style={labelSt}>Notatka (opcjonalnie)</label>
          <input style={baseInp} placeholder="np. TOS1227, IKE..." value={form.note}
            onChange={e=>setForm(f=>({...f,note:e.target.value}))}
            onFocus={focusInp} onBlur={blurInp}/>
        </div>

        {/* Podgląd */}
        {preview && (
          <div style={{background:"#0f1a27",border:"1px solid #1a3a20",borderRadius:12,padding:"14px 16px",marginBottom:18}}>
            <div style={{fontSize:11,color:"#5a7a9e",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Stan obecny</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><div style={{fontSize:11,color:"#5a7a9e"}}>Kwota zakupu</div><div style={{fontSize:15,fontWeight:600,color:"#e8f0f8",fontFamily:"'DM Mono',monospace"}}>{fmt(qty*100)}</div></div>
              <div><div style={{fontSize:11,color:"#5a7a9e"}}>Obecna wartość</div><div style={{fontSize:15,fontWeight:600,color:"#00c896",fontFamily:"'DM Mono',monospace"}}>{fmt(preview.currentValue)}</div></div>
              <div><div style={{fontSize:11,color:"#5a7a9e"}}>Narosłe odsetki</div><div style={{fontSize:14,fontWeight:600,color:"#f0a030",fontFamily:"'DM Mono',monospace"}}>+{fmt(preview.earned)}</div></div>
              <div><div style={{fontSize:11,color:"#5a7a9e"}}>Przyrost dzienny</div><div style={{fontSize:14,fontWeight:600,color:"#a78bfa",fontFamily:"'DM Mono',monospace"}}>+{fmt(preview.dailyGain)}/dzień</div></div>
            </div>
            <div style={{marginTop:10}}>
              <div style={{height:6,background:"#1e2a38",borderRadius:99,overflow:"hidden"}}>
                <div style={{width:(preview.progress*100)+"%",height:"100%",background:"#f0a030",borderRadius:99}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:11,color:"#5a7a9e"}}>
                <span>{new Date(form.purchaseDate).toLocaleDateString("pl-PL")}</span>
                <span>{Math.round(preview.progress*100)}% czasu</span>
                <span>{preview.maturityDate?.toLocaleDateString("pl-PL")}</span>
              </div>
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:10}}>
          <button onClick={submit} onMouseEnter={()=>setHovSave(true)} onMouseLeave={()=>setHovSave(false)}
            style={{flex:1,padding:"10px 16px",borderRadius:8,border:"2px solid #f0a030",background:hovSave?"#f0a03012":"transparent",color:"#f0a030",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'Sora',sans-serif",transition:"all .2s"}}>
            {isEdit?"Zapisz zmiany":"Dodaj obligacje"}
          </button>
          {isEdit && (
            <button onClick={()=>{onDelete(bond.id);onClose();}} onMouseEnter={()=>setHovDel(true)} onMouseLeave={()=>setHovDel(false)}
              style={{padding:"10px 16px",borderRadius:8,border:`1px solid ${hovDel?"#f05060":"#f0506040"}`,background:hovDel?"#f0506018":"transparent",color:"#f05060",fontSize:13,cursor:"pointer",transition:"all .15s"}}>Usuń</button>
          )}
          <button onClick={onClose}
            style={{padding:"10px 16px",borderRadius:8,border:"1px solid #f0506040",background:"transparent",color:"#f05060",fontSize:13,cursor:"pointer"}}>Anuluj</button>
        </div>
      </div>
    </div>
  );
}

// ─── Wiersz na liście ─────────────────────────────────────────────────────────
export function BondRow({ bond, onClick }) {
  const calc = calcBondCurrentValue(bond);
  const [hov, setHov] = useState(false);
  const gainPct = bond.purchaseAmount > 0 ? ((calc.currentValue-bond.purchaseAmount)/bond.purchaseAmount*100) : 0;

  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{display:"flex",alignItems:"center",gap:12,padding:"13px 18px",background:hov?"#111720":"#161d28",borderRadius:12,marginBottom:8,border:`1px solid ${hov?"#f0a03050":"#1e2a38"}`,cursor:"pointer",transition:"all .15s"}}>
      <div style={{width:4,height:36,borderRadius:2,background:"#f0a030",flexShrink:0}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:14,fontWeight:500,color:"#e8f0f8"}}>{bond.name}</div>
        <div style={{fontSize:11,color:"#4a5a6e",marginTop:2}}>
          zakup: {new Date(bond.purchaseDate).toLocaleDateString("pl-PL")} · wykup: {new Date(bond.maturityDate).toLocaleDateString("pl-PL")} · {Math.round(calc.progress*100)}% czasu
        </div>
      </div>
      <div style={{textAlign:"right",flexShrink:0}}>
        <div style={{fontSize:15,fontWeight:600,fontFamily:"'DM Mono',monospace",color:"#e8f0f8"}}>{fmt(calc.currentValue)}</div>
        <div style={{fontSize:11,color:"#f0a030",fontFamily:"'DM Mono',monospace",marginTop:2}}>+{fmt(calc.dailyGain)}/dzień · +{gainPct.toFixed(2)}%</div>
      </div>
      <div style={{width:50,height:4,background:"#1e2a38",borderRadius:2,flexShrink:0,overflow:"hidden"}}>
        <div style={{width:(calc.progress*100)+"%",height:"100%",background:"#f0a030",borderRadius:2}}/>
      </div>
    </div>
  );
}
