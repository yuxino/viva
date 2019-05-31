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
  }

  public removeTab(tab) {
    // this._tabs.delete(tab);
  }

  public swapTab(tab, tab2) {
    // same tab .. don't swap
    if (tab === tab2) return;
    const tabIsHead = this._isHead(tab);
    const tab2IsHead = this._isHead(tab2);
    const tabIsTail = this._isTail(tab);
    const tab2isTail = this._isTail(tab2);

    if (tabIsHead) {
      this._head = tab2;
    } else if (tab2IsHead) {
      this._head = tab;
    }

    if (tabIsTail) {
      this._tail = tab2;
    } else if (tab2isTail) {
      this._tail = tab;
    }

    let temp = tab;
    tab = tab2;
  }

  public removeSavedTab() {
    // const tabsArray = this._getTabsArray();
    // const savedTabs: Tab[] = tabsArray.filter(({ saved }) => saved);
    // savedTabs.forEach(tab => {
    //   this.removeTab(tab);
    // });
  }

  public removeAll() {
    // this._tabs = new Set();
  }

  public removeLeft(tab: Tab) {
    // const tabsArray = this._getTabsArray();
    // const tabIdx = this.findTabIdx(tab);
    // for (let idx = 0; idx < tabIdx; idx++) {
    //   this.removeTab(tabsArray[idx]);
    // }
  }

  public removeRight(tab: Tab) {
    // const tabsArray = this._getTabsArray();
    // const tabIdx = this.findTabIdx(tab);
    // for (let idx = tabIdx + 1; idx <= this.size; idx++) {
    //   this.removeTab(tabsArray[idx]);
    // }
  }

  public isEmpty() {
    // return this.size === 0;
  }

  public has(tab: Tab) {
    // return this.tabs.has(tab);
  }
}
