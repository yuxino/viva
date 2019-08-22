// describe the Tab
export default class Tab {
  private _saved = true;
  public _prev = null;
  public _next = null;
  public data = {};

  constructor(options?) {
    if (options) {
      this.saved = options.saved ? options.saved : true;
      this.data = options.data;
    }
  }

  // get prev tab item
  get prev() {
    return this._prev;
  }

  // set prev tab item
  set prev(tab: Tab) {
    this._prev = tab;
  }

  // get next tab item
  get next() {
    return this._next;
  }

  // set next tab time
  set next(tab: Tab) {
    this._next = tab;
  }

  // get tab status
  get saved() {
    return this._saved;
  }

  // set tab status
  set saved(flag: boolean) {
    this._saved = flag;
  }
}
