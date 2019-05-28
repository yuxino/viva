class Tab {
  saved = true;
  filename = undefined;
  constructor () {}
}

class Tabs {
  set:Set<Tab> = null;
  tail:Tab = null;

  constructor () {
    this.set = new Set();
  }

  addTab () {}

  removeTab () {}

  removeSavedTab () {}

  removeAll () {}

  removeLeft () {}
  
  removeRight () {}
}