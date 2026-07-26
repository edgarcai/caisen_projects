import type { StoryConfigDocument } from "../domain/content";
import type { KeyItemWarehouseConfig } from "../domain/survival-systems";

/** 从剧情发放规则生成完整的仓库关键物品档案，并拒绝缺失元数据。 */
export function createKeyItemWarehouseCatalog(
  story: StoryConfigDocument,
): readonly KeyItemWarehouseConfig[] {
  const discoveryById = new Map<string, KeyItemWarehouseConfig>();
  for (const discovery of story.discoveries) {
    if (discoveryById.has(discovery.discovery_id)) {
      throw new Error(`剧情发现物 ID 重复：${discovery.discovery_id}`);
    }
    discoveryById.set(discovery.discovery_id, {
      item_id: discovery.discovery_id,
      name: discovery.name,
      description: discovery.description,
    });
  }

  const grantedIds = new Set(story.defaults.story_state.key_items);
  for (const scene of story.scenes) {
    for (const choice of scene.choices) {
      for (const itemId of choice.add_key_items ?? []) {
        grantedIds.add(itemId);
      }
    }
  }
  return [...grantedIds].map((itemId) => {
    const item = discoveryById.get(itemId);
    if (item === undefined) {
      throw new Error(`剧情关键物品缺少仓库档案：${itemId}`);
    }
    return item;
  });
}
