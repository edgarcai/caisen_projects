/** 懒生成探索节点的稳定编号与确定性种子规则。 */
export interface DistrictExplorationIdentityConfig {
  readonly node_id_prefix: string;
  readonly segment_separator: string;
  readonly path_separator: string;
  readonly index_width: number;
  readonly seed_salt: string;
}

/** 单个区划探索树可采用的最小与最大层数。 */
export interface DistrictExplorationDepthPolicyConfig {
  readonly minimum_depth: number;
  readonly maximum_depth: number;
}

/** 页面投影使用的可替换占位文案规则。 */
export interface DistrictExplorationProjectionConfig {
  readonly root_path_label: string;
  readonly display_path_separator: string;
  readonly layer_title_template: string;
  readonly layer_description_template: string;
}

/** 某一深度的分支数量和确定性文案模板池。 */
export interface DistrictExplorationLayerConfig {
  readonly depth: number;
  readonly option_count: number;
  readonly label_templates: readonly string[];
  readonly description_templates: readonly string[];
}

/** 区划多层探索懒生成器的完整配置。 */
export interface DistrictExplorationTreeConfig {
  readonly schema_version: number;
  readonly identity: DistrictExplorationIdentityConfig;
  readonly depth_policy: DistrictExplorationDepthPolicyConfig;
  readonly projection: DistrictExplorationProjectionConfig;
  readonly layers: readonly DistrictExplorationLayerConfig[];
}

/** 服务解析城市和区划名称时依赖的最小内容端口。 */
export interface DistrictExplorationCatalogPort {
  city(cityId: string): DistrictExplorationCityReference;
  district(cityId: string, districtId: string): DistrictExplorationDistrictReference;
}

/** 探索树需要读取的最小城市资料。 */
export interface DistrictExplorationCityReference {
  readonly id: string;
  readonly name: string;
}

/** 探索树需要读取的最小区划资料。 */
export interface DistrictExplorationDistrictReference {
  readonly id: string;
  readonly name: string;
}

/** 一个节点的可序列化地址；路径索引从 1 开始。 */
export interface DistrictExplorationNodeAddress {
  readonly cityId: string;
  readonly districtId: string;
  readonly path: readonly number[];
}

/** 页面可直接展示的一项懒生成探索选择。 */
export interface DistrictExplorationOptionProjection {
  readonly address: DistrictExplorationNodeAddress;
  readonly nodeId: string;
  readonly depth: number;
  readonly index: number;
  readonly label: string;
  readonly description: string;
  readonly terminal: boolean;
  readonly childCount: number;
}

/** 页面可直接消费的一层探索选项投影。 */
export interface DistrictExplorationLayerProjection {
  readonly cityId: string;
  readonly cityName: string;
  readonly districtId: string;
  readonly districtName: string;
  readonly parentNodeId: string | null;
  readonly parentPath: readonly number[];
  readonly depth: number;
  readonly maximumDepth: number;
  readonly title: string;
  readonly description: string;
  readonly options: readonly DistrictExplorationOptionProjection[];
}
