import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  assertManagedAssetWhitelist,
  assertPublishedCopiesCurrent,
  loadWebAssetManifest,
  resolveProjectPath,
  validateDeclaredImageAssets,
  validateManifestPaths,
  validatePublishedImageAssets,
} from "./web-asset-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(projectRoot, "web-assets.json");
const publicRoot = resolve(projectRoot, "public");

/** 删除清单声明的过时公开资源，避免生产包继续携带低分辨率副本。 */
async function removeStaleAsset(target) {
  const targetPath = resolveProjectPath(projectRoot, target, "removals.target");
  await rm(targetPath, { force: true });
}

/** 把单个权威配置或素材复制到 Vite 公共资源目录。 */
async function copyAsset(entry) {
  const sourcePath = resolveProjectPath(
    projectRoot,
    entry.source,
    "copies.source",
  );
  const targetPath = resolveProjectPath(
    projectRoot,
    entry.target,
    "copies.target",
  );
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

/** 同步并验证全部配置化 Web 资源，保证开发和构建使用同一份白名单。 */
async function syncAssets() {
  const manifest = await loadWebAssetManifest(manifestPath);
  validateManifestPaths(projectRoot, publicRoot, manifest);
  await validateDeclaredImageAssets(projectRoot, manifest);
  for (const target of manifest.removals) {
    await removeStaleAsset(target);
  }
  for (const entry of manifest.copies) {
    await copyAsset(entry);
  }
  await validatePublishedImageAssets(projectRoot, manifest);
  await assertPublishedCopiesCurrent(projectRoot, manifest);
  await assertManagedAssetWhitelist(projectRoot, manifest);
}

await syncAssets();
