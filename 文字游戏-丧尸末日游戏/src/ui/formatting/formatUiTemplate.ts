/** UI 文案模板允许插入的原子值。 */
export type UiTemplateValue = string | number;

/**
 * 替换界面配置中的命名占位符，未提供的占位符保持原样以便排查配置。
 */
export function formatUiTemplate(
  template: string,
  values: Readonly<Record<string, UiTemplateValue>>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}
