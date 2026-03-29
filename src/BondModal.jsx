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

// ─── Silnik obliczeń ──────────────────────────────────────────────────────────
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

  // Estymacja zysku na koniec — zakładamy obecną stawkę dla przyszłych okresów
  const maturity = new Date(maturityDate); maturity.setHours(0,0,0,0);
  let totalAtMaturity = 0;
  for (let i = 0; i < quantity; i++) totalAtMaturity += calcSingleBond(params, purchase, maturity, bondRate);

  return {
    currentValue: Math.round(totalValue * 100) / 100,
    earned: Math.round((totalValue - totalNominal) * 100) / 100,
    dailyGain: Math.round((totalValue - valueYesterday) * 100) / 100,
    estimatedAtMaturity: Math.round(totalAtMaturity * 100) / 100,
    estimatedProfit: Math.round((totalAtMaturity - totalNominal) * 100) / 100,
    progress, maturityDate, totalNominal, bondRate,
  };
}

// ─── Style ────────────────────────────────────────────────────────────────────
const labelSt = { fontSize:11, color:"#5a6a7e", display:"block", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" };
const baseInp = { display:"block", width:"100%", padding:"9px 12px", fontSize:13, borderRadius:8, background:"#1a2535", border:"1px solid #243040", color:"#e8f0f8", fontFamily:"'Sora', sans-serif", outline:"none", WebkitAppearance:"none", boxSizing:"border-box", transition:"border-color .15s, box-shadow .15s" };
const focusInp = e => { e.target.style.borderColor="#f0a030"; e.target.style.boxShadow="0 0 0 3px #f0a03018"; };
const blurInp  = e => { e.target.style.borderColor="#243040"; e.target.style.boxShadow="none"; };
const fmt2 = n => new Intl.NumberFormat("pl-PL",{style:"currency",currency:"PLN",maximumFractionDigits:2}).format(n);
const fmt0 = n => new Intl.NumberFormat("pl-PL",{style:"currency",currency:"PLN",maximumFractionDigits:0}).format(n);

// ─── Panel Szczegółów (Widok Otwarty) ─────────────────────────────────────────
export function BondDetailPanel({ bond, onEdit, onDelete, onClose, onMove }) {
  const calc = calcBondCurrentValue(bond);
  const params = BOND_TYPES[bond.type];
  const [menuOpen, setMenuOpen] = useState(false);
  const earned = calc.earned;
  const gainPct = bond.purchaseAmount > 0 ? (earned / bond.purchaseAmount * 100) : 0;
  const estimatedProfitPct = bond.purchaseAmount > 0 ? (calc.estimatedProfit / bond.purchaseAmount * 100) : 0;

  // Inflacja dla obligacji indeksowanych
  const isInflationBond = params?.rateType === "inflation";
  const latestInflKey = Object.keys(INFLATION_HISTORY).sort().pop();
  const latestInfl = INFLATION_HISTORY[latestInflKey];
  const currentPeriodRate = isInflationBond
    ? Math.max(0, latestInfl) + params.margin
    : bond.rate;

  // Oblicz stawki dla każdego okresu
  const periods = [];
  if (params) {
    for (let k = 0; k < params.periods; k++) {
      const pStart = new Date(bond.purchaseDate);
      pStart.setFullYear(pStart.getFullYear() + k);
      const pEnd = new Date(bond.purchaseDate);
      pEnd.setFullYear(pEnd.getFullYear() + k + 1);
      const today = new Date();

      let rate, rateLabel;
      if (k === 0) {
        rate = bond.rate;
        rateLabel = `${(rate*100).toFixed(2)}% (stała)`;
      } else if (params.rateType === "inflation") {
        const infl = getInflationForBondPeriod(pStart);
        rate = Math.max(0, infl) + params.margin;
        const inflKey = (() => {
          const pm = pStart.getMonth() === 0 ? 12 : pStart.getMonth();
          const py = pStart.getMonth() === 0 ? pStart.getFullYear()-1 : pStart.getFullYear();
          return `${py}-${String(pm).padStart(2,"0")}`;
        })();
        rateLabel = `${(rate*100).toFixed(2)}% (infl. ${(infl*100).toFixed(1)}% + ${(params.margin*100).toFixed(1)}%)`;
      } else {
        rate = bond.rate;
        rateLabel = `${(rate*100).toFixed(2)}%`;
      }

      const isPast = today > pEnd;
      const isCurrent = today >= pStart && today <= pEnd;
      periods.push({ k, pStart, pEnd, rate, rateLabel, isPast, isCurrent });
    }
  }

  return (
    <div onClick={e => e.target===e.currentTarget && onClose()}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}}>
      <div style={{background:"#161d28",border:"1px solid #2a3a50",borderRadius:16,padding:"20px 16px",width:"100%",maxWidth:500,maxHeight:"90vh",overflowY:"auto"}}>

        {/* Header — nazwa + przyciski w jednym wierszu */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,gap:8}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:16,fontWeight:700,color:"#e8f0f8",marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
              {bond.name}
            </div>
            <div style={{fontSize:11,color:"#5a6a7e",display:"flex",flexWrap:"wrap",gap:"0 6px"}}>
              <span>{params?.label}</span>
              <span>·</span>
              <span>zakup: {new Date(bond.purchaseDate).toLocaleDateString("pl-PL")}</span>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
            <div style={{position:"relative"}}>
              <button onClick={()=>setMenuOpen(o=>!o)}
                style={{background:menuOpen?"#1e2a38":"transparent",border:`1px solid ${menuOpen?"#2a3a50":"#1e2a38"}`,borderRadius:8,color:"#8a9bb0",cursor:"pointer",width:32,height:32,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>
                ···
              </button>
              {menuOpen && (
                <div style={{position:"absolute",top:38,right:0,background:"#161d28",border:"1px solid #2a3a50",borderRadius:10,padding:"4px",minWidth:150,boxShadow:"0 8px 24px rgba(0,0,0,0.4)",zIndex:10}}>
                  <button onClick={()=>{setMenuOpen(false);onEdit(bond);}}
                    style={{display:"block",width:"100%",padding:"9px 14px",background:"transparent",border:"none",color:"#e8f0f8",fontSize:13,cursor:"pointer",textAlign:"left",borderRadius:6,fontFamily:"'Sora',sans-serif"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#1e2a38"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    Edytuj
                  </button>
                  {onMove && (
                    <button onClick={()=>{setMenuOpen(false);onMove(bond);}}
                      style={{display:"block",width:"100%",padding:"9px 14px",background:"transparent",border:"none",color:"#e8f0f8",fontSize:13,cursor:"pointer",textAlign:"left",borderRadius:6,fontFamily:"'Sora',sans-serif"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#1e2a38"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      Przenieś
                    </button>
                  )}
                  <button onClick={()=>{setMenuOpen(false);onDelete(bond.id);onClose();}}
                    style={{display:"block",width:"100%",padding:"9px 14px",background:"transparent",border:"none",color:"#f05060",fontSize:13,cursor:"pointer",textAlign:"left",borderRadius:6,fontFamily:"'Sora',sans-serif"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#f0506018"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    Usuń
                  </button>
                </div>
              )}
            </div>
            <button onClick={onClose}
              style={{background:"transparent",border:"1px solid #f0506030",borderRadius:6,color:"#f05060",cursor:"pointer",width:30,height:30,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
        </div>

        {/* Obecna wartość — 2 kolumny × 2 wiersze */}
        <div style={{background:"#0f1a27",borderRadius:12,padding:"14px 14px",marginBottom:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 12px"}}>
            <div>
              <div style={{fontSize:10,color:"#5a6a7e",marginBottom:2}}>Kwota zakupu</div>
              <div style={{fontSize:14,fontWeight:600,color:"#e8f0f8",fontFamily:"'DM Mono',monospace"}}>{fmt2(bond.purchaseAmount)}</div>
            </div>
            <div>
              <div style={{fontSize:10,color:"#5a6a7e",marginBottom:2}}>Obecna wartość</div>
              <div style={{fontSize:14,fontWeight:600,color:"#00c896",fontFamily:"'DM Mono',monospace"}}>{fmt2(calc.currentValue)}</div>
            </div>
            <div>
              <div style={{fontSize:10,color:"#5a6a7e",marginBottom:2}}>Narosłe odsetki</div>
              {/* Dwie linijki: kwota i procent osobno */}
              <div style={{fontSize:13,fontWeight:600,color:"#f0a030",fontFamily:"'DM Mono',monospace"}}>+{fmt2(earned)}</div>
              <div style={{fontSize:11,color:"#c07820",fontFamily:"'DM Mono',monospace"}}>(+{gainPct.toFixed(2)}%)</div>
            </div>
            <div>
              <div style={{fontSize:10,color:"#5a6a7e",marginBottom:2}}>Przyrost dzienny</div>
              <div style={{fontSize:13,fontWeight:600,color:"#a78bfa",fontFamily:"'DM Mono',monospace"}}>+{fmt2(calc.dailyGain)}</div>
              <div style={{fontSize:11,color:"#7a5bc4",fontFamily:"'DM Mono',monospace"}}>/dzień</div>
            </div>
          </div>
          {/* Pasek postępu */}
          <div style={{marginTop:12}}>
            <div style={{height:5,background:"#1e2a38",borderRadius:99,overflow:"hidden"}}>
              <div style={{width:(calc.progress*100)+"%",height:"100%",background:"#f0a030",borderRadius:99,transition:"width .3s"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:10,color:"#5a6a7e"}}>
              <span>{new Date(bond.purchaseDate).toLocaleDateString("pl-PL")}</span>
              <span style={{color:"#f0a030"}}>{Math.round(calc.progress*100)}%</span>
              <span>{calc.maturityDate?.toLocaleDateString("pl-PL")}</span>
            </div>
          </div>
        </div>

        {/* Estymacja — pełna szerokość, nie 2 kolumny */}
        <div style={{background:"#0a1a12",border:"1px solid #1a3a20",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
          <div style={{fontSize:10,color:"#5a6a7e",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>
            Estymacja na dzień wykupu
            {isInflationBond && <span style={{color:"#3a4a5e",marginLeft:6,textTransform:"none"}}>(inflacja {(latestInfl*100).toFixed(1)}%)</span>}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:8}}>
            <div>
              <div style={{fontSize:10,color:"#5a6a7e",marginBottom:2}}>Wartość w wykupie</div>
              <div style={{fontSize:15,fontWeight:700,color:"#00c896",fontFamily:"'DM Mono',monospace"}}>{fmt2(calc.estimatedAtMaturity)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:10,color:"#5a6a7e",marginBottom:2}}>Estymowany zysk</div>
              <div style={{fontSize:15,fontWeight:700,color:"#00c896",fontFamily:"'DM Mono',monospace"}}>+{fmt2(calc.estimatedProfit)}</div>
              <div style={{fontSize:11,color:"#009966",fontFamily:"'DM Mono',monospace"}}>(+{estimatedProfitPct.toFixed(2)}%)</div>
            </div>
          </div>
        </div>

        {/* Okresy odsetkowe */}
        <div style={{background:"#0f1a27",borderRadius:12,padding:"12px 14px"}}>
          <div style={{fontSize:10,color:"#5a6a7e",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>Okresy odsetkowe</div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {periods.map(({k, pStart, pEnd, rateLabel, isPast, isCurrent}) => (
              <div key={k} style={{padding:"7px 10px",borderRadius:8,background:isCurrent?"#1a2a1a":isPast?"transparent":"transparent",border:`1px solid ${isCurrent?"#00c89640":"#1e2a38"}`}}>
                {/* Wiersz: numer roku + stawka (whiteSpace nowrap) */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                    <div style={{width:5,height:5,borderRadius:"50%",background:isCurrent?"#00c896":isPast?"#2a3a50":"#3a4a5e",flexShrink:0}}/>
                    <span style={{fontSize:12,fontWeight:isCurrent?600:400,color:isCurrent?"#e8f0f8":isPast?"#3a4a5e":"#5a6a7e",whiteSpace:"nowrap"}}>
                      Rok {k+1}
                    </span>
                    {isCurrent && (
                      <span style={{fontSize:9,color:"#00c896",background:"#00c89620",padding:"1px 5px",borderRadius:4,whiteSpace:"nowrap"}}>
                        teraz
                      </span>
                    )}
                  </div>
                  <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:isCurrent?"#f0a030":isPast?"#3a4a5e":"#5a6a7e",fontWeight:isCurrent?600:400,whiteSpace:"nowrap",flexShrink:0}}>
                    {rateLabel}
                  </div>
                </div>
                {/* Daty w osobnym wierszu */}
                <div style={{fontSize:10,color:isPast?"#2a3a4e":"#3a4a5e",marginTop:2,marginLeft:10}}>
                  {pStart.toLocaleDateString("pl-PL")} – {pEnd.toLocaleDateString("pl-PL")}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Modal dodawania/edycji ───────────────────────────────────────────────────
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

  // Auto-dobierz stawkę gdy zmienia się typ lub data (tylko gdy nie wpisano ręcznie)
  useEffect(() => {
    if (!form.purchaseDate) return;
    // Zawsze próbuj dobrać automatycznie — nadpisze tylko jeśli pole jest puste
    const detected = getRateForPurchase(form.type, form.purchaseDate);
    setAutoRate(detected);
    // Wyczyść ręczny wpis gdy zmienia się typ lub data
    setForm(f => ({ ...f, rate: "" }));
  }, [form.type, form.purchaseDate, ratesLoaded]);

  const params = BOND_TYPES[form.type];
  const qty = parseInt(form.quantity) || 0;
  const bondRate = form.rate ? parseFloat(form.rate) / 100 : (autoRate || params?.defaultRate);

  let preview = null;
  if (qty > 0 && form.purchaseDate && bondRate) {
    preview = calcBondCurrentValue({ type:form.type, purchaseDate:form.purchaseDate, quantity:qty, rate:bondRate });
  }

  const isInflationBond = params?.rateType === "inflation";
  const latestInflKey = Object.keys(INFLATION_HISTORY).sort().pop();
  const latestInfl = INFLATION_HISTORY[latestInflKey];

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

        <div style={{marginBottom:14}}>
          <label style={labelSt}>Rodzaj obligacji</label>
          <select style={baseInp} value={form.type}
            onChange={e => setForm(f=>({...f,type:e.target.value}))}
            onFocus={focusInp} onBlur={blurInp}>
            {Object.entries(BOND_TYPES).map(([k,v])=>(
              <option key={k} value={k} style={{background:"#1a2535"}}>{v.label}</option>
            ))}
          </select>
        </div>

        {isInflationBond && (
          <div style={{background:"#0f1a27",border:"1px solid #1e3a50",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#5a7a9e",lineHeight:1.7}}>
            <span style={{color:"#3b9eff",fontWeight:600}}>Indeksowana inflacją GUS</span> · marża {((params.margin)*100).toFixed(1)}%
            <br/>Ostatnia inflacja GUS: <span style={{color:"#e8f0f8",fontFamily:"'DM Mono',monospace"}}>{(latestInfl*100).toFixed(1)}%</span>
            <span style={{color:"#4a5a6e",marginLeft:6}}>({latestInflKey})</span>
            <br/>Stawka bieżącego okresu: <span style={{color:"#00c896",fontFamily:"'DM Mono',monospace"}}>{((Math.max(0,latestInfl)+params.margin)*100).toFixed(2)}%</span>
          </div>
        )}

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
              onChange={e=>setForm(f=>({...f,purchaseDate:e.target.value}))}
              onFocus={focusInp} onBlur={blurInp}/>
          </div>
        </div>

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
              ? `Dobrano automatycznie dla ${form.type} z ${form.purchaseDate?.substring(0,7)}.`
              : "Znajdziesz na obligacjeskarbowe.pl → lista emisyjna Twojej serii"}
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <label style={labelSt}>Notatka (opcjonalnie)</label>
          <input style={baseInp} placeholder="np. TOS1227, IKE..." value={form.note}
            onChange={e=>setForm(f=>({...f,note:e.target.value}))}
            onFocus={focusInp} onBlur={blurInp}/>
        </div>

        {preview && (
          <div style={{background:"#0f1a27",border:"1px solid #1a3a20",borderRadius:12,padding:"14px 16px",marginBottom:18}}>
            <div style={{fontSize:11,color:"#5a7a9e",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Podgląd</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><div style={{fontSize:11,color:"#5a7a9e"}}>Kwota zakupu</div><div style={{fontSize:15,fontWeight:600,color:"#e8f0f8",fontFamily:"'DM Mono',monospace"}}>{fmt2(qty*100)}</div></div>
              <div><div style={{fontSize:11,color:"#5a7a9e"}}>Obecna wartość</div><div style={{fontSize:15,fontWeight:600,color:"#00c896",fontFamily:"'DM Mono',monospace"}}>{fmt2(preview.currentValue)}</div></div>
              <div><div style={{fontSize:11,color:"#5a7a9e"}}>Narosłe odsetki</div><div style={{fontSize:14,fontWeight:600,color:"#f0a030",fontFamily:"'DM Mono',monospace"}}>+{fmt2(preview.earned)}</div></div>
              <div><div style={{fontSize:11,color:"#5a7a9e"}}>Przyrost dzienny</div><div style={{fontSize:14,fontWeight:600,color:"#a78bfa",fontFamily:"'DM Mono',monospace"}}>+{fmt2(preview.dailyGain)}/dzień</div></div>
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
export function BondRow({ bond, color, onClick }) {
  const calc = calcBondCurrentValue(bond);
  const [hov, setHov] = useState(false);
  const earned = calc.earned;
  const gainPct = bond.purchaseAmount > 0 ? (earned / bond.purchaseAmount * 100) : 0;
  const c = color || "#f0a030";

  // Skrócona nazwa: "EDO – 100 szt. (6.80%)" → "EDO · 100 szt."
  const shortName = `${bond.type || bond.name?.split("–")[0]?.trim()} · ${bond.quantity} szt.`;
  const rateLabel = bond.rate ? ` (${(bond.rate*100).toFixed(2)}%)` : "";

  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:hov?"#111720":"#161d28",borderRadius:12,marginBottom:8,border:`1px solid ${hov?c+"50":"#1e2a38"}`,cursor:"pointer",transition:"all .15s"}}>

      {/* Pasek lewostronny */}
      <div style={{width:4,borderRadius:2,background:c,flexShrink:0,alignSelf:"stretch"}}/>

      <div style={{flex:1,minWidth:0}}>
        {/* Wiersz 1: nazwa + wartość */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
          <div style={{fontSize:13,fontWeight:600,color:"#e8f0f8",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {bond.name}
          </div>
          <div style={{fontSize:14,fontWeight:600,fontFamily:"'DM Mono',monospace",color:"#e8f0f8",flexShrink:0}}>
            {fmt2(calc.currentValue)}
          </div>
        </div>

        {/* Wiersz 2: daty w jednej linii + zysk */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:4}}>
          <div style={{fontSize:11,color:"#4a5a6e",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0}}>
            {new Date(bond.purchaseDate).toLocaleDateString("pl-PL")} → {new Date(bond.maturityDate).toLocaleDateString("pl-PL")} · {Math.round(calc.progress*100)}%
          </div>
          <div style={{fontSize:11,color:"#00c896",fontFamily:"'DM Mono',monospace",flexShrink:0,whiteSpace:"nowrap"}}>
            +{fmt2(earned)} (+{gainPct.toFixed(2)}%)
          </div>
        </div>
      </div>
    </div>
  );
}
