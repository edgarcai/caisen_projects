import { formatTemplate } from "../domain/content";
import type {
  DistrictExplorationCatalogPort,
  DistrictExplorationLayerConfig,
  DistrictExplorationLayerProjection,
  DistrictExplorationNodeAddress,
  DistrictExplorationOptionProjection,
  DistrictExplorationTreeConfig,
} from "../domain/district-exploration-tree";
import { DomainError } from "../domain/errors";

/** 服务内部使用的已验证城市与区划上下文。 */
interface ResolvedDistrictContext {
  readonly cityId: string;
  readonly cityName: string;
  readonly districtId: string;
  readonly districtName: string;
}

/** 所有配置化探索文案都可使用的完整占位参数。 */
type ExplorationTemplateTokens = Readonly<Record<string, string | number>>;

/**
 * 按请求即时投影单层区划探索选项，不递归物化整棵组合树。
 */
export class DistrictExplorationTreeService {
  private readonly config: DistrictExplorationTreeConfig;
  private readonly catalog: DistrictExplorationCatalogPort;
  private readonly layerByDepth: ReadonlyMap<number, DistrictExplorationLayerConfig>;

  /** 注入已校验配置和最小城市目录端口。 */
  public constructor(
    config: DistrictExplorationTreeConfig,
    catalog: DistrictExplorationCatalogPort,
  ) {
    this.config = config;
    this.catalog = catalog;
    this.layerByDepth = new Map(
      config.layers.map((layer) => [layer.depth, layer]),
    );
  }

  /** 返回指定区划的第一层入口。 */
  public projectRoot(
    cityId: string,
    districtId: string,
  ): DistrictExplorationLayerProjection {
    return this.projectLayer(cityId, districtId, []);
  }

  /** 只生成指定父路径的下一层选项；不会预生成任何孙节点。 */
  public projectChildren(
    cityId: string,
    districtId: string,
    parentPath: readonly number[],
  ): DistrictExplorationLayerProjection {
    return this.projectLayer(cityId, districtId, parentPath);
  }

  /** 根据可序列化路径重新构造单一节点投影。 */
  public projectNode(
    address: DistrictExplorationNodeAddress,
  ): DistrictExplorationOptionProjection {
    const context = this.resolveContext(address.cityId, address.districtId);
    const maximumDepth = this.resolveMaximumDepth(context);
    this.validatePath(address.path, maximumDepth, false);
    return this.projectNodeForContext(context, address.path, maximumDepth);
  }

  /** 返回一个区划由确定性种子选出的配置化总深度。 */
  public maximumDepth(cityId: string, districtId: string): number {
    return this.resolveMaximumDepth(this.resolveContext(cityId, districtId));
  }

  /** 解析目录并拒绝会破坏稳定节点 ID 的城市或区划标识。 */
  private resolveContext(
    cityId: string,
    districtId: string,
  ): ResolvedDistrictContext {
    this.validateStableSegment(cityId, "城市 ID");
    this.validateStableSegment(districtId, "区划 ID");
    const city = this.catalog.city(cityId);
    const district = this.catalog.district(cityId, districtId);
    if (city.id !== cityId || district.id !== districtId) {
      throw new DomainError("城市目录返回了与请求不一致的稳定 ID。");
    }
    if (city.name.trim().length === 0 || district.name.trim().length === 0) {
      throw new DomainError("城市与区划名称不能为空。");
    }
    return {
      cityId,
      cityName: city.name,
      districtId,
      districtName: district.name,
    };
  }

  /** 使用稳定哈希在配置范围内为每个区划选择固定总深度。 */
  private resolveMaximumDepth(context: ResolvedDistrictContext): number {
    const { minimum_depth: minimum, maximum_depth: maximum } =
      this.config.depth_policy;
    const span = maximum - minimum + 1;
    const seed = [
      this.config.identity.seed_salt,
      context.cityId,
      context.districtId,
      "maximum-depth",
    ].join("|");
    return minimum + stableHash(seed) % span;
  }

  /** 构造一层页面投影，并把内存增长限制为当前层的选项数。 */
  private projectLayer(
    cityId: string,
    districtId: string,
    parentPath: readonly number[],
  ): DistrictExplorationLayerProjection {
    const context = this.resolveContext(cityId, districtId);
    const maximumDepth = this.resolveMaximumDepth(context);
    this.validatePath(parentPath, maximumDepth, true);
    if (parentPath.length >= maximumDepth) {
      throw new DomainError("当前探索节点已经是终点，没有下一层选项。");
    }
    const depth = parentPath.length + 1;
    const layer = this.requireLayer(depth);
    const options = Array.from(
      { length: layer.option_count },
      (_unused, offset) => this.projectNodeForContext(
        context,
        [...parentPath, offset + 1],
        maximumDepth,
      ),
    );
    const parentNodeId = parentPath.length === 0
      ? null
      : this.buildNodeId(context, parentPath);
    const tokens = this.templateTokens(
      context,
      parentPath,
      depth,
      parentPath[parentPath.length - 1] ?? 0,
      parentNodeId ?? "",
      layer.option_count,
      maximumDepth,
    );
    return {
      cityId: context.cityId,
      cityName: context.cityName,
      districtId: context.districtId,
      districtName: context.districtName,
      parentNodeId,
      parentPath: [...parentPath],
      depth,
      maximumDepth,
      title: formatTemplate(
        this.config.projection.layer_title_template,
        tokens,
      ),
      description: formatTemplate(
        this.config.projection.layer_description_template,
        tokens,
      ),
      options,
    };
  }

  /** 从路径构造一个节点，并确定其下一层数量和终点状态。 */
  private projectNodeForContext(
    context: ResolvedDistrictContext,
    path: readonly number[],
    maximumDepth: number,
  ): DistrictExplorationOptionProjection {
    const depth = path.length;
    const index = path[depth - 1];
    if (index === undefined) {
      throw new DomainError("探索节点路径不能为空。");
    }
    const layer = this.requireLayer(depth);
    const terminal = depth >= maximumDepth;
    const childCount = terminal ? 0 : this.requireLayer(depth + 1).option_count;
    const nodeId = this.buildNodeId(context, path);
    const tokens = this.templateTokens(
      context,
      path,
      depth,
      index,
      nodeId,
      childCount,
      maximumDepth,
    );
    const labelTemplate = selectDeterministicTemplate(
      layer.label_templates,
      `${this.config.identity.seed_salt}|${nodeId}|label`,
    );
    const descriptionTemplate = selectDeterministicTemplate(
      layer.description_templates,
      `${this.config.identity.seed_salt}|${nodeId}|description`,
    );
    return {
      address: {
        cityId: context.cityId,
        districtId: context.districtId,
        path: [...path],
      },
      nodeId,
      depth,
      index,
      label: formatTemplate(labelTemplate, tokens),
      description: formatTemplate(descriptionTemplate, tokens),
      terminal,
      childCount,
    };
  }

  /** 返回指定深度配置；启动期漏检时仍拒绝静默生成错误节点。 */
  private requireLayer(depth: number): DistrictExplorationLayerConfig {
    const layer = this.layerByDepth.get(depth);
    if (layer === undefined) {
      throw new DomainError(`区划探索树缺少第 ${String(depth)} 层配置。`);
    }
    return layer;
  }

  /** 校验路径深度以及每一层的一基索引范围。 */
  private validatePath(
    path: readonly number[],
    maximumDepth: number,
    allowEmpty: boolean,
  ): void {
    if (!allowEmpty && path.length === 0) {
      throw new DomainError("探索节点路径不能为空。");
    }
    if (path.length > maximumDepth) {
      throw new DomainError("探索节点路径超过当前区划的最大深度。");
    }
    path.forEach((index, offset) => {
      const layer = this.requireLayer(offset + 1);
      if (!Number.isSafeInteger(index) || index < 1 || index > layer.option_count) {
        throw new DomainError(
          `第 ${String(offset + 1)} 层索引 ${String(index)} 越界。`,
        );
      }
    });
  }

  /** 生成不依赖数组下标变化的可持久化稳定节点 ID。 */
  private buildNodeId(
    context: ResolvedDistrictContext,
    path: readonly number[],
  ): string {
    const identity = this.config.identity;
    const encodedPath = path.map((index) => (
      String(index).padStart(identity.index_width, "0")
    )).join(identity.path_separator);
    return [
      identity.node_id_prefix,
      context.cityId,
      context.districtId,
      encodedPath,
    ].join(identity.segment_separator);
  }

  /** 为所有文案模板提供同一组完整参数，避免页面层拼接文案。 */
  private templateTokens(
    context: ResolvedDistrictContext,
    path: readonly number[],
    depth: number,
    index: number,
    nodeId: string,
    childCount: number,
    maximumDepth: number,
  ): ExplorationTemplateTokens {
    return {
      city_id: context.cityId,
      city_name: context.cityName,
      district_id: context.districtId,
      district_name: context.districtName,
      depth,
      max_depth: maximumDepth,
      index,
      path: path.length === 0
        ? this.config.projection.root_path_label
        : path.map((value) => String(value).padStart(
          this.config.identity.index_width,
          "0",
        )).join(this.config.projection.display_path_separator),
      node_id: nodeId,
      child_count: childCount,
    };
  }

  /** 拒绝空 ID 或包含配置分隔符的不可逆稳定段。 */
  private validateStableSegment(value: string, label: string): void {
    const identity = this.config.identity;
    if (value.trim().length === 0) {
      throw new DomainError(`${label}不能为空。`);
    }
    if (
      value.includes(identity.segment_separator)
      || value.includes(identity.path_separator)
    ) {
      throw new DomainError(`${label}不能包含探索树 ID 分隔符。`);
    }
  }
}

/** 从非空模板池中按稳定种子选择一项。 */
function selectDeterministicTemplate(
  templates: readonly string[],
  seed: string,
): string {
  const template = templates[stableHash(seed) % templates.length];
  if (template === undefined) {
    throw new DomainError("探索树文案模板池不能为空。");
  }
  return template;
}

/** 使用 FNV-1a 生成跨运行时一致的无符号 32 位哈希。 */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
