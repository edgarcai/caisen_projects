import type { StorageLike } from "../domain/ports";

/** 在 localStorage 不可用或测试环境中提供进程内存储。 */
export class MemoryStorage implements StorageLike {
  private readonly values: Map<string, string>;

  /** 使用可选初始键值创建隔离的内存存储。 */
  public constructor(initialValues: Readonly<Record<string, string>> = {}) {
    this.values = new Map(Object.entries(initialValues));
  }

  /** 读取指定键；不存在时与 localStorage 一样返回 null。 */
  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  /** 将值按字符串原样写入指定键。 */
  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  /** 删除指定键且允许键不存在。 */
  public removeItem(key: string): void {
    this.values.delete(key);
  }

  /** 返回当前内容副本，供诊断和单元测试使用。 */
  public snapshot(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.values);
  }
}
