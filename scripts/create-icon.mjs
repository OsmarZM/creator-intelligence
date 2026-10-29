import sharp from "sharp";
import { writeFile } from "node:fs/promises";
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#0d0a14"/><path d="M47 137h36l24-65 33 112 23-61h46" fill="none" stroke="#b18aff" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/></svg>');
const png=await sharp(svg).png().toBuffer();
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
await writeFile("desktop/icon.ico",Buffer.concat([header,png]));await writeFile("desktop/icon.png",png);
