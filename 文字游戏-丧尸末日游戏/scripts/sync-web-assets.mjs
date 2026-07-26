import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(projectRoot, "web-assets.json");
const publicRoot = resolve(projectRoot, "public");

/**
 * 读取并验证 Web 资源同步清单。
 * @returns {Promise<{removals: string[], copies: Array<{source: string, target: string}>}>}
 */
async function loadManifest() {
  const document = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(document.copies)) {
    throw new Error("web-assets.json 缺少 copies 数组");
  }
  if (document.removals !== undefined && !Array.isArray(document.removals)) {
    throw new Error("web-assets.json 的 removals 必须是数组");
  }
  return {
    removals: document.removals ?? [],
    copies: document.copies,
  };
}

/**
 * 删除清单声明的过时公开资源，避免生产包继续携带低分辨率副本。
 * @param {string} target
 * @returns {Promise<void>}
 */
async function removeStaleAsset(target) {
  const targetPath = resolve(projectRoot, target);
  const relativeToPublic = relative(publicRoot, targetPath);
  if (
    relativeToPublic === "" ||
    relativeToPublic.startsWith("..") ||
    resolve(publicRoot, relativeToPublic) !== targetPath
  ) {
    throw new Error(`拒绝删除 public 目录之外的资源：${target}`);
  }
  await rm(targetPath, { force: true });
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
  await Promise.all(manifest.removals.map(removeStaleAsset));
  await Promise.all(manifest.copies.map(copyAsset));
}

await syncAssets();
