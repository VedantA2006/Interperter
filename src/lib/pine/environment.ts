export type Value = number | string | boolean | null | any[];

export class Environment {
  private store: Map<string, Value>;
  private outer: Environment | null;

  constructor(outer: Environment | null = null) {
    this.store = new Map();
    this.outer = outer;
  }

  public get(name: string): Value | undefined {
    if (this.store.has(name)) {
      return this.store.get(name);
    }
    if (this.outer) {
      return this.outer.get(name);
    }
    return undefined;
  }

  public set(name: string, value: Value): Value {
    this.store.set(name, value);
    return value;
  }
  
  public update(name: string, value: Value): boolean {
    if (this.store.has(name)) {
      this.store.set(name, value);
      return true;
    }
    if (this.outer) {
      return this.outer.update(name, value);
    }
    return false;
  }

  public entries(): IterableIterator<[string, Value]> {
    return this.store.entries();
  }
}
