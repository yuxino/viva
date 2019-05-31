import Tab from './tab';

export default class Tabs {

  _size = 0;
  _head: Tab = null;
  _tail: Tab = null;

  get head () {
    return this._head;
  }

  get tail () {
    return this._tail;
  }

  private _isHead(tab) {
    return this._head === tab
  }

  private _isTail (tab) {
    return this._tail === tab;
  }

  public findTabIdx(tab) {
    // let item = this._head;
    // if (item.next)    
  }

  public addTab(tab: Tab) {
    // init linked list
    if (!this._head) {
      this._head = tab;
    }
    if (!this._tail) {
      this._tail = tab;
    }
    else if (!this._tail.prev) { 

    }
  }

  public removeTab(tab) {
    // this._tabs.delete(tab);
  }

  public swapTab (tab, tab2) {
    // same tab .. don't swap
    if (tab === tab2) return
    const tabIsHead = this._isHead(tab);
    const tab2IsHead = this._isHead(tab2);
    const tabIsTail = this._isTail(tab);
    const tab2isTail = this._isTail(tab2);

    if (tabIsHead) {
      this._head = tab2;
    }
    else if (tab2IsHead) {
      this._head = tab;
    }
    
    if (tabIsTail) {
      this._tail = tab2;
    }
    else if (tab2isTail) {
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
