export default class Tab {
  private _saved = true;
  public _prev = null;
  public _next = null;
  public data = {};

  constructor(tab?: Tab) {
    if (tab) {
      this.saved = tab.saved;
      this.data = tab.data;
      if (tab['name']) this['name'] = tab['name'];
    }
  }

  get prev() {
    return this._prev;
  }

  set prev(tab: Tab) {
    this._prev = tab;
  }

  get next() {
    return this._next;
  }

  set next(tab: Tab) {
    this._next = tab;
  }

  get saved() {
    return this._saved;
  }

  set saved(flag: boolean) {
    this._saved = flag;
  }
}
