import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const targetDir = path.join(process.cwd(), "resources", "bin");
fs.mkdirSync(targetDir, { recursive: true });

function which(name) {
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(command, [name], { encoding: "utf8" });
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

let missing = false;
for (const name of ["ffmpeg", "ffprobe"]) {
  const filename = process.platform === "win32" ? name + ".exe" : name;
  const target = path.join(targetDir, filename);
  if (fs.existsSync(target)) {
    console.log("[prepare] exists", target);
    continue;
  }
  const source = which(name);
  if (!source) {
    console.warn("[prepare] missing", name, "— 安装包将不内置该程序，运行时会回退到系统 PATH");
    missing = true;
    continue;
  }
  fs.copyFileSync(source, target);
  console.log("[prepare] copied", source, "->", target);
}
if (missing) process.exitCode = 0;
