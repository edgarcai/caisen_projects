import eventsDocument from "../../config/events.json";
import gameDocument from "../../config/game_config.json";
import v1ToV2MigrationDocument from "../../config/save_migrations/v1_to_v2.json";
import v2ToV3MigrationDocument from "../../config/save_migrations/v2_to_v3.json";
import v3ToV4MigrationDocument from "../../config/save_migrations/v3_to_v4.json";
import v4ToV5MigrationDocument from "../../config/save_migrations/v4_to_v5.json";
import v5ToV6MigrationDocument from "../../config/save_migrations/v5_to_v6.json";
import v6ToV7MigrationDocument from "../../config/save_migrations/v6_to_v7.json";
import v7ToV8MigrationDocument from "../../config/save_migrations/v7_to_v8.json";
import v8ToV9MigrationDocument from "../../config/save_migrations/v8_to_v9.json";
import storyDocument from "../../config/story.json";
import survivalSystemsDocument from "../../config/survival_systems.json";
import shelterLayoutDocument from "../../config/shelter_layout.json";
import webDocument from "../../config/web_config.json";
import { demoSystemsConfig } from "../config/demoSystemsConfig";
import { districtExplorationTreeConfig } from "../config/districtExplorationTreeConfig";
import { createKeyItemWarehouseCatalog } from "../config/keyItemCatalog";
import {
  createManufacturingDiscoveryItems,
  manufacturingDiscoveryConfig,
} from "../config/manufacturingDiscoveryConfig";
import { mergeCampaignProfileExpansion } from "../config/campaignProfileExpansionAdapter";
import {
  createProfileTriggeredBonusSources,
  profileTriggeredBonusConfig,
} from "../config/profileTriggeredBonusConfig";
import {
  contentExpansionCatalog,
  manufacturingCatalog,
  mergeManufacturingCatalogIntoSurvivalSystems,
  shelterTypes,
} from "../config/contentExpansion";
import { createSettlementNetworkConfig } from "../config/settlementNetworkConfig";
import { validateSurvivalSystemsConfig } from "../config/survivalSystemsValidator";
import { validateWorldMapConfig } from "../config/worldMapValidator";
import { parseShelterLayoutConfig } from "../domain/shelter-layout";
import type {
  EventsConfigDocument,
  GameConfigDocument,
  SaveMigrationConfig,
  StoryConfigDocument,
  V2ToV3SaveMigrationConfig,
  V3ToV4SaveMigrationConfig,
  V4ToV5SaveMigrationConfig,
  V5ToV6SaveMigrationConfig,
  V6ToV7SaveMigrationConfig,
  V7ToV8SaveMigrationConfig,
  V8ToV9SaveMigrationConfig,
} from "../domain/content";
import type { SurvivalSystemsConfigDocument } from "../domain/survival-systems";
import type {
  AchievementProgressPort,
  RandomSource,
  SaveRepository,
  StorageLike,
} from "../domain/ports";
import {
  BrowserRandomSource,
  LocalStorageAchievementRepository,
  LocalStorageSaveRepository,
  MemoryStorage,
  SaveStateValidator,
  V1ToV2SaveMigrator,
  V2ToV3SaveMigrator,
  V5ToV6SaveMigrator,
  V6ToV7SaveMigrator,
  V7ToV8SaveMigrator,
  V8ToV9SaveMigrator,
} from "../infrastructure";
import { V3ToV4SaveMigrator } from "../infrastructure/V3ToV4SaveMigrator";
import { V4ToV5SaveMigrator } from "../infrastructure/V4ToV5SaveMigrator";
import {
  AchievementService,
  ArchiveStorageService,
  CampaignDifficultyRules,
  CampaignProfileService,
  CompanionManagementService,
  ChronicleService,
  CityAccessService,
  CombatService,
  DemoSystemsCoordinator,
  DistrictExplorationTreeService,
  EquipmentService,
  EncounterBattleService,
  ExpeditionService,
  ExplorationService,
  GameContent,
  GameModeCapabilityPolicy,
  GameRules,
  InventoryService,
  ManufacturingDiscoveryService,
  ProfileTriggeredBonusService,
  ResearchCraftingService,
  ReturnIncidentService,
  ShelterService,
  ShelterLayoutService,
  ShelterLayoutStateProjector,
  SettlementNetworkService,
  StateOperations,
  StoryService,
  TradeAmbushService,
  TransportLoadoutService,
} from "../services";
import type { CampaignDifficultyLootTargets } from "../services/CampaignDifficultyRules";
import { GameApplication } from "./GameApplication";

interface StorageDocument {
  key: string;
  achievement_key: string;
  achievement_schema_version: number;
  schema_version: number;
  save_slot_count: number;
  backup_slots: number;
}

export interface CreateGameApplicationOptions {
  randomSource?: RandomSource;
  repository?: SaveRepository;
  achievementRepository?: AchievementProgressPort;
  storage?: StorageLike;
  storageKey?: string;
  slotCount?: number;
  backupSlots?: number;
  now?: () => Date;
}

/** 从版本化 JSON 内容和可注入浏览器端口装配完整游戏应用。 */
export function createGameApplication(
  options: CreateGameApplicationOptions = {},
): GameApplication {
  const game = mergeCampaignProfileExpansion(
    gameDocument as unknown as GameConfigDocument,
    contentExpansionCatalog,
  );
  const story = storyDocument as unknown as StoryConfigDocument;
  const events = eventsDocument as unknown as EventsConfigDocument;
  const v1ToV2Migration = v1ToV2MigrationDocument as unknown as SaveMigrationConfig;
  const v2ToV3Migration = v2ToV3MigrationDocument as unknown as V2ToV3SaveMigrationConfig;
  const v3ToV4Migration: V3ToV4SaveMigrationConfig = v3ToV4MigrationDocument;
  const v4ToV5Migration: V4ToV5SaveMigrationConfig = v4ToV5MigrationDocument;
  const v5ToV6Migration: V5ToV6SaveMigrationConfig = v5ToV6MigrationDocument;
  const v6ToV7Migration: V6ToV7SaveMigrationConfig = v6ToV7MigrationDocument;
  const v7ToV8Migration: V7ToV8SaveMigrationConfig = v7ToV8MigrationDocument;
  const v8ToV9Migration: V8ToV9SaveMigrationConfig = v8ToV9MigrationDocument;
  const storageConfig = webDocument.storage as unknown as StorageDocument;
  const baseSurvivalSystems = validateSurvivalSystemsConfig(survivalSystemsDocument);
  const survivalSystems = validateSurvivalSystemsConfig(
    mergeManufacturingCatalogIntoSurvivalSystems(
      baseSurvivalSystems,
      manufacturingCatalog,
    ),
  );
  const shelterLayoutConfig = parseShelterLayoutConfig(shelterLayoutDocument);
  validateWorldMapConfig(game, events);
  const content = new GameContent(game, story, events);
  const random = options.randomSource ?? new BrowserRandomSource();
  const storage = options.storage ?? browserStorageOrMemory();
  const archiveStorage = new ArchiveStorageService(
    demoSystemsConfig.archive_storage,
  );
  const operations = new StateOperations(random, [archiveStorage]);
  const difficultyRules = new CampaignDifficultyRules(
    content,
    createDifficultyLootTargets(survivalSystems),
  );
  const campaignProfiles = new CampaignProfileService(content, operations);
  const modeCapabilities = new GameModeCapabilityPolicy(content);
  const settlementNetwork = new SettlementNetworkService(
    createSettlementNetworkConfig(shelterTypes),
    content,
  );
  const cityAccess = new CityAccessService(content, survivalSystems, {
    isUnlocked: (state, cityId): boolean =>
      settlementNetwork.cityUnlocked(state, cityId),
    lockedReason: (cityId): string =>
      settlementNetwork.cityAccessLockedReason(cityId),
  });
  const equipment = new EquipmentService(survivalSystems);
  const storyService = new StoryService(content, operations, equipment);
  const tradeAmbush = new TradeAmbushService(content, operations, random);
  const shelter = new ShelterService(
    content,
    operations,
    storyService,
    random,
    tradeAmbush,
    difficultyRules,
  );
  const shelterLayout = new ShelterLayoutService(shelterLayoutConfig);
  const shelterLayoutState = new ShelterLayoutStateProjector(
    shelterLayout,
    story.companions,
  );
  const encounterBattle = new EncounterBattleService(
    demoSystemsConfig.encounter_battle,
    random,
  );
  const returnIncidents = new ReturnIncidentService(
    demoSystemsConfig.return_incidents,
    operations,
    random,
  );
  const demoSystems = new DemoSystemsCoordinator(
    demoSystemsConfig,
    encounterBattle,
    returnIncidents,
    archiveStorage,
    equipment,
    content,
  );
  const districtExplorationTree = new DistrictExplorationTreeService(
    districtExplorationTreeConfig,
    content,
  );
  const chronicle = new ChronicleService(content);
  const rules = new GameRules(content, shelter, chronicle, difficultyRules);
  const exploration = new ExplorationService(
    content,
    operations,
    random,
    difficultyRules,
  );
  const manufacturingDiscovery = new ManufacturingDiscoveryService(
    manufacturingDiscoveryConfig,
    createManufacturingDiscoveryItems(manufacturingCatalog),
    random,
    {
      cityName: (cityId): string => content.city(cityId).name,
      districtCode: (cityId, districtId): string =>
        content.district(cityId, districtId).code,
    },
  );
  const profileTriggeredBonuses = new ProfileTriggeredBonusService(
    profileTriggeredBonusConfig,
    createProfileTriggeredBonusSources(),
    operations,
    random,
  );
  const inventory = new InventoryService(
    survivalSystems,
    operations,
    createKeyItemWarehouseCatalog(story),
  );
  const companionManagement = new CompanionManagementService(
    content,
    inventory,
    operations,
    storyService,
  );
  const researchCrafting = new ResearchCraftingService(
    survivalSystems,
    operations,
    content,
    difficultyRules,
  );
  const transportLoadout = new TransportLoadoutService(survivalSystems);
  const expedition = new ExpeditionService(
    survivalSystems,
    content,
    inventory,
    cityAccess,
    operations,
    random,
    {
      isAvailableForExpedition: (state, companionId): boolean =>
        !settlementNetwork.companionAssigned(state, companionId),
    },
  );
  const combat = new CombatService(
    content,
    operations,
    random,
    shelter,
    equipment,
    difficultyRules,
  );
  const achievementRepository = options.achievementRepository
    ?? new LocalStorageAchievementRepository(
      storage,
      storageConfig.achievement_key,
      storageConfig.achievement_schema_version,
    );
  const achievements = new AchievementService(content, achievementRepository);
  const repository = options.repository ?? createRepository(
    { ...options, storage },
    storageConfig,
    game,
    story,
    survivalSystems,
    v1ToV2Migration,
    v2ToV3Migration,
    v3ToV4Migration,
    v4ToV5Migration,
    v5ToV6Migration,
    v6ToV7Migration,
    v7ToV8Migration,
    v8ToV9Migration,
    shelterLayoutState,
    archiveStorage,
  );
  return new GameApplication(
    content,
    achievements,
    exploration,
    manufacturingDiscovery,
    profileTriggeredBonuses,
    storyService,
    combat,
    shelter,
    shelterLayout,
    shelterLayoutState,
    demoSystems,
    companionManagement,
    chronicle,
    inventory,
    equipment,
    researchCrafting,
    transportLoadout,
    expedition,
    settlementNetwork,
    districtExplorationTree,
    campaignProfiles,
    modeCapabilities,
    rules,
    repository,
    random,
  );
}

/** 依仓库物品类别生成难度掉落目标，资源字段变更时无需修改规则服务。 */
function createDifficultyLootTargets(
  survivalSystems: SurvivalSystemsConfigDocument,
): CampaignDifficultyLootTargets {
  const text = survivalSystems.warehouse.resource_items
    .filter((item) => item.category === "archive")
    .map((item) => item.state_target);
  const common = survivalSystems.warehouse.resource_items
    .filter((item) => item.category !== "archive")
    .map((item) => item.state_target);
  return { common, text };
}

/** 按 Web 配置创建带迁移、验证和滚动备份的存档仓库。 */
function createRepository(
  options: CreateGameApplicationOptions,
  storageConfig: StorageDocument,
  game: GameConfigDocument,
  story: StoryConfigDocument,
  survivalSystems: SurvivalSystemsConfigDocument,
  v1ToV2Migration: SaveMigrationConfig,
  v2ToV3Migration: V2ToV3SaveMigrationConfig,
  v3ToV4Migration: V3ToV4SaveMigrationConfig,
  v4ToV5Migration: V4ToV5SaveMigrationConfig,
  v5ToV6Migration: V5ToV6SaveMigrationConfig,
  v6ToV7Migration: V6ToV7SaveMigrationConfig,
  v7ToV8Migration: V7ToV8SaveMigrationConfig,
  v8ToV9Migration: V8ToV9SaveMigrationConfig,
  shelterLayoutState: ShelterLayoutStateProjector,
  archiveStorage: ArchiveStorageService,
): SaveRepository {
  const validator = new SaveStateValidator(
    game.rules,
    story.facilities,
    story.facility_management,
    story.defaults.companions.map((companion) => companion.companion_id),
    survivalSystems,
    game.campaign_profiles,
    game.cities,
    shelterLayoutState,
    archiveStorage,
  );
  return new LocalStorageSaveRepository({
    storage: options.storage ?? browserStorageOrMemory(),
    storageKey: options.storageKey ?? storageConfig.key,
    schemaVersion: game.save_schema_version,
    slotCount: options.slotCount ?? storageConfig.save_slot_count,
    backupSlots: options.backupSlots ?? storageConfig.backup_slots,
    validator,
    campaignMetadataFlags: game.campaign_profiles.metadata_flags,
    migrators: [
      new V1ToV2SaveMigrator(v1ToV2Migration),
      new V2ToV3SaveMigrator(v2ToV3Migration),
      new V3ToV4SaveMigrator(v3ToV4Migration),
      new V4ToV5SaveMigrator(v4ToV5Migration, game.cities),
      new V5ToV6SaveMigrator(v5ToV6Migration),
      new V6ToV7SaveMigrator(v6ToV7Migration, {
        facilities: story.facilities,
        facilityManagement: story.facility_management,
        allowedHomeCityIds: game.rules.world_map.home_city_ids,
      }),
      new V7ToV8SaveMigrator(
        v7ToV8Migration,
        demoSystemsConfig.archive_storage.collections,
      ),
      new V8ToV9SaveMigrator(v8ToV9Migration),
    ],
    now: options.now,
  });
}

/** 优先读取浏览器 localStorage，访问受限时降级到内存存储。 */
function browserStorageOrMemory(): StorageLike {
  try {
    return globalThis.localStorage;
  } catch {
    return new MemoryStorage();
  }
}
