function parseStatusPTKP(s) {
  const t = String(s || "").trim().toUpperCase();
  const kawin = t.startsWith("K");
  const parts = t.split("/");
  const tanggungan = parts[1] ? Number(parts[1]) : 0;
  return { kawin, tanggungan: isNaN(tanggungan) ? 0 : tanggungan };
}

const BRACKETS = [
  { upTo: 60_000_000, rate: 0.05 },
  { upTo: 250_000_000, rate: 0.15 },
  { upTo: 500_000_000, rate: 0.25 },
  { upTo: 5_000_000_000, rate: 0.30 },
  { upTo: Infinity, rate: 0.35 },
];

function ptkp({ kawin = false, tanggungan = 0 } = {}) {
  const base = 54_000_000;
  const kawinAdd = kawin ? 4_500_000 : 0;
  const tanggunganAdd = Math.min(3, Math.max(0, Number(tanggungan || 0))) * 4_500_000;
  return base + kawinAdd + tanggunganAdd;
}

function calcProgressiveTax(brackets, taxable) {
  let remaining = Math.max(0, taxable);
  let lastCap = 0;
  let tax = 0;
  for (const b of brackets) {
    const cap = isFinite(b.upTo) ? b.upTo : Infinity;
    const slice = Math.max(0, Math.min(remaining, cap - lastCap));
    tax += slice * b.rate;
    remaining -= slice;
    lastCap = cap;
    if (remaining <= 0) break;
  }
  return Math.max(0, Math.round(tax));
}

function roundDownThousand(n) {
  const x = Math.max(0, Math.floor(Number(n || 0)));
  return Math.floor(x / 1000) * 1000;
}

function toNum(x) {
  if (x === null || x === undefined) return 0;
  if (typeof x === "number") return x;
  const s = String(x).replace(/[^\d\-\.]/g, "");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function pick(fields, obj) {
  for (const k of fields) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function mapRow(row) {
  const lower = {};
  Object.keys(row || {}).forEach(k => lower[k.toLowerCase()] = row[k]);
  const netoFields = ["neto","neto_pegawai","neto_pegawai_tahunan","penghasilan_neto","penghasilan neto","penghasilan_neto_setahun"];
  const brutoFields = ["penghasilan_bruto","bruto","bruto_setahun","penghasilan_bruto_setahun"];
  const bjFields = ["biaya_jabatan","biaya jabatan","bj","biaya_jabatan_setahun"];
  const pensiunFields = ["iuran_pensiun","iuran pensiun","iuran_pensiun_setahun"];
  const pengurangLain = ["pengurang_lain","pengurangan_lain","pengurangan_lainnya"];
  const pphFields = ["pph21_dipotong","pph21","pph_21","pph_dipotong","pph21_dipotong_setahun"];
  const netoDirect = pick(netoFields, lower);
  const pph = toNum(pick(pphFields, lower));
  if (netoDirect !== undefined) return { neto: toNum(netoDirect), kredit: pph };
  const bruto = toNum(pick(brutoFields, lower));
  const bj = toNum(pick(bjFields, lower));
  const pens = toNum(pick(pensiunFields, lower));
  const lain = toNum(pick(pengurangLain, lower));
  const neto = Math.max(0, bruto - bj - pens - lain);
  return { neto, kredit: pph };
}

function parseJSONText(txt) {
  const j = JSON.parse(txt);
  if (Array.isArray(j)) {
    return j.reduce((acc, row) => {
      const r = mapRow(row);
      return { neto: acc.neto + r.neto, kredit: acc.kredit + r.kredit };
    }, { neto: 0, kredit: 0 });
  }
  return mapRow(j);
}

function parseCSVText(txt) {
  const lines = txt.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { neto: 0, kredit: 0 };
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, "").toLowerCase());
  let neto = 0, kredit = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ""));
    const row = {};
    headers.forEach((h, idx) => row[h] = cols[idx]);
    const mapped = mapRow(row);
    neto += mapped.neto; kredit += mapped.kredit;
  }
  return { neto, kredit };
}

function computeAnnual({ brutoPraktekTahunan, norma, status, netoPegawai, kreditNonPegawai, kreditPegawai }) {
  const st = parseStatusPTKP(status);
  const netoProfesi = Math.max(0, Number(brutoPraktekTahunan) * Number(norma));
  netoPegawai = Math.max(0, Number(netoPegawai || 0));
  const netoTotal = netoProfesi + netoPegawai;
  const ptkpValue = ptkp(st);
  const pkp = roundDownThousand(netoTotal - ptkpValue);
  const pphTerutang = calcProgressiveTax(BRACKETS, pkp);
  const kreditPeg = Math.max(0, Number(kreditPegawai || 0));
  const kreditNon = Math.max(0, Number(kreditNonPegawai || 0));
  const kredit = kreditPeg + kreditNon;
  const kurangBayar = Math.max(0, pphTerutang - kredit);
  const lebihBayar = Math.max(0, kredit - pphTerutang);
  return { netoProfesi, netoPegawai, netoTotal, ptkpValue, pkp, pphTerutang, kreditPeg, kreditNon, kredit, kurangBayar, lebihBayar };
}

function fmtIDR(n) {
  return new Intl.NumberFormat("id-ID").format(Math.round(n));
}

function addBuktiRow(container, brutoVal = 0, pphVal = 0) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <div>
      <label>Bruto (Rp)</label>
      <input class="bp-bruto" type="number" value="${brutoVal}" />
    </div>
    <div>
      <label>PPh Dipotong (Rp)</label>
      <input class="bp-pph" type="number" value="${pphVal}" />
    </div>
    <div>
      <label>Keterangan</label>
      <input class="bp-ket" type="text" value="" />
    </div>
    <div style="align-self:end;">
      <button type="button" class="btnRemove">Hapus</button>
    </div>
  `;
  row.querySelector(".btnRemove").addEventListener("click", () => {
    container.removeChild(row);
    if (typeof window.updateBrutoFromTotals === "function") window.updateBrutoFromTotals();
  });
  const onInput = () => {
    if (typeof window.updateBrutoFromTotals === "function") window.updateBrutoFromTotals();
  };
  row.querySelector(".bp-bruto").addEventListener("input", onInput);
  row.querySelector(".bp-pph").addEventListener("input", onInput);
  container.appendChild(row);
}

function getBuktiTotals(container) {
  const brutoEls = container.querySelectorAll(".bp-bruto");
  const pphEls = container.querySelectorAll(".bp-pph");
  let totalBruto = 0, totalPph = 0;
  brutoEls.forEach(el => totalBruto += Number(el.value || 0));
  pphEls.forEach(el => totalPph += Number(el.value || 0));
  return { totalBruto, totalPph };
}

document.addEventListener("DOMContentLoaded", () => {
  const netoPegawai = document.getElementById("netoPegawai");
  const pphPegawai = document.getElementById("pphPegawai");
  const bpContainer = document.getElementById("bpContainer");
  const btnAddBP = document.getElementById("btnAddBP");
  const btnAdd5BP = document.getElementById("btnAdd5BP");
  const btnResetBP = document.getElementById("btnResetBP");
  const brutoPraktik = document.getElementById("brutoPraktik");
  const norma = document.getElementById("norma");
  const status = document.getElementById("status");
  const btn = document.getElementById("btnHitung");
  const hasil = document.getElementById("hasil");
  const btnSalin = document.getElementById("btnSalin");
  const btnCSV = document.getElementById("btnCSV");
  const errors = document.getElementById("errors");

  window.updateBrutoFromTotals = () => {
    const totals = getBuktiTotals(bpContainer);
    brutoPraktik.value = String(totals.totalBruto || 0);
  };

  addBuktiRow(bpContainer, 0, 0);
  window.updateBrutoFromTotals();
  btnAddBP.addEventListener("click", () => {
    addBuktiRow(bpContainer, 0, 0);
    window.updateBrutoFromTotals();
  });
  btnAdd5BP.addEventListener("click", () => {
    for (let i = 0; i < 5; i++) addBuktiRow(bpContainer, 0, 0);
    window.updateBrutoFromTotals();
  });
  btnResetBP.addEventListener("click", () => {
    bpContainer.innerHTML = "";
    addBuktiRow(bpContainer, 0, 0);
    window.updateBrutoFromTotals();
  });

  btn.addEventListener("click", async () => {
    const totals = getBuktiTotals(bpContainer);
    brutoPraktik.value = String(totals.totalBruto || 0);
    const errs = [];
    const numFields = [
      { label: "Neto pegawai tahunan", value: Number(netoPegawai.value || 0) },
      { label: "PPh 21 pegawai", value: Number(pphPegawai.value || 0) },
      { label: "Total bruto bukti potong", value: Number(totals.totalBruto || 0) },
      { label: "Total PPh bukti potong", value: Number(totals.totalPph || 0) },
    ];
    numFields.forEach(f => {
      if (!isFinite(f.value) || f.value < 0) errs.push(`${f.label} tidak boleh negatif atau tidak valid`);
    });
    if (!isFinite(Number(norma.value)) || Number(norma.value) < 0 || Number(norma.value) > 1) {
      errs.push("Norma harus antara 0 dan 1");
    }
    const bpBrutoEls = bpContainer.querySelectorAll(".bp-bruto");
    const bpPphEls = bpContainer.querySelectorAll(".bp-pph");
    bpBrutoEls.forEach((el, idx) => {
      const v = Number(el.value || 0);
      if (!isFinite(v) || v < 0) errs.push(`Bruto bukti potong baris ${idx + 1} tidak valid`);
    });
    bpPphEls.forEach((el, idx) => {
      const v = Number(el.value || 0);
      if (!isFinite(v) || v < 0) errs.push(`PPh bukti potong baris ${idx + 1} tidak valid`);
    });
    if (errs.length > 0) {
      errors.style.display = "";
      errors.textContent = errs.join("\n");
      return;
    } else {
      errors.style.display = "none";
      errors.textContent = "";
    }
    const res = computeAnnual({
      brutoPraktekTahunan: totals.totalBruto,
      norma: Number(norma.value),
      status: status.value,
      netoPegawai: Number(netoPegawai.value || 0),
      kreditPegawai: Number(pphPegawai.value || 0),
      kreditNonPegawai: totals.totalPph
    });
    const lines = [
      "SPT Tahunan Dokter — Ringkasan",
      `Neto profesi   : Rp ${fmtIDR(res.netoProfesi)} (norma ${Math.round(Number(norma.value)*100)}%)`,
      `Neto pegawai   : Rp ${fmtIDR(res.netoPegawai)}`,
      `Neto total     : Rp ${fmtIDR(res.netoTotal)}`,
      `PTKP           : Rp ${fmtIDR(res.ptkpValue)}`,
      `PKP            : Rp ${fmtIDR(res.pkp)}`,
      `PPh terutang   : Rp ${fmtIDR(res.pphTerutang)}`,
      `Kredit pegawai : Rp ${fmtIDR(res.kreditPeg)}`,
      `Kredit nonpeg. : Rp ${fmtIDR(res.kreditNon)}`,
      `Total kredit   : Rp ${fmtIDR(res.kredit)}`,
      `Total bruto bukti potong : Rp ${fmtIDR(totals.totalBruto)}`,
      `Kurang bayar   : Rp ${fmtIDR(res.kurangBayar)}`,
      `Lebih bayar    : Rp ${fmtIDR(res.lebihBayar)}`
    ];
    hasil.textContent = lines.join("\n");
  });

  btnSalin.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(hasil.textContent || "");
      alert("Hasil disalin ke clipboard.");
    } catch {
      alert("Gagal menyalin. Pilih teks secara manual.");
    }
  });

  btnCSV.addEventListener("click", () => {
    const totals = getBuktiTotals(bpContainer);
    const res = computeAnnual({
      brutoPraktekTahunan: totals.totalBruto,
      norma: Number(norma.value),
      status: status.value,
      netoPegawai: Number(netoPegawai.value || 0),
      kreditPegawai: Number(pphPegawai.value || 0),
      kreditNonPegawai: totals.totalPph
    });
    const rows = [
      ["Neto profesi", res.netoProfesi],
      ["Neto pegawai", res.netoPegawai],
      ["Neto total", res.netoTotal],
      ["PTKP", res.ptkpValue],
      ["PKP", res.pkp],
      ["PPh terutang", res.pphTerutang],
      ["Kredit pegawai", res.kreditPeg],
      ["Kredit nonpegawai", res.kreditNon],
      ["Total kredit", res.kredit],
      ["Total bruto bukti potong", totals.totalBruto],
      ["Kurang bayar", res.kurangBayar],
      ["Lebih bayar", res.lebihBayar],
    ];
    const csv = ["Label,Nilai"].concat(rows.map(r => `${r[0]},${Math.round(r[1])}`)).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ringkasan_spt.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
});
