import type { EngineConfig } from "../config/types";

type RuntimeFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type JsonObject = Readonly<Record<string, unknown>>;
export type LayaRuntimeGlobal = typeof Laya;

interface RuntimeScriptEntry {
  readonly path: string;
  readonly integrity: string;
}

interface LayaRuntimeManifest {
  readonly schema_version: number;
  readonly engine_name: string;
  readonly engine_version: string;
  readonly release_url: string;
  readonly archive_sha256: string;
  readonly scripts: readonly RuntimeScriptEntry[];
}

const RUNTIME_MANIFEST_SCHEMA_VERSION = 1;
const VENDOR_ROOT = "vendor/layaair";
let loadedEngineVersion: string | null = null;
let loadedRuntime: LayaRuntimeGlobal | null = null;
let runtimeLoadingPromise: Promise<LayaRuntimeGlobal> | null = null;

/** 表示官方 LayaAir 运行库无法安全加载。 */
export class LayaRuntimeError extends Error {
  /** 创建带稳定名称的运行库异常。 */
  public constructor(message: string) {
    super(message);
    this.name = "LayaRuntimeError";
  }
}

/** 调用浏览器 Fetch API，保留可注入的测试边界。 */
const defaultFetcher: RuntimeFetcher = (input, init) =>
  globalThis.fetch(input, init);

/** 确保运行库清单值是 JSON 对象。 */
function expectObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LayaRuntimeError(`${path} 必须是对象`);
  }
  return value as JsonObject;
}

/** 读取运行库清单中的非空字符串。 */
function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LayaRuntimeError(`${path} 必须是非空字符串`);
  }
  return value;
}

/** 读取运行库清单中的正整数。 */
function expectPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new LayaRuntimeError(`${path} 必须是正整数`);
  }
  return value;
}

/** 读取运行库清单中的数组。 */
function expectArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new LayaRuntimeError(`${path} 必须是数组`);
  }
  return value;
}

/** 拒绝绝对路径和目录穿越，将运行库限定在版本目录。 */
function validateRelativeScriptPath(value: unknown, path: string): string {
  const scriptPath = expectString(value, path);
  const segments = scriptPath.split("/");
  if (
    scriptPath.startsWith("/") ||
    scriptPath.includes(":") ||
    segments.some((segment) => segment === ".." || segment.length === 0)
  ) {
    throw new LayaRuntimeError(`${path} 必须是安全的相对路径`);
  }
  return scriptPath;
}

/** 解析单个带 SRI 校验的经典脚本条目。 */
function parseScriptEntry(value: unknown, index: number): RuntimeScriptEntry {
  const path = `scripts[${String(index)}]`;
  const source = expectObject(value, path);
  const integrity = expectString(source.integrity, `${path}.integrity`);
  if (!integrity.startsWith("sha256-")) {
    throw new LayaRuntimeError(`${path}.integrity 必须使用 SHA-256 SRI`);
  }
  return {
    path: validateRelativeScriptPath(source.path, `${path}.path`),
    integrity,
  };
}

/** 校验未信任的 LayaAir 运行库清单。 */
function parseRuntimeManifest(value: unknown): LayaRuntimeManifest {
  const source = expectObject(value, "runtime_manifest");
  const schemaVersion = expectPositiveInteger(
    source.schema_version,
    "runtime_manifest.schema_version",
  );
  if (schemaVersion !== RUNTIME_MANIFEST_SCHEMA_VERSION) {
    throw new LayaRuntimeError(
      `不支持的运行库清单版本 ${String(schemaVersion)}`,
    );
  }
  const scripts = expectArray(source.scripts, "runtime_manifest.scripts").map(
    parseScriptEntry,
  );
  if (scripts.length === 0) {
    throw new LayaRuntimeError("runtime_manifest.scripts 不得为空");
  }
  return {
    schema_version: schemaVersion,
    engine_name: expectString(
      source.engine_name,
      "runtime_manifest.engine_name",
    ),
    engine_version: expectString(
      source.engine_version,
      "runtime_manifest.engine_version",
    ),
    release_url: expectString(source.release_url, "runtime_manifest.release_url"),
    archive_sha256: expectString(
      source.archive_sha256,
      "runtime_manifest.archive_sha256",
    ),
    scripts,
  };
}

/** 根据配置版本生成同源运行库清单 URL。 */
function resolveManifestUrl(
  engineVersion: string,
  documentRef: Document,
): string {
  const versionSegment = encodeURIComponent(engineVersion);
  return new URL(
    `${VENDOR_ROOT}/${versionSegment}/manifest.json`,
    documentRef.baseURI,
  ).toString();
}

/** 获取并验证指定引擎版本的运行库清单。 */
async function loadRuntimeManifest(
  engineConfig: EngineConfig,
  manifestUrl: string,
  fetcher: RuntimeFetcher,
): Promise<LayaRuntimeManifest> {
  let response: Response;
  try {
    response = await fetcher(manifestUrl, { cache: "no-cache" });
  } catch (error: unknown) {
    throw new LayaRuntimeError(
      `无法请求 LayaAir 运行库清单: ${String(error)}`,
    );
  }
  if (!response.ok) {
    throw new LayaRuntimeError(
      `LayaAir 运行库清单请求失败 ${String(response.status)} ${response.statusText}`,
    );
  }
  const document: unknown = await response.json();
  const manifest = parseRuntimeManifest(document);
  if (
    manifest.engine_name !== engineConfig.name ||
    manifest.engine_version !== engineConfig.version
  ) {
    throw new LayaRuntimeError(
      `运行库 ${manifest.engine_name} ${manifest.engine_version} 与配置 ${engineConfig.name} ${engineConfig.version} 不匹配`,
    );
  }
  return manifest;
}

/** 按顺序注入一个带 SRI 的经典脚本。 */
function loadClassicScript(
  sourceUrl: string,
  integrity: string,
  documentRef: Document,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptElement = documentRef.createElement("script");
    scriptElement.src = sourceUrl;
    scriptElement.async = false;
    scriptElement.integrity = integrity;
    scriptElement.crossOrigin = "anonymous";
    scriptElement.dataset.layaRuntime = sourceUrl;
    scriptElement.addEventListener(
      "load",
      () => {
        resolve();
      },
      { once: true },
    );
    scriptElement.addEventListener(
      "error",
      () => {
        scriptElement.remove();
        reject(new LayaRuntimeError(`LayaAir 脚本加载失败 ${sourceUrl}`));
      },
      { once: true },
    );
    documentRef.head.append(scriptElement);
  });
}

/** 从全局宿主读取已注入的 LayaAir 运行时。 */
function resolveGlobalLayaRuntime(): LayaRuntimeGlobal | null {
  const runtime = (
    globalThis as typeof globalThis & {
      readonly Laya?: LayaRuntimeGlobal;
    }
  ).Laya;
  return runtime ?? null;
}

/** 实际加载与当前配置匹配的官方 LayaAir 模块。 */
async function performRuntimeLoad(
  engineConfig: EngineConfig,
  documentRef: Document,
  fetcher: RuntimeFetcher,
): Promise<LayaRuntimeGlobal> {
  const manifestUrl = resolveManifestUrl(engineConfig.version, documentRef);
  const manifest = await loadRuntimeManifest(
    engineConfig,
    manifestUrl,
    fetcher,
  );
  for (const script of manifest.scripts) {
    const sourceUrl = new URL(script.path, manifestUrl).toString();
    await loadClassicScript(sourceUrl, script.integrity, documentRef);
  }
  const runtime = resolveGlobalLayaRuntime();
  if (runtime === null) {
    throw new LayaRuntimeError("LayaAir 脚本已加载，但全局 Laya 入口不存在");
  }
  loadedEngineVersion = engineConfig.version;
  loadedRuntime = runtime;
  return runtime;
}

/** 仅加载一次配置指定的 LayaAir 运行库。 */
export async function loadLayaRuntime(
  engineConfig: EngineConfig,
  documentRef: Document = document,
  fetcher: RuntimeFetcher = defaultFetcher,
): Promise<LayaRuntimeGlobal> {
  if (loadedEngineVersion !== null) {
    if (loadedEngineVersion !== engineConfig.version) {
      throw new LayaRuntimeError(
        `当前页面已加载 LayaAir ${loadedEngineVersion}，不能再加载 ${engineConfig.version}`,
      );
    }
    if (loadedRuntime === null) {
      throw new LayaRuntimeError("LayaAir 版本已记录，但运行时引用丢失");
    }
    return loadedRuntime;
  }
  runtimeLoadingPromise ??= performRuntimeLoad(
    engineConfig,
    documentRef,
    fetcher,
  );
  try {
    return await runtimeLoadingPromise;
  } catch (error: unknown) {
    runtimeLoadingPromise = null;
    throw error;
  }
}
