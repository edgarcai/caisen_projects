/** 从 story.flags 中读取指定命名空间的单一值。 */
export function readCampaignMetadataFlag(
  flags: readonly string[],
  prefix: string,
): string | null {
  const flag = flags.find((candidate) => candidate.startsWith(prefix));
  if (flag === undefined) return null;
  const value = flag.slice(prefix.length).trim();
  return value === "" ? null : value;
}

/** 用新值替换同命名空间的旧值，并保留其他剧情标记的顺序。 */
export function writeCampaignMetadataFlag(
  flags: string[],
  prefix: string,
  value: string | number,
): void {
  const normalized = String(value).trim();
  if (prefix.trim() === "" || normalized === "") {
    throw new RangeError("开局元数据标记前缀和值均不能为空。");
  }
  const nextFlag = `${prefix}${normalized}`;
  const firstIndex = flags.findIndex((candidate) => candidate.startsWith(prefix));
  for (let index = flags.length - 1; index >= 0; index -= 1) {
    if (flags[index]?.startsWith(prefix) === true) flags.splice(index, 1);
  }
  flags.splice(firstIndex < 0 ? flags.length : firstIndex, 0, nextFlag);
}
