import eventsDocument from "../../config/events.json";
import gameDocument from "../../config/game_config.json";
import v1ToV2MigrationDocument from "../../config/save_migrations/v1_to_v2.json";
import v2ToV3MigrationDocument from "../../config/save_migrations/v2_to_v3.json";
import v3ToV4MigrationDocument from "../../config/save_migrations/v3_to_v4.json";
import storyDocument from "../../config/story.json";
import survivalSystemsDocument from "../../config/survival_systems.json";
import webDocument from "../../config/web_config.json";
import { createKeyItemWarehouseCatalog } from "../config/keyItemCatalog";
import { validateSurvivalSystemsConfig } from "../config/survivalSystemsValidator";
import type {
  EventsConfigDocument,
  GameConfigDocument,
  SaveMigrationConfig,
  StoryConfigDocument,
  V2ToV3SaveMigrationConfig,
  V3ToV4SaveMigrationConfig,
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
} from "../infrastructure";
import { V3ToV4SaveMigrator } from "../infrastructure/V3ToV4SaveMigrator";
import {
  AchievementService,
  CampaignProfileService,
  ChronicleService,
  CityAccessService,
  CombatService,
  EquipmentService,
  ExpeditionService,
  ExplorationService,
  GameContent,
  GameModeCapabilityPolicy,
  GameRules,
  InventoryService,
  ResearchCraftingService,
  ShelterService,
  StateOperations,
  StoryService,
} from "../services";
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
  const game = gameDocument as unknown as GameConfigDocument;
  const story = storyDocument as unknown as StoryConfigDocument;
  const events = eventsDocument as unknown as EventsConfigDocument;
  const v1ToV2Migration = v1ToV2MigrationDocument as unknown as SaveMigrationConfig;
  const v2ToV3Migration = v2ToV3MigrationDocument as unknown as V2ToV3SaveMigrationConfig;
  const v3ToV4Migration: V3ToV4SaveMigrationConfig = v3ToV4MigrationDocument;
  const storageConfig = webDocument.storage as unknown as StorageDocument;
  const survivalSystems = validateSurvivalSystemsConfig(survivalSystemsDocument);
  const content = new GameContent(game, story, events);
  const random = options.randomSource ?? new BrowserRandomSource();
  const storage = options.storage ?? browserStorageOrMemory();
  const operations = new StateOperations(random);
  const campaignProfiles = new CampaignProfileService(content, operations);
  const modeCapabilities = new GameModeCapabilityPolicy(content);
  const cityAccess = new CityAccessService(content, survivalSystems);
  const equipment = new EquipmentService(survivalSystems);
  const storyService = new StoryService(content, operations, equipment);
  const shelter = new ShelterService(content, operations, storyService, random);
  const chronicle = new ChronicleService(content);
  const rules = new GameRules(content, shelter, chronicle, campaignProfiles);
  const exploration = new ExplorationService(content, operations, random);
  const inventory = new InventoryService(
    survivalSystems,
    operations,
    createKeyItemWarehouseCatalog(story),
  );
  const researchCrafting = new ResearchCraftingService(survivalSystems, operations);
  const expedition = new ExpeditionService(
    survivalSystems,
    content,
    inventory,
    researchCrafting,
    cityAccess,
    campaignProfiles,
    operations,
    random,
  );
  const combat = new CombatService(content, operations, random, shelter, equipment);
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
  );
  return new GameApplication(
    content,
    achievements,
    exploration,
    storyService,
    combat,
    shelter,
    chronicle,
    inventory,
    equipment,
    researchCrafting,
    expedition,
    campaignProfiles,
    modeCapabilities,
    rules,
    repository,
    random,
  );
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
): SaveRepository {
  const validator = new SaveStateValidator(
    game.rules,
    Object.keys(story.defaults.facility_levels),
    story.defaults.companions.map((companion) => companion.companion_id),
    survivalSystems,
    game.campaign_profiles,
  );
  return new LocalStorageSaveRepository({
    storage: options.storage ?? browserStorageOrMemory(),
    storageKey: options.storageKey ?? storageConfig.key,
    schemaVersion: storageConfig.schema_version,
    slotCount: options.slotCount ?? storageConfig.save_slot_count,
    backupSlots: options.backupSlots ?? storageConfig.backup_slots,
    validator,
    migrators: [
      new V1ToV2SaveMigrator(v1ToV2Migration),
      new V2ToV3SaveMigrator(v2ToV3Migration),
      new V3ToV4SaveMigrator(v3ToV4Migration),
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
