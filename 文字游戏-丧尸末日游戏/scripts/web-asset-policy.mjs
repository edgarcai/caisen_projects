import { Buffer } from "node:buffer";
import { readdir, readFile, stat } from "node:fs/promises";
import {
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const SUPPORTED_SCHEMA_VERSION = 2;
const SUPPORTED_IMAGE_FORMATS = new Set(["png", "webp"]);
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_METADATA_CHUNKS = new Set([
  "eXIf",
  "iCCP",
  "iTXt",
  "tEXt",
  "tIME",
  "zTXt",
]);
const WEBP_METADATA_CHUNKS = new Set(["EXIF", "ICCP", "XMP "]);

/** 判断未知输入是否为可安全读取字段的普通对象。 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取必填对象字段并提供带路径的中文错误。 */
function expectRecord(value, path) {
  if (!isRecord(value)) {
    throw new Error(`${path} 必须是对象`);
  }
  return value;
}

/** 读取必填数组字段并提供带路径的中文错误。 */
function expectArray(value, path) {
  if (!Array.isArray(value)) {
    throw new Error(`${path} 必须是数组`);
  }
  return value;
}

/** 读取非空字符串字段，避免路径和值被静默纠正。 */
function expectString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} 必须是非空字符串`);
  }
  return value;
}

/** 读取正整数字段，供尺寸和字节上限策略复用。 */
function expectPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} 必须是正整数`);
  }
  return value;
}

/** 读取布尔字段，禁止真假字符串绕过资源门禁。 */
function expectBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw new Error(`${path} 必须是布尔值`);
  }
  return value;
}

/** 解析单个图片策略，保持格式、尺寸和体积均由清单配置。 */
function parseImagePolicy(value, path) {
  const source = expectRecord(value, path);
  const format = expectString(source.format, `${path}.format`).toLowerCase();
  if (!SUPPORTED_IMAGE_FORMATS.has(format)) {
    throw new Error(`${path}.format 暂不支持 ${format}`);
  }
  return {
    format,
    width: expectPositiveInteger(source.width, `${path}.width`),
    height: expectPositiveInteger(source.height, `${path}.height`),
    alpha: expectBoolean(source.alpha, `${path}.alpha`),
    metadata_stripped: expectBoolean(
      source.metadata_stripped,
      `${path}.metadata_stripped`,
    ),
    max_bytes: expectPositiveInteger(source.max_bytes, `${path}.max_bytes`),
  };
}

/** 解析单个复制项，并保留可选的图片质量策略。 */
function parseCopyEntry(value, index) {
  const path = `web-assets.json.copies[${index}]`;
  const source = expectRecord(value, path);
  const entry = {
    source: expectString(source.source, `${path}.source`),
    target: expectString(source.target, `${path}.target`),
  };
  if (source.image_policy === undefined) {
    return entry;
  }
  return {
    ...entry,
    image_policy: parseImagePolicy(
      source.image_policy,
      `${path}.image_policy`,
    ),
  };
}

/** 把未经信任的 JSON 文档解析为规范化资源同步清单。 */
function parseManifest(document) {
  const source = expectRecord(document, "web-assets.json");
  if (source.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `web-assets.json.schema_version 必须为 ${SUPPORTED_SCHEMA_VERSION}`,
    );
  }
  const managedRoots = [];
  const managedRootValues = expectArray(
    source.managed_roots,
    "web-assets.json.managed_roots",
  );
  for (let index = 0; index < managedRootValues.length; index += 1) {
    managedRoots.push(expectString(
      managedRootValues[index],
      `web-assets.json.managed_roots[${index}]`,
    ));
  }
  if (managedRoots.length === 0) {
    throw new Error("web-assets.json.managed_roots 不得为空");
  }

  const removals = [];
  const removalValues = expectArray(
    source.removals ?? [],
    "web-assets.json.removals",
  );
  for (let index = 0; index < removalValues.length; index += 1) {
    removals.push(expectString(
      removalValues[index],
      `web-assets.json.removals[${index}]`,
    ));
  }

  const copies = [];
  const copyValues = expectArray(source.copies, "web-assets.json.copies");
  for (let index = 0; index < copyValues.length; index += 1) {
    copies.push(parseCopyEntry(copyValues[index], index));
  }
  if (copies.length === 0) {
    throw new Error("web-assets.json.copies 不得为空");
  }
  return {
    schema_version: SUPPORTED_SCHEMA_VERSION,
    managed_roots: managedRoots,
    removals,
    copies,
  };
}

/** 从磁盘读取并严格解析 Web 资源清单。 */
export async function loadWebAssetManifest(manifestPath) {
  const document = JSON.parse(await readFile(manifestPath, "utf8"));
  return parseManifest(document);
}

/** 判断候选路径是否位于指定父目录内部或等于该目录。 */
function isInside(parentPath, candidatePath) {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === "" || (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

/** 把清单中的项目相对路径解析为不会逃逸工作区的绝对路径。 */
export function resolveProjectPath(projectRoot, configuredPath, label) {
  if (isAbsolute(configuredPath)) {
    throw new Error(`${label} 必须是项目相对路径：${configuredPath}`);
  }
  const resolvedPath = resolve(projectRoot, configuredPath);
  if (resolvedPath === projectRoot || !isInside(projectRoot, resolvedPath)) {
    throw new Error(`${label} 逃逸项目目录：${configuredPath}`);
  }
  return resolvedPath;
}

/** 验证源、发布目标、删除项和托管根目录的安全边界及唯一性。 */
export function validateManifestPaths(projectRoot, publicRoot, manifest) {
  const managedRootPaths = [];
  const managedRootSet = new Set();
  for (let index = 0; index < manifest.managed_roots.length; index += 1) {
    const configuredRoot = manifest.managed_roots[index];
    const rootPath = resolveProjectPath(
      projectRoot,
      configuredRoot,
      `managed_roots[${index}]`,
    );
    if (!isInside(publicRoot, rootPath)) {
      throw new Error(`托管目录必须位于 public 内：${configuredRoot}`);
    }
    if (managedRootSet.has(rootPath)) {
      throw new Error(`托管目录重复：${configuredRoot}`);
    }
    managedRootSet.add(rootPath);
    managedRootPaths.push(rootPath);
  }
  for (let left = 0; left < managedRootPaths.length; left += 1) {
    for (let right = left + 1; right < managedRootPaths.length; right += 1) {
      if (
        isInside(managedRootPaths[left], managedRootPaths[right]) ||
        isInside(managedRootPaths[right], managedRootPaths[left])
      ) {
        throw new Error("managed_roots 不得彼此嵌套");
      }
    }
  }

  const targetPaths = new Set();
  for (let index = 0; index < manifest.copies.length; index += 1) {
    const entry = manifest.copies[index];
    resolveProjectPath(projectRoot, entry.source, `copies[${index}].source`);
    const targetPath = resolveProjectPath(
      projectRoot,
      entry.target,
      `copies[${index}].target`,
    );
    if (!isInside(publicRoot, targetPath) || targetPath === publicRoot) {
      throw new Error(`复制目标必须位于 public 内：${entry.target}`);
    }
    if (targetPaths.has(targetPath)) {
      throw new Error(`复制目标重复：${entry.target}`);
    }
    targetPaths.add(targetPath);
  }

  const removalPaths = new Set();
  for (let index = 0; index < manifest.removals.length; index += 1) {
    const configuredRemoval = manifest.removals[index];
    const removalPath = resolveProjectPath(
      projectRoot,
      configuredRemoval,
      `removals[${index}]`,
    );
    if (!isInside(publicRoot, removalPath) || removalPath === publicRoot) {
      throw new Error(`删除目标必须位于 public 内：${configuredRemoval}`);
    }
    if (targetPaths.has(removalPath)) {
      throw new Error(`删除目标与复制目标冲突：${configuredRemoval}`);
    }
    if (removalPaths.has(removalPath)) {
      throw new Error(`删除目标重复：${configuredRemoval}`);
    }
    removalPaths.add(removalPath);
  }
}

/** 扫描 PNG 块并读取尺寸、透明度及可能携带身份信息的元数据。 */
function inspectPng(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("PNG 文件头无效");
  }
  const metadataChunks = new Set();
  let width = 0;
  let height = 0;
  let alpha = false;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + chunkLength + 4;
    if (nextOffset > buffer.length) {
      throw new Error(`PNG ${chunkType} 块越界`);
    }
    if (chunkType === "IHDR") {
      if (chunkLength !== 13) {
        throw new Error("PNG IHDR 长度无效");
      }
      width = buffer.readUInt32BE(dataOffset);
      height = buffer.readUInt32BE(dataOffset + 4);
      const colorType = buffer[dataOffset + 9];
      alpha = colorType === 4 || colorType === 6;
    } else if (chunkType === "tRNS") {
      alpha = true;
    }
    if (PNG_METADATA_CHUNKS.has(chunkType)) {
      metadataChunks.add(chunkType);
    }
    offset = nextOffset;
    if (chunkType === "IEND") {
      break;
    }
  }
  if (width <= 0 || height <= 0) {
    throw new Error("PNG 缺少有效 IHDR 尺寸");
  }
  return {
    format: "png",
    width,
    height,
    alpha,
    metadata_chunks: [...metadataChunks].sort(),
  };
}

/** 从 VP8 有损图片块读取十四位画布尺寸。 */
function readVp8Dimensions(buffer, dataOffset, chunkLength) {
  if (
    chunkLength < 10 ||
    buffer[dataOffset + 3] !== 0x9d ||
    buffer[dataOffset + 4] !== 0x01 ||
    buffer[dataOffset + 5] !== 0x2a
  ) {
    throw new Error("WebP VP8 帧头无效");
  }
  return {
    width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
    height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
    alpha: false,
  };
}

/** 从 VP8L 无损图片块读取画布尺寸和透明通道标记。 */
function readVp8lDimensions(buffer, dataOffset, chunkLength) {
  if (chunkLength < 5 || buffer[dataOffset] !== 0x2f) {
    throw new Error("WebP VP8L 帧头无效");
  }
  const packedDimensions = buffer.readUInt32LE(dataOffset + 1);
  return {
    width: (packedDimensions & 0x3fff) + 1,
    height: ((packedDimensions >>> 14) & 0x3fff) + 1,
    alpha: (packedDimensions & 0x10000000) !== 0,
  };
}

/** 从 VP8X 扩展图片块读取二十四位画布尺寸和透明标记。 */
function readVp8xDimensions(buffer, dataOffset, chunkLength) {
  if (chunkLength < 10) {
    throw new Error("WebP VP8X 帧头无效");
  }
  return {
    width: buffer.readUIntLE(dataOffset + 4, 3) + 1,
    height: buffer.readUIntLE(dataOffset + 7, 3) + 1,
    alpha: (buffer[dataOffset] & 0x10) !== 0,
  };
}

/** 扫描 WebP RIFF 块并统一读取三种编码的尺寸与元数据。 */
function inspectWebp(buffer) {
  if (
    buffer.length < 20 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("WebP RIFF 文件头无效");
  }
  const metadataChunks = new Set();
  let dimensions = null;
  let hasAlphaChunk = false;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkLength = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + chunkLength + (chunkLength % 2);
    if (nextOffset > buffer.length) {
      throw new Error(`WebP ${chunkType} 块越界`);
    }
    if (chunkType === "VP8X") {
      dimensions = readVp8xDimensions(buffer, dataOffset, chunkLength);
    } else if (chunkType === "VP8 " && dimensions === null) {
      dimensions = readVp8Dimensions(buffer, dataOffset, chunkLength);
    } else if (chunkType === "VP8L" && dimensions === null) {
      dimensions = readVp8lDimensions(buffer, dataOffset, chunkLength);
    } else if (chunkType === "ALPH") {
      hasAlphaChunk = true;
    }
    if (WEBP_METADATA_CHUNKS.has(chunkType)) {
      metadataChunks.add(chunkType);
    }
    offset = nextOffset;
  }
  if (dimensions === null || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error("WebP 缺少有效画布尺寸");
  }
  return {
    format: "webp",
    width: dimensions.width,
    height: dimensions.height,
    alpha: dimensions.alpha || hasAlphaChunk,
    metadata_chunks: [...metadataChunks].sort(),
  };
}

/** 读取 PNG 或 WebP 文件的运行时关键属性，不依赖平台图像命令。 */
export async function inspectImageFile(filePath) {
  const buffer = await readFile(filePath);
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return inspectPng(buffer);
  }
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return inspectWebp(buffer);
  }
  throw new Error(`不支持的图片格式：${filePath}`);
}

/** 按清单策略校验单张图片的格式、尺寸、透明度、元数据和体积。 */
export async function validateImageAsset(filePath, policy, label) {
  const [descriptor, fileStats] = await Promise.all([
    inspectImageFile(filePath),
    stat(filePath),
  ]);
  const extension = extname(filePath).slice(1).toLowerCase();
  if (descriptor.format !== policy.format || extension !== policy.format) {
    throw new Error(
      `${label} 格式应为 ${policy.format}，实际为 ${descriptor.format}`,
    );
  }
  if (descriptor.width !== policy.width || descriptor.height !== policy.height) {
    throw new Error(
      `${label} 尺寸应为 ${policy.width}x${policy.height}，` +
      `实际为 ${descriptor.width}x${descriptor.height}`,
    );
  }
  if (descriptor.alpha !== policy.alpha) {
    throw new Error(
      `${label} 透明通道应为 ${policy.alpha}，实际为 ${descriptor.alpha}`,
    );
  }
  if (policy.metadata_stripped && descriptor.metadata_chunks.length > 0) {
    throw new Error(
      `${label} 仍包含元数据块：${descriptor.metadata_chunks.join(", ")}`,
    );
  }
  if (fileStats.size > policy.max_bytes) {
    throw new Error(
      `${label} 大小 ${fileStats.size} 超过上限 ${policy.max_bytes} 字节`,
    );
  }
  return descriptor;
}

/** 校验全部权威图片源，阻止错误资源进入 public。 */
export async function validateDeclaredImageAssets(projectRoot, manifest) {
  for (let index = 0; index < manifest.copies.length; index += 1) {
    const entry = manifest.copies[index];
    if (entry.image_policy === undefined) {
      continue;
    }
    const sourcePath = resolveProjectPath(
      projectRoot,
      entry.source,
      `copies[${index}].source`,
    );
    await validateImageAsset(sourcePath, entry.image_policy, entry.source);
  }
}

/** 校验发布目录中的图片副本，覆盖复制后损坏和人工替换。 */
export async function validatePublishedImageAssets(projectRoot, manifest) {
  for (let index = 0; index < manifest.copies.length; index += 1) {
    const entry = manifest.copies[index];
    if (entry.image_policy === undefined) {
      continue;
    }
    const targetPath = resolveProjectPath(
      projectRoot,
      entry.target,
      `copies[${index}].target`,
    );
    await validateImageAsset(targetPath, entry.image_policy, entry.target);
  }
}

/** 确认所有公开副本与权威源逐字节一致，避免配置或美术漂移。 */
export async function assertPublishedCopiesCurrent(projectRoot, manifest) {
  for (let index = 0; index < manifest.copies.length; index += 1) {
    const entry = manifest.copies[index];
    const sourcePath = resolveProjectPath(
      projectRoot,
      entry.source,
      `copies[${index}].source`,
    );
    const targetPath = resolveProjectPath(
      projectRoot,
      entry.target,
      `copies[${index}].target`,
    );
    const [sourceBytes, targetBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(targetPath),
    ]);
    if (!sourceBytes.equals(targetBytes)) {
      throw new Error(`公开资源未同步：${entry.target}`);
    }
  }
}

/** 递归收集托管目录中的普通文件，并拒绝可能逃逸目录的符号链接。 */
async function collectManagedFiles(directoryPath, output) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`托管资源目录不允许符号链接：${entryPath}`);
    }
    if (entry.isDirectory()) {
      await collectManagedFiles(entryPath, output);
    } else if (entry.isFile()) {
      output.push(entryPath);
    } else {
      throw new Error(`托管资源目录包含未知节点：${entryPath}`);
    }
  }
}

/** 严格比对托管目录与清单目标，阻止遗漏资源和低清残留进入产物。 */
export async function assertManagedAssetWhitelist(projectRoot, manifest) {
  const allTargetPaths = new Set();
  for (let index = 0; index < manifest.copies.length; index += 1) {
    allTargetPaths.add(resolveProjectPath(
      projectRoot,
      manifest.copies[index].target,
      `copies[${index}].target`,
    ));
  }

  for (let index = 0; index < manifest.managed_roots.length; index += 1) {
    const configuredRoot = manifest.managed_roots[index];
    const rootPath = resolveProjectPath(
      projectRoot,
      configuredRoot,
      `managed_roots[${index}]`,
    );
    const allowedFiles = new Set();
    for (const targetPath of allTargetPaths) {
      if (isInside(rootPath, targetPath) && targetPath !== rootPath) {
        allowedFiles.add(targetPath);
      }
    }
    if (allowedFiles.size === 0) {
      throw new Error(`托管目录没有声明任何资源：${configuredRoot}`);
    }

    const actualFiles = [];
    await collectManagedFiles(rootPath, actualFiles);
    const actualFileSet = new Set(actualFiles);
    const unexpected = [];
    for (const actualPath of actualFiles) {
      if (!allowedFiles.has(actualPath)) {
        unexpected.push(relative(projectRoot, actualPath));
      }
    }
    const missing = [];
    for (const allowedPath of allowedFiles) {
      if (!actualFileSet.has(allowedPath)) {
        missing.push(relative(projectRoot, allowedPath));
      }
    }
    if (unexpected.length > 0 || missing.length > 0) {
      const details = [];
      if (unexpected.length > 0) {
        details.push(`未登记：${unexpected.sort().join(", ")}`);
      }
      if (missing.length > 0) {
        details.push(`缺失：${missing.sort().join(", ")}`);
      }
      throw new Error(`运行时资源白名单不一致（${details.join("；")}）`);
    }
  }
}
