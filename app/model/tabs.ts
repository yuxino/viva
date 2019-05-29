import Tab from './tab';

export default class Tabs {
  _tabs: Set<Tab> = new Set();
  _tail: Tab = null;

  get tail() {
    return this._tail;
  }

  // TODO: get index in tabs
  findTabIdx(tab) {
    // for (let item in tab) {
    //   if (tab === item) return item;
    // }
    // return null;
  }

  addTab(tab: Tab) {
    this._tabs.add(tab);
  }

  removeTab(tab) {
    this._tabs.delete(tab);
    // TODO: check tail
  }

  removeSavedTab() {
    const tabsArray = [...this._tabs];
    const savedTabs: Tab[] = tabsArray.filter(({ saved }) => saved);
    savedTabs.forEach(this._tabs.delete);
    // TODO: check tail
  }

  removeAll() {
    this._tabs = new Set();
    this._tabs = null;
  }

  removeLeft(tab: Tab) {
    // const tabIdx = this._tabs.
  }

  removeRight(tab: Tab) {
    // const findIdx = this._tabs.
  }

  size() {
    return this._tabs.size;
  }
}
