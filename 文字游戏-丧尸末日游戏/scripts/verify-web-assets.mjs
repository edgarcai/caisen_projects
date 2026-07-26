import { resolve } from "node:path";
import {
  assertManagedAssetWhitelist,
  assertPublishedCopiesCurrent,
  loadWebAssetManifest,
  validateDeclaredImageAssets,
  validateManifestPaths,
  validatePublishedImageAssets,
} from "./web-asset-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(projectRoot, "web-assets.json");
const publicRoot = resolve(projectRoot, "public");

/** 只读验证权威资源、公开副本、图片策略和运行时资源白名单。 */
async function verifyWebAssets() {
  const manifest = await loadWebAssetManifest(manifestPath);
  validateManifestPaths(projectRoot, publicRoot, manifest);
  await validateDeclaredImageAssets(projectRoot, manifest);
  await validatePublishedImageAssets(projectRoot, manifest);
  await assertPublishedCopiesCurrent(projectRoot, manifest);
  await assertManagedAssetWhitelist(projectRoot, manifest);
}

await verifyWebAssets();
