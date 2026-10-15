// Replace text between two markers in a file (UTF-8). Usage: node splice.mjs file startMarker endMarker replacementFile
import { readFileSync, writeFileSync } from "node:fs";
const [file, startMarker, endMarker, replacementFile] = process.argv.slice(2);
const src = readFileSync(file, "utf8");
const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("markers not found");
writeFileSync(file, src.slice(0, start) + readFileSync(replacementFile, "utf8") + src.slice(end), "utf8");
console.log(`replaced ${end - start} characters`);
