export function zipBand(zip: string): "low" | "neutral" | "high" {
  if (["20871","75035","75070"].includes(zip)) return "low";
  if (["10001","94103","60601"].includes(zip)) return "high";
  return "neutral";
}

function vehicleBase(year: number) {
  if (year >= 2020) return 620;
  if (year >= 2010) return 560;
  return 520;
}

export function rateQuote(payload: any) {
  const { person, drivers, vehicles, bundle } = payload;

  const zipFactor = (() => {
    const band = zipBand(person?.zipcode || vehicles?.[0]?.garaging_zip || "");
    if (band === "low") return 0.95;
    if (band === "high") return 1.10;
    return 1.00;
  })();

  const driverSurchargeFactor = (() => {
    let maxPct = 0;
    for (const d of drivers) {
      let pct = 0;
      pct += Math.min(2, (d?.accidents_last_5y || 0)) * 0.12;
      pct += Math.min(3, (d?.violations_last_3y || 0)) * 0.07;
      if ((d?.years_licensed || 0) < 3) pct += 0.15;
      maxPct = Math.max(maxPct, pct);
    }
    if (person?.prior_insurance === false || (person?.lapse_days || 0) > 30) {
      maxPct = Math.max(maxPct, 0.10 + maxPct);
    }
    return 1 + maxPct;
  })();

  const perVehicle = vehicles.map((v: any) => {
    const base = vehicleBase(v.year);
    const useFactor = v.primary_use === "commute" ? 1.08 : v.primary_use === "business" ? 1.12 : 1.00;
    const surcharged = base * useFactor * zipFactor * driverSurchargeFactor;
    return { year: v.year, make: v.make, model: v.model, base, surcharges: +(surcharged - base).toFixed(2), subtotal: +surcharged.toFixed(2) };
  });

  // Discounts
  const discounts: string[] = [];
  let discountPct = 0;
  if (vehicles.length >= 2) { discountPct += 0.08; discounts.push("Multi-vehicle (8%)"); }
  if (drivers.length >= 2) { discountPct += 0.04; discounts.push("Multi-driver (4%)"); }
  if (bundle?.homeowners_selected) { discountPct += 0.12; discounts.push("Auto + Home bundle (12%)"); }
  const safe = drivers.every((d:any)=> (d.accidents_last_5y||0)===0 && (d.violations_last_3y||0)===0);
  if (safe) { discountPct += 0.05; discounts.push("Safe driver (5%)"); }
  else if (person?.prior_insurance && (person?.lapse_days||0) <= 30) { discountPct += 0.05; discounts.push("Continuous insurance (5%)"); }

  const discounted = perVehicle.map(v => {
    const disc = +(v.subtotal * discountPct).toFixed(2);
    const after = +(v.subtotal - disc).toFixed(2);
    return { ...v, discounts: disc, subtotal: after };
  });

  const policy_fee = 25;
  const subtotal = discounted.reduce((s, v)=> s + v.subtotal, 0);
  const state_surcharge = +(subtotal * 0.02).toFixed(2);
  const final_6mo = +(subtotal + policy_fee + state_surcharge).toFixed(2);
  const final_12mo = +(final_6mo * 1.95).toFixed(2);

  return {
    per_vehicle: discounted,
    policy_fee,
    state_surcharge,
    final_6mo,
    final_12mo,
    discounts_applied: discounts
  };
}
