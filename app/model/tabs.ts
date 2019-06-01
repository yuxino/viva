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

  private swapBetween(tab, tab2) {
    const prevTab = tab.prev;
    const nextTab = tab.next;

    const prevTab2 = tab2.prev;
    const nextTab2 = tab2.next;

    const tempTab = new Tab(tab);
    const tempTab2 = new Tab(tab2);
    // near ...
    // prevTab <-> tempTab2 <-> tempTab2 <-> nextTab2
    if (tab === prevTab2) {
      prevTab.next = tempTab2;
      nextTab2.prev = tempTab;

      tempTab2.prev = prevTab;
      tempTab2.next = tempTab;

      tempTab.prev = tempTab2;
      tempTab.next = nextTab2;
    } else {
      // prevTab <-> tempTab2 <-> nextTab
      prevTab.next = tempTab2; // 1 -> 2
      nextTab.prev = tempTab2; //
      tempTab2.prev = prevTab;
      tempTab2.next = nextTab;

      // prevTab2 <-> tempTab <-> nextTab2
      prevTab2.next = tempTab;
      nextTab2.prev = tempTab;
      tempTab.prev = prevTab2;
      tempTab.next = nextTab2;
    }
  }

  private swapHeadTail() {
    const temp = this._tail;
    this._tail = this._head;
    this._tail.next = null;
    this._tail.prev = temp;

    this._head = temp;
    this._head.prev = null;
    this._head.next = this._tail;
  }

  private swapwithHead(tab) {
    this._head.next = tab.next;
    this._head.prev = tab;

    tab.prev = null;
    tab.next = this._head;
    this._head = tab;
  }

  private swapWithTail(tab) {
    tab.prev.next = this.tail;
    this.tail.prev = tab.prev;

    this._tail.next = tab;
    this._tail = tab;
    tab.next = null;
  }

  public swapTab(tab, tab2) {
    if (tab === tab2) return;
    const tabIsHead = this._isHead(tab);
    const tab2IsHead = this._isHead(tab2);
    const tabIsTail = this._isTail(tab);
    const tab2IsTail = this._isTail(tab2);
    const bothInMid = !tabIsHead && !tabIsTail && !tab2IsHead && !tab2IsTail;

    if (bothInMid) {
      this.swapBetween(tab, tab2);
    } else if ((tabIsHead && tab2IsTail) || (tab2IsHead && tabIsTail)) {
      this.swapHeadTail();
    } else if (tabIsHead || tab2IsHead) {
      this.swapwithHead(tabIsHead ? tab2 : tab);
    } else if (tabIsTail || tab2IsTail) {
      this.swapWithTail(tabIsTail ? tab2 : tab);
    }
    return this.head;
  }

  public isEmpty() {
    return this.size === 0;
  }

  [Symbol.iterator]() {
    let item = this.head;
    return {
      next() {
        if (item) {
          const ret = { value: item, done: false };
          item = item.next;
          return ret;
        } else {
          return { value: undefined, done: true };
        }
      }
    };
  }
}