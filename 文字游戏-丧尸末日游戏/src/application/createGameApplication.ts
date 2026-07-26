import eventsDocument from "../../config/events.json";
import gameDocument from "../../config/game_config.json";
import migrationDocument from "../../config/save_migrations/v1_to_v2.json";
import storyDocument from "../../config/story.json";
import webDocument from "../../config/web_config.json";
import type {
  EventsConfigDocument,
  GameConfigDocument,
  SaveMigrationConfig,
  StoryConfigDocument,
} from "../domain/content";
import type { RandomSource, SaveRepository, StorageLike } from "../domain/ports";
import {
  BrowserRandomSource,
  LocalStorageSaveRepository,
  MemoryStorage,
  SaveStateValidator,
  V1ToV2SaveMigrator,
} from "../infrastructure";
import {
  CombatService,
  ExplorationService,
  GameContent,
  GameRules,
  ShelterService,
  StateOperations,
  StoryService,
} from "../services";
import { GameApplication } from "./GameApplication";

interface StorageDocument {
  key: string;
  schema_version: number;
  backup_slots: number;
}

export interface CreateGameApplicationOptions {
  randomSource?: RandomSource;
  repository?: SaveRepository;
  storage?: StorageLike;
  storageKey?: string;
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
  const migration = migrationDocument as unknown as SaveMigrationConfig;
  const storageConfig = webDocument.storage as StorageDocument;
  const content = new GameContent(game, story, events);
  const random = options.randomSource ?? new BrowserRandomSource();
  const operations = new StateOperations(random);
  const storyService = new StoryService(content, operations);
  const shelter = new ShelterService(content, operations, storyService, random);
  const rules = new GameRules(content, shelter);
  const exploration = new ExplorationService(content, operations, random);
  const combat = new CombatService(content, operations, random, shelter);
  const repository = options.repository ?? createRepository(
    options,
    storageConfig,
    game,
    story,
    migration,
  );
  return new GameApplication(
    content,
    exploration,
    storyService,
    combat,
    shelter,
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
  migration: SaveMigrationConfig,
): SaveRepository {
  const validator = new SaveStateValidator(
    game.rules,
    Object.keys(story.defaults.facility_levels),
    story.defaults.companions.map((companion) => companion.companion_id),
  );
  return new LocalStorageSaveRepository({
    storage: options.storage ?? browserStorageOrMemory(),
    storageKey: options.storageKey ?? storageConfig.key,
    schemaVersion: game.save_schema_version,
    backupSlots: options.backupSlots ?? storageConfig.backup_slots,
    validator,
    migrators: [new V1ToV2SaveMigrator(migration)],
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
