/** 为教程正文提供当前字体与宽度下的真实排版高度。 */
export type TutorialTextHeightMeasurer = (text: string) => number;

/** 中文通讯段落优先用于断页的标点集合。 */
const PREFERRED_PAGE_BREAKS = new Set([
  "\n",
  "。",
  "！",
  "？",
  "；",
  "：",
  "，",
  "、",
]);

/**
 * 依据真实文字测量将一步教程拆成无需滚动的多页通讯。
 */
export function paginateTutorialInstruction(
  instruction: string,
  maximumPageHeight: number,
  minimumPageFillRatio: number,
  measureHeight: TutorialTextHeightMeasurer,
): readonly string[] {
  if (maximumPageHeight <= 0) {
    throw new RangeError("教程分页高度必须大于 0。");
  }
  if (minimumPageFillRatio <= 0 || minimumPageFillRatio >= 1) {
    throw new RangeError("教程分页填充比必须介于 0 与 1 之间。");
  }
  const characters = Array.from(instruction.trim());
  if (characters.length === 0) {
    return [""];
  }
  const pages: string[] = [];
  let cursor = 0;
  while (cursor < characters.length) {
    const maximumCount = findLargestFittingCharacterCount(
      characters,
      cursor,
      maximumPageHeight,
      measureHeight,
    );
    const remainingCount = characters.length - cursor;
    const pageCount = maximumCount >= remainingCount
      ? remainingCount
      : resolvePreferredPageCharacterCount(
          characters,
          cursor,
          maximumCount,
          minimumPageFillRatio,
        );
    const page = characters.slice(cursor, cursor + pageCount).join("").trim();
    pages.push(page);
    cursor += pageCount;
    while (characters[cursor] === "\n" || characters[cursor] === " ") {
      cursor += 1;
    }
  }
  return pages;
}

/** 用二分查找确定当前页可容纳的最大 Unicode 字符数。 */
function findLargestFittingCharacterCount(
  characters: readonly string[],
  cursor: number,
  maximumPageHeight: number,
  measureHeight: TutorialTextHeightMeasurer,
): number {
  let lowerBound = 1;
  let upperBound = characters.length - cursor;
  let largestFittingCount = 0;
  while (lowerBound <= upperBound) {
    const candidateCount = Math.floor((lowerBound + upperBound) / 2);
    const candidate = characters
      .slice(cursor, cursor + candidateCount)
      .join("");
    if (measureHeight(candidate) <= maximumPageHeight) {
      largestFittingCount = candidateCount;
      lowerBound = candidateCount + 1;
    } else {
      upperBound = candidateCount - 1;
    }
  }
  return Math.max(1, largestFittingCount);
}

/** 在不造成过多留白的前提下向前寻找自然标点断页位置。 */
function resolvePreferredPageCharacterCount(
  characters: readonly string[],
  cursor: number,
  maximumCount: number,
  minimumPageFillRatio: number,
): number {
  const minimumCount = Math.max(
    1,
    Math.floor(maximumCount * minimumPageFillRatio),
  );
  for (let count = maximumCount; count >= minimumCount; count -= 1) {
    const lastCharacter = characters[cursor + count - 1];
    if (lastCharacter !== undefined && PREFERRED_PAGE_BREAKS.has(lastCharacter)) {
      return count;
    }
  }
  return maximumCount;
}
