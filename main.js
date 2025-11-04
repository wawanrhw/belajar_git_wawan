const basePath = 'data/';  // Folder data JSON
let map;
let kriminalMarkers = new Map();
let polresMarkers = [];
let batasPolresGeojson = null;
let batasKabLayer = null;
let jenisChartInstance = null;

/**
 * Fungsi fetch data JSON dengan error handling
 * @param {string} file Nama file JSON
 * @returns {Promise<Object|null>} data JSON atau null jika gagal
 */
async function fetchJson(file) {
  try {
    const res = await fetch(basePath + file);
    if (!res.ok) throw new Error(`Gagal load ${file}: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Muat semua data sekaligus, inisiasi map dan chart
 */
async function loadData() {
  const [
    kriminalitas,
    gangguan,
    bencana,
    top5,
    tren,
    persen,
    batasKab,
    jenis10
  ] = await Promise.all([
    fetchJson('kriminalitas.json'),
    fetchJson('gangguan.json'),
    fetchJson('bencana.json'),
    fetchJson('top5.json'),
    fetchJson('tren.json'),
    fetchJson('persen_kekerasan.json'),
    fetchJson('batasKab.json'),
    fetchJson('10besar.json'),
  ]);

  batasPolresGeojson = batasKab;

  // Tampilkan tabel top 5 wilayah dengan kasus terbanyak
  if (kriminalitas) {
    const topWilayah = kriminalitas
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(({ polda, total, lat, lon }) => ({ wilayah: polda, jumlah: total, lat, lon }));

    populateTable('top5Table', topWilayah, ['wilayah', 'jumlah']);
  } else {
    showTableError('top5Table');
  }

  // Tampilkan tabel tren dan persen kekerasan
  if (!tren || !persen) {
    ['trenTable', 'persenTable'].forEach(showTableError);
  } else {
    populateTable('trenTable', tren, ['tahun', 'jumlah']);
    populateTable('persenTable', persen, ['kategori', 'persen']);
  }

  // Render chart 10 besar jenis tindak pidana
  if (jenis10 && jenis10.length) {
    renderJenisChart(jenis10);
  } else {
    showChartError('jenisChart');
  }

  // Inisiasi peta jika data lengkap
  if (kriminalitas && gangguan && bencana) {
    initMap(kriminalitas, gangguan, bencana);
  } else {
    document.getElementById('map').innerHTML = `<p style="color:red;padding:10px;">Gagal memuat data peta.</p>`;
  }
}

/**
 * Tampilkan pesan error pada tabel
 * @param {string} tableId 
 */
function showTableError(tableId) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = `<tr><td colspan="2" style="color:red;">Gagal memuat data.</td></tr>`;
}

/**
 * Tampilkan pesan error pada chart
 * @param {string} chartId 
 */
function showChartError(chartId) {
  document.querySelector(`#${chartId}`).parentElement.innerHTML = `<p style="color:red;">Gagal memuat data chart.</p>`;
}

/**
 * Isi tabel dengan data dan kolom yang diberikan
 * @param {string} tableId 
 * @param {Array<Object>} data 
 * @param {Array<string>} keys 
 */
function populateTable(tableId, data, keys) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = '';

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2">Tidak ada data</td></tr>`;
    return;
  }

  data.forEach(row => {
    let tr = '<tr>';
    keys.forEach(key => {
      if (key === 'wilayah') {
        // Cell wilayah bisa diklik untuk zoom ke lokasi
        tr += `<td class="clickable" data-lat="${row.lat}" data-lon="${row.lon}" data-wilayah="${row.wilayah}">${row[key] ?? ''}</td>`;
      } else {
        tr += `<td>${row[key] ?? ''}</td>`;
      }
    });
    tr += '</tr>';
    tbody.innerHTML += tr;
  });

  // Setup klik zoom pada cell wilayah
  document.querySelectorAll(`#${tableId} td.clickable`).forEach(cell => {
    cell.style.color = '#0066cc';
    cell.style.cursor = 'pointer';
    cell.style.textDecoration = 'underline';

    cell.addEventListener('click', () => {
      const lat = parseFloat(cell.dataset.lat);
      const lon = parseFloat(cell.dataset.lon);
      const wilayah = cell.dataset.wilayah;
      if (!isNaN(lat) && !isNaN(lon) && map) {
        // Animasi flyTo agar smooth zoom
        map.flyTo([lat, lon], 10, { duration: 1.2 });
        const marker = kriminalMarkers.get(wilayah);
        if (marker) marker.openPopup();
      }
    });
  });
}

/**
 * Buat marker Leaflet dengan icon custom
 * @param {Object} data objek dengan lat & lon
 * @param {string} color warna marker
 * @param {string} type tipe icon (circle/star/emoji)
 * @returns {L.Marker|null}
 */
function createMarker(data, color, type = 'circle') {
  if (data.lat == null || data.lon == null) return null;

  let html = '';
  let style = '';
  let className = 'custom-div-icon';

  if (type === 'star') {
    html = `<div style="color:${color};font-size:30px;animation:pulse 1.5s infinite;">⭐</div>`;
  } else if (type === 'emoji') {
    html = `<div style="font-size:30px;animation:float 1s ease-in-out infinite;">👮‍♂️</div>`;
  } else {
    style = `
      background-color: ${color};
      border-radius: 50%;
      width: 25px;
      height: 25px;
      box-shadow: 0 0 5px ${color};
      transition: transform 0.3s ease;
    `;
    html = `<div style="${style}"></div>`;
  }

  const icon = L.divIcon({
    className,
    html,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  return L.marker([data.lat, data.lon], { icon });
}

/**
 * Marker khusus Polres dengan emoji dan label nama
 * @param {Object} polres 
 * @returns {L.Marker|null}
 */
function createPolresMarker(polres) {
  if (polres.lat == null || polres.lon == null) return null;

  const html = `
    <div style="
      text-align: center;
      font-size: 20px;
      user-select: none;
      animation: float 1.5s ease-in-out infinite;
      white-space: nowrap;
      line-height: 1.2;
      cursor: pointer;
    ">
      <div>👮‍♂️</div>
      <div style="
        font-size: 12px;
        color: white;
        margin-top: 2px;
        font-weight: 600;
        background: rgba(0, 0, 0, 0.5);
        padding: 2px 6px;
        border-radius: 4px;
        box-shadow: 0 0 3px rgba(0,0,0,0.3);
        display: inline-block;
      ">
        ${polres.nama}
      </div>
    </div>`;

  const icon = L.divIcon({
    className: 'emoji-polres',
    html,
    iconSize: [100, 40],
    iconAnchor: [50, 40]
  });

  return L.marker([polres.lat, polres.lon], { icon });
}

/**
 * Buat layer batas kabupaten/kota dari GeoJSON
 * @returns {L.GeoJSON|null}
 */
function buatBatasKabupatenLayer() {
  if (!batasPolresGeojson) return null;

  return L.geoJSON(batasPolresGeojson, {
    style: {
      color: 'red',
      weight: 2,
      opacity: 0.8,
      fillColor: 'red',
      fillOpacity: 0.2,
    }
  });
}

/**
 * Inisiasi peta dan marker-layer kriminal, gangguan, bencana
 * @param {Array} kriminalitas 
 * @param {Array} gangguan 
 * @param {Array} bencana 
 */
function initMap(kriminalitas, gangguan, bencana) {
  map = L.map('map').setView([-2.5, 118], 5.5);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Layer batas kabupaten/kota
  batasKabLayer = buatBatasKabupatenLayer();

  const kriminalLayer = L.layerGroup();
  const gangguanLayer = L.layerGroup();
  const bencanaLayer = L.layerGroup();

  kriminalMarkers.clear();

  // Marker Kriminalitas
  kriminalitas.forEach(k => {
    let content = `<strong>${k.polda}</strong><br/>Total Kasus: ${k.total}<hr/><em>5 Jenis Kejahatan:</em><ul>`;
    if (k.jenis && k.jenis.length) {
      k.jenis.slice(0, 5).forEach(j => {
        content += `<li>${j.nama}: ${j.jumlah}</li>`;
      });
    }
    content += `</ul><hr/><em>Klik ⭐ untuk tampilkan Polres</em>`;

    const marker = createMarker(k, '#ff0000', 'star');
    if (marker) {
      marker.bindPopup(content);
      marker.on('mouseover', () => marker.openPopup());
      marker.on('mouseout', () => marker.closePopup());

      marker.on('click', () => {
        // Hapus marker polres sebelumnya
        polresMarkers.forEach(m => map.removeLayer(m));
        polresMarkers = [];

        if (k.top_polres && k.top_polres.length) {
          k.top_polres.forEach(polres => {
            const polresMarker = createPolresMarker(polres);
            if (polresMarker) {
              polresMarker.bindPopup(formatPolresPopup(polres));
              polresMarker.addTo(map);
              polresMarkers.push(polresMarker);
            }
          });
        }
      });

      marker.addTo(kriminalLayer);
      kriminalMarkers.set(k.polda, marker);
    }
  });

  // Marker Gangguan
  gangguan.forEach(g => {
    const content = `<strong>${g.polda}</strong><br/>Jumlah Gangguan: ${g.kejadian}<br/>Jenis: ${g.jenis}`;
    const marker = createMarker(g, '#ff9933');
    if (marker) {
      marker.bindPopup(content);
      marker.on('mouseover', () => marker.openPopup());
      marker.on('mouseout', () => marker.closePopup());
      marker.addTo(gangguanLayer);
    }
  });

  // Marker Bencana
  bencana.forEach(b => {
    const content = `<strong>${b.polda}</strong><br/>Jenis: ${b.jenis}<br/>Jumlah: ${b.kejadian}<br/>Keterangan: ${b.keterangan}`;
    const marker = createMarker(b, '#ff3333');
    if (marker) {
      marker.bindPopup(content);
      marker.on('mouseover', () => marker.openPopup());
      marker.on('mouseout', () => marker.closePopup());
      marker.addTo(bencanaLayer);
    }
  });

  kriminalLayer.addTo(map);

  // Layer control toggle
  L.control.layers(
    {
      "Kriminalitas": kriminalLayer,
      "Gangguan": gangguanLayer,
      "Bencana": bencanaLayer
    },
    {
      "Batas Kabupaten/Kota": batasKabLayer
    },
    { collapsed: false }
  ).addTo(map);
}

/**
 * Format isi popup marker Polres
 * @param {Object} polres 
 * @returns {string} html
 */
function formatPolresPopup(polres) {
  let html = `<strong>${polres.nama}</strong><br/>Total Kasus: ${polres.jumlah}<ul>`;
  if (polres.jenis && polres.jenis.length) {
    polres.jenis.forEach(j => {
      html += `<li>${j.nama}: ${j.jumlah}</li>`;
    });
  }
  html += '</ul>';
  return html;
}

/**
 * Render chart batang 10 besar jenis tindak pidana
 * @param {Array} data 
 */
function renderJenisChart(data) {
  const ctx = document.getElementById('jenisChart').getContext('2d');

  const sorted = data.slice().sort((a, b) => b.jumlah - a.jumlah);
  const labels = sorted.map(d => d.nama);
  const jumlahData = sorted.map(d => d.jumlah);

  if (jenisChartInstance) {
    jenisChartInstance.destroy();
  }

  jenisChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Jumlah Kasus',
        data: jumlahData,
        backgroundColor: 'rgba(42, 157, 143, 0.85)', // hijau toska
        borderColor: 'rgba(21, 101, 73, 1)',
        borderWidth: 1,
        borderRadius: 6,
        maxBarThickness: 40,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1000,
        easing: 'easeOutQuart'
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          title: { display: true, text: 'Jumlah Kasus' },
          grid: {
            color: '#e0e0e0',
            borderDash: [4, 4],
          }
        },
        x: {
          title: { display: true, text: 'Jenis Tindak Pidana' },
          ticks: {
            maxRotation: 45,
            minRotation: 30,
            color: '#264653',
            font: {
              size: 12,
              weight: '600'
            }
          },
          grid: {
            display: false
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#2a9d8f',
          titleColor: '#fff',
          bodyColor: '#fff',
          cornerRadius: 6,
          padding: 8,
          displayColors: false,
          callbacks: {
            label: ctx => `${ctx.parsed.y} kasus`
          }
        }
      }
    }
  });
}

/**
 * Setup animasi CSS
 */
function setupAnimationCSS() {
  const style = document.createElement('style');
  style.innerHTML = `
  @keyframes pulse {
    0% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.3); opacity: 0.6; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }
  .custom-div-icon div {
    transition: transform 0.3s ease;
  }
  .custom-div-icon:hover div {
    transform: scale(1.3);
    filter: drop-shadow(0 0 4px rgba(0,0,0,0.4));
    cursor: pointer;
  }
  .clickable {
    color: #0066cc;
    cursor: pointer;
    text-decoration: underline;
  }
  `;
  document.head.appendChild(style);
}

// Jalankan
setupAnimationCSS();
loadData();
