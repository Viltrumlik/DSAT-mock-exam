/** Export to Excel: a real .xlsx — a zip of the workbook's parts, stored, each listed in the central directory. */
import { describe, expect, it } from "vitest";

import { sheetXml, xlsxBytes, zipStore } from "../xlsx";

const dec = new TextDecoder();

/** The zip's entries as the central directory lists them, each read back from its local header. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < entries; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 8, true)).toBe(0); // stored
    const dataAt = local + 30 + view.getUint16(local + 26, true);
    out[name] = dec.decode(bytes.subarray(dataAt, dataAt + size));
    at += 46 + nameLen;
  }
  return out;
}

describe("the workbook", () => {
  it("holds the five parts of a one-sheet workbook", () => {
    const parts = unzip(xlsxBytes([["Room", "Students"], ["Room 301", 12]], "Timetable"));
    expect(Object.keys(parts)).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"]);
    expect(parts["xl/workbook.xml"]).toContain('<sheet name="Timetable" sheetId="1" r:id="rId1"/>');
    expect(parts["xl/worksheets/sheet1.xml"]).toContain('<c r="B2"><v>12</v></c>');
  });

  it("writes text as text and numbers as numbers, escaped, Uzbek letters kept", () => {
    const xml = sheetXml([["Group", "N"], ["G‘ulom & <Co>", 3]]);
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">G‘ulom &amp; &lt;Co&gt;</t></is></c>');
    expect(xml).toContain('<c r="B2"><v>3</v></c>');
  });

  it("checks each stored file with its CRC-32", () => {
    const zip = zipStore([{ name: "a.txt", data: new TextEncoder().encode("The quick brown fox jumps over the lazy dog") }]);
    expect(new DataView(zip.buffer).getUint32(14, true)).toBe(0x414fa339);
  });
});
