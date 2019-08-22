import Tab from './Tab';

// describe the Tabs
export default class Tabs {
  private _size = 0;
  private _head: Tab = null;
  private _tail: Tab = null;

  // get tabs first item
  get head() {
    return this._head;
  }

  // get tabs last item
  get tail() {
    return this._tail;
  }

  // get tabs size
  get size() {
    return this._size;
  }

  // check tab is head whether or not
  private _isHead(tab) {
    return this._head === tab;
  }

  // check tab is tail whether or not
  private _isTail(tab) {
    return this._tail === tab;
  }

  // reComputed the tabs size
  private reComputedSize() {
    let item = this._head;
    this._size = 0;
    while (item) {
      this._size = this.size + 1;
      item = item.next;
    }
  }

  // add tab to tabs
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
    return this;
  }

  // remove tab from tabs
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

  // remove all saved status tab
  public removeSavedTab() {
    let item = this._head;
    while (item) {
      item.saved && this.removeTab(item);
      item = item.next;
    }
    return this.head;
  }

  // empty tabs
  public removeAll() {
    this._head = null;
    this._tail = null;
    this._size = 0;
    return this._head;
  }

  // rremove tabs on the left side of `tab`
  public removeLeft(tab: Tab) {
    const isHead = this._isHead(tab);
    const isTail = this._isTail(tab);

    this._head = tab;
    this._head.prev = null;
    isHead && isTail && (this._tail = this._head);

    this.reComputedSize();
    return this.head;
  }

  // rremove tabs on the right side of `tab`
  public removeRight(tab: Tab) {
    const isHead = this._isHead(tab);
    const isTail = this._isTail(tab);

    this._tail = tab;
    this._tail.next = null;
    isHead && isTail && (this._head = this._tail);

    this.reComputedSize();
    return this.head;
  }

  // swap two tab position
  private swapBetween(tab, tab2) {
    const prevTab = tab.prev;
    const nextTab = tab.next;

    const prevTab2 = tab2.prev;
    const nextTab2 = tab2.next;

    const tempTab = new Tab(tab);
    const tempTab2 = new Tab(tab2);
    if (tab === prevTab2) {
      prevTab.next = tempTab2;
      tempTab2.prev = prevTab;

      tempTab2.next = tempTab;
      tempTab.prev = tempTab2;

      tempTab.next = nextTab2;
      nextTab2.prev = tempTab;
    } else if (tab === nextTab2) {
      prevTab2.next = tempTab;
      tempTab.prev = prevTab2;

      tempTab.next = tempTab2;
      tempTab2.prev = tempTab;
      tempTab2.next = nextTab;
      nextTab.prev = tempTab2;
    } else {
      // prevTab <-> tempTab2 <-> nextTab
      prevTab.next = tempTab2;
      nextTab.prev = tempTab2;
      tempTab2.prev = prevTab;
      tempTab2.next = nextTab;

      // prevTab2 <-> tempTab <-> nextTab2
      prevTab2.next = tempTab;
      nextTab2.prev = tempTab;
      tempTab.prev = prevTab2;
      tempTab.next = nextTab2;
    }
  }

  // swap head item and tail item
  private swapHeadTail() {
    const tempTail = new Tab(this._tail);
    const tempHead = new Tab(this._head);

    const nextHead = this._head.next;
    const prevTail = this._tail.prev;

    if (this.size > 2) {
      this._head = tempTail;
      this._head.next = nextHead;
      nextHead.prev = this._head;

      this._tail = tempHead;
      this._tail.prev = prevTail;
      prevTail.next = this._tail;
    } else {
      this._head = tempTail;
      this._head.prev = null;

      this._tail = tempHead;
      this._tail.next = null;

      this._head.next = this._tail;
      this._tail.prev = this._head;
    }
  }

  // swap tab to head
  private swapWithHead(tab) {
    const tempTab = new Tab(tab);
    const tempHead = new Tab(this._head);

    const nextHead = this._head.next;
    const nextTab = tab.next;
    const prevTab = tab.prev;

    if (nextHead === tab) {
      this._head = tempTab;
      this._head.next = tempHead;
      tempHead.prev = this._head;

      nextTab.prev = tempHead;
      tempHead.next = nextTab;
    } else {
      this._head = tempTab;
      this._head.next = nextHead;

      nextTab.prev = tempHead;
      prevTab.next = tempHead;

      tempHead.prev = prevTab;
      tempHead.next = nextTab;
    }
  }

  // swap tab to tail
  private swapWithTail(tab) {
    const tempTab = new Tab(tab);
    const tempTail = new Tab(this._tail);

    const prevTail = this._tail.prev;
    const prevTab = tab.prev;
    const nextTab = tab.next;

    if (prevTail === tab) {
      // change prevTail ...
      prevTail.prev.next = tempTail;
      tempTail.prev = prevTail.prev;
      tempTail.next = tempTab;
      tempTab.prev = tempTail;

      this._tail = tempTab;
    } else {
      prevTab.next = tempTail;
      tempTail.prev = prevTab;
      nextTab.prev = tempTail;
      tempTail.next = nextTab;

      this._tail = tempTab;
      prevTail.next = this._tail;
      this._tail.prev = prevTail;
    }
  }

  // swap two tab posiiton
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
      this.swapWithHead(tabIsHead ? tab2 : tab);
    } else if (tabIsTail || tab2IsTail) {
      this.swapWithTail(tabIsTail ? tab2 : tab);
    }
    return this.head;
  }

  // check tabs is empty whether or not
  public isEmpty() {
    return this.size === 0;
  }

  // let tabs can use in for..of
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

  // chang tabs to an array
  public getArray() {
    let array = [];
    for (let item of this) {
      array.push(item);
    }
    return array;
  }
}
