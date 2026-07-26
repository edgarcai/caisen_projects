import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assertManagedAssetWhitelist,
  inspectImageFile,
  loadWebAssetManifest,
  validateDeclaredImageAssets,
  validateImageAsset,
  validateManifestPaths,
} from "../../scripts/web-asset-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "../..");
const publicRoot = resolve(projectRoot, "public");
const manifestPath = resolve(projectRoot, "web-assets.json");
const desktopCoverPath = resolve(
  projectRoot,
  "assets/covers/cover_theme_bunker_gate_2k.png",
);

/** 验证四个新封面变体均受清单策略约束并已剥离元数据。 */
async function verifyBunkerGateCoverVariants() {
  const manifest = await loadWebAssetManifest(manifestPath);
  validateManifestPaths(projectRoot, publicRoot, manifest);
  await validateDeclaredImageAssets(projectRoot, manifest);

  const expectedVariants = new Map([
    ["assets/covers/cover_theme_bunker_gate_2k.png", [2048, 1152, "png"]],
    ["assets/covers/cover_theme_bunker_gate_2k.webp", [2048, 1152, "webp"]],
    [
      "assets/covers/cover_theme_bunker_gate_mobile_2k.png",
      [1152, 2048, "png"],
    ],
    [
      "assets/covers/cover_theme_bunker_gate_mobile_2k.webp",
      [1152, 2048, "webp"],
    ],
  ]);
  let matchedVariants = 0;
  for (const entry of manifest.copies) {
    const expected = expectedVariants.get(entry.source);
    if (expected === undefined) {
      continue;
    }
    const descriptor = await inspectImageFile(resolve(projectRoot, entry.source));
    assert.deepEqual(
      [descriptor.width, descriptor.height, descriptor.format],
      expected,
    );
    assert.equal(descriptor.alpha, false);
    assert.deepEqual(descriptor.metadata_chunks, []);
    matchedVariants += 1;
  }
  assert.equal(matchedVariants, expectedVariants.size);
}

/** 用故意错误的宽度策略调用图片校验器。 */
async function validateWrongDesktopWidth() {
  await validateImageAsset(desktopCoverPath, {
    format: "png",
    width: 1024,
    height: 1152,
    alpha: false,
    metadata_stripped: true,
    max_bytes: 2500000,
  }, "错误桌面封面策略");
}

/** 验证尺寸门禁会拒绝不符合清单的图片。 */
async function rejectWrongImageDimensions() {
  await assert.rejects(validateWrongDesktopWidth, /尺寸应为 1024x1152/u);
}

/** 验证托管目录出现未登记文件时白名单门禁立即失败。 */
async function rejectUnexpectedManagedAsset() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "web-asset-policy-"));
  try {
    const managedRoot = resolve(temporaryRoot, "public/assets");
    await mkdir(managedRoot, { recursive: true });
    await writeFile(resolve(managedRoot, "declared.bin"), "declared");
    await writeFile(resolve(managedRoot, "unexpected.bin"), "unexpected");
    const manifest = {
      schema_version: 2,
      managed_roots: ["public/assets"],
      removals: [],
      copies: [{
        source: "assets/declared.bin",
        target: "public/assets/declared.bin",
      }],
    };

    /** 对包含额外文件的临时托管目录执行白名单核验。 */
    async function verifyTemporaryWhitelist() {
      await assertManagedAssetWhitelist(temporaryRoot, manifest);
    }

    await assert.rejects(verifyTemporaryWhitelist, /未登记/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("四个避难所大门封面变体满足像素与元数据策略", verifyBunkerGateCoverVariants);
test("图片策略拒绝错误尺寸", rejectWrongImageDimensions);
test("运行时白名单拒绝额外资源", rejectUnexpectedManagedAsset);
