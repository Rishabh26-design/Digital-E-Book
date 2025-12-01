// --- CONFIG ---
// ----------------------------------------------------
// DEFAULT PDF CONFIGURATION
// To load a PDF automatically on start:
// 1. Place your PDF file in the project folder.
// 2. Enter the file name below (e.g., "manual.pdf").
// 3. Leave empty "" to show the upload button first.
// ----------------------------------------------------
const DEFAULT_MANUAL_URL = "asset/SED 3.0_Magazine.pdf";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let book = null;
let pdfDoc = null;
let autoPlayInterval = null;
let isSoundOn = true;
let currentZoom = 1;
const isMobile = window.innerWidth < 768;
let currentSearchQuery = "";

// --- INITIALIZATION ---
window.onload = () => {
  // Check if default manual exists
  if (DEFAULT_MANUAL_URL && DEFAULT_MANUAL_URL.trim() !== "") {
    loadDefaultManual();
  }
};

async function loadDefaultManual() {
  showLoading(true, "Loading Default Manual...");
  try {
    const response = await fetch(DEFAULT_MANUAL_URL);
    if (!response.ok) throw new Error("Default PDF not found");
    const buffer = await response.arrayBuffer();
    await loadPDFFromBuffer(buffer);
  } catch (e) {
    console.warn("Could not load default PDF:", e);
    showLoading(false);
    document.getElementById("placeholder").style.display = "block";
  }
}

// --- 1. UPLOAD HANDLER ---
async function handleUpload(input) {
  if (!input.files[0]) return;
  const file = input.files[0];
  const buffer = await file.arrayBuffer();
  await loadPDFFromBuffer(buffer);
  input.value = ""; // Reset input
}

// --- 2. CORE PDF LOADER (Refactored) ---
async function loadPDFFromBuffer(buffer) {
  resetUI();
  document.getElementById("placeholder").style.display = "none";
  showLoading(true, "Processing PDF...");

  try {
    pdfDoc = await pdfjsLib.getDocument(buffer).promise;

    const p1 = await pdfDoc.getPage(1);
    const vp = p1.getViewport({ scale: 1 });
    const ratio = vp.width / vp.height;

    let h, w;
    if (isMobile) {
      w = window.innerWidth * 0.95;
      h = w / ratio;
      if (h > window.innerHeight * 0.8) {
        h = window.innerHeight * 0.8;
        w = h * ratio;
      }
    } else {
      h = window.innerHeight * 0.8;
      w = h * ratio;
    }

    showLoading(true, `Rendering ${pdfDoc.numPages} Pages...`);

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      await createDOMPage(i, w, h);
      document.getElementById(
        "loading-txt"
      ).innerText = `Page ${i}/${pdfDoc.numPages}`;
    }

    generateThumbnails(pdfDoc);
    initBook(w, h);

    document.getElementById("pageTotal").innerText = `/ ${pdfDoc.numPages}`;
  } catch (err) {
    alert("Error loading PDF: " + err.message);
    console.error(err);
    document.getElementById("placeholder").style.display = "block";
  }
  showLoading(false);
}

// --- 3. DOM GENERATION ---
async function createDOMPage(num, width, height) {
  const bookEl = document.getElementById("book");
  const pageDiv = document.createElement("div");
  pageDiv.className = "page";
  pageDiv.id = `page-${num}`;

  if (num === 1) {
    pageDiv.classList.add("-hard");
  } else {
    pageDiv.classList.add(num % 2 === 0 ? "-left" : "-right");
  }
  pageDiv.setAttribute("data-density", "soft");

  const contentDiv = document.createElement("div");
  contentDiv.className = "page-content";

  // Canvas Layer
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const page = await pdfDoc.getPage(num);
  const scale = isMobile ? 1.5 : 2.0;
  const viewport = page.getViewport({ scale: scale });

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport: viewport }).promise;

  // Highlight Overlay Layer
  const highlightLayer = document.createElement("div");
  highlightLayer.className = "highlighter-layer";
  highlightLayer.id = `hl-layer-${num}`;

  contentDiv.appendChild(canvas);
  contentDiv.appendChild(highlightLayer);
  pageDiv.appendChild(contentDiv);
  bookEl.appendChild(pageDiv);
}

// --- 4. PAGE FLIP ENGINE ---
function initBook(width, height) {
  const bookEl = document.getElementById("book");
  bookEl.style.display = "block";

  book = new St.PageFlip(bookEl, {
    width: width,
    height: height,
    size: "fixed",
    usePortrait: isMobile ? true : false,
    startPage: 0,
    showCover: true,
    maxShadowOpacity: 0.3,
    showPageCorners: true,
    useMouseEvents: true,
    swipeDistance: 20,
    flippingTime: 800,
  });

  book.loadFromHTML(document.querySelectorAll(".page"));

  book.on("flip", (e) => {
    const pIndex = e.data;
    updateUI(pIndex);
    updateBookPosition(pIndex);
  });

  updateUI(0);
  setTimeout(() => updateBookPosition(0), 100);
}

// --- 5. SEARCH & HIGHLIGHT ---
async function performSearch() {
  const query = document.getElementById("searchInput").value.trim();
  const container = document.getElementById("thumbsPane");

  document
    .querySelectorAll(".highlighter-layer")
    .forEach((el) => (el.innerHTML = ""));
  currentSearchQuery = query;

  if (!query) {
    if (pdfDoc) generateThumbnails(pdfDoc);
    return;
  }
  if (!pdfDoc) return;

  showLoading(true, `Searching...`);
  container.classList.add("open");
  container.innerHTML =
    '<div style="color:white;text-align:center;padding:10px;">Searching...</div>';

  const dummyCtx = document.createElement("canvas").getContext("2d");
  dummyCtx.font = "100px sans-serif";

  try {
    const matchingPages = [];

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();

      let pageHasMatch = false;

      textContent.items.forEach((item) => {
        const itemStr = item.str;
        const lowerItemStr = itemStr.toLowerCase();
        const lowerQ = query.toLowerCase();

        let index = 0;
        while ((index = lowerItemStr.indexOf(lowerQ, index)) !== -1) {
          pageHasMatch = true;

          const layer = document.getElementById(`hl-layer-${i}`);
          if (layer) {
            const canvas = layer.parentElement.querySelector("canvas");
            const domWidth =
              canvas.clientWidth || canvas.width / (isMobile ? 1.5 : 2.0);

            const pdfViewport = page.getViewport({ scale: 1 });
            const domScale = domWidth / pdfViewport.width;
            const viewport = page.getViewport({ scale: domScale });

            const totalMeasured = dummyCtx.measureText(itemStr).width;
            const scaleFactor =
              totalMeasured > 0 ? item.width / totalMeasured : 0;

            const preStr = itemStr.substring(0, index);
            const preMeasured = dummyCtx.measureText(preStr).width;
            const preWidthPDF = preMeasured * scaleFactor;

            const matchStr = itemStr.substring(index, index + lowerQ.length);
            const matchMeasured = dummyCtx.measureText(matchStr).width;
            const matchWidthPDF = matchMeasured * scaleFactor;

            const pdfX = item.transform[4] + preWidthPDF;
            const pdfY = item.transform[5];

            const rect = viewport.convertToViewportRectangle([
              pdfX,
              pdfY,
              pdfX + matchWidthPDF,
              pdfY + Math.sqrt(item.transform[2] ** 2 + item.transform[3] ** 2),
            ]);

            const x = Math.min(rect[0], rect[2]);
            const y = Math.min(rect[1], rect[3]);
            const w = Math.abs(rect[2] - rect[0]);
            const h = Math.abs(rect[3] - rect[1]);

            const highlight = document.createElement("div");
            highlight.className = "highlight-box";
            highlight.style.left = `${x}px`;

            const padY = h * 0.15;
            highlight.style.top = `${y - padY}px`;
            highlight.style.height = `${h + padY * 2}px`;
            highlight.style.width = `${w}px`;

            layer.appendChild(highlight);
          }

          index += lowerQ.length;
        }
      });

      if (pageHasMatch) matchingPages.push(i);
    }

    container.innerHTML = "";
    if (matchingPages.length === 0) {
      container.innerHTML = `<div style="color:#ccc;text-align:center;padding:20px;">No match found</div>`;
    } else {
      const header = document.createElement("div");
      header.style.cssText =
        "padding:10px; color:#ffeb3b; text-align:center; font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:10px;";
      header.innerText = `Found on ${matchingPages.length} pages`;
      container.appendChild(header);

      if (matchingPages.length > 0) book.flip(matchingPages[0] - 1);

      for (const pageNum of matchingPages) {
        await renderThumbnailItem(pageNum, container, true);
      }
    }
  } catch (e) {
    console.error(e);
  }
  showLoading(false);
}

// --- UI HELPERS ---
function updateBookPosition(index) {
  const bookEl = document.getElementById("book");
  const prevT = document.getElementById("trigger-prev");
  const nextT = document.getElementById("trigger-next");

  if (isMobile || (book && book.getSettings().usePortrait)) {
    bookEl.style.transform = `translateX(0%) scale(${currentZoom})`;
    prevT.style.display = "none";
    nextT.style.display = "none";
    return;
  }

  if (index === 0) {
    bookEl.style.transform = `translateX(-25%) scale(${currentZoom})`;
    prevT.style.display = "none";
    nextT.style.display = "block";
  } else if (index >= pdfDoc.numPages - 1) {
    bookEl.style.transform = `translateX(25%) scale(${currentZoom})`;
    prevT.style.display = "block";
    nextT.style.display = "none";
  } else {
    bookEl.style.transform = `translateX(0%) scale(${currentZoom})`;
    prevT.style.display = "block";
    nextT.style.display = "block";
  }
  alignTriggers();
}

function alignTriggers() {
  const wrapper = document.querySelector(".stf__wrapper");
  if (!wrapper) return;
  const r = wrapper.getBoundingClientRect();
  const prev = document.getElementById("trigger-prev");
  const next = document.getElementById("trigger-next");
  prev.style.left = r.left - 40 + "px";
  next.style.left = r.right - 40 + "px";
}

async function generateThumbnails(pdf) {
  const container = document.getElementById("thumbsPane");
  container.innerHTML = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    await renderThumbnailItem(i, container, false);
  }
}

async function renderThumbnailItem(pageNum, container, isHighlight = false) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport_raw = page.getViewport({ scale: 1 });
    const scale = 220 / viewport_raw.width;
    const vp = page.getViewport({ scale: scale });

    const div = document.createElement("div");
    div.className = "thumb-item";
    if (isHighlight) div.classList.add("search-match");
    div.id = `thumb-${pageNum - 1}`;
    div.onclick = () => {
      book.flip(pageNum - 1);
      if (window.innerWidth < 768) toggleThumbnails();
    };

    const can = document.createElement("canvas");
    can.width = vp.width;
    can.height = vp.height;
    const ctx = can.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, can.width, can.height);
    div.appendChild(can);

    const lbl = document.createElement("div");
    lbl.className = "thumb-label";
    lbl.innerText = `Page ${pageNum}`;
    div.appendChild(lbl);
    container.appendChild(div);

    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } catch (e) {
    console.error("Thumb render error:", e);
  }
}

function toggleThumbnails() {
  document.getElementById("thumbsPane").classList.toggle("open");
}

function updateUI(index) {
  document.getElementById("pageInput").value = index + 1;
  document.querySelectorAll(".thumb-item").forEach((el) => {
    if (!el.classList.contains("search-match")) el.classList.remove("current");
  });
  const t = document.getElementById(`thumb-${index}`);
  if (t) {
    if (!t.classList.contains("search-match")) t.classList.add("current");
    t.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function jumpToPage(val) {
  let p = parseInt(val) - 1;
  if (p < 0) p = 0;
  if (p >= pdfDoc.numPages) p = pdfDoc.numPages - 1;
  book.flip(p);
}

function goToLast() {
  book.flip(pdfDoc.numPages - 1);
}

function toggleAutoPlay() {
  const btn = document.getElementById("btnAutoPlay");
  if (autoPlayInterval) {
    clearInterval(autoPlayInterval);
    autoPlayInterval = null;
    btn.classList.remove("active");
    btn.innerHTML = '<i class="fa-solid fa-play"></i>';
  } else {
    autoPlayInterval = setInterval(() => {
      if (book) book.flipNext();
    }, 3000);
    btn.classList.add("active");
    btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
  }
}

function toggleSound() {
  isSoundOn = !isSoundOn;
  const btn = document.getElementById("btnSound");
  btn.innerHTML = isSoundOn
    ? '<i class="fa-solid fa-volume-high"></i>'
    : '<i class="fa-solid fa-volume-xmark"></i>';
}

function zoomBook(delta) {
  currentZoom += delta;
  if (currentZoom < 0.5) currentZoom = 0.5;
  if (currentZoom > 3) currentZoom = 3;
  updateBookPosition(book.getCurrentPageIndex());
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
}

function showLoading(show, txt) {
  document.getElementById("loading").style.display = show ? "flex" : "none";
  if (txt) document.getElementById("loading-txt").innerText = txt;
}

function resetUI() {
  if (book) {
    try {
      book.destroy();
    } catch (e) {
      console.warn(e);
    }
    book = null;
  }

  const oldBook = document.getElementById("book");
  if (oldBook) oldBook.remove();

  const newBook = document.createElement("div");
  newBook.id = "book";
  newBook.className = "flip-book";

  const stage = document.getElementById("stage");
  const thumbs = document.getElementById("thumbsPane");
  stage.insertBefore(newBook, thumbs);

  document.getElementById("thumbsPane").innerHTML = "";
  document.getElementById("thumbsPane").classList.remove("open");
  document
    .querySelectorAll(".highlighter-layer")
    .forEach((el) => (el.innerHTML = ""));
  pdfDoc = null;
}

document.addEventListener("click", (e) => {
  const sidebar = document.getElementById("thumbsPane");
  const toggleBtn = document.getElementById("btnThumbToggle");
  const searchBar = document.querySelector(".search-bar");

  if (sidebar.classList.contains("open")) {
    if (
      !sidebar.contains(e.target) &&
      (!toggleBtn || !toggleBtn.contains(e.target)) &&
      (!searchBar || !searchBar.contains(e.target))
    ) {
      sidebar.classList.remove("open");
    }
  }
});

window.addEventListener("resize", () => {
  if (book)
    setTimeout(() => updateBookPosition(book.getCurrentPageIndex()), 200);
});
