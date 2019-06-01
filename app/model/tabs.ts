import Tab from './tab';

export default class Tabs {
  private _size = 0;
  private _head: Tab = null;
  private _tail: Tab = null;

  get head() {
    return this._head;
  }

  get tail() {
    return this._tail;
  }

  get size() {
    return this._size;
  }

  private _isHead(tab) {
    return this._head === tab;
  }

  private _isTail(tab) {
    return this._tail === tab;
  }

  private reComputedSize() {
    let item = this._head;
    this._size = 0;
    while (item) {
      this._size = this.size + 1;
      item = item.next;
    }
  }

  public addTab(tab: Tab) {
    if (!this._head) {
      this._head = tab;
      this._tail = tab;
    } else {
      tab.prev = this.tail;
      this._tail.next = tab;
      this._tail = tab;
    }
    this._size = this._size + 1;
    return this.head;
  }

  public removeTab(tab) {
    const isHead = this._isHead(tab);
    const isTail = this._isTail(tab);
    const inMid = !isHead && !isTail;

    if (isHead && isTail) {
      this._head = null;
      this._tail = null;
    } else if (isHead) {
      this._head = tab.next;
      this._head.prev = null;
    } else if (isTail) {
      this._tail = tab.prev;
      this._tail.next = null;
      tab.prev.next = tab.next;
    } else if (inMid) {
      tab.prev.next = tab.next;
    }
    this._size = this._size - 1;
    return this.head;
  }

  public removeSavedTab() {
    let item = this._head;
    while (item) {
      item.saved && this.removeTab(item);
      item = item.next;
    }
    return this.head;
  }

  public removeAll() {
    this._head = null;
    this._tail = null;
    this._size = 0;
    return this._head;
  }

  public removeLeft(tab: Tab) {
    const isHead = this._isHead(tab);
    const isTail = this._isTail(tab);

    this._head = tab;
    this._head.prev = null;
    isHead && isTail && (this._tail = this._head);

    this.reComputedSize();
    return this.head;
  }

  public removeRight(tab: Tab) {
    const isHead = this._isHead(tab);
    const isTail = this._isTail(tab);

    this._tail = tab;
    this._tail.next = null;
    isHead && isTail && (this._head = this._tail);

    this.reComputedSize();
    return this.head;
  }

  public swapTab(tab, tab2) {
    // same tab .. don't swap
    if (tab === tab2) return;
    const tabIsHead = this._isHead(tab);
    const tab2IsHead = this._isHead(tab2);

    const tabIsTail = this._isTail(tab);
    const tab2isTail = this._isTail(tab2);
    return this.head;
  }

  public isEmpty() {
    return this.size === 0;
  }
}
