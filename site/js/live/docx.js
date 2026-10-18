// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * docx.js — a small Word document (.docx) maker for the printable program, with no outside library
 * (the site only runs its own scripts).
 *
 * A .docx file is a zip archive of a few XML files. This writes the zip "stored" (not compressed):
 * every program is small, and Word, Google Docs, Pages and LibreOffice all open it.
 */

const encoder = new TextEncoder();

/* ------------------------------------------------------------------- zip */

/** The standard CRC-32 lookup table: the checksum's value for each possible byte. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let byte = 0; byte < 256; byte++) {
    let value = byte;
    for (let iBit = 0; iBit < 8; iBit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[byte] = value >>> 0;
  }
  return table;
})();

/** The CRC-32 checksum a zip file stores for each file. */
export function crc32(bytes) {
  let checksum = 0xffffffff;
  for (let iByte = 0; iByte < bytes.length; iByte++) checksum = CRC_TABLE[(checksum ^ bytes[iByte]) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

/** A zip archive (stored, not compressed) of [{ name, text }]. */
export function zip(files) {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1 January 1980: the date is not needed
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, 0, true); // time
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); // central directory entry
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true); // where its local header is
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const totalLength = (pieces) => pieces.reduce((total, piece) => total + piece.length, 0);
  const centralSize = totalLength(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const pieces = [...parts, ...central, new Uint8Array(end.buffer)];
  const bytes = new Uint8Array(totalLength(pieces));
  let writeAt = 0;
  for (const piece of pieces) {
    bytes.set(piece, writeAt);
    writeAt += piece.length;
  }
  return bytes;
}

/* ------------------------------------------------------------------ docx */

/** Text made safe inside XML (the five special characters written as entities). */
export const escapeXml = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);

/** Word's XML namespace ("w:" in the document). */
const WORD_NAMESPACE = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A run of text (bold, size in half points), and a paragraph of one run. */
const run = (text, { bold = false, size = null } = {}) =>
  `<w:r>${bold || size ? `<w:rPr>${bold ? "<w:b/>" : ""}${size ? `<w:sz w:val="${size}"/>` : ""}</w:rPr>` : ""}` +
  `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const paragraph = (text, style = {}) => `<w:p>${text ? run(text, style) : ""}</w:p>`;

/**
 * A Word document with a title, an optional note, and one table: `headers` (the header row, repeated
 * on every page) and `rows` (arrays of cell text). `widths` are column widths in twentieths of a point
 * (the page's text is 9360 wide: 6.5 inches). Returns the file's bytes.
 */
export function tableDocx({ title, note = "", headers, rows, widths }) {
  const cell = (text, width, bold) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraph(text, { bold })}</w:tc>`;
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
  const table =
    "<w:tbl>" +
    `<w:tblPr><w:tblW w:w="${widths.reduce((total, width) => total + width, 0)}" w:type="dxa"/>` +
    `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
    '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>` +
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((heading, iColumn) => cell(heading, widths[iColumn], true)).join("")}</w:tr>` +
    rows.map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((text, iColumn) => cell(text, widths[iColumn], false)).join("")}</w:tr>`).join("") +
    "</w:tbl>";
  const body =
    paragraph(title, { bold: true, size: 36 }) +
    (note ? paragraph(note) : "") +
    table +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  return zip([
    {
      name: "[Content_Types].xml",
      text: XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      text: XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    },
    { name: "word/document.xml", text: `${XML_HEAD}<w:document ${WORD_NAMESPACE}><w:body>${body}</w:body></w:document>` },
  ]);
}

export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
