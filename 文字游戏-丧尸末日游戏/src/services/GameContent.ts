import type {
  BossConfig,
  CityConfig,
  EventConfig,
  EventsConfigDocument,
  GameConfigDocument,
  StoryConfigDocument,
  StorySceneConfig,
} from "../domain/content";
import { formatTemplate } from "../domain/content";
import { DomainError } from "../domain/errors";

/** 为领域服务提供只读、按稳定 ID 索引的游戏内容。 */
export class GameContent {
  public readonly game: GameConfigDocument;
  public readonly story: StoryConfigDocument;
  public readonly events: EventsConfigDocument;

  private readonly sceneById: ReadonlyMap<string, StorySceneConfig>;
  private readonly bossById: ReadonlyMap<string, BossConfig>;
  private readonly eventById: ReadonlyMap<string, EventConfig>;
  private readonly cityById: ReadonlyMap<string, CityConfig>;

  /** 绑定三份已经启动期校验的 JSON 内容文档。 */
  public constructor(
    game: GameConfigDocument,
    story: StoryConfigDocument,
    events: EventsConfigDocument,
  ) {
    this.game = game;
    this.story = story;
    this.events = events;
    this.sceneById = new Map(story.scenes.map((scene) => [scene.scene_id, scene]));
    this.bossById = new Map(story.bosses.map((boss) => [boss.boss_id, boss]));
    this.eventById = new Map(events.events.map((event) => [event.id, event]));
    this.cityById = new Map(game.cities.map((city) => [city.id, city]));
  }

  /** 读取并格式化主配置中的中文文案。 */
  public text(
    key: string,
    values: Readonly<Record<string, string | number>> = {},
  ): string {
    const template = this.game.texts[key];
    if (template === undefined) {
      throw new DomainError(`缺少文案配置：${key}`);
    }
    return formatTemplate(template, values);
  }

  /** 按稳定 ID 返回剧情场景。 */
  public scene(sceneId: string): StorySceneConfig {
    const scene = this.sceneById.get(sceneId);
    if (scene === undefined) {
      throw new DomainError(`未知剧情场景：${sceneId}`);
    }
    return scene;
  }

  /** 按稳定 ID 返回首领配置。 */
  public boss(bossId: string): BossConfig {
    const boss = this.bossById.get(bossId);
    if (boss === undefined) {
      throw new DomainError(`未知首领：${bossId}`);
    }
    return boss;
  }

  /** 按稳定 ID 返回探索事件。 */
  public event(eventId: string): EventConfig {
    const event = this.eventById.get(eventId);
    if (event === undefined) {
      throw new DomainError(`未知探索事件：${eventId}`);
    }
    return event;
  }

  /** 按稳定 ID 返回城市与它的事件池。 */
  public city(cityId: string): CityConfig {
    const city = this.cityById.get(cityId);
    if (city === undefined) {
      throw new DomainError(this.text("unknown_city", { city_id: cityId }));
    }
    return city;
  }
}
