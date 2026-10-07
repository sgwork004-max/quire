fetch("data.json")
  .then((r) => r.json())
  .then(({ kpis, months }) => {
    document.getElementById("kpis").innerHTML = kpis
      .map((k) => `<div class="kpi"><span>${k.label}</span><strong>${k.value}</strong></div>`)
      .join("");
    const max = Math.max(...months.map((m) => m[1]));
    document.getElementById("bars").innerHTML = months
      .map(([m, v]) => `<div class="bar" style="height:${(v / max) * 100}%"><label>${m}</label></div>`)
      .join("");
  })
  .catch((e) => document.body.insertAdjacentHTML("beforeend", `<p style="color:red">data.json failed: ${e}</p>`));
