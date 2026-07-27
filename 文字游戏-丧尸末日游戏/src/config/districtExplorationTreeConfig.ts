import districtExplorationTreeDocument from "../../config/district_exploration_tree.json";
import type {
  DistrictExplorationIdentityConfig,
  DistrictExplorationLayerConfig,
  DistrictExplorationProjectionConfig,
  DistrictExplorationTreeConfig,
} from "../domain/district-exploration-tree";
import { DomainError } from "../domain/errors";

type JsonRecord = Readonly<Record<string, unknown>>;

const SUPPORTED_SCHEMA_VERSION = 1;
const TEMPLATE_TOKENS = new Set([
  "city_id",
  "city_name",
  "district_id",
  "district_name",
  "depth",
  "max_depth",
  "index",
  "path",
  "node_id",
  "child_count",
]);

/** 解析并验证区划多层探索的懒生成规则。 */
export function parseDistrictExplorationTreeConfig(
  source: unknown,
): DistrictExplorationTreeConfig {
  const root = recordValue(source, "district_exploration_tree");
  const schemaVersion = integerValue(root.schema_version, "schema_version", 1);
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw configurationError(
      `不支持 schema_version=${String(schemaVersion)}`,
    );
  }
  const identity = parseIdentity(root.identity);
  const depthPolicy = parseDepthPolicy(root.depth_policy);
  const projection = parseProjection(root.projection);
  const layers = parseLayers(root.layers, depthPolicy.maximum_depth);
  validateIdentityCapacity(identity, layers);
  return {
    schema_version: schemaVersion,
    identity,
    depth_policy: depthPolicy,
    projection,
    layers,
  };
}

/** 解析稳定 ID、路径格式和确定性种子配置。 */
function parseIdentity(source: unknown): DistrictExplorationIdentityConfig {
  const value = recordValue(source, "identity");
  const identity = {
    node_id_prefix: nonEmptyString(
      value.node_id_prefix,
      "identity.node_id_prefix",
    ),
    segment_separator: nonEmptyString(
      value.segment_separator,
      "identity.segment_separator",
    ),
    path_separator: nonEmptyString(
      value.path_separator,
      "identity.path_separator",
    ),
    index_width: integerValue(value.index_width, "identity.index_width", 1),
    seed_salt: nonEmptyString(value.seed_salt, "identity.seed_salt"),
  };
  if (identity.segment_separator === identity.path_separator) {
    throw configurationError("稳定 ID 的段分隔符与路径分隔符不能相同");
  }
  if (identity.node_id_prefix.includes(identity.segment_separator)) {
    throw configurationError("node_id_prefix 不能包含段分隔符");
  }
  return identity;
}

/** 解析每个区划可采用的确定性深度范围。 */
function parseDepthPolicy(
  source: unknown,
): DistrictExplorationTreeConfig["depth_policy"] {
  const value = recordValue(source, "depth_policy");
  const minimumDepth = integerValue(
    value.minimum_depth,
    "depth_policy.minimum_depth",
    1,
  );
  const maximumDepth = integerValue(
    value.maximum_depth,
    "depth_policy.maximum_depth",
    minimumDepth,
  );
  return {
    minimum_depth: minimumDepth,
    maximum_depth: maximumDepth,
  };
}

/** 解析页面标题、路径和说明的占位模板。 */
function parseProjection(source: unknown): DistrictExplorationProjectionConfig {
  const value = recordValue(source, "projection");
  return {
    root_path_label: nonEmptyString(
      value.root_path_label,
      "projection.root_path_label",
    ),
    display_path_separator: nonEmptyString(
      value.display_path_separator,
      "projection.display_path_separator",
    ),
    layer_title_template: templateValue(
      value.layer_title_template,
      "projection.layer_title_template",
    ),
    layer_description_template: templateValue(
      value.layer_description_template,
      "projection.layer_description_template",
    ),
  };
}

/** 解析、排序并验证从第一层到最大深度的连续规则。 */
function parseLayers(
  source: unknown,
  maximumDepth: number,
): readonly DistrictExplorationLayerConfig[] {
  const layers = arrayValue(source, "layers").map((entry, index) => (
    parseLayer(entry, `layers[${String(index)}]`)
  )).sort((left, right) => left.depth - right.depth);
  if (layers.length !== maximumDepth) {
    throw configurationError(
      `layers 必须为 1..${String(maximumDepth)} 的每一层提供规则`,
    );
  }
  layers.forEach((layer, index) => {
    const expectedDepth = index + 1;
    if (layer.depth !== expectedDepth) {
      throw configurationError(
        `layers 缺少第 ${String(expectedDepth)} 层或存在重复层级`,
      );
    }
  });
  return layers;
}

/** 解析单层的选项数量及可替换文案模板池。 */
function parseLayer(
  source: unknown,
  path: string,
): DistrictExplorationLayerConfig {
  const value = recordValue(source, path);
  return {
    depth: integerValue(value.depth, `${path}.depth`, 1),
    option_count: integerValue(
      value.option_count,
      `${path}.option_count`,
      1,
    ),
    label_templates: templateArray(
      value.label_templates,
      `${path}.label_templates`,
    ),
    description_templates: templateArray(
      value.description_templates,
      `${path}.description_templates`,
    ),
  };
}

/** 确保固定宽度能够无歧义地容纳最大选项索引。 */
function validateIdentityCapacity(
  identity: DistrictExplorationIdentityConfig,
  layers: readonly DistrictExplorationLayerConfig[],
): void {
  const maximumOptionCount = Math.max(
    ...layers.map((layer) => layer.option_count),
  );
  const requiredWidth = String(maximumOptionCount).length;
  if (identity.index_width < requiredWidth) {
    throw configurationError(
      `identity.index_width 至少需要 ${String(requiredWidth)}`,
    );
  }
}

/** 返回至少包含一个有效模板的只读字符串数组。 */
function templateArray(source: unknown, path: string): readonly string[] {
  const values = arrayValue(source, path).map((entry, index) => (
    templateValue(entry, `${path}[${String(index)}]`)
  ));
  if (values.length === 0) {
    throw configurationError(`${path} 至少需要一个模板`);
  }
  return values;
}

/** 返回只含受支持占位符的非空模板。 */
function templateValue(source: unknown, path: string): string {
  const template = nonEmptyString(source, path);
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    const token = match[1];
    if (token === undefined || !TEMPLATE_TOKENS.has(token)) {
      throw configurationError(`${path} 使用未知占位符 ${String(token)}`);
    }
  }
  const withoutKnownTokens = template.replace(
    /\{[A-Za-z_][A-Za-z0-9_]*\}/g,
    "",
  );
  if (withoutKnownTokens.includes("{") || withoutKnownTokens.includes("}")) {
    throw configurationError(`${path} 包含无法解析的花括号`);
  }
  return template;
}

/** 把未知输入收窄为普通 JSON 对象。 */
function recordValue(source: unknown, path: string): JsonRecord {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw configurationError(`${path} 必须是对象`);
  }
  return source as JsonRecord;
}

/** 把未知输入收窄为 JSON 数组。 */
function arrayValue(source: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(source)) {
    throw configurationError(`${path} 必须是数组`);
  }
  return source;
}

/** 返回去除首尾空白后的非空字符串。 */
function nonEmptyString(source: unknown, path: string): string {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw configurationError(`${path} 必须是非空字符串`);
  }
  return source.trim();
}

/** 返回满足最小值约束的安全整数。 */
function integerValue(
  source: unknown,
  path: string,
  minimum: number,
): number {
  if (
    typeof source !== "number"
    || !Number.isSafeInteger(source)
    || source < minimum
  ) {
    throw configurationError(
      `${path} 必须是不小于 ${String(minimum)} 的安全整数`,
    );
  }
  return source;
}

/** 统一生成可在启动阶段阻断加载的探索树配置错误。 */
function configurationError(message: string): DomainError {
  return new DomainError(`区划探索树配置错误：${message}。`);
}

/** 模块加载时即完成校验的默认区划探索树配置。 */
export const districtExplorationTreeConfig =
  parseDistrictExplorationTreeConfig(districtExplorationTreeDocument);
