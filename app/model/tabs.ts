import Tab from './tab';

export default class Tabs {
  _tabs: Set<Tab> = new Set();

  get tabs() {
    return this._tabs;
  }

  get size() {
    return this.tabs.size;
  }

  private _getTabsArray() {
    return [...this._tabs];
  }

  public findTabIdx(tab) {
    const tabsArray = this._getTabsArray();
    for (let idx in tabsArray) {
      if (tabsArray[idx] === tab) {
        return +idx;
      }
    }
    return -1;
  }

  public addTab(tab: Tab) {
    this._tabs.add(tab);
  }

  public removeTab(tab) {
    this._tabs.delete(tab);
  }

  public removeSavedTab() {
    const tabsArray = this._getTabsArray();
    const savedTabs: Tab[] = tabsArray.filter(({ saved }) => saved);
    savedTabs.forEach(tab => {
      this.removeTab(tab);
    });
  }

  public removeAll() {
    this._tabs = new Set();
  }

  // TODO:
  public removeLeft(tab: Tab) {
    const tabIdx = this.findTabIdx(tab);
    for (let i = 0; i < tabIdx; i++) {}
  }

  // TODO:
  public removeRight(tab: Tab) {
    const tabIdx = this.findTabIdx(tab);
    for (let i = tabIdx; i > this.size; i++) {}
  }

  public isEmpty() {
    return this.size === 0;
  }
}
