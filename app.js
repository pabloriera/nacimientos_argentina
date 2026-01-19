const CSV_FILES = {
  male: "argentina_male.csv",
  female: "argentina_female.csv",
};

const COLORS = {
  Estimates: "#2E86AB",
  Medium: "#A23B72",
  High: "#F18F01",
  Low: "#06A77D",
};

const fertilityPattern = (age) => {
  if (age >= 15 && age <= 19) return 0.08;
  if (age >= 20 && age <= 24) return 0.2;
  if (age >= 25 && age <= 29) return 0.27;
  if (age >= 30 && age <= 34) return 0.24;
  if (age >= 35 && age <= 39) return 0.14;
  if (age >= 40 && age <= 44) return 0.05;
  if (age >= 45 && age <= 49) return 0.02;
  return 0.0;
};

const ages = Array.from({ length: 101 }, (_, i) => i);
const fertilityWeights = ages.map((age) => fertilityPattern(age));

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    rows.push({
      location: cols[idx.location],
      year: Number(cols[idx.year]),
      age: Number(cols[idx.age]),
      value: Number(cols[idx.value]),
      variant: cols[idx.variant],
    });
  }
  return rows;
}

async function loadData() {
  const [maleText, femaleText] = await Promise.all([
    fetch(CSV_FILES.male).then((r) => r.text()),
    fetch(CSV_FILES.female).then((r) => r.text()),
  ]);
  const male = parseCSV(maleText);
  const female = parseCSV(femaleText);
  return {
    male,
    female,
    index: {
      male: indexByVariantYearAge(male),
      female: indexByVariantYearAge(female),
    },
  };
}

function indexByVariantYearAge(rows) {
  const byVariant = new Map();
  rows.forEach((row) => {
    const variantMap = byVariant.get(row.variant) || new Map();
    byVariant.set(row.variant, variantMap);
    const yearArr = variantMap.get(row.year) || new Array(101).fill(0);
    variantMap.set(row.year, yearArr);
    const age = Math.min(100, row.age);
    yearArr[age] += row.value;
  });
  return byVariant;
}

function buildTotals(data) {
  const totals = new Map();
  const add = (row) => {
    const key = `${row.variant}-${row.year}`;
    const current = totals.get(key) || 0;
    totals.set(key, current + row.value);
  };
  data.male.forEach(add);
  data.female.forEach(add);

  const perVariant = {};
  for (const [key, value] of totals.entries()) {
    const [variant, yearStr] = key.split("-");
    const year = Number(yearStr);
    if (!perVariant[variant]) perVariant[variant] = [];
    perVariant[variant].push({ year, total: value * 1000 });
  }

  Object.values(perVariant).forEach((arr) => arr.sort((a, b) => a.year - b.year));
  return perVariant;
}

function buildPyramid(data, year, variant) {
  const maleYear = data.index.male.get(variant)?.get(year) || new Array(101).fill(0);
  const femaleYear = data.index.female.get(variant)?.get(year) || new Array(101).fill(0);
  return {
    male: maleYear.slice(),
    female: femaleYear.slice(),
  };
}

function fitSurvival(data, variant, startYear = 2025, endYear = 2100) {
  const surv = {
    male: new Array(101).fill(1.0),
    female: new Array(101).fill(1.0),
  };

  const bySex = {
    male: data.index.male.get(variant) || new Map(),
    female: data.index.female.get(variant) || new Map(),
  };

  const fitFor = (yearMap, targetArr) => {
    for (let age = 0; age < 100; age++) {
      const ratios = [];
      for (let year = startYear; year < endYear; year++) {
        const arrA = yearMap.get(year);
        const arrB = yearMap.get(year + 1);
        const popA = arrA ? arrA[age] : 0;
        const popNext = arrB ? arrB[age + 1] : 0;
        if (popA > 0) ratios.push(popNext / popA);
      }
      if (ratios.length) {
        ratios.sort((a, b) => a - b);
        const mid = ratios[Math.floor(ratios.length / 2)];
        targetArr[age] = Math.min(0.9999, Math.max(0.5, mid));
      }
    }
    const ratios100 = [];
    for (let year = startYear; year < endYear; year++) {
      const arrA = yearMap.get(year);
      const arrB = yearMap.get(year + 1);
      const popA = arrA ? arrA[100] : 0;
      const popNext = arrB ? arrB[100] : 0;
      if (popA > 0) ratios100.push(popNext / popA);
    }
    if (ratios100.length) {
      ratios100.sort((a, b) => a - b);
      const mid = ratios100[Math.floor(ratios100.length / 2)];
      targetArr[100] = Math.min(0.9999, Math.max(0.5, mid));
    }
  };

  fitFor(bySex.male, surv.male);
  fitFor(bySex.female, surv.female);
  return surv;
}

function fitFertilityScale(data, variant, startYear = 2025, endYear = 2100) {
  const femaleMap = data.index.female.get(variant) || new Map();
  const maleMap = data.index.male.get(variant) || new Map();

  const scales = [];
  for (let year = startYear + 1; year <= endYear; year++) {
    const maleYear = maleMap.get(year);
    const femaleYear = femaleMap.get(year);
    const births = (maleYear ? maleYear[0] : 0) + (femaleYear ? femaleYear[0] : 0);
    let exposure = 0;
    for (let age = 15; age <= 49; age++) {
      const femalePrev = femaleMap.get(year - 1);
      const fa = femalePrev ? femalePrev[age] : 0;
      exposure += fa * fertilityWeights[age];
    }
    if (exposure > 0) {
      scales.push({ year, scale: births / exposure });
    }
  }
  const tail = scales.slice(-10);
  const n = tail.length;
  if (n === 0) return { intercept: 0, slope: 0 };
  const meanX = tail.reduce((s, d) => s + d.year, 0) / n;
  const meanY = tail.reduce((s, d) => s + d.scale, 0) / n;
  let num = 0;
  let den = 0;
  tail.forEach((d) => {
    num += (d.year - meanX) * (d.scale - meanY);
    den += (d.year - meanX) ** 2;
  });
  const slope = den > 0 ? num / den : 0;
  const intercept = meanY - slope * meanX;
  return { intercept, slope };
}

function buildFertilityScaleSeries(data, variant) {
  const femaleMap = data.index.female.get(variant) || new Map();
  const maleMap = data.index.male.get(variant) || new Map();
  const years = Array.from(new Set([...maleMap.keys(), ...femaleMap.keys()])).sort((a, b) => a - b);
  if (!years.length) return [];
  const minYear = years[0];
  const maxYear = years[years.length - 1];

  const scales = [];
  for (let year = minYear; year <= maxYear; year++) {
    const maleYear = maleMap.get(year);
    const femaleYear = femaleMap.get(year);
    const births = (maleYear ? maleYear[0] : 0) + (femaleYear ? femaleYear[0] : 0);
    let exposure = 0;
    const femalePrev = femaleMap.get(year - 1) || femaleMap.get(year);
    for (let age = 15; age <= 49; age++) {
      const fa = femalePrev ? femalePrev[age] : 0;
      exposure += fa * fertilityWeights[age];
    }
    if (exposure > 0) {
      scales.push({ year, scale: births / exposure });
    }
  }
  return scales;
}

function meanAgeFromArrays(male, female) {
  let total = 0;
  let weighted = 0;
  for (let age = 0; age <= 100; age++) {
    const value = (male[age] || 0) + (female[age] || 0);
    total += value;
    weighted += value * age;
  }
  return total > 0 ? weighted / total : 0;
}

function buildMeanAgeSeries(data, variant) {
  const maleMap = data.index.male.get(variant) || new Map();
  const femaleMap = data.index.female.get(variant) || new Map();
  const years = Array.from(new Set([...maleMap.keys(), ...femaleMap.keys()])).sort((a, b) => a - b);
  return years.map((year) => {
    const maleYear = maleMap.get(year) || new Array(101).fill(0);
    const femaleYear = femaleMap.get(year) || new Array(101).fill(0);
    return { year, mean: meanAgeFromArrays(maleYear, femaleYear) };
  });
}

function projectPopulation({ pyramid, surv, baseFertScale, tfrSlope, tfrBias, startYear, endYear, baseYear, survivalMult }) {
  let male = pyramid.male.slice();
  let female = pyramid.female.slice();
  const years = [];
  const totals = [];
  const meanAges = [];
  const fertScales = [];
  const slopeScale = tfrSlope / 5;
  const biasScale = tfrBias / 5;
  const survivalFactor = survivalMult ?? 1;

  for (let year = startYear; year <= endYear; year++) {
    const fertScale = Math.max(0, baseFertScale + biasScale + slopeScale * (year - baseYear));
    let births = 0;
    for (let age = 15; age <= 49; age++) {
      births += female[age] * fertilityWeights[age] * fertScale;
    }

    const newMale = new Array(101).fill(0);
    const newFemale = new Array(101).fill(0);
    newMale[0] = births * 0.512;
    newFemale[0] = births * 0.488;

    for (let age = 0; age < 100; age++) {
      newMale[age + 1] = male[age] * Math.min(1, surv.male[age] * survivalFactor);
      newFemale[age + 1] = female[age] * Math.min(1, surv.female[age] * survivalFactor);
    }
    newMale[100] += male[100] * Math.min(1, surv.male[100] * survivalFactor);
    newFemale[100] += female[100] * Math.min(1, surv.female[100] * survivalFactor);

    male = newMale;
    female = newFemale;

    const total = (male.reduce((s, v) => s + v, 0) + female.reduce((s, v) => s + v, 0)) * 1000;
    const meanAge = meanAgeFromArrays(male, female);
    years.push(year);
    totals.push(total);
    meanAges.push(meanAge);
    fertScales.push(fertScale);
  }

  return { years, totals, meanAges, fertScales };
}

function updateValue(id, value) {
  document.getElementById(id).textContent = value;
}

function buildUnTraces(unTotals) {
  return Object.entries(unTotals).map(([key, series]) => ({
    x: series.map((d) => d.year),
    y: series.map((d) => d.total),
    mode: "lines",
    name: `UN ${key}`,
    line: {
      color: COLORS[key] || "#999",
      width: key === "Estimates" ? 3 : 2,
    },
    hovertemplate: "%{x}: %{y:,.0f}<extra></extra>",
  }));
}

function buildChart(unTraces, modelSeries, variant, layout) {
  const traces = [
    ...unTraces,
    {
      x: modelSeries.years,
      y: modelSeries.totals,
      mode: "lines",
      name: `Modelo desde 2025 (${variant})`,
      line: {
        color: COLORS[variant] || "#111",
        width: 2,
        dash: "dot",
      },
      hovertemplate: "%{x}: %{y:,.0f}<extra></extra>",
    },
  ];

  Plotly.react("chart", traces, layout, { responsive: true });
}

function buildMeanAgeChart(unSeriesByVariant, modelSeries, variant, layout) {
  const traces = [];

  Object.entries(unSeriesByVariant).forEach(([key, series]) => {
    traces.push({
      x: series.map((d) => d.year),
      y: series.map((d) => d.mean),
      mode: "lines",
      name: `UN ${key}`,
      line: { color: COLORS[key] || "#2E86AB", width: key === "Estimates" ? 3 : 2 },
      hovertemplate: "%{x}: %{y:.1f} años<extra></extra>",
    });
  });

  traces.push({
    x: modelSeries.years,
    y: modelSeries.meanAges,
    mode: "lines",
    name: `Modelo (${variant})`,
    line: { color: COLORS[variant] || "#111", width: 2, dash: "dot" },
    hovertemplate: "%{x}: %{y:.1f} años<extra></extra>",
  });

  Plotly.react("meanAgeChart", traces, layout, { responsive: true });
}

function buildFertilityChart(realScales, trendSeries, variant, layout, estimatesScales, scaleFactor) {
  const factor = scaleFactor ?? 1;
  const traces = [
    {
      x: realScales.map((d) => d.year),
      y: realScales.map((d) => d.scale * factor),
      mode: "lines",
      name: `TFR UN (${variant})`,
      line: { color: COLORS[variant] || "#2E86AB", width: 2 },
      hovertemplate: "%{x}: %{y:.2f}<extra></extra>",
    },
    {
      x: trendSeries.map((d) => d.year),
      y: trendSeries.map((d) => d.scale * factor),
      mode: "lines",
      name: "Tendencia (slider)",
      line: { color: "#1f2a44", width: 2, dash: "dot" },
      hovertemplate: "%{x}: %{y:.2f}<extra></extra>",
    },
  ];

  if (estimatesScales && estimatesScales.length) {
    traces.unshift({
      x: estimatesScales.map((d) => d.year),
      y: estimatesScales.map((d) => d.scale * factor),
      mode: "lines",
      name: "TFR UN (Estimates)",
      line: { color: COLORS.Estimates || "#2E86AB", width: 2 },
      hovertemplate: "%{x}: %{y:.2f}<extra></extra>",
    });
  }

  Plotly.react("fertilityChart", traces, layout, { responsive: true });
}

function findScaleAtYear(series, year) {
  return series.find((d) => d.year === year)?.scale ?? null;
}

async function main() {
  const data = await loadData();
  const totals = buildTotals(data);
  const unTraces = buildUnTraces(totals);
  const baseYear = 2024;

  const variants = Object.keys(totals);
  const cache = {
    pyramid: new Map(),
    surv: new Map(),
    fertScales: new Map(),
    meanAgeUN: new Map(),
    modelBaseline: new Map(),
    baseFertScale: new Map(),
  };

  variants.forEach((variant) => {
    cache.pyramid.set(variant, buildPyramid(data, 2025, variant));
    cache.surv.set(variant, fitSurvival(data, variant, 2025, 2100));
    cache.fertScales.set(variant, buildFertilityScaleSeries(data, variant));
    cache.meanAgeUN.set(variant, buildMeanAgeSeries(data, variant));
  });

  variants.forEach((variant) => {
    const estimatesSeries = cache.fertScales.get("Estimates") || [];
    const variantSeries = cache.fertScales.get(variant) || [];
    const baseScale =
      findScaleAtYear(estimatesSeries, baseYear) ??
      findScaleAtYear(variantSeries, baseYear) ??
      (variantSeries.length ? variantSeries[variantSeries.length - 1].scale : 0);
    cache.baseFertScale.set(variant, baseScale);
  });

  let yMax = 0;
  Object.values(totals).forEach((series) => {
    series.forEach((d) => {
      if (d.total > yMax) yMax = d.total;
    });
  });

  let meanAgeMin = Infinity;
  let meanAgeMax = -Infinity;
  let fertMin = Infinity;
  let fertMax = -Infinity;
  const fertDisplayFactor = 5;

  variants.forEach((variant) => {
    const modelSeries = projectPopulation({
      pyramid: cache.pyramid.get(variant),
      surv: cache.surv.get(variant),
      baseFertScale: cache.baseFertScale.get(variant),
      tfrSlope: 0,
      tfrBias: 0,
      baseYear,
      startYear: 2026,
      endYear: 2200,
      survivalMult: 1,
    });
    cache.modelBaseline.set(variant, modelSeries);
    modelSeries.totals.forEach((v) => {
      if (v > yMax) yMax = v;
    });
    modelSeries.meanAges.forEach((v) => {
      if (v < meanAgeMin) meanAgeMin = v;
      if (v > meanAgeMax) meanAgeMax = v;
    });
    cache.meanAgeUN.get(variant).forEach((d) => {
      if (d.mean < meanAgeMin) meanAgeMin = d.mean;
      if (d.mean > meanAgeMax) meanAgeMax = d.mean;
    });
    cache.fertScales.get(variant).forEach((d) => {
      if (d.scale < fertMin) fertMin = d.scale;
      if (d.scale > fertMax) fertMax = d.scale;
    });
    modelSeries.fertScales.forEach((d) => {
      if (d < fertMin) fertMin = d;
      if (d > fertMax) fertMax = d;
    });
  });

  const populationLayout = {
    margin: { t: 30, r: 20, l: 50, b: 50 },
    xaxis: { title: "Año", range: [1950, 2200], fixedrange: true },
    yaxis: { title: "Población (personas)", range: [0, yMax * 1.05], fixedrange: true },
    legend: { orientation: "h" },
    uirevision: "static",
  };

  const meanAgeLayout = {
    margin: { t: 30, r: 20, l: 50, b: 50 },
    xaxis: { title: "Año", range: [1950, 2200], fixedrange: true },
    yaxis: {
      title: "Edad media (años)",
      range: [Math.max(0, meanAgeMin - 2), meanAgeMax + 2],
      fixedrange: true,
    },
    legend: { orientation: "h" },
    uirevision: "static-mean-age",
  };

  const fertilityLayout = {
    margin: { t: 30, r: 20, l: 50, b: 50 },
    xaxis: { title: "Año", range: [1950, 2200], fixedrange: true },
    yaxis: {
      title: "TFR (hijos por mujer)",
      range: [Math.max(0, fertMin * fertDisplayFactor * 0.9), fertMax * fertDisplayFactor * 1.1],
      fixedrange: true,
    },
    legend: { orientation: "h" },
    uirevision: "static-fertility",
  };

  const variantSelect = document.getElementById("variantSelect");
  const tfrBias = document.getElementById("tfrBias");
  const tfrSlope = document.getElementById("tfrSlope");
  const survivalMult = document.getElementById("survivalMult");

  let rafId = null;
  let pending = false;

  const doUpdate = () => {
    const variant = variantSelect.value;
    const biasValue = Number(tfrBias.value);
    const slopeValue = Number(tfrSlope.value);
    const survivalValue = Number(survivalMult.value);

    updateValue("tfrBiasVal", biasValue.toFixed(2));
    updateValue("tfrSlopeVal", slopeValue.toFixed(3));
    updateValue("survivalMultVal", survivalValue.toFixed(3));

    const modelSeries = projectPopulation({
      pyramid: cache.pyramid.get(variant),
      surv: cache.surv.get(variant),
      baseFertScale: cache.baseFertScale.get(variant),
      tfrBias: biasValue,
      tfrSlope: slopeValue,
      baseYear,
      startYear: 2026,
      endYear: 2200,
      survivalMult: survivalValue,
    });

    const trendSeries = modelSeries.years.map((year, idx) => ({
      year,
      scale: modelSeries.fertScales[idx],
    }));

    buildChart(unTraces, modelSeries, variant, populationLayout);
    const meanAgeSeriesByVariant = {};
    cache.meanAgeUN.forEach((series, key) => {
      meanAgeSeriesByVariant[key] = series;
    });
    buildMeanAgeChart(meanAgeSeriesByVariant, modelSeries, variant, meanAgeLayout);
    buildFertilityChart(
      cache.fertScales.get(variant),
      trendSeries,
      variant,
      fertilityLayout,
      cache.fertScales.get("Estimates"),
      fertDisplayFactor
    );
  };

  const scheduleUpdate = () => {
    pending = true;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!pending) return;
      pending = false;
      doUpdate();
    });
  };

  [variantSelect, tfrBias, tfrSlope, survivalMult].forEach((el) => {
    el.addEventListener("input", scheduleUpdate);
  });

  doUpdate();
}

main();
