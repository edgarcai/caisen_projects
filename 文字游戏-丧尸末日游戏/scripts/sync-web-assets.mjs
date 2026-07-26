import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(projectRoot, "web-assets.json");

/**
 * 读取并验证 Web 资源同步清单。
 * @returns {Promise<{copies: Array<{source: string, target: string}>}>}
 */
async function loadManifest() {
  const document = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(document.copies)) {
    throw new Error("web-assets.json 缺少 copies 数组");
  }
  return document;
}

/**
 * 把单个权威配置或素材复制到 Vite 公共资源目录。
 * @param {{source: string, target: string}} entry
 * @returns {Promise<void>}
 */
async function copyAsset(entry) {
  const sourcePath = resolve(projectRoot, entry.source);
  const targetPath = resolve(projectRoot, entry.target);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

/**
 * 同步全部配置化 Web 资源，避免维护两份剧情数据。
 * @returns {Promise<void>}
 */
async function syncAssets() {
  const manifest = await loadManifest();
  await Promise.all(manifest.copies.map(copyAsset));
}

await syncAssets();
