const PDFDocument = require("pdfkit");

const PAGE_MARGIN = 48;
const LABEL_WIDTH = 92;
const ROW_HEIGHT = 18;
const IMAGE_BOX_WIDTH = 240;
const IMAGE_BOX_HEIGHT = 170;
const SUPPORTED_PDF_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const STATUS_LABELS = Object.freeze({
  registered: "Registreret",
  planned: "Planlagt",
  mounted: "Monteret",
  checked: "Kontrolleret",
  deviation: "Afvigelse",
});

function text(value, fallback = "-") {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || fallback;
}

function formatDateTime(value = new Date()) {
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  }).format(value);
}

function splitBrandModel(modelValue) {
  const model = text(modelValue, "");
  if (!model) {
    return { brand: "-", model: "-" };
  }
  const separator = " · ";
  if (model.includes(separator)) {
    const [brand, ...rest] = model.split(separator);
    return {
      brand: text(brand),
      model: text(rest.join(separator)),
    };
  }
  return { brand: "-", model };
}

function statusLabel(value) {
  return STATUS_LABELS[value] || text(value);
}

function formatMac(value) {
  const raw = text(value, "");
  const compact = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(compact)) {
    return raw || "-";
  }
  return compact.match(/.{1,2}/g).join(":");
}

function safeText(value) {
  return text(value).replace(/\s+/g, " ");
}

function addPageIfNeeded(doc, neededHeight) {
  if (doc.y + neededHeight > doc.page.height - PAGE_MARGIN) {
    doc.addPage();
  }
}

function drawKeyValue(doc, label, value) {
  addPageIfNeeded(doc, ROW_HEIGHT);
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151").text(label, PAGE_MARGIN, y, {
    width: LABEL_WIDTH,
    continued: false,
  });
  doc.font("Helvetica").fillColor("#111827").text(text(value), PAGE_MARGIN + LABEL_WIDTH, y, {
    width: doc.page.width - PAGE_MARGIN * 2 - LABEL_WIDTH,
  });
  doc.moveDown(0.35);
}

function drawHeader(doc, title) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#6B7280").text("Fielddesk / Projektudstyr", PAGE_MARGIN, PAGE_MARGIN);
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827").text(title, PAGE_MARGIN, PAGE_MARGIN + 20, {
    width: doc.page.width - PAGE_MARGIN * 2,
  });
  doc.moveDown(1.8);
}

function drawSummaryBox(doc, label, value, x, y, width) {
  doc.roundedRect(x, y, width, 54, 4).fillAndStroke("#F8FAFC", "#D1D5DB");
  doc.fillColor("#6B7280").font("Helvetica").fontSize(8).text(label, x + 10, y + 10, { width: width - 20 });
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(18).text(String(value), x + 10, y + 27, { width: width - 20 });
}

function drawOverviewTable(doc, cameras) {
  doc.addPage();
  drawHeader(doc, "Kameraoversigt");

  const columns = [
    { label: "Kamera-ID", key: "camera_id", width: 48 },
    { label: "Mærke", key: "brand", width: 48 },
    { label: "Model", key: "model", width: 60 },
    { label: "MAC", key: "mac", width: 73 },
    { label: "S/N", key: "serial_number", width: 54 },
    { label: "Placering", key: "location_text", width: 73 },
    { label: "Status", key: "status", width: 50 },
    { label: "Note", key: "note", width: 93 },
  ];

  function drawTableHeader() {
    let x = PAGE_MARGIN;
    const y = doc.y;
    doc.rect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, 18).fill("#E5E7EB");
    columns.forEach((column) => {
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(7).text(column.label, x + 3, y + 5, {
        width: column.width - 6,
        lineBreak: false,
      });
      x += column.width;
    });
    doc.y = y + 22;
  }

  drawTableHeader();
  cameras.forEach((camera, index) => {
    addPageIfNeeded(doc, 30);
    if (doc.y < PAGE_MARGIN + 80) {
      drawTableHeader();
    }

    const modelParts = splitBrandModel(camera.model);
    const row = {
      camera_id: safeText(camera.camera_id),
      brand: safeText(modelParts.brand),
      model: safeText(modelParts.model),
      mac: formatMac(camera.mac_address),
      serial_number: safeText(camera.serial_number),
      location_text: safeText(camera.location_text),
      status: statusLabel(camera.status),
      note: safeText(camera.note),
    };
    let x = PAGE_MARGIN;
    const y = doc.y;
    if (index % 2 === 0) {
      doc.rect(PAGE_MARGIN, y - 2, doc.page.width - PAGE_MARGIN * 2, 24).fill("#F9FAFB");
    }
    columns.forEach((column) => {
      doc.fillColor("#111827").font("Helvetica").fontSize(7).text(row[column.key], x + 3, y + 2, {
        width: column.width - 6,
        height: 20,
        ellipsis: true,
      });
      x += column.width;
    });
    doc.y = y + 24;
  });
}

function drawImagePlaceholder(doc, x, y, width, height, message) {
  doc.roundedRect(x, y, width, height, 4).fillAndStroke("#F9FAFB", "#D1D5DB");
  doc.font("Helvetica").fontSize(9).fillColor("#6B7280").text(message, x + 12, y + height / 2 - 10, {
    width: width - 24,
    align: "center",
  });
}

function drawImageSlot(doc, slot, x, y, width, height) {
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(slot.label, x, y, { width });
  const boxY = y + 16;
  if (!slot.hasImage) {
    drawImagePlaceholder(doc, x, boxY, width, height, slot.missingText);
    return;
  }
  if (!SUPPORTED_PDF_IMAGE_TYPES.has(String(slot.contentType || "").toLowerCase())) {
    drawImagePlaceholder(doc, x, boxY, width, height, "Billedformatet kan ikke indlejres i PDF-betaen endnu.");
    return;
  }
  if (!slot.buffer) {
    drawImagePlaceholder(doc, x, boxY, width, height, "Billedet kunne ikke hentes fra storage.");
    return;
  }
  doc.roundedRect(x, boxY, width, height, 4).stroke("#D1D5DB");
  try {
    doc.image(slot.buffer, x + 6, boxY + 6, {
      fit: [width - 12, height - 12],
      align: "center",
      valign: "center",
    });
  } catch (_error) {
    drawImagePlaceholder(doc, x, boxY, width, height, "Billedet kunne ikke indlejres i PDF.");
  }
}

function drawCameraDetail(doc, camera, index) {
  doc.addPage();
  drawHeader(doc, `${index + 1}. ${text(camera.camera_id, "Kamera")}`);
  const modelParts = splitBrandModel(camera.model);
  drawKeyValue(doc, "Mærke", modelParts.brand);
  drawKeyValue(doc, "Model", modelParts.model);
  drawKeyValue(doc, "MAC", formatMac(camera.mac_address));
  drawKeyValue(doc, "S/N", camera.serial_number);
  drawKeyValue(doc, "Placering", camera.location_text);
  drawKeyValue(doc, "Status", statusLabel(camera.status));
  drawKeyValue(doc, "Note", camera.note);

  addPageIfNeeded(doc, IMAGE_BOX_HEIGHT + 70);
  doc.moveDown(0.6);
  const y = doc.y;
  const gap = 16;
  drawImageSlot(doc, {
    ...camera.reportSlots.projection,
    label: "Projektering",
    missingText: "Intet projekteringsbillede",
  }, PAGE_MARGIN, y, IMAGE_BOX_WIDTH, IMAGE_BOX_HEIGHT);
  drawImageSlot(doc, {
    ...camera.reportSlots.installation,
    label: "Installation",
    missingText: "Intet installationsbillede",
  }, PAGE_MARGIN + IMAGE_BOX_WIDTH + gap, y, IMAGE_BOX_WIDTH, IMAGE_BOX_HEIGHT);
}

function buildCctvPdfReport({ project, cameras, generatedAt, exportedBy }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE_MARGIN,
      info: {
        Title: "CCTV dokumentationsrapport",
        Author: "Fielddesk",
        Subject: "Project Equipment CCTV beta",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const projectionCount = cameras.filter((camera) => camera.reportSlots.projection.hasImage).length;
    const installationCount = cameras.filter((camera) => camera.reportSlots.installation.hasImage).length;
    drawHeader(doc, "CCTV dokumentationsrapport");
    drawKeyValue(doc, "Projekt", `${text(project?.external_project_ref)} · ${text(project?.name)}`);
    drawKeyValue(doc, "Eksporteret", formatDateTime(generatedAt));
    drawKeyValue(doc, "Eksporteret af", exportedBy || "-");

    const boxY = doc.y + 12;
    const boxWidth = (doc.page.width - PAGE_MARGIN * 2 - 24) / 3;
    drawSummaryBox(doc, "Kameraer", cameras.length, PAGE_MARGIN, boxY, boxWidth);
    drawSummaryBox(doc, "Med projektering", projectionCount, PAGE_MARGIN + boxWidth + 12, boxY, boxWidth);
    drawSummaryBox(doc, "Med installation", installationCount, PAGE_MARGIN + (boxWidth + 12) * 2, boxY, boxWidth);

    drawOverviewTable(doc, cameras);
    cameras.forEach((camera, index) => drawCameraDetail(doc, camera, index));
    doc.end();
  });
}

module.exports = {
  buildCctvPdfReport,
  splitBrandModel,
};
