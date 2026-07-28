/** 一号槽沿用历史主键，确保旧版单槽存档无需搬迁。 */
export const FIRST_SAVE_SLOT_ID = 1;

const SAVE_SLOT_NAMESPACE = ":slot:";
const SAVE_BACKUP_NAMESPACE = ":backup:";

/** 按稳定格式返回指定手动槽的主存档键。 */
export function buildSaveSlotStorageKey(
  baseKey: string,
  slotId: number,
): string {
  return slotId === FIRST_SAVE_SLOT_ID
    ? baseKey
    : `${baseKey}${SAVE_SLOT_NAMESPACE}${String(slotId)}`;
}

/** 按稳定格式返回指定手动槽的滚动备份键。 */
export function buildSaveBackupStorageKey(
  baseKey: string,
  slotId: number,
  backupIndex: number,
): string {
  return buildSaveSlotStorageKey(baseKey, slotId) +
    `${SAVE_BACKUP_NAMESPACE}${String(backupIndex)}`;
}

/** 判断候选键是否占用当前或未来槽位、备份使用的存档命名空间。 */
export function isSaveStorageNamespaceKey(
  baseKey: string,
  candidateKey: string,
): boolean {
  return candidateKey === baseKey ||
    candidateKey.startsWith(`${baseKey}${SAVE_SLOT_NAMESPACE}`) ||
    candidateKey.startsWith(`${baseKey}${SAVE_BACKUP_NAMESPACE}`);
}
